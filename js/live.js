/* SHine-K live mode — REAL in-browser edge inference on the visitor's webcam.
 * MoveNet MultiPose Lightning (the model evaluated in the paper) runs locally
 * via TensorFlow.js; COCO-17 keypoints stream into the SAME FallSM + REBA
 * pipeline as the simulation. No pixel ever leaves this tab.
 * Fallback: if the camera is unavailable, a synthetic REPLAY sequence drives
 * the identical pipeline so the loop is still demonstrable.
 */
(function (global) {
  'use strict';
  var SK = global.SHineK;

  var L = {
    mode: 'off',            // off | loading | live | replay
    detector: null, stream: null, video: null, cv: null, ctx: null,
    sms: {},                // per-track-id FallSM
    lastState: 'normal', lastAlert: 0, startGen: 0,
    reba: 1, fps: 0, lastT: 0, poseAcc: 0,
    replayT: 0, raf: 0
  };

  function EN() { return global.SHLANG === 'en'; }

  var CDN = [
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.20.0/dist/tf-core.min.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.20.0/dist/tf-converter.min.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.20.0/dist/tf-backend-webgl.min.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js'
  ];

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('load fail: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function setStatus(html, cls) {
    var el = document.getElementById('live-status');
    if (el) { el.innerHTML = html; el.className = 'live-status ' + (cls || ''); }
  }

  var BONES = [[15,13],[13,11],[16,14],[14,12],[11,12],[5,11],[6,12],[5,6],[5,7],[7,9],[6,8],[8,10]];

  function drawSkeleton(ctx, kps, color, scaleX, scaleY) {
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    BONES.forEach(function (b) {
      var p = kps[b[0]], q = kps[b[1]];
      if (p[2] > 0.3 && q[2] > 0.3) {
        ctx.beginPath();
        ctx.moveTo(p[0] * scaleX, p[1] * scaleY);
        ctx.lineTo(q[0] * scaleX, q[1] * scaleY);
        ctx.stroke();
      }
    });
    if (kps[5][2] > 0.3 && kps[6][2] > 0.3 && kps[0][2] > 0.3) {
      var sx = (kps[5][0] + kps[6][0]) / 2, sy = (kps[5][1] + kps[6][1]) / 2;
      ctx.beginPath(); ctx.moveTo(sx * scaleX, sy * scaleY); ctx.lineTo(kps[0][0] * scaleX, kps[0][1] * scaleY); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(kps[0][0] * scaleX, kps[0][1] * scaleY, 4, 0, 6.283); ctx.fill();
    }
    kps.forEach(function (k) {
      if (k[2] > 0.3) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(k[0] * scaleX, k[1] * scaleY, 2.4, 0, 6.283); ctx.fill();
      }
    });
  }

  function angle(a, b, c) { // at b, degrees
    var v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    var d = (v1[0] * v2[0] + v1[1] * v2[1]) /
      (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) + 1e-9);
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  }

  function analyse(kps, W, H, now, personId) {
    if (!L.sms[personId]) {
      L.sms[personId] = new SK.FallSM({ sens: 1.0 });
      var keys = Object.keys(L.sms);           // bound per-track machines
      while (keys.length > 12) { delete L.sms[keys[0]]; keys.shift(); }
    }
    var sm = L.sms[personId];
    var st = sm.step(kps, W, H, now);

    // simplified REBA (same approximation as the paper's pose module)
    var trunk = sm.tilt;
    var arm = 0;
    if (kps[11][2] > 0.3 && kps[5][2] > 0.3 && kps[7][2] > 0.3) {
      arm = Math.max(0, 180 - angle(kps[11], kps[5], kps[7]));
    }
    L.reba = SK.rebaLevel(trunk, arm);

    // event edge-detection → shared bus (wall clock for the cooldown —
    // `now` may be replay-relative and must only drive the state machine)
    var wall = performance.now();
    if ((st === 'fall' || st === 'inactive') && wall - L.lastAlert > 4000) {
      L.lastAlert = wall;
      if (global.SHSim) global.SHSim.ingestLive(st === 'fall' ? 'fall' : 'inactive',
        { tilt: Math.round(sm.tilt), src: L.mode.toUpperCase() });
      announce(EN() ? (st === 'fall' ? 'Fall detected — alert sent to control center' : 'Inactivity detected — alert sent to control center')
                    : (st === 'fall' ? '낙상 감지 — 관제센터에 알림 전송됨' : '무동작 감지 — 관제센터에 알림 전송됨'));
    }
    L.lastState = st;
    return { state: st, trunk: trunk, arm: arm };
  }

  /* assistive-tech announcement — only on state change, never per frame */
  function announce(msg) {
    var el = document.getElementById('sr-announce');
    if (el) el.textContent = msg;
  }

  function hud(res, persons) {
    var el = document.getElementById('live-hud');
    if (!el) return;
    var map = EN()
      ? { normal: ['NORMAL', 'ok'], warn: ['WARN', 'warn'], fall: ['FALL!', 'crit'], inactive: ['INACTIVE!', 'crit'], sedentary: ['SEDENTARY', 'warn'] }
      : { normal: ['정상', 'ok'], warn: ['주의', 'warn'], fall: ['낙상!', 'crit'], inactive: ['무동작!', 'crit'], sedentary: ['장시간 정지', 'warn'] };
    var m = map[res.state] || map.normal;
    el.innerHTML =
      '<span class="badge ' + m[1] + '">' + m[0] + (EN() ? '' : ' · ' + res.state.toUpperCase()) + '</span>' +
      '<span class="hud-m">REBA L' + L.reba + '</span>' +
      '<span class="hud-m">' + persons + (EN() ? 'p · ' : '명 · ') + L.fps.toFixed(0) + ' FPS</span>' +
      '<span class="hud-m mono">tilt ' + Math.round(res.trunk) + '°</span>';
  }

  /* ── LIVE loop ── */
  function liveLoop() {
    if (L.mode !== 'live') return;
    var gen = L.startGen;
    L.detector.estimatePoses(L.video, { maxPoses: 5 }).then(function (poses) {
      if (L.mode !== 'live' || gen !== L.startGen) return; // stopped mid-flight
      var now = performance.now();
      L.fps = 1000 / Math.max(1, now - L.lastT); L.lastT = now;
      var vw = L.video.videoWidth || 640, vh = L.video.videoHeight || 480;
      L.cv.width = L.cv.clientWidth; L.cv.height = L.cv.clientHeight;
      var sx = L.cv.width / vw, sy = L.cv.height / vh;
      L.ctx.clearRect(0, 0, L.cv.width, L.cv.height);

      var best = null;
      poses.forEach(function (p, i) {
        var kps = p.keypoints.map(function (k) { return [k.x, k.y, k.score]; });
        var res = analyse(kps, vw, vh, now, p.id != null ? p.id : i);
        var color = res.state === 'fall' || res.state === 'inactive' ? '#f43f5e' :
                    res.state === 'warn' ? '#f59e0b' : '#34d399';
        drawSkeleton(L.ctx, kps, color, sx, sy);
        if (!best) best = res;
      });
      if (best) hud(best, poses.length);

      // event-only uplink accounting (pose messages, no pixels)
      L.poseAcc += 1;
      if (L.poseAcc >= 4 && global.SHSim && poses.length) {
        L.poseAcc = 0;
        global.SHSim.ingestLivePose(poses.length);
      }
      L.raf = requestAnimationFrame(liveLoop);
    }).catch(function (e) {
      if (L.mode !== 'live' || gen !== L.startGen) return;
      setStatus((EN() ? 'inference error: ' : '추론 오류: ') + e.message, 'err');
      L.raf = requestAnimationFrame(liveLoop);
    });
  }

  /* ── REPLAY: synthetic fall sequence through the same pipeline ── */
  function replayKps(t, W, H) {
    // 10 s loop: stand(0-3) → walk(3-5.5) → fall(5.5-6.2) → lying(6.2-10)
    var phase = t % 10;
    var cx = W * (0.3 + 0.04 * Math.sin(t * 0.7)), gy = H * 0.86;
    var Hb = H * 0.62;
    var lie = phase < 5.5 ? 0 : phase < 6.2 ? (phase - 5.5) / 0.7 : 1;
    var walk = phase >= 3 && phase < 5.5 ? Math.sin(t * 6) : 0;
    if (phase >= 3 && phase < 5.5) cx += (phase - 3) * W * 0.06;
    if (phase >= 5.5) cx += 2.5 * W * 0.06;

    var hw = Hb * 0.115, ww = Hb * 0.075;
    var pts = [
      [0.05, 0.97], [0.04, 0.99], [0.02, 0.99], [0, 0.96], [-0.02, 0.96],
      [0.115, 0.82], [-0.115, 0.82],
      [0.16 + walk * 0.05, 0.66], [-0.16 - walk * 0.05, 0.66],
      [0.18 + walk * 0.08, 0.52], [-0.18 - walk * 0.08, 0.52],
      [0.075, 0.52], [-0.075, 0.52],
      [0.075 + walk * 0.12, 0.27], [-0.075 - walk * 0.12, 0.27],
      [0.075 + walk * 0.2, 0.01], [-0.075 - walk * 0.2, 0.01]
    ];
    var ang = lie * 1.38;   // deep enough to trip the deployed tilt/aspect thresholds
    return pts.map(function (p) {
      var lx = p[0] * Hb, ly = p[1] * Hb;
      var rx = lx * Math.cos(ang * 0.4) + ly * Math.sin(ang);
      var ry = ly * Math.cos(ang) - lx * Math.sin(ang) * 0.2;
      return [cx + rx, gy - ry, 0.92];
    });
  }

  var replayLast = 0;
  function replayLoop(ts) {
    if (L.mode !== 'replay') return;
    if (!replayLast) replayLast = ts;
    var dt = Math.min(0.05, (ts - replayLast) / 1000);
    replayLast = ts;
    L.replayT += dt;

    // virtual dimensions never collapse to 0 when the route is hidden —
    // the FSM keeps stepping and events keep reaching the twin/agents panels
    var W = L.cv.clientWidth || 640, H = L.cv.clientHeight || 480;
    var visible = L.cv.clientWidth > 0;
    if (visible) { L.cv.width = W; L.cv.height = H; }
    var ctx = L.ctx;
    if (!visible) {
      var kpsH = replayKps(L.replayT, W, H);
      analyse(kpsH, W, H, L.replayT * 1000, 'replay');
      L.poseAcc += dt * 8;
      if (L.poseAcc >= 1 && global.SHSim) { L.poseAcc = 0; global.SHSim.ingestLivePose(1); }
      L.raf = requestAnimationFrame(replayLoop);
      return;
    }
    ctx.fillStyle = '#04070d'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    for (var gx = 0; gx < W; gx += 24) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, H * 0.87); ctx.lineTo(W, H * 0.87);
    ctx.strokeStyle = 'rgba(148,163,184,0.25)'; ctx.stroke();

    var kps = replayKps(L.replayT, W, H);
    var res = analyse(kps, W, H, L.replayT * 1000, 'replay');
    var color = res.state === 'fall' || res.state === 'inactive' ? '#f43f5e' :
                res.state === 'warn' ? '#f59e0b' : '#34d399';
    drawSkeleton(ctx, kps, color, 1, 1);
    hud(res, 1);
    L.fps = 60;

    ctx.fillStyle = 'rgba(245,158,11,0.9)';
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.fillText('REPLAY · SYNTHETIC', 10, 16);

    L.poseAcc += dt * 8;
    if (L.poseAcc >= 1 && global.SHSim) { L.poseAcc = 0; global.SHSim.ingestLivePose(1); }
    L.raf = requestAnimationFrame(replayLoop);
  }

  /* background heartbeat for REPLAY — rAF pauses in hidden tabs, timers don't.
   * Also active under ?autoreplay (headless captures / kiosk demos). */
  setInterval(function () {
    if (L.mode === 'replay' && (document.hidden || /[?&]autoreplay/.test(location.search))) {
      L.replayT += 1.0;
      var kps = replayKps(L.replayT, 640, 480);
      analyse(kps, 640, 480, L.replayT * 1000, 'replay');
      if (global.SHSim) global.SHSim.ingestLivePose(1);
    }
  }, 1000);

  function stop() {
    L.mode = 'off';
    L.startGen++;                       // invalidate any in-flight start() chain
    cancelAnimationFrame(L.raf);
    if (L.stream) { L.stream.getTracks().forEach(function (t) { t.stop(); }); L.stream = null; }
    if (L.video) L.video.style.display = 'none';
    if (L.ctx && L.cv) { L.cv.style.transform = ''; L.ctx.clearRect(0, 0, L.cv.width, L.cv.height); }
    if (global.SHSim) global.SHSim.setLiveTile(false);
    var el = document.getElementById('live-hud');
    if (el) el.innerHTML = '';
    setStatus(EN() ? 'OFF' : '꺼짐 · OFF', '');
    var btn = document.getElementById('btn-live');
    if (btn) btn.lastChild.textContent = btn.dataset.idleLabel || (EN() ? ' Connect my camera as CAM-07' : ' 내 카메라를 CAM-07로 연결');
  }

  function startReplay(reason) {
    L.startGen++;                       // kill any pending live start() chain
    L.mode = 'replay';
    L.sms = {}; L.replayT = 0; replayLast = 0; L.lastAlert = 0;
    if (L.video) L.video.style.display = 'none';
    if (L.cv) L.cv.style.transform = 'none';   // replay scene is not mirrored
    setStatus((reason ? reason + ' — ' : '') + (EN() ? 'synthetic REPLAY driving the same pipeline' : '합성 REPLAY로 동일 파이프라인 시연 중'), 'warn');
    if (global.SHSim) global.SHSim.setLiveTile(true);
    L.raf = requestAnimationFrame(replayLoop);
  }

  function start() {
    if (L.mode !== 'off') { stop(); return; }   // toggles live/replay AND cancels loading
    L.video = document.getElementById('live-video');
    L.cv = document.getElementById('live-canvas');
    L.ctx = L.cv.getContext('2d');
    L.cv.style.transform = '';
    L.mode = 'loading'; L.sms = {}; L.lastAlert = 0;
    var gen = ++L.startGen;
    var btn = document.getElementById('btn-live');
    if (btn) {
      if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.lastChild.textContent;
      btn.lastChild.textContent = EN() ? ' STOP' : ' 연결 해제 · STOP';
    }

    setStatus(EN() ? 'Loading TF.js + MoveNet MultiPose…' : 'TF.js + MoveNet MultiPose 로딩 중…', 'load');
    var chain = Promise.resolve();
    if (!global.poseDetection) {
      CDN.forEach(function (src) { chain = chain.then(function () { return loadScript(src); }); });
    }
    chain.then(function () {
      if (gen !== L.startGen) throw { stale: true };
      return global.tf.setBackend('webgl').then(function () { return global.tf.ready(); });
    }).then(function () {
      if (gen !== L.startGen) throw { stale: true };
      return global.poseDetection.createDetector(
        global.poseDetection.SupportedModels.MoveNet,
        { modelType: global.poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING, enableTracking: true }
      );
    }).then(function (det) {
      if (gen !== L.startGen) throw { stale: true };
      L.detector = det;
      setStatus(EN() ? 'Requesting camera permission…' : '카메라 권한 요청 중…', 'load');
      return navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    }).then(function (stream) {
      if (gen !== L.startGen) { stream.getTracks().forEach(function (t) { t.stop(); }); throw { stale: true }; }
      L.stream = stream;
      L.video.srcObject = stream;
      L.video.style.display = 'block';
      return L.video.play();
    }).then(function () {
      if (gen !== L.startGen) throw { stale: true };
      L.mode = 'live';
      setStatus(EN() ? '<b>● LIVE</b> — frames never leave this tab · events only' : '<b>● LIVE</b> — 영상은 이 탭 밖으로 나가지 않습니다 · 이벤트만 전송', 'live');
      if (global.SHSim) global.SHSim.setLiveTile(true);
      liveLoop();
    }).catch(function (e) {
      if (e && e.stale) return;          // superseded by stop()/replay — stay silent
      console.warn('live mode fallback:', e);
      if (gen !== L.startGen) return;
      if (L.detector && !L.stream) startReplay((EN() ? 'camera unavailable (' : '카메라 사용 불가(') + (e.name || 'error') + ')');
      else startReplay(EN() ? 'model/network unavailable' : '모델/네트워크 사용 불가');
    });
  }

  global.SHLive = { start: start, stop: stop, startReplay: startReplay, state: L };
})(window);

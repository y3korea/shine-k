/* SHine-K control-twin simulation engine.
 * Simulated workers are rendered as COCO-17 skeletons and — crucially —
 * their generated keypoints are fed through the SAME deployed FallSM
 * (js/shinek-core.js) that the paper validated on URFD. Simulation and
 * live webcam therefore share one detection pipeline and one event bus.
 */
(function (global) {
  'use strict';
  var SK = global.SHineK;

  /* ───────────────────────── world model ───────────────────────── */

  var ZONES = [
    { id: 'press',   ko: '프레스',  en: 'PRESS',     x: 30,  y: 40,  w: 200, h: 170, risk: 'high' },
    { id: 'weld',    ko: '용접',    en: 'WELDING',   x: 250, y: 40,  w: 190, h: 170, risk: 'high' },
    { id: 'assembly',ko: '조립',    en: 'ASSEMBLY',  x: 460, y: 40,  w: 220, h: 170, risk: 'mid' },
    { id: 'logis',   ko: '물류',    en: 'LOGISTICS', x: 30,  y: 235, w: 300, h: 130, risk: 'mid' },
    { id: 'rest',    ko: '휴게',    en: 'REST',      x: 350, y: 235, w: 140, h: 130, risk: 'low' },
    { id: 'qc',      ko: '검사',    en: 'QC',        x: 510, y: 235, w: 170, h: 130, risk: 'low' }
  ];

  var SITES = [
    { id: 'GM-A', ko: '구미 A · 프레스', en: 'GUMI-A PRESS', workers: 8, prefix: 'GA', online: true },
    { id: 'GM-B', ko: '구미 B · 용접', en: 'GUMI-B WELD', workers: 6, prefix: 'GB', online: true },
    { id: 'CC-C', ko: '칠곡 C · 조립', en: 'CHILGOK-C ASM', workers: 5, prefix: 'CC', online: true }
  ];

  /* seeded PRNG (mulberry32) — deterministic demo, seed shown in footer */
  var SEED = 20260722;
  var _rng = (function (a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  })(SEED);

  var AGENTS = [
    { id: 'a-pose',  group: 'sense',   ko: '자세 감시',   en: 'Pose Sentinel' },
    { id: 'a-fall',  group: 'sense',   ko: '낙상 감지',   en: 'Fall Watch' },
    { id: 'a-ppe',   group: 'sense',   ko: 'PPE 판독',    en: 'PPE Reader' },
    { id: 'a-fire',  group: 'sense',   ko: '화재 픽셀',   en: 'Fire Pixel' },
    { id: 'a-fuse',  group: 'judge',   ko: '위험 융합',   en: 'Risk Fusion' },
    { id: 'a-hist',  group: 'judge',   ko: '이력 분석',   en: 'History' },
    { id: 'a-prio',  group: 'judge',   ko: '우선순위',    en: 'Priority' },
    { id: 'a-nudge', group: 'act',     ko: '행동 넛지',   en: 'Nudge' },
    { id: 'a-rest',  group: 'act',     ko: '휴식 처방',   en: 'Recovery' },
    { id: 'a-task',  group: 'act',     ko: '작업 조정',   en: 'Rotation' },
    { id: 'a-egen',  group: 'connect', ko: '응급 연계',   en: '119 / e-Gen', design: true },
    { id: 'a-roll',  group: 'connect', ko: '대피 점호',   en: 'Roll-call' }
  ];

  var KINDS = {
    fall:      { ko: '낙상',        en: 'FALL',        sev: 'crit' },
    inactive:  { ko: '무동작',      en: 'INACTIVE',    sev: 'crit' },
    ppe:       { ko: 'PPE 미착용',  en: 'PPE MISSING', sev: 'warn' },
    fire:      { ko: '화재 조기감지', en: 'FIRE',      sev: 'crit' },
    heat:      { ko: '온열 위험',   en: 'HEAT',        sev: 'warn' },
    posture:   { ko: '고위험 자세', en: 'POSTURE',     sev: 'warn' },
    zone:      { ko: '구역 침입',   en: 'ZONE',        sev: 'warn' },
    health:    { ko: '심박 이상',   en: 'VITALS',      sev: 'warn' },
    fatigue:   { ko: '과로 위험',   en: 'FATIGUE',     sev: 'warn' },
    recover:   { ko: '정상 복귀',   en: 'RECOVERED',   sev: 'ok' }
  };

  /* console language: 'en' via ?en or persisted toggle (default ko) */
  var EN = /[?&]en\b/.test(location.search) ||
           (function () { try { return localStorage.getItem('shinek_console_lang') === 'en'; } catch (e) { return false; } })();
  global.SHLANG = EN ? 'en' : 'ko';

  function rand(a, b) { return a + _rng() * (b - a); }
  function pick(arr) { return arr[Math.floor(_rng() * arr.length)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function makeWorker(i, site) {
    var z = pick(ZONES.filter(function (z) { return z.id !== 'rest'; }));
    var w = {
      id: site.prefix + '-' + pad2(i + 1), site: site, zone: z,
      x: rand(z.x + 20, z.x + z.w - 20), y: rand(z.y + 30, z.y + z.h - 15),
      tx: 0, ty: 0, speed: rand(14, 22),
      pose: 'work', phase: rand(0, 6.28), gait: rand(5, 7),
      facing: Math.random() < 0.5 ? 1 : -1,
      hr: Math.round(rand(68, 84)), hrBase: 0,
      load: rand(8, 38), workedMin: rand(40, 200),
      reba: 1, ppe: true, state: 'normal',
      fallT: -1, downT: 0, heat: false,
      sm: new SK.FallSM({ sens: 1.0 }),
      nextThink: rand(2, 6), still: 0
    };
    w.hrBase = w.hr;
    w.tx = w.x; w.ty = w.y;
    return w;
  }

  /* ─────────────────── COCO-17 skeleton generator ─────────────────── */
  /* Returns 17 [x,y,score] in map pixels (y down), driven by pose state. */

  function workerKeypoints(w, t) {
    var H = 34;                       // body height px
    var lie = 0;                      // 0 upright → 1 lying
    if (w.fallT >= 0) lie = clamp((t - w.fallT) / 0.55, 0, 1);
    var bend = 0;                     // trunk forward pitch (rad)
    var armR = 0.25;                  // arm raise factor
    var legSwing = 0, armSwing = 0, bob = 0;

    if (w.pose === 'walk') {
      legSwing = Math.sin(w.phase) * 0.30;
      armSwing = -Math.sin(w.phase) * 0.22;
      bob = Math.abs(Math.sin(w.phase)) * 1.2;
      bend = 0.06;
    } else if (w.pose === 'work') {
      bend = 0.38 + 0.18 * Math.sin(w.phase * 0.5);
      armR = 0.65 + 0.2 * Math.sin(w.phase * 0.5 + 1);
    } else if (w.pose === 'idle') {
      bend = 0.04 + 0.02 * Math.sin(w.phase * 0.3);
    } else if (w.pose === 'heat') {
      bend = 0.22 + 0.10 * Math.sin(w.phase * 0.2);
      bob = Math.sin(w.phase * 0.2) * 0.8;
    }

    // local skeleton, origin at ground under pelvis, y up, then rotate for lie
    var hipY = 0.52 * H - bob, shY = 0.82 * H - bob, headY = 0.97 * H - bob;
    var hw = 0.115 * H, ww = 0.075 * H;
    var f = w.facing;

    var P = [];                        // local [x, y(up)]
    P[0]  = [0.06 * H * f, headY + 0.03 * H - bend * 6];        // nose
    P[1]  = [0.04 * H * f, headY + 0.05 * H - bend * 6];
    P[2]  = [0.02 * H * f, headY + 0.05 * H - bend * 6];
    P[3]  = [0.00 * H * f, headY + 0.02 * H - bend * 6];
    P[4]  = [-0.02 * H * f, headY + 0.02 * H - bend * 6];
    var bx = bend * 0.45 * H * f;                                // trunk shift from bend
    P[5]  = [ hw + bx * 0.9, shY - bend * 4];                    // L shoulder
    P[6]  = [-hw + bx * 0.9, shY - bend * 4];                    // R shoulder
    var ax = (armR * 0.28 * H + armSwing * H * 0.2) * f;
    P[7]  = [ hw + bx + ax * 0.5,  shY - 0.16 * H];              // elbows
    P[8]  = [-hw + bx - armSwing * H * 0.2 * f + ax * 0.2, shY - 0.16 * H];
    P[9]  = [ hw + bx + ax,        shY - 0.30 * H + armR * 6];   // wrists
    P[10] = [-hw + bx - armSwing * H * 0.3 * f, shY - 0.30 * H];
    P[11] = [ ww, hipY]; P[12] = [-ww, hipY];                    // hips
    P[13] = [ ww + legSwing * H * 0.5 * f, 0.27 * H];            // knees
    P[14] = [-ww - legSwing * H * 0.5 * f, 0.27 * H];
    P[15] = [ ww + legSwing * H * f, 0.5];                       // ankles
    P[16] = [-ww - legSwing * H * f, 0.5];

    // nose forward relative to spine when bending
    P[0][0] += bend * 0.55 * H * f;
    for (var e = 1; e <= 4; e++) P[e][0] += bend * 0.5 * H * f;

    var kps = [];
    var ang = lie * 1.32;                         // ~76°: lying but limbs keep structure
    var cos = Math.cos(ang), sin = Math.sin(ang);
    // human micro-movement so a working (not collapsed) body never reads as
    // "inactive" to the deployed state machine — same as real muscle sway
    var jit = lie > 0 ? 0 : (w.pose === 'work' ? 3.2 : w.pose === 'walk' ? 2.2 : 2.5);
    for (var i = 0; i < 17; i++) {
      var lx = P[i][0], ly = P[i][1];
      var rx = lx * Math.cos(ang * 0.4) + ly * sin * f;
      var ry = ly * cos - lx * sin * f * 0.15;
      rx += Math.sin(w.phase * 5.1 + i * 1.7) * jit * 0.5;
      ry += Math.cos(w.phase * 4.3 + i * 2.3) * jit * 0.35;
      kps.push([w.x + rx, w.y - ry, 0.9]);
    }
    return kps;
  }

  /* ───────────────────────── engine ───────────────────────── */

  var S = {
    t: 0, speed: 1, running: true,
    site: SITES[0], workersBySite: {}, workers: [],
    allEvents: [], events: [], eventsToday: { crit: 0, warn: 0, total: 0 },
    fire: null, heatOn: false, wbgt: 26.4,
    uplinkBps: 0, uplinkTotal: 0, msgCount: 0,
    liveTile: null, el: {}, lang: 'ko',
    focusWorker: null, onEvent: null,
    autopilot: false, apStep: 0, apTimer: null, seed: SEED
  };

  var POSE_MSG_BYTES = 146;   // {type:'pose',id,17×[x,y,s]} compact JSON
  var POSE_HZ = 8;
  var VIDEO_KBPS = 2500;      // H.264 720p baseline for comparison

  function speak(txt) {
    try {
      if (!global.speechSynthesis) return;
      var u = new SpeechSynthesisUtterance(txt);
      u.lang = EN ? 'en-US' : 'ko-KR'; u.rate = 1.05;
      global.speechSynthesis.speak(u);
    } catch (e) { /* non-fatal */ }
  }

  function emit(kind, workerId, source, extra, siteId) {
    var k = KINDS[kind];
    var ev = {
      kind: kind, sev: k.sev, worker: workerId || null,
      site: source === 'LIVE' ? 'LIVE' : (siteId || S.site.id), source: source || 'SIM',
      ts: new Date(), extra: extra || null
    };
    S.events.unshift(ev);
    if (S.events.length > 60) S.events.pop();
    S.allEvents.push(ev);
    if (S.allEvents.length > 400) S.allEvents.shift();
    if (k.sev === 'crit') S.eventsToday.crit++;
    if (k.sev === 'warn') S.eventsToday.warn++;
    S.eventsToday.total++;
    pushUplink({ type: 'alert', kind: kind, id: workerId, site: ev.site, src: ev.source }, true);
    renderFeed(); animateAgents(kind); renderKpi();
    if (k.sev === 'crit' && S.ttsOn) speak(EN ? (k.en + ' detected. Check ' + (workerId || 'site') + '.') : (k.ko + ' 발생. ' + (workerId || '') + ' 확인 바랍니다.'));
    if (navigator.vibrate && k.sev === 'crit') navigator.vibrate([120, 60, 120]);
    if (S.onEvent) S.onEvent(ev);
  }

  /* uplink inspector — every message that would cross the network.
   * DOM render is throttled in the frame loop (upDirty), not per message. */
  var upLog = [], upDirty = false, upLastRender = 0;
  function pushUplink(obj, highlight) {
    var s = JSON.stringify(obj);
    S.msgCount++;
    S.uplinkTotal += s.length;
    upLog.unshift({ s: s, hl: !!highlight, t: Date.now() });
    if (upLog.length > 14) upLog.pop();
    upDirty = true;
  }
  function renderUplink(now) {
    if (!upDirty || !S.el.uplink) return;
    if (now - upLastRender < 120) return;
    upLastRender = now; upDirty = false;
    S.el.uplink.innerHTML = upLog.map(function (m) {
      return '<div class="up-line' + (m.hl ? ' hl' : '') + '">' +
        m.s.replace(/"(\w+)":/g, '"<i>$1</i>":') + '</div>';
    }).join('');
  }

  /* ───────────────────── behaviours & scenarios ───────────────────── */

  function think(w) {
    if (w.state !== 'normal') return;
    var r = Math.random();
    if (r < 0.35) {                       // wander to a new spot in zone (or nearby zone)
      var z = Math.random() < 0.8 ? w.zone : pick(ZONES);
      w.zone = z;
      w.tx = rand(z.x + 18, z.x + z.w - 18);
      w.ty = rand(z.y + 28, z.y + z.h - 12);
      w.pose = 'walk';
    } else if (r < 0.8) { w.pose = 'work'; }
    else { w.pose = 'idle'; }
    w.nextThink = rand(3, 9);
  }

  function scenarioFall() {
    var w = pick(S.workers.filter(function (w) { return w.state === 'normal'; }));
    if (!w) return;
    w.state = 'falling'; w.pose = 'idle';
    w.fallT = S.t; w.tx = w.x; w.ty = w.y;
    focus(w);
  }
  function scenarioPpe() {
    var w = pick(S.workers.filter(function (w) { return w.state === 'normal' && w.ppe; }));
    if (!w) return;
    w.ppe = false;
    setTimeout(function () { emit('ppe', w.id, 'SIM'); w.state = 'ppe'; }, 1200 / S.speed);
    focus(w);
  }
  function scenarioFire() {
    if (S.fire) return;
    var z = pick([ZONES[0], ZONES[1]]);
    S.fire = { zone: z, t0: S.t, detected: false };
  }
  function scenarioHeat() {
    if (S.heatOn) return;
    S.heatOn = true;
    var w = pick(S.workers.filter(function (w) { return w.state === 'normal'; }));
    setTimeout(function () {
      if (w && w.state === 'normal') {
        w.state = 'heat'; w.pose = 'heat';
        emit('heat', w.id, 'SIM', { wbgt: S.wbgt.toFixed(1) });
        focus(w);
      }
    }, 2600 / S.speed);
  }
  function scenarioInactive() {
    var w = pick(S.workers.filter(function (w) { return w.state === 'normal'; }));
    if (!w) return;
    w.state = 'freeze'; w.pose = 'idle'; w.tx = w.x; w.ty = w.y;
    w.freezeT = S.t;
    focus(w);
  }
  function scenarioReset() {
    S.workers.forEach(function (w) {
      w.state = 'normal'; w.fallT = -1; w.ppe = true; w.pose = 'work';
      w.sm.reset(); w.hr = w.hrBase; w.freezeT = null;
    });
    S.fire = null; S.heatOn = false; S.wbgt = 26.4;
    emit('recover', null, 'SIM');
  }

  function focus(w) {
    S.focusWorker = w;
    renderWorkerCard();
  }

  /* ───────────────────────── tick ───────────────────────── */

  function tick(dt) {
    S.t += dt;
    var now = S.t * 1000;

    if (S.heatOn) S.wbgt = Math.min(33.8, S.wbgt + dt * 0.35);
    else S.wbgt = Math.max(26.4, S.wbgt - dt * 0.2);

    // fire progression → camera pixel detector fires after ~2.5 s
    if (S.fire && !S.fire.detected && S.t - S.fire.t0 > 2.5) {
      S.fire.detected = true;
      emit('fire', null, 'SIM', { zone: S.fire.zone.id });
    }

    var all = [];
    Object.keys(S.workersBySite).forEach(function (k) { all = all.concat(S.workersBySite[k]); });
    if (!all.length) all = S.workers;

    all.forEach(function (w) {
      w.phase += dt * w.gait * (w.pose === 'walk' ? 1.6 : 1);

      // movement
      if (w.state === 'normal' || w.state === 'ppe' || w.state === 'heat') {
        var dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy);
        if (d > 2) {
          var sp = w.speed * (w.state === 'heat' ? 0.4 : 1) * dt;
          w.x += dx / d * sp; w.y += dy / d * sp;
          w.facing = dx >= 0 ? 1 : -1;
          if (w.pose !== 'walk') w.pose = 'walk';
        } else if (w.pose === 'walk') w.pose = 'work';
        w.nextThink -= dt;
        if (w.nextThink <= 0) think(w);
      }

      // falling animation → after impact, remain down (FallSM will confirm)
      if (w.state === 'falling' && S.t - w.fallT > 0.6) w.state = 'down';

      // heart rate model
      var target = w.hrBase +
        (w.pose === 'walk' ? 14 : w.pose === 'work' ? 8 : 0) +
        (w.state === 'heat' || S.heatOn ? 26 : 0) +
        (w.state === 'down' || w.state === 'falling' ? 30 : 0);
      w.hr += (target - w.hr) * dt * 0.5 + rand(-0.8, 0.8);

      // REBA from generated pose
      var trunkDeg = (w.pose === 'work' ? 30 + 12 * Math.sin(w.phase * 0.5) : w.pose === 'heat' ? 18 : 4);
      var armDeg = (w.pose === 'work' ? 55 + 18 * Math.sin(w.phase * 0.5 + 1) : 12);
      w.reba = SK.rebaLevel(trunkDeg, armDeg);

      // ── the deployed pipeline: generated skeleton → FallSM ──
      // stepped at ~15 Hz sensing cadence (per-frame displacement at 60 fps
      // would read as half the real movement and misclassify stillness)
      var kps = workerKeypoints(w, S.t);
      w.kps = kps;
      w.smAcc = (w.smAcc || 0) + dt;
      var st = w.sm.state;
      if (w.smAcc >= 0.066) {
        w.smAcc = 0;
        st = w.sm.step(kps, 700, 380, now);
      }
      if (st === 'fall' && !w.alertedFall && (w.state === 'down' || w.state === 'falling')) {
        w.alertedFall = true;
        emit('fall', w.id, 'SIM', { tilt: Math.round(w.sm.tilt), latency: '0.7s' }, w.site.id);
      }
      if ((w.state === 'freeze') && w.freezeT && (S.t - w.freezeT) > 4 && !w.alertedInactive) {
        // sim time-compressed: the real threshold is 12 s of stillness
        w.alertedInactive = true;
        emit('inactive', w.id, 'SIM', { still: '12s+' }, w.site.id);
      }
      if (w.state === 'normal') { w.alertedFall = false; w.alertedInactive = false; }

      // health alert on sustained tachycardia (wide hysteresis — one alert per episode)
      if (w.hr > 118 && !w.alertedHr) { w.alertedHr = true; emit('health', w.id, 'SIM', { hr: Math.round(w.hr) }, w.site.id); }
      if (w.hr < 96) w.alertedHr = false;

      // cumulative workload → fatigue (과로) model:
      // load rises with high-REBA work / heat, decays with idle/rest-zone time
      var loading = (w.pose === 'work' ? 1.6 + (w.reba - 1) * 0.9 : w.pose === 'walk' ? 0.7 : -2.2) +
                    (S.heatOn ? 2.4 : 0);
      if (w.zone.id === 'rest') loading = -4.5;
      w.load = clamp(w.load + loading * dt * 0.14, 0, 100);
      w.workedMin += dt / 6; // compressed session clock
      if (w.load > 78 && !w.alertedFatigue) {
        w.alertedFatigue = true;
        emit('fatigue', w.id, 'SIM', { load: Math.round(w.load), workedMin: Math.round(w.workedMin) }, w.site.id);
        // Act loop: prescribe rest — worker walks to rest zone
        var rz = ZONES.find(function (z) { return z.id === 'rest'; });
        w.zone = rz; w.tx = rand(rz.x + 18, rz.x + rz.w - 18); w.ty = rand(rz.y + 28, rz.y + rz.h - 12);
        w.pose = 'walk';
      }
      if (w.load < 45) w.alertedFatigue = false;
    });

    // uplink accounting: pose messages at POSE_HZ per tracked worker (all sites)
    S.poseAcc = (S.poseAcc || 0) + dt * POSE_HZ * all.length;
    while (S.poseAcc >= 1) {
      S.poseAcc -= 1;
      var w2 = pick(all);
      if (w2) pushUplink({ type: 'pose', id: w2.id, kp: 17, b: POSE_MSG_BYTES });
    }
    S.uplinkBps = all.length * POSE_HZ * POSE_MSG_BYTES * 8 / 1000; // kbps
  }

  /* ───────────────────────── rendering ───────────────────────── */

  var BONES = [[15,13],[13,11],[16,14],[14,12],[11,12],[5,11],[6,12],[5,6],[5,7],[7,9],[6,8],[8,10]];

  function stateColor(w) {
    if (w.state === 'down' || w.state === 'falling') return '#f43f5e';
    if (w.state === 'freeze') return '#f43f5e';
    if (w.state === 'heat') return '#f59e0b';
    if (!w.ppe) return '#f59e0b';
    if (w.reba >= 3) return '#f59e0b';
    return '#34d399';
  }

  function drawMap() {
    var cv = S.el.map, ctx = cv.getContext('2d');
    var W = cv.width, Hh = cv.height;
    ctx.clearRect(0, 0, W, Hh);

    // floor grid
    ctx.strokeStyle = 'rgba(148,163,184,0.06)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx < W; gx += 28) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, Hh); ctx.stroke(); }
    for (var gy = 0; gy < Hh; gy += 28) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    // zones
    ZONES.forEach(function (z) {
      var hot = S.heatOn && (z.id === 'press' || z.id === 'weld');
      var burning = S.fire && S.fire.zone.id === z.id;
      ctx.fillStyle = burning ? 'rgba(244,63,94,0.10)' : hot ? 'rgba(245,158,11,0.08)' :
        z.risk === 'high' ? 'rgba(56,189,248,0.05)' : 'rgba(148,163,184,0.04)';
      ctx.strokeStyle = burning ? 'rgba(244,63,94,0.55)' : hot ? 'rgba(245,158,11,0.4)' : 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 1;
      roundRect(ctx, z.x, z.y, z.w, z.h, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,0.55)';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(z.en, z.x + 10, z.y + 16);
      if (!EN) {
        ctx.fillStyle = 'rgba(226,232,240,0.75)';
        ctx.font = '600 11px Pretendard, sans-serif';
        ctx.fillText(z.ko, z.x + 10, z.y + 30);
      }
    });

    // fire particles
    if (S.fire) {
      var z2 = S.fire.zone, n = S.fire.detected ? 26 : 10;
      for (var i = 0; i < n; i++) {
        var fx = z2.x + z2.w * 0.5 + Math.sin(S.t * 3 + i * 2.1) * 18 + (i % 5) * 6 - 12;
        var fy = z2.y + z2.h * 0.55 - ((S.t * 40 + i * 17) % 46);
        var a = 1 - ((S.t * 40 + i * 17) % 46) / 46;
        ctx.fillStyle = 'rgba(' + (i % 3 === 0 ? '250,204,21' : '244,63,94') + ',' + (a * 0.7).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(fx, fy, 2.2 + a * 2.5, 0, 6.283); ctx.fill();
      }
    }

    // workers (+ the YOU avatar mirroring the live webcam FSM state)
    var renderList = S.workers;
    if (S.youWorker) {
      var yw = S.youWorker, ls = global.SHLive ? global.SHLive.state.lastState : 'normal';
      yw.phase += 0.03;
      if (ls === 'fall' || ls === 'inactive') { if (yw.fallT < 0) yw.fallT = S.t; yw.state = 'down'; }
      else { yw.fallT = -1; yw.state = ls === 'warn' ? 'heat' : 'normal'; yw.pose = ls === 'warn' ? 'work' : 'idle'; }
      yw.kps = workerKeypoints(yw, S.t);
      renderList = S.workers.concat([yw]);
    }
    renderList.forEach(function (w) {
      var col = stateColor(w);
      var kps = w.kps || workerKeypoints(w, S.t);

      // alert pulse ring
      if (col !== '#34d399') {
        var pr = 10 + Math.sin(S.t * 5) * 3;
        ctx.strokeStyle = col + '55';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(w.x, w.y - 12, pr + 8, 0, 6.283); ctx.stroke();
      }
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(w.x, w.y + 2, 9, 3, 0, 0, 6.283); ctx.fill();

      // skeleton
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      BONES.forEach(function (b) {
        var p = kps[b[0]], q = kps[b[1]];
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      });
      // neck→nose + head
      var sh = [(kps[5][0] + kps[6][0]) / 2, (kps[5][1] + kps[6][1]) / 2];
      ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(kps[0][0], kps[0][1]); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(kps[0][0], kps[0][1] - 2, 3.4, 0, 6.283); ctx.fill();

      // missing hardhat marker
      if (!w.ppe) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = '700 10px sans-serif';
        ctx.fillText('!', kps[0][0] + 6, kps[0][1] - 6);
      }
      // id label
      var isF = S.focusWorker === w;
      ctx.fillStyle = isF ? '#e2e8f0' : 'rgba(148,163,184,0.8)';
      ctx.font = (isF ? '700 ' : '500 ') + '9px "JetBrains Mono", monospace';
      ctx.fillText(w.id, w.x - 12, w.y + 14);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* camera wall: each SIM tile renders a zone crop with CCTV styling */
  function drawCams() {
    (S.el.cams || []).forEach(function (c) {
      var ctx = c.cv.getContext('2d');
      var z = c.zone;
      var W = c.cv.width, Hh = c.cv.height;
      ctx.fillStyle = '#04070d'; ctx.fillRect(0, 0, W, Hh);
      ctx.save();
      var sx = W / z.w, sy = Hh / z.h, s = Math.min(sx, sy) * 1.35;
      ctx.translate(W / 2, Hh / 2 + 8);
      ctx.scale(s, s);
      ctx.translate(-(z.x + z.w / 2), -(z.y + z.h / 2));

      // zone outline
      ctx.strokeStyle = 'rgba(56,189,248,0.25)'; ctx.lineWidth = 1 / s;
      ctx.strokeRect(z.x, z.y, z.w, z.h);

      // fire glow in this zone
      if (S.fire && S.fire.zone.id === z.id) {
        ctx.fillStyle = 'rgba(244,63,94,0.16)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        for (var i = 0; i < 14; i++) {
          var fx = z.x + z.w * 0.5 + Math.sin(S.t * 3 + i * 2.1) * 16;
          var fy = z.y + z.h * 0.55 - ((S.t * 42 + i * 15) % 40);
          ctx.fillStyle = i % 3 ? 'rgba(244,63,94,0.5)' : 'rgba(250,204,21,0.55)';
          ctx.beginPath(); ctx.arc(fx, fy, 2.4, 0, 6.283); ctx.fill();
        }
      }

      S.workers.forEach(function (w) {
        if (w.x < z.x - 8 || w.x > z.x + z.w + 8 || w.y < z.y - 8 || w.y > z.y + z.h + 8) return;
        var col = stateColor(w);
        var kps = w.kps || workerKeypoints(w, S.t);
        ctx.strokeStyle = col; ctx.lineWidth = 1.6 / s; ctx.lineCap = 'round';
        BONES.forEach(function (b) {
          ctx.beginPath(); ctx.moveTo(kps[b[0]][0], kps[b[0]][1]); ctx.lineTo(kps[b[1]][0], kps[b[1]][1]); ctx.stroke();
        });
        var sh = [(kps[5][0] + kps[6][0]) / 2, (kps[5][1] + kps[6][1]) / 2];
        ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(kps[0][0], kps[0][1]); ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(kps[0][0], kps[0][1] - 1.5, 2.6, 0, 6.283); ctx.fill();
      });
      ctx.restore();

      // scanlines + REC
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      for (var yl = 0; yl < Hh; yl += 3) ctx.fillRect(0, yl, W, 1);
      ctx.fillStyle = 'rgba(244,63,94,0.9)';
      ctx.beginPath(); ctx.arc(10, 11, 3, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(226,232,240,0.85)';
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.fillText(c.label, 20, 14);
      ctx.fillStyle = 'rgba(148,163,184,0.6)';
      ctx.fillText('EDGE · NO-UPLINK', W - 104, Hh - 8);
    });
  }

  /* ───────────────────────── DOM panels ───────────────────────── */

  function fmtTime(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function evNode(ev) {
    var k = KINDS[ev.kind];
    var d = document.createElement('div');
    d.className = 'ev ' + ev.sev + (ev.source === 'LIVE' ? ' live' : '');
    d.innerHTML =
      '<span class="ev-time">' + fmtTime(ev.ts) + '</span>' +
      '<span class="ev-kind">' + (EN ? k.en : k.ko) + ' <i>' + (EN ? '' : k.en + ' · ') + ev.sev.toUpperCase() + '</i></span>' +
      '<span class="ev-meta">' + (ev.worker ? ev.worker + ' · ' : '') + ev.site +
      ' · <b class="src">' + ev.source + '</b></span>';
    return d;
  }

  /* prepend-only so the aria-live region announces just the new event */
  function renderFeed() {
    var el = S.el.feed; if (!el) return;
    if (!S.events.length) { el.innerHTML = ''; return; }
    el.prepend(evNode(S.events[0]));
    while (el.children.length > 24) el.removeChild(el.lastChild);
  }

  function renderKpi() {
    var e = S.el;
    if (e.kSites) e.kSites.textContent = SITES.length;
    if (e.kWorkers) e.kWorkers.textContent = SITES.reduce(function (a, s) { return a + s.workers; }, 0) + (S.liveTile ? 1 : 0);
    if (e.kCrit) e.kCrit.textContent = S.eventsToday.crit;
    if (e.kWarn) e.kWarn.textContent = S.eventsToday.warn;
    if (e.kWbgt) e.kWbgt.textContent = S.wbgt.toFixed(1) + '°C';
  }

  function renderWorkerCard() {
    var el = S.el.wcard; if (!el) return;
    var w = S.focusWorker;
    if (!w) { el.classList.remove('open'); return; }
    el.classList.add('open');
    var k = w.state === 'down' || w.state === 'falling' ? KINDS.fall :
            w.state === 'freeze' ? KINDS.inactive :
            w.state === 'heat' ? KINDS.heat : !w.ppe ? KINDS.ppe : null;
    el.querySelector('.wc-id').textContent = w.id;
    el.querySelector('.wc-zone').textContent = EN ? w.zone.en : (w.zone.ko + ' · ' + w.zone.en);
    el.querySelector('.wc-hr').textContent = Math.round(w.hr);
    el.querySelector('.wc-reba').textContent = 'L' + w.reba;
    var loadEl = el.querySelector('.wc-load');
    if (loadEl) {
      var lv = Math.round(w.load || 0);
      loadEl.textContent = lv + '%';
      loadEl.style.color = lv > 78 ? 'var(--danger)' : lv > 55 ? 'var(--warn)' : 'var(--ok)';
    }
    var wmEl = el.querySelector('.wc-worked');
    if (wmEl) wmEl.textContent = Math.round(w.workedMin || 0) + (EN ? ' min' : '분');
    el.querySelector('.wc-state').innerHTML = k ?
      '<span class="badge ' + k.sev + '">' + (EN ? k.en : k.ko) + '</span>' :
      '<span class="badge ok">' + (EN ? 'NORMAL' : '정상 NORMAL') + '</span>';
    el.querySelector('.wc-sm').textContent =
      'tilt ' + Math.round(w.sm.tilt) + '° · asp ' + w.sm.aspect.toFixed(2) + ' · state ' + w.sm.state;
  }

  var agentTimer = {};
  function animateAgents(kind) {
    var order = ['sense', 'judge', 'act', 'connect'];
    var senseMap = { fall: 'a-fall', inactive: 'a-pose', ppe: 'a-ppe', fire: 'a-fire', heat: 'a-pose', posture: 'a-pose', health: 'a-pose', fatigue: 'a-pose', zone: 'a-pose', recover: 'a-pose' };
    var delay = 0;
    order.forEach(function (g, gi) {
      AGENTS.filter(function (a) { return a.group === g; }).forEach(function (a) {
        var hit = gi > 0 || a.id === senseMap[kind];
        if (!hit) return;
        setTimeout(function () {
          var node = document.getElementById(a.id);
          if (!node) return;
          node.classList.add('fire');
          clearTimeout(agentTimer[a.id]);
          agentTimer[a.id] = setTimeout(function () { node.classList.remove('fire'); }, 1400);
        }, delay + gi * 260);
      });
    });
  }

  /* ───────────────────────── public API ───────────────────────── */

  /* background heartbeat — rAF pauses in hidden tabs, but an edge node must
   * keep detecting; timers still fire (~1 Hz), enough for the state machines.
   * Also active under ?demo (guided demos / headless captures, where rAF is
   * throttled but virtual-time advances timers). */
  setInterval(function () {
    if ((document.hidden || /[?&]demo/.test(location.search)) && S.running && S.workers.length) {
      tick(1.0 * S.speed);
      renderKpi();
    }
  }, 1000);

  var last = 0;
  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000) * S.speed;
    last = ts;
    if (S.running) {
      tick(dt);
      drawMap(); drawCams();
      renderUplink(ts);
      if (S.el.clock) S.el.clock.textContent = fmtTime(new Date());
      if (S.el.kUplink) S.el.kUplink.textContent = S.uplinkBps.toFixed(1);
      if (S.el.upStats) S.el.upStats.innerHTML = EN
        ? ('total <b>' + (S.uplinkTotal / 1024).toFixed(1) + ' KB</b> · ' + S.msgCount + ' msgs' +
           ' · <b class="save">×' + Math.round(VIDEO_KBPS / Math.max(0.1, S.uplinkBps)) + '</b> less than video')
        : ('누적 <b>' + (S.uplinkTotal / 1024).toFixed(1) + ' KB</b> · ' + S.msgCount + ' msgs' +
           ' · 영상 대비 <b class="save">×' + Math.round(VIDEO_KBPS / Math.max(0.1, S.uplinkBps)) + '</b> 절감');
      if (S.focusWorker) renderWorkerCard();
    }
    requestAnimationFrame(frame);
  }

  var AUTOPILOT_SEQ = ['fall', 'reset', 'ppe', 'fire', 'reset', 'heat', 'inactive', 'reset'];

  global.SHSim = {
    ZONES: ZONES, SITES: SITES, AGENTS: AGENTS, KINDS: KINDS,
    state: S,
    init: function (els) {
      S.el = els;
      SITES.forEach(function (site) {
        var arr = [];
        for (var i = 0; i < site.workers; i++) arr.push(makeWorker(i, site));
        S.workersBySite[site.id] = arr;
      });
      S.workers = S.workersBySite[S.site.id];
      renderKpi(); renderFeed();
      requestAnimationFrame(frame);
    },
    setSite: function (id) {
      var site = SITES.find(function (s) { return s.id === id; });
      if (!site) return;
      S.site = site;
      S.workers = S.workersBySite[id];
      S.focusWorker = null; renderWorkerCard(); renderKpi();
    },
    scenario: function (name) {
      ({ fall: scenarioFall, ppe: scenarioPpe, fire: scenarioFire,
         heat: scenarioHeat, inactive: scenarioInactive, reset: scenarioReset }[name] || function () {})();
    },
    autopilot: function (on) {
      S.autopilot = on;
      clearInterval(S.apTimer);
      if (on) {
        S.apStep = 0;
        var step = function () {
          if (!S.autopilot) return;
          var name = AUTOPILOT_SEQ[S.apStep % AUTOPILOT_SEQ.length];
          global.SHSim.scenario(name);
          if (S.el.apLabel) S.el.apLabel.textContent =
            'AUTOPILOT ' + (S.apStep % AUTOPILOT_SEQ.length + 1) + '/' + AUTOPILOT_SEQ.length + ' · ' + name.toUpperCase();
          S.apStep++;
        };
        step();
        S.apTimer = setInterval(step, 9000);
      } else if (S.el.apLabel) S.el.apLabel.textContent = '';
    },
    setTts: function (on) { S.ttsOn = on; },
    setSpeed: function (v) { S.speed = v; },
    pause: function (p) { S.running = !p; },
    focusById: function (id) {
      var w = S.workers.find(function (w) { return w.id === id; });
      if (w) focus(w);
    },
    clickMap: function (mx, my) {
      var best = null, bd = 1e9;
      S.workers.forEach(function (w) {
        var d = Math.hypot(w.x - mx, w.y - my - 12);
        if (d < 26 && d < bd) { bd = d; best = w; }
      });
      if (best) focus(best); else { S.focusWorker = null; renderWorkerCard(); }
    },
    /* live webcam bridge: events from js/live.js enter the same bus */
    ingestLive: function (kind, extra) { emit(kind, 'CAM-07', 'LIVE', extra); },
    ingestLivePose: function (nPersons) {
      pushUplink({ type: 'pose', id: 'CAM-07', persons: nPersons, kp: 17 * nPersons, b: POSE_MSG_BYTES * nPersons });
    },
    setLiveTile: function (on) {
      S.liveTile = on;
      if (on && !S.youWorker) {
        var rest = ZONES.find(function (z) { return z.id === 'rest'; });
        S.youWorker = {
          id: 'YOU', zone: rest, site: S.site,
          x: rest.x + rest.w / 2, y: rest.y + rest.h / 2 + 20,
          tx: 0, ty: 0, speed: 0, pose: 'idle', phase: 0, gait: 5,
          facing: 1, hr: 76, hrBase: 76, reba: 1, ppe: true,
          state: 'normal', fallT: -1, you: true,
          sm: { tilt: 0, aspect: 0, state: 'normal' }
        };
      }
      if (!on) S.youWorker = null;
      renderKpi();
    }
  };
})(window);

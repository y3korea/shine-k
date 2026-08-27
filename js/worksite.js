/* SHine-K worksite (enterprise) page — local event bus + roster + Act loop.
 * Provides a minimal SHSim-compatible bus so js/live.js pipes real webcam
 * events into this page's feed and uplink panel unchanged. */
(function (global) {
  'use strict';

  var session = global.SHAuth ? global.SHAuth.session() : null;
  // demo pages stay usable without login, but reflect it honestly
  document.getElementById('org-name').textContent =
    session && session.role === 'enterprise' ? session.org : '게스트 데모 (로그인 없음)';

  var KINDS = {
    fall: { ko: '낙상', sev: 'crit' }, inactive: { ko: '무동작', sev: 'crit' },
    posture: { ko: '고위험 자세', sev: 'warn' }, fatigue: { ko: '과로 위험', sev: 'warn' },
    health: { ko: '심박 이상', sev: 'warn' }, recover: { ko: '정상 복귀', sev: 'ok' }
  };

  var W = {
    events: 0, uplinkTotal: 0, msgCount: 0, upLog: [], liveOn: false,
    rebaHighSince: 0, rxOpen: false, points: 0
  };

  /* safety-behavior reward (T8, design-stage): points for COMPLETED safety
   * actions only — never for data volume, never penalized on opt-out */
  function grantPoints(n, why) {
    W.points += n;
    var p = document.getElementById('k-points'), c = document.getElementById('k-coin');
    if (p) p.textContent = W.points.toLocaleString();
    if (c) c.textContent = (W.points * 10).toLocaleString() + '원';
    pushUp({ type: 'act', step: 'reward', p: n, why: why, coin: 'local-currency(DESIGN)' }, true);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function now() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  /* ── feed + uplink ── */
  var feedEl = document.getElementById('feed');
  function pushFeed(kind, meta, live) {
    var k = KINDS[kind] || { ko: kind, sev: 'warn' };
    var d = document.createElement('div');
    d.className = 'ev ' + k.sev + (live ? ' live' : '');
    d.innerHTML = '<span class="ev-time">' + now() + '</span>' +
      '<span class="ev-kind">' + k.ko + ' <i>' + kind.toUpperCase() + '</i></span>' +
      '<span class="ev-meta">' + meta + '</span>';
    feedEl.prepend(d);
    while (feedEl.children.length > 20) feedEl.removeChild(feedEl.lastChild);
    if (k.sev !== 'ok') {
      W.events++;
      document.getElementById('k-events').textContent = W.events;
    }
  }

  var upEl = document.getElementById('uplink'), upDirty = false;
  function pushUp(obj, hl) {
    var s = JSON.stringify(obj);
    W.msgCount++; W.uplinkTotal += s.length;
    W.upLog.unshift({ s: s, hl: hl });
    if (W.upLog.length > 12) W.upLog.pop();
    upDirty = true;
  }
  setInterval(function () {
    if (!upDirty) return;
    upDirty = false;
    upEl.innerHTML = W.upLog.map(function (m) {
      return '<div class="up-line' + (m.hl ? ' hl' : '') + '">' +
        m.s.replace(/"(\w+)":/g, '"<i>$1</i>":') + '</div>';
    }).join('');
    document.getElementById('up-stats').innerHTML =
      '누적 <b>' + (W.uplinkTotal / 1024).toFixed(1) + ' KB</b> · ' + W.msgCount + ' msgs · 영상 무전송';
  }, 200);

  /* SHSim-compatible bridge consumed by live.js */
  global.SHSim = {
    ingestLive: function (kind, extra) {
      pushFeed(kind, 'CAM-01 · ' + (session ? session.org : '데모') + ' · <b class="src">LIVE</b>', true);
      pushUp({ type: 'alert', kind: kind, cam: 'CAM-01', src: 'LIVE' }, true);
    },
    ingestLivePose: function (n) {
      pushUp({ type: 'pose', cam: 'CAM-01', persons: n, kp: 17 * n, b: 146 * n });
      document.getElementById('k-uplink').textContent = (n * 8 * 146 * 8 / 1000).toFixed(1);
    },
    setLiveTile: function (on) {
      W.liveOn = on;
      if (!on) document.getElementById('k-uplink').textContent = '0.0';
    }
  };

  /* ── REBA watch → Act loop prescription ── */
  var RX = {
    posture: { img: 'img/recovery/stretch.gif', t: '스트레칭 처방 (Act 루프)', b: '허리·어깨 굽힘이 지속되었습니다. 90초 스트레칭 후 자세를 다시 측정하세요.' },
    neck: { img: 'img/recovery/neck.gif', t: '목 이완 처방 (Act 루프)', b: '목 전방 굽힘 부담이 감지되었습니다. 목 스트레칭을 권장합니다.' },
    fatigue: { img: 'img/recovery/rest.gif', t: '휴식 처방 (Act 루프)', b: '피로 부하가 임계(78%)를 넘었습니다. 10분 휴식 후 재개하세요 — 완료 시 재측정으로 회복을 확인합니다.' }
  };
  function openRx(kind) {
    if (W.rxOpen) return;
    W.rxOpen = true;
    var r = RX[kind] || RX.posture;
    document.getElementById('rx-img').src = r.img;
    document.getElementById('rx-title').textContent = r.t;
    document.getElementById('rx-body').textContent = r.b;
    document.getElementById('rx-card').classList.add('open');
  }
  document.getElementById('rx-done').addEventListener('click', function () {
    document.getElementById('rx-card').classList.remove('open');
    W.rxOpen = false;
    pushFeed('recover', '휴식/스트레칭 완료 확인 — 재측정 루프 · +150P 적립', false);
    pushUp({ type: 'act', step: 'recovery_confirmed', cam: 'CAM-01' }, true);
    grantPoints(150, 'recovery_done');
  });

  setInterval(function () {
    var live = global.SHLive && global.SHLive.state;
    var reba = live && (live.mode === 'live' || live.mode === 'replay') ? live.reba : null;
    document.getElementById('k-reba').textContent = reba ? 'L' + reba : '—';
    if (reba >= 3) {
      if (!W.rebaHighSince) W.rebaHighSince = Date.now();
      if (Date.now() - W.rebaHighSince > 8000) {
        W.rebaHighSince = Date.now() + 30000; // cooldown
        pushFeed('posture', 'CAM-01 · REBA L' + reba + ' 지속 · <b class="src">LIVE</b>', true);
        pushUp({ type: 'alert', kind: 'posture', reba: reba, cam: 'CAM-01' }, true);
        openRx('posture');
      }
    } else W.rebaHighSince = 0;
  }, 500);

  /* ── roster (wearable-simulated) ── */
  var NAMES = ['GA-01', 'GA-02', 'GA-03', 'GA-04', 'GA-05', 'GA-06'];
  var ZONES = ['프레스', '용접', '조립', '물류', '검사'];
  var roster = NAMES.map(function (id, i) {
    return {
      id: id, zone: ZONES[i % ZONES.length],
      hr: 70 + Math.random() * 14, reba: 1 + Math.floor(Math.random() * 2),
      worked: 40 + Math.random() * 180, load: 15 + Math.random() * 45, alerted: false
    };
  });

  function drift(v, lo, hi, k) {
    v += (Math.random() - 0.5) * k;
    return v < lo ? lo : v > hi ? hi : v;
  }

  setInterval(function () {
    roster.forEach(function (r) {
      r.hr = drift(r.hr, 62, 132, 3.2);
      r.load = Math.min(100, Math.max(0, r.load + (Math.random() - 0.42) * 2.2));
      r.worked += 5 / 60;
      if (Math.random() < 0.06) r.reba = 1 + Math.floor(Math.random() * 3.2);
      if (r.load > 78 && !r.alerted) {
        r.alerted = true;
        pushFeed('fatigue', r.id + ' · 부하 ' + Math.round(r.load) + '% · 연속 ' + Math.round(r.worked) + '분', false);
        pushUp({ type: 'alert', kind: 'fatigue', id: r.id, load: Math.round(r.load) }, true);
        openRx('fatigue');
        r.load -= 30; // rest prescribed
        setTimeout(function () { r.alerted = false; }, 30000);
      }
    });
    var tb = document.querySelector('#roster tbody');
    tb.innerHTML = roster.map(function (r) {
      var lc = r.load > 78 ? 'var(--danger)' : r.load > 55 ? 'var(--warn)' : 'var(--ok)';
      var st = r.load > 78 ? '<span class="badge crit">과로</span>' :
               r.reba >= 3 ? '<span class="badge warn">자세</span>' :
               '<span class="badge ok">정상</span>';
      return '<tr><td>' + r.id + '</td><td>' + r.zone + '</td><td>' + Math.round(r.hr) +
        '</td><td>L' + r.reba + '</td><td>' + Math.round(r.worked) + '분</td>' +
        '<td><span class="loadbar"><i style="width:' + Math.round(r.load) + '%;background:' + lc + '"></i></span> ' +
        Math.round(r.load) + '%</td><td>' + st + '</td></tr>';
    }).join('');
    document.getElementById('k-onsite').textContent = roster.length + (W.liveOn ? 1 : 0);
  }, 1200);

  /* clock */
  setInterval(function () { document.getElementById('clock').textContent = now(); }, 1000);

  /* opening feed line so the page is alive immediately */
  pushFeed('recover', '엣지 노드 기동 — 센터 구독 채널 연결(이벤트 전용)', false);
  pushUp({ type: 'hello', node: 'worksite-edge', schema: 'pose|alert|hb', video: false }, true);

  /* liveness heartbeat → control twin (BroadcastChannel cross-tab transport).
   * 1 Hz beat; the console watchdog flags this node within 5 s of silence.
   * If the browser throttles this tab's timers below 1 Hz, the beat stops
   * and the center alarms — lifecycle failures are detectable, not silent. */
  if (global.SHLiveness) {
    global.SHLiveness.startEdgeHeartbeat({
      node: 'worksite-edge',
      mode: function () {
        var live = global.SHLive && global.SHLive.state;
        return live ? live.mode : 'sim';
      },
      onEcho: function (msg) { pushUp(msg, false); }
    });
  }
})(window);

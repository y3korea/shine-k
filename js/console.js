/* SHine-K console glue — hash routing, agent panel, veto strip, session table */
(function () {
  'use strict';
  var Sim = window.SHSim, Live = window.SHLive;

  /* portal session context (demo auth — no real credentials) */
  var sess = window.SHAuth ? window.SHAuth.session() : null;
  if (sess && sess.role === 'center') {
    var badge = document.getElementById('cc-org');
    badge.textContent = sess.org + ' · 로그인됨';
    badge.style.display = 'inline-flex';
    var pl = document.getElementById('portal-link');
    pl.textContent = '로그아웃';
    pl.addEventListener('click', function (e) { e.preventDefault(); window.SHAuth.logout(); });
  }

  /* ── hash routing ── */
  var ROUTES = ['twin', 'live', 'agents', 'events', 'evidence'];
  function route() {
    var h = (location.hash || '#twin').slice(1);
    if (ROUTES.indexOf(h) < 0) h = 'twin';
    ROUTES.forEach(function (r) {
      document.getElementById('route-' + r).classList.toggle('active', r === h);
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.route === h);
      });
    });
    if (h === 'events') renderSession();
  }
  window.addEventListener('hashchange', route);
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { location.hash = t.dataset.route; });
  });

  /* ── site tabs ── */
  var siteTabs = document.getElementById('site-tabs');
  Sim.SITES.forEach(function (s, i) {
    var b = document.createElement('button');
    b.className = 'site-tab' + (i === 0 ? ' active' : '');
    b.textContent = s.en + ' · ' + s.ko;
    b.addEventListener('click', function () {
      Sim.setSite(s.id);
      siteTabs.querySelectorAll('.site-tab').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
    });
    siteTabs.appendChild(b);
  });

  /* ── agent columns ── */
  var GROUPS = [
    { key: 'sense', label: 'SENSE · 감지' },
    { key: 'judge', label: 'JUDGE · 판단' },
    { key: 'act', label: 'ACT · 조치' },
    { key: 'connect', label: 'CONNECT · 연계' }
  ];
  var cols = document.getElementById('agent-cols');
  GROUPS.forEach(function (g) {
    var col = document.createElement('div');
    col.className = 'agent-col ' + g.key;
    col.innerHTML = '<h4>' + g.label + '</h4>';
    Sim.AGENTS.filter(function (a) { return a.group === g.key; }).forEach(function (a) {
      var d = document.createElement('div');
      d.className = 'agent'; d.id = a.id;
      d.innerHTML = '<span>' + a.ko + '<i>' + a.en + '</i></span>' +
        (a.design ? '<span class="dtag tag-design">design</span>' : '');
      col.appendChild(d);
    });
    cols.appendChild(col);
  });

  /* ── scenario bar ── */
  document.querySelectorAll('[data-sc]').forEach(function (b) {
    b.addEventListener('click', function () { Sim.scenario(b.dataset.sc); });
  });
  var apBtn = document.getElementById('btn-autopilot');
  apBtn.setAttribute('aria-pressed', 'false');
  apBtn.addEventListener('click', function () {
    var on = !apBtn.classList.contains('toggled');
    apBtn.classList.toggle('toggled', on);
    apBtn.setAttribute('aria-pressed', String(on));
    Sim.autopilot(on);
  });
  var ttsBtn = document.getElementById('btn-tts');
  ttsBtn.addEventListener('click', function () {
    var on = !ttsBtn.classList.contains('toggled');
    ttsBtn.classList.toggle('toggled', on);
    ttsBtn.setAttribute('aria-pressed', String(on));
    Sim.setTts(on);
  });

  /* ── map click → worker case file ── */
  var map = document.getElementById('map');
  map.addEventListener('click', function (e) {
    var r = map.getBoundingClientRect();
    Sim.clickMap((e.clientX - r.left) * map.width / r.width,
                 (e.clientY - r.top) * map.height / r.height);
  });

  /* ── live slot tile → #live ── */
  var slot = document.getElementById('live-slot');
  function goLive() { location.hash = 'live'; }
  slot.addEventListener('click', goLive);
  slot.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goLive(); }
  });

  /* ── live controls ── */
  document.getElementById('btn-live').addEventListener('click', function () { Live.start(); });
  document.getElementById('btn-replay').addEventListener('click', function () {
    if (Live.state.mode === 'replay') { Live.stop(); return; }
    if (Live.state.mode === 'live') Live.stop();
    Live.state.cv = document.getElementById('live-canvas');
    Live.state.ctx = Live.state.cv.getContext('2d');
    Live.state.video = document.getElementById('live-video');
    Live.startReplay();
  });
  var vfBtn = document.getElementById('btn-videofree');
  vfBtn.addEventListener('click', function () {
    var pane = document.getElementById('live-pane');
    var on = !pane.classList.contains('videofree');
    pane.classList.toggle('videofree', on);
    vfBtn.classList.toggle('toggled', on);
    vfBtn.setAttribute('aria-pressed', String(on));
  });

  /* live state → tile label + FSM readout */
  setInterval(function () {
    var lbl = document.getElementById('live-slot-lbl');
    var mode = Live.state.mode;
    slot.classList.toggle('on', mode === 'live' || mode === 'replay');
    lbl.textContent = mode === 'live' ? 'CAM-07 ● LIVE — YOU가 트윈에 표시됨' :
      mode === 'replay' ? 'CAM-07 ● REPLAY(합성)' : 'CAM-07 · 내 카메라 연결';
    var sm = document.getElementById('live-sm');
    if (sm) {
      if (mode === 'off') sm.textContent = 'state=off · tilt −° · asp −';
      else {
        var s0 = Live.state.sms && (Live.state.sms[0] || Live.state.sms.replay || Object.values(Live.state.sms)[0]);
        if (s0) sm.textContent = 'state=' + s0.state + ' · tilt ' + Math.round(s0.tilt) +
          '° (>52°=down) · asp ' + s0.aspect.toFixed(2) + ' (>1.0=down) · 700ms confirm';
      }
    }
  }, 500);

  /* ── veto strip: fired on any crit fall/inactive event ── */
  var veto = document.getElementById('veto'),
      vetoCount = document.getElementById('veto-count'),
      vetoTimer = null, vetoT = 0, vetoCleanup = null;
  function srAnnounce(msg) {
    var el = document.getElementById('sr-announce');
    if (el) el.textContent = msg;
  }
  function openVeto() {
    if (vetoTimer) return;
    clearTimeout(vetoCleanup);
    veto.classList.add('open'); veto.classList.remove('dispatched');
    srAnnounce('낙상 확정 — 10초 내 거부권 응답 필요, 미응답 시 모의 출동 발신');
    vetoT = 10.0;
    document.querySelector('.rung[data-l="3"]').classList.add('on');
    vetoTimer = setInterval(function () {
      vetoT -= 0.1;
      vetoCount.textContent = Math.max(0, vetoT).toFixed(1);
      if (vetoT <= 0) {
        clearInterval(vetoTimer); vetoTimer = null;
        veto.classList.add('dispatched');
        veto.querySelector('p').innerHTML =
          '<strong>모의 출동 발신 완료.</strong> 119/e-Gen 연계는 논문 Table 2 기준 <em>설계 단계</em>입니다 — 실제 발신 없음. 트레이스가 CONNECT 컬럼에 기록되었습니다.';
        srAnnounce('거부권 시간 만료 — 모의 출동 발신 완료 (실제 발신 아님)');
        addTrace('CONNECT', 'e-Gen dispatch(SIMULATED) → site=' + Sim.state.site.id + ' · human-veto expired');
        vetoCleanup = setTimeout(function () { veto.classList.remove('open'); resetVetoText(); }, 6000);
      }
    }, 100);
  }
  function resetVetoText() {
    veto.querySelector('p').innerHTML =
      '<strong>낙상 확정 — 119/e-Gen 연계 시퀀스(모의).</strong> 관리자 거부권(human veto) 카운트다운. 시간 내 응답이 없으면 모의 출동 요청이 발신됩니다. <em>실제 119에 연결되지 않습니다 — 설계 단계 시연.</em>';
    document.querySelector('.rung[data-l="3"]').classList.remove('on');
  }
  document.getElementById('veto-ack').addEventListener('click', function () {
    clearInterval(vetoTimer); vetoTimer = null;
    veto.classList.remove('open'); resetVetoText();
    addTrace('ACT', 'human veto → escalation cancelled by operator');
  });

  /* ── trace cards ── */
  var traceLog = document.getElementById('trace-log');
  function addTrace(stage, text) {
    var d = document.createElement('div');
    d.className = 'trace';
    d.innerHTML = '<b>[' + stage + ']</b> ' + text;
    traceLog.prepend(d);
    while (traceLog.children.length > 20) traceLog.removeChild(traceLog.lastChild);
  }

  var LADDER_BY_KIND = { fall: 3, inactive: 3, fire: 3, ppe: 1, heat: 2, posture: 1, health: 2, fatigue: 2, zone: 1, recover: 0 };
  function onBusEvent(ev) {
    var conf = (0.72 + Math.random() * 0.24).toFixed(2);
    var fused = Math.min(0.99, +conf + 0.08).toFixed(2);
    var L = LADDER_BY_KIND[ev.kind] != null ? LADDER_BY_KIND[ev.kind] : 1;
    addTrace('BUS',
      ev.source + ' ' + ev.kind + (ev.worker ? ' @' + ev.worker : '') +
      ' · conf ' + conf + ' → fused ' + fused + ' → L' + L +
      (L >= 2 ? ' → action issued' : ' → notify'));
    document.querySelectorAll('.rung').forEach(function (r) {
      r.classList.toggle('on', +r.dataset.l === L);
    });
    if ((ev.kind === 'fall' || ev.kind === 'inactive') && ev.sev === 'crit') openVeto();
  }
  Sim.state.onEvent = onBusEvent;

  /* ── session table + debrief + export ── */
  function renderSession() {
    var tb = document.querySelector('#ev-table tbody');
    var evs = Sim.state.allEvents.slice().reverse();
    tb.innerHTML = evs.map(function (ev) {
      var k = Sim.KINDS[ev.kind];
      return '<tr><td>' + ev.ts.toLocaleTimeString('ko-KR', { hour12: false }) + '</td>' +
        '<td>' + k.ko + ' <span style="color:var(--ink-4)">' + k.en + '</span></td>' +
        '<td><span class="badge ' + ev.sev + '">' + ev.sev.toUpperCase() + '</span></td>' +
        '<td>' + (ev.worker || '—') + '</td><td>' + ev.site + '</td>' +
        '<td style="color:' + (ev.source === 'LIVE' ? 'var(--ok)' : 'var(--cyan)') + '">' + ev.source + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--ink-4)">아직 이벤트가 없습니다 — 관제 트윈에서 시나리오를 주입해 보세요.</td></tr>';

    var st = Sim.state;
    var falls = st.allEvents.filter(function (e) { return e.kind === 'fall'; }).length;
    var liveN = st.allEvents.filter(function (e) { return e.source === 'LIVE'; }).length;
    var kb = st.uplinkTotal / 1024;
    var sessionSec = st.t;
    var cams = 4 + (st.liveTile ? 1 : 0); // CCTV-streaming alternative = one H.264 stream per camera
    var videoKB = cams * 2500 / 8 * sessionSec;
    document.getElementById('debrief').innerHTML =
      dbCard(st.eventsToday.total, '총 이벤트') +
      dbCard(falls, '낙상 확정') +
      dbCard(liveN, 'LIVE 소스 이벤트') +
      dbCard(st.msgCount.toLocaleString(), '업링크 메시지') +
      dbCard(kb.toFixed(1) + ' KB', '실전송(스켈레톤+이벤트)') +
      dbCard('×' + Math.round(videoKB / Math.max(1, kb)).toLocaleString(), '영상 대비 절감(카메라 ' + cams + '대 기준)');
  }
  function dbCard(v, l) {
    return '<div class="kpi"><b>' + v + '</b><span>' + l + '</span></div>';
  }
  setInterval(function () {
    if (document.getElementById('route-events').classList.contains('active')) renderSession();
  }, 2000);

  document.getElementById('btn-export').addEventListener('click', function () {
    var data = {
      exported: new Date().toISOString(),
      platform: 'SHine-K console demo',
      note: 'event-only uplink record — no video, no raw biometrics (paper §3.1)',
      seed: Sim.state.seed,
      events: Sim.state.allEvents.map(function (e) {
        return { ts: e.ts.toISOString(), kind: e.kind, sev: e.sev, worker: e.worker, site: e.site, source: e.source, extra: e.extra };
      })
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'shine-k_session_events.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ── boot ── */
  Sim.init({
    map: map,
    cams: Array.prototype.map.call(document.querySelectorAll('.cam-tile canvas[data-zone]'), function (cv) {
      var z = Sim.ZONES.find(function (z) { return z.id === cv.dataset.zone; });
      return { cv: cv, zone: z, label: 'CAM-' + (Sim.ZONES.indexOf(z) + 1).toString().padStart(2, '0') + ' ' + z.en };
    }),
    feed: document.getElementById('feed'),
    uplink: document.getElementById('uplink'),
    upStats: document.getElementById('up-stats'),
    clock: document.getElementById('clock'),
    wcard: document.getElementById('wcard'),
    apLabel: document.getElementById('ap-label'),
    kSites: document.getElementById('k-sites'),
    kWorkers: document.getElementById('k-workers'),
    kUplink: document.getElementById('k-uplink'),
    kCrit: document.getElementById('k-crit'),
    kWarn: document.getElementById('k-warn'),
    kWbgt: document.getElementById('k-wbgt')
  });
  route();

  /* a first ambient event so the feed is never empty */
  setTimeout(function () { Sim.scenario('ppe'); }, 4000);
})();

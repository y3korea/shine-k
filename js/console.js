/* SHine-K console glue — hash routing, agent panel, veto strip, session table */
(function () {
  'use strict';
  var Sim = window.SHSim, Live = window.SHLive;
  var EN = window.SHLANG === 'en';

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
    b.textContent = EN ? s.en : s.en + ' · ' + s.ko;
    b.addEventListener('click', function () {
      Sim.setSite(s.id);
      siteTabs.querySelectorAll('.site-tab').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
    });
    siteTabs.appendChild(b);
  });

  /* ── agent columns ── */
  var GROUPS = EN ? [
    { key: 'sense', label: 'SENSE' },
    { key: 'judge', label: 'JUDGE' },
    { key: 'act', label: 'ACT' },
    { key: 'connect', label: 'CONNECT' }
  ] : [
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
      d.innerHTML = '<span>' + (EN ? a.en : a.ko + '<i>' + a.en + '</i>') + '</span>' +
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
    lbl.textContent = EN
      ? (mode === 'live' ? 'CAM-07 ● LIVE — YOU appears on the twin' : mode === 'replay' ? 'CAM-07 ● REPLAY (synthetic)' : 'CAM-07 · connect my camera')
      : (mode === 'live' ? 'CAM-07 ● LIVE — YOU가 트윈에 표시됨' : mode === 'replay' ? 'CAM-07 ● REPLAY(합성)' : 'CAM-07 · 내 카메라 연결');
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
    srAnnounce(EN ? 'Fall confirmed — 10 s human-veto window before simulated dispatch' : '낙상 확정 — 10초 내 거부권 응답 필요, 미응답 시 모의 출동 발신');
    vetoT = 10.0;
    document.querySelector('.rung[data-l="3"]').classList.add('on');
    vetoTimer = setInterval(function () {
      vetoT -= 0.1;
      vetoCount.textContent = Math.max(0, vetoT).toFixed(1);
      if (vetoT <= 0) {
        clearInterval(vetoTimer); vetoTimer = null;
        veto.classList.add('dispatched');
        veto.querySelector('p').innerHTML = EN
          ? '<strong>Simulated dispatch sent.</strong> The 119/e-Gen linkage is a <em>design-stage</em> item (Table 2) — nothing was actually dispatched. A trace was logged in the CONNECT column.'
          : '<strong>모의 출동 발신 완료.</strong> 119/e-Gen 연계는 논문 Table 2 기준 <em>설계 단계</em>입니다 — 실제 발신 없음. 트레이스가 CONNECT 컬럼에 기록되었습니다.';
        srAnnounce(EN ? 'Veto window expired — simulated dispatch sent (not real)' : '거부권 시간 만료 — 모의 출동 발신 완료 (실제 발신 아님)');
        addTrace('CONNECT', 'e-Gen dispatch(SIMULATED) → site=' + Sim.state.site.id + ' · human-veto expired');
        vetoCleanup = setTimeout(function () { veto.classList.remove('open'); resetVetoText(); }, 6000);
      }
    }, 100);
  }
  function resetVetoText() {
    veto.querySelector('p').innerHTML = EN
      ? '<strong>Fall confirmed — simulated 119/e-Gen sequence.</strong> Human-veto countdown; if no response, a simulated dispatch is sent. <em>Nothing connects to real emergency services — design-stage demo.</em>'
      : '<strong>낙상 확정 — 119/e-Gen 연계 시퀀스(모의).</strong> 관리자 거부권(human veto) 카운트다운. 시간 내 응답이 없으면 모의 출동 요청이 발신됩니다. <em>실제 119에 연결되지 않습니다 — 설계 단계 시연.</em>';
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

  var LADDER_BY_KIND = { fall: 3, inactive: 3, fire: 3, ppe: 1, heat: 2, posture: 1, health: 2, fatigue: 2, zone: 1, edge_loss: 2, recover: 0 };
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
        '<td>' + (EN ? k.en : k.ko + ' <span style="color:var(--ink-4)">' + k.en + '</span>') + '</td>' +
        '<td><span class="badge ' + ev.sev + '">' + ev.sev.toUpperCase() + '</span></td>' +
        '<td>' + (ev.worker || '—') + '</td><td>' + ev.site + '</td>' +
        '<td style="color:' + (ev.source === 'LIVE' ? 'var(--ok)' : 'var(--cyan)') + '">' + ev.source + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--ink-4)">' + (EN ? 'No events yet — inject a scenario from the Control Twin.' : '아직 이벤트가 없습니다 — 관제 트윈에서 시나리오를 주입해 보세요.') + '</td></tr>';

    var st = Sim.state;
    var falls = st.allEvents.filter(function (e) { return e.kind === 'fall'; }).length;
    var liveN = st.allEvents.filter(function (e) { return e.source === 'LIVE'; }).length;
    var kb = st.uplinkTotal / 1024;
    var sessionSec = st.t;
    var cams = 4 + (st.liveTile ? 1 : 0); // CCTV-streaming alternative = one H.264 stream per camera
    var videoKB = cams * 2500 / 8 * sessionSec;
    document.getElementById('debrief').innerHTML = EN
      ? (dbCard(st.eventsToday.total, 'Total events') +
         dbCard(falls, 'Falls confirmed') +
         dbCard(liveN, 'LIVE-source events') +
         dbCard(st.msgCount.toLocaleString(), 'Uplink messages') +
         dbCard(kb.toFixed(1) + ' KB', 'Actually sent (skeletons+events)') +
         dbCard('×' + Math.round(videoKB / Math.max(1, kb)).toLocaleString(), 'Less than video (' + cams + ' cameras)'))
      : (dbCard(st.eventsToday.total, '총 이벤트') +
         dbCard(falls, '낙상 확정') +
         dbCard(liveN, 'LIVE 소스 이벤트') +
         dbCard(st.msgCount.toLocaleString(), '업링크 메시지') +
         dbCard(kb.toFixed(1) + ' KB', '실전송(스켈레톤+이벤트)') +
         dbCard('×' + Math.round(videoKB / Math.max(1, kb)).toLocaleString(), '영상 대비 절감(카메라 ' + cams + '대 기준)'));
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

  /* ── static English pack (?en / toggle) — console-wide reviewer mode ── */
  function T(sel, html) { var el = document.querySelector(sel); if (el) el.innerHTML = html; }
  function TT(sel, txt) { var el = document.querySelector(sel); if (el && el.lastChild) el.lastChild.textContent = txt; }
  if (EN) {
    document.documentElement.lang = 'en';
    // tabs
    var tabEn = { twin: 'Control Twin', live: 'Live', agents: 'Agents', events: 'Events', evidence: 'Evidence' };
    var tabSub = { twin: 'TWIN · SIM', live: 'LIVE · EDGE', agents: '12-AGENT', events: 'SESSION', evidence: 'EVIDENCE' };
    document.querySelectorAll('.tab').forEach(function (t) {
      t.innerHTML = tabEn[t.dataset.route] + '<span class="en">' + tabSub[t.dataset.route] + '</span>';
    });
    T('#portal-link', 'Portal');
    T('.paper-link[href="index.html"]', 'Paper ↗');
    // mode badges
    T('#route-twin .mode-badge', '⟦ SIMULATION ⟧ synthetic data · scenarios injectable — not real workers');
    T('#route-live .mode-badge', '⟦ LIVE ⟧ your webcam · on-device inference — frames never leave this page');
    T('#route-agents .mode-badge', '⟦ DESIGN-STAGE PoC ⟧ 12-agent harness — per Table 2, designed but not evaluated');
    T('#route-events .mode-badge', 'Session data — shared SIM·LIVE event bus (synthetic + real device)');
    T('#route-evidence .mode-badge', '⟦ MEASURED ⟧ results reported in the paper — full run_20260722_195713_full70 · subset run_20260627_222419');
    // scenario buttons
    var scEn = { fall: ' Inject fall', ppe: ' PPE violation', fire: ' Ignite fire', heat: ' Heat stress', inactive: ' Inactivity', reset: ' Reset to normal' };
    document.querySelectorAll('[data-sc]').forEach(function (b) { b.lastChild.textContent = scEn[b.dataset.sc]; });
    TT('#btn-autopilot', ' Autopilot'); TT('#btn-tts', ' Voice alerts');
    TT('#btn-live', ' Connect my camera as CAM-07');
    T('#btn-videofree', 'Hide video · skeleton-only');
    T('#btn-replay', 'No camera? Synthetic REPLAY');
    // rail
    T('.rail .panel:nth-child(1) h3', 'Live KPI <span class="badge warn">SIM synthetic</span>');
    var kpiEn = { 'k-sites': 'SITES', 'k-workers': 'TRACKED', 'k-uplink': 'UPLINK kbps', 'k-crit': 'CRIT', 'k-warn': 'WARN', 'k-wbgt': 'WBGT' };
    Object.keys(kpiEn).forEach(function (id) {
      var b = document.getElementById(id); if (b && b.nextElementSibling) b.nextElementSibling.textContent = kpiEn[id];
    });
    var wcl = document.querySelectorAll('#wcard .wc-m span');
    if (wcl.length >= 4) { wcl[0].textContent = 'HR BPM (wearable · sim)'; wcl[1].textContent = 'REBA (simplified)'; wcl[2].textContent = 'Fatigue load'; wcl[3].textContent = 'Time on task'; }
    var railH3 = document.querySelectorAll('.rail .panel h3'); // [0]=KPI, [1]=feed, [2]=uplink (wcard has no h3)
    if (railH3[1]) railH3[1].innerHTML = 'Alert feed <span class="badge info">shared SIM+LIVE bus</span>';
    if (railH3[2]) railH3[2].textContent = 'Event uplink — everything sent to the center';
    T('.up-note', 'Pixels, video, and raw biometrics never appear in this list. That is the core claim of the paper.');
    // live route storyboard + privacy
    var steps = document.querySelectorAll('#live-steps .step p');
    if (steps.length >= 4) {
      steps[0].innerHTML = '<strong>Allow the camera</strong> — accept the browser permission prompt. ~5 s.';
      steps[1].innerHTML = '<strong>Model load</strong> — TF.js + MoveNet MultiPose Lightning (the model used in the paper) is fetched from a CDN and initialized. ~10 s.';
      steps[2].innerHTML = '<strong>Show your full body</strong> — stand about 2 m from the camera. Multiple people are tracked simultaneously.';
      steps[3].innerHTML = '<strong>Watch the state machine</strong> — slowly sit or lie down to trigger the warn → fall transition. Alerts also propagate to the Control Twin and Agents views.';
    }
    T('#route-live .privacy-plate', '<b>Video-free principle.</b> All inference runs inside this tab (MoveNet MultiPose · the same fall state machine validated on URFD in the paper · deployed thresholds unchanged). The only thing that leaves over the network is the JSON in the uplink panel on the right — never pixels.');
    // agents route
    T('#route-agents .panel > h3', 'Sense → Judge → Act → Connect orchestration');
    var rungs = document.querySelectorAll('.rung');
    if (rungs.length === 4) { rungs[0].textContent = 'L0 Observe'; rungs[1].textContent = 'L1 Alert'; rungs[2].textContent = 'L2 Mitigate'; rungs[3].innerHTML = 'L3 Intervene <span class="mono">(human-veto)</span>'; }
    T('#veto-ack', 'STOP · VETO');
    var agH3 = document.querySelectorAll('#route-agents h3');
    if (agH3.length >= 2) agH3[1].textContent = 'Event traces';
    T('#route-agents .footnote', 'Each trace is generated from a real bus event (not pre-recorded). Confidence/fusion scores are simulated values, and the harness itself is a <b>design-stage proof-of-concept</b>, as stated in the paper.');
    // events route
    var evH3 = document.querySelectorAll('#route-events h3');
    if (evH3.length >= 2) {
      if (evH3[0].childNodes.length) evH3[0].childNodes[0].textContent = 'Session event log ';
      TT('#btn-export', ' Export JSON');
      evH3[1].textContent = 'Session debrief';
    }
    var ths = document.querySelectorAll('#ev-table th');
    var thEn = ['Time', 'Kind', 'Severity', 'Subject', 'Site', 'Source'];
    ths.forEach(function (th, i) { th.textContent = thEn[i] || th.textContent; });
    T('#route-events .footnote', 'Uplink totals are the actual byte counts of the skeleton/event JSON; the video equivalent assumes H.264 720p (≈2.5 Mbps) — reproducing, from session data, the "2–3 orders of magnitude" claim of §IV-C.');
    // evidence route (headline cards)
    T('#route-evidence .panel > h3', 'URFD fall detection — deployed logic, no re-tuning (full 70 sequences)');
    var evc = document.querySelectorAll('#route-evidence .evi-card .cap');
    if (evc.length >= 6) {
      evc[0].innerHTML = 'Recall — 23 of 30 falls on the FULL benchmark. The 8+8 subset scored 1.00, which the full run confirms was an upper bound — misses crossed thresholds only transiently without sustaining the 700 ms window (§IV-A).';
      evc[1].innerHTML = 'F1 (precision 0.61) — the 15 false alarms split into deep-bending vs deliberate lying-down classes (subset F1 0.84).';
      evc[2].innerHTML = 'Median detection latency — 57 frames @30 fps on the full run (subset: 99.5 frames ≈ 3.3 s), including the 700 ms confirmation.';
      evc[3].innerHTML = 'Post-processing per frame (REBA + fire pixel-scan, Colab x86 vCPU) — the bottleneck is neural inference, not the platform logic.';
      evc[5].innerHTML = 'Uplink reduction — a few kbps of skeletons per worker vs an H.264 stream. The uplink panel of this console reproduces the same message schema live.';
    }
    var evH3s = document.querySelectorAll('#route-evidence h3');
    if (evH3s.length >= 3) { evH3s[1].textContent = 'Paper figures (Figures 1–4)'; evH3s[2].textContent = 'Implementation transparency (Table 2)'; }
    var conf = document.querySelector('#route-evidence .micro');
    if (conf) conf.textContent = 'Confusion (full n=70)';
  }

  /* language toggle (persists; reload applies) */
  (function () {
    var pill = document.createElement('div');
    pill.className = 'lang-pill-console';
    pill.innerHTML = '<button data-l="ko"' + (EN ? '' : ' class="on"') + '>KO</button><button data-l="en"' + (EN ? ' class="on"' : '') + '>EN</button>';
    var clock = document.getElementById('clock');
    clock.parentNode.insertBefore(pill, clock);
    pill.addEventListener('click', function (e) {
      var l = e.target && e.target.dataset && e.target.dataset.l;
      if (!l) return;
      try { localStorage.setItem('shinek_console_lang', l); } catch (err) {}
      location.reload();
    });
  })();

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

  /* ── edge liveness watchdog — detects a silent edge node within 5 s ──
   * Edge pages (worksite.html) beat at 1 Hz over BroadcastChannel; a node
   * that stays silent past the 4 s window (swept every 500 ms) raises a
   * system-level EDGE LOSS alert on the same bus as safety events. */
  if (window.SHLiveness) {
    var wd = window.SHLiveness.startWatchdog({
      onNode: function (node) {
        addTrace('CONNECT', 'liveness: edge node "' + node + '" registered — 1 Hz heartbeat');
      },
      onLoss: function (node, silenceMs) {
        Sim.ingestSystem('edge_loss', node, { silence_ms: Math.round(silenceMs) });
        addTrace('CONNECT', 'liveness watchdog: "' + node + '" silent ' +
          (silenceMs / 1000).toFixed(1) + ' s → EDGE LOSS raised (system alert)');
      },
      onRestore: function (node) {
        Sim.ingestSystem('recover', node, { note: 'heartbeat restored' });
        addTrace('CONNECT', 'liveness: "' + node + '" heartbeat restored');
      },
      onBye: function (node) {
        addTrace('CONNECT', 'liveness: "' + node + '" clean shutdown (bye)');
      }
    });
    /* the header pill is now a VERIFIED liveness readout, not demo state */
    var pill = document.getElementById('edge-pill');
    if (pill) setInterval(function () {
      var ids = Object.keys(wd.nodes);
      var alive = 0, lost = 0;
      ids.forEach(function (id) {
        var n = wd.nodes[id];
        if (n.bye) return;              // departed cleanly — not an outage
        if (n.lost) lost++; else if (n.ever) alive++;
      });
      pill.classList.remove('idle', 'lost');
      if (lost > 0) {
        pill.classList.add('lost');
        pill.innerHTML = '<i></i>EDGE LOSS · ' + lost;
      } else if (alive > 0) {
        pill.innerHTML = '<i></i>EDGE ONLINE · ' + alive + ' · HB';
      } else {
        pill.classList.add('idle');
        pill.innerHTML = '<i></i>EDGE · NO NODE';
      }
    }, 500);
  }

  /* a first ambient event so the feed is never empty */
  setTimeout(function () { Sim.scenario('ppe'); }, 4000);

  if (location.search.indexOf('light') > -1) document.body.classList.add('capture-light');

  /* demo/capture helpers via query params:
   *   ?autoreplay — start the synthetic REPLAY on load (e.g. console.html?autoreplay#live)
   *   ?demo       — inject a fall + fire shortly after load for guided demos */
  if (location.search.indexOf('autoreplay') > -1) {
    setTimeout(function () {
      Live.state.cv = document.getElementById('live-canvas');
      Live.state.ctx = Live.state.cv.getContext('2d');
      Live.state.video = document.getElementById('live-video');
      Live.startReplay();
    }, 600);
  }
  if (location.search.indexOf('demo') > -1) {
    setTimeout(function () { Sim.scenario('fall'); }, 2500);
    setTimeout(function () { Sim.scenario('fire'); }, 5000);
  }
})();

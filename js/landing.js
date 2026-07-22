/* SHine-K landing — reveal, count-up, KO/EN toggle, hero twin, privacy canvases */
(function () {
  'use strict';

  /* ── reveal on scroll ── */
  var io = new IntersectionObserver(function (ents) {
    ents.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ── count-up (static fallback text already present) ── */
  function countUp(el) {
    var target = parseFloat(el.dataset.count);
    var dec = +(el.dataset.dec || 0);
    var final = dec ? target.toFixed(dec) : Math.round(target).toLocaleString();
    if (document.hidden ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      el.textContent = final;             // never freeze mid-animation off-screen
      return;
    }
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / 1200);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = target * eased;
      el.textContent = p < 1 ? (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()) : final;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var cio = new IntersectionObserver(function (ents) {
    ents.forEach(function (e) {
      if (e.isIntersecting) { countUp(e.target); cio.unobserve(e.target); }
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('[data-count]').forEach(function (el) { cio.observe(el); });

  /* ── KO/EN toggle via data-en (original KO cached on first switch) ── */
  var lang = 'ko';
  function setLang(l) {
    if (l === lang) return;
    lang = l;
    document.documentElement.lang = l;
    document.querySelectorAll('[data-en]').forEach(function (el) {
      if (!el.dataset.ko) el.dataset.ko = el.innerHTML;
      el.innerHTML = l === 'en' ? el.dataset.en : el.dataset.ko;
    });
    document.getElementById('lang-ko').classList.toggle('on', l === 'ko');
    document.getElementById('lang-en').classList.toggle('on', l === 'en');
    try { localStorage.setItem('shinek_lang', l); } catch (e) {}
  }
  document.getElementById('lang-ko').addEventListener('click', function () { setLang('ko'); });
  document.getElementById('lang-en').addEventListener('click', function () { setLang('en'); });
  try { if (localStorage.getItem('shinek_lang') === 'en') setLang('en'); } catch (e) {}

  /* ── latency strip (real per-sequence trigger frames) ── */
  var LAT = [150, 81, 202, 41, 118, 57, 122, 51]; // fall-01..08 trigger frames
  var strip = document.getElementById('lat-strip');
  if (strip) {
    var mx = Math.max.apply(null, LAT);
    strip.innerHTML = LAT.map(function (f, i) {
      return '<i class="fall" style="height:' + Math.round(f / mx * 100) + '%" title="fall-0' + (i + 1) + ': ' + f + ' frames"></i>';
    }).join('');
  }

  /* ── bibtex copy (text captured once, before any button-label mutation) ── */
  var bc = document.getElementById('bib-copy');
  if (bc) {
    var bibText = document.getElementById('bibtex').innerText.replace(/^(복사|Copy)\n/, '');
    bc.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(bibText);
      bc.textContent = '복사됨 ✓';
      setTimeout(function () { bc.textContent = lang === 'en' ? 'Copy' : '복사'; }, 1600);
    });
  }

  /* ── hero mini-twin: walk → fall → alert loop ── */
  var cv = document.getElementById('hero-canvas');
  if (cv) {
    var ctx = cv.getContext('2d');
    var BONES = [[15,13],[13,11],[16,14],[14,12],[11,12],[5,11],[6,12],[5,6],[5,7],[7,9],[6,8],[8,10]];
    var t = 0, alertFlash = 0, msgs = [];

    function kpsAt(t, W, H) {
      var phase = t % 11;
      var cx = W * 0.24, gy = H * 0.78, Hb = H * 0.5;
      var lie = phase < 5.5 ? 0 : phase < 6.2 ? (phase - 5.5) / 0.7 : phase < 9.5 ? 1 : Math.max(0, 1 - (phase - 9.5) / 1.0);
      var walk = phase < 5.5 ? Math.sin(t * 5.2) : 0;
      cx += Math.min(phase, 5.5) * W * 0.055;
      var hw = Hb * 0.115, ww = Hb * 0.075;
      var pts = [
        [0.06, 0.97], [0.045, 0.99], [0.02, 0.99], [0, 0.955], [-0.02, 0.955],
        [0.115, 0.82], [-0.115, 0.82],
        [0.16 + walk * 0.05, 0.66], [-0.16 - walk * 0.05, 0.66],
        [0.18 + walk * 0.09, 0.52], [-0.18 - walk * 0.09, 0.52],
        [0.075, 0.52], [-0.075, 0.52],
        [0.075 + walk * 0.12, 0.27], [-0.075 - walk * 0.12, 0.27],
        [0.075 + walk * 0.2, 0.01], [-0.075 - walk * 0.2, 0.01]
      ];
      var ang = lie * 1.32; // ~76° — lying figure keeps limb structure
      return { kps: pts.map(function (p) {
        var lx = p[0] * Hb, ly = p[1] * Hb;
        return [cx + lx * Math.cos(ang * 0.4) + ly * Math.sin(ang),
                gy - ly * Math.cos(ang) - lx * Math.sin(ang) * 0.25];
      }), falling: phase >= 5.5 && phase < 9.5, justFell: phase >= 6.2 && phase < 6.35 };
    }

    function draw() {
      var W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      // grid
      ctx.strokeStyle = 'rgba(148,163,184,0.07)'; ctx.lineWidth = 1;
      for (var gx = 0; gx < W; gx += 26) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (var gy2 = 0; gy2 < H; gy2 += 26) { ctx.beginPath(); ctx.moveTo(0, gy2); ctx.lineTo(W, gy2); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(148,163,184,0.28)';
      ctx.beginPath(); ctx.moveTo(14, H * 0.79); ctx.lineTo(W - 14, H * 0.79); ctx.stroke();

      var r = kpsAt(t, W, H);
      var col = r.falling ? '#F04452' : '#16C68C';
      if (r.justFell && alertFlash <= 0) {
        alertFlash = 1;
        msgs.unshift('{"type":"alert","kind":"fall","site":"GM-A"}');
        if (msgs.length > 4) msgs.pop();
      }
      if (Math.floor(t * 4) % 3 === 0 && msgs[0] !== undefined && Math.random() < 0.02) {
        msgs.unshift('{"type":"pose","id":"GA-03","kp":17}');
        if (msgs.length > 4) msgs.pop();
      }
      alertFlash = Math.max(0, alertFlash - 0.016);

      ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      BONES.forEach(function (b) {
        ctx.beginPath(); ctx.moveTo(r.kps[b[0]][0], r.kps[b[0]][1]);
        ctx.lineTo(r.kps[b[1]][0], r.kps[b[1]][1]); ctx.stroke();
      });
      var sh = [(r.kps[5][0] + r.kps[6][0]) / 2, (r.kps[5][1] + r.kps[6][1]) / 2];
      ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(r.kps[0][0], r.kps[0][1]); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(r.kps[0][0], r.kps[0][1] - 3, 5, 0, 6.283); ctx.fill();

      // alert ring
      if (alertFlash > 0) {
        ctx.strokeStyle = 'rgba(240,68,82,' + (alertFlash * 0.8).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sh[0], sh[1], 30 + (1 - alertFlash) * 34, 0, 6.283); ctx.stroke();
      }

      // uplink messages
      ctx.font = '600 10px "JetBrains Mono", monospace';
      msgs.forEach(function (m, i) {
        ctx.fillStyle = m.indexOf('alert') > -1 ?
          'rgba(245,158,11,' + (0.95 - i * 0.2) + ')' : 'rgba(148,163,184,' + (0.7 - i * 0.15) + ')';
        ctx.fillText(m, 14, H - 16 - i * 16);
      });
      ctx.fillStyle = 'rgba(74,222,158,0.85)';
      ctx.fillText('no pixels leave the site', W - 148, H - 16);

      t += 0.016;
      if (heroVisible) requestAnimationFrame(draw);
    }
    var heroVisible = true;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      t = 2.2;             // draw one representative mid-walk frame, no loop
      heroVisible = false;
      draw();
    } else {
      new IntersectionObserver(function (ents) {
        ents.forEach(function (e) {
          var was = heroVisible;
          heroVisible = e.isIntersecting;
          if (heroVisible && !was) requestAnimationFrame(draw);
        });
      }, { threshold: 0.05 }).observe(cv);
      requestAnimationFrame(draw);
    }
  }

  /* ── privacy canvases: left "camera" mosaic vs right skeleton ── */
  function privLeft() {
    var c = document.getElementById('priv-left'); if (!c) return;
    var x = c.getContext('2d');
    x.fillStyle = '#0B0F19'; x.fillRect(0, 0, c.width, c.height);
    for (var i = 0; i < 380; i++) {
      var g = 24 + Math.random() * 60;
      x.fillStyle = 'rgb(' + (g + 14) + ',' + g + ',' + (g - 6) + ')';
      x.fillRect((i % 20) * 21, Math.floor(i / 20) * 11, 21, 11);
    }
    x.fillStyle = 'rgba(240,68,82,0.85)';
    x.font = '700 11px "JetBrains Mono", monospace';
    x.fillText('RAW VIDEO — never uploaded', 12, 22);
    x.strokeStyle = 'rgba(240,68,82,0.6)'; x.lineWidth = 2;
    x.strokeRect(3, 3, c.width - 6, c.height - 6);
  }
  function privRight() {
    var c = document.getElementById('priv-right'); if (!c) return;
    var x = c.getContext('2d');
    x.fillStyle = '#04070D'; x.fillRect(0, 0, c.width, c.height);
    var BONES = [[15,13],[13,11],[16,14],[14,12],[11,12],[5,11],[6,12],[5,6],[5,7],[7,9],[6,8],[8,10]];
    var cx = c.width / 2, gy = c.height * 0.88, Hb = c.height * 0.7;
    var pts = [[0.05,0.97],[0.04,0.99],[0.02,0.99],[0,0.955],[-0.02,0.955],[0.115,0.82],[-0.115,0.82],[0.17,0.65],[-0.17,0.65],[0.2,0.5],[-0.2,0.5],[0.075,0.52],[-0.075,0.52],[0.08,0.27],[-0.08,0.27],[0.08,0.01],[-0.08,0.01]];
    var kps = pts.map(function (p) { return [cx + p[0] * Hb, gy - p[1] * Hb]; });
    x.strokeStyle = '#16C68C'; x.lineWidth = 2.6; x.lineCap = 'round';
    BONES.forEach(function (b) {
      x.beginPath(); x.moveTo(kps[b[0]][0], kps[b[0]][1]); x.lineTo(kps[b[1]][0], kps[b[1]][1]); x.stroke();
    });
    var sh = [(kps[5][0] + kps[6][0]) / 2, (kps[5][1] + kps[6][1]) / 2];
    x.beginPath(); x.moveTo(sh[0], sh[1]); x.lineTo(kps[0][0], kps[0][1]); x.stroke();
    x.fillStyle = '#16C68C';
    x.beginPath(); x.arc(kps[0][0], kps[0][1] - 3, 5, 0, 6.283); x.fill();
    kps.forEach(function (k) { x.beginPath(); x.arc(k[0], k[1], 2.6, 0, 6.283); x.fill(); });
    x.fillStyle = 'rgba(22,198,140,0.9)';
    x.font = '700 11px "JetBrains Mono", monospace';
    x.fillText('17 keypoints + events — this is all', 12, 22);
  }
  privLeft(); privRight();
})();

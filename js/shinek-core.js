/* SHine-K core — the deployed fall/inactivity state machine and simplified REBA.
 * This is the SAME logic evaluated on URFD in the Sensors paper (deployed
 * defaults, sens = 1.0): full 70-sequence benchmark recall 0.77 / F1 0.68,
 * standing-fall subset recall 1.00 / F1 0.84.
 * Keypoints follow COCO-17 order: [x, y, score] per joint.
 */
(function (global) {
  'use strict';

  var ACT_IDX = [0, 5, 6, 9, 10, 11, 12, 15, 16]; // nose, shoulders, wrists, hips, ankles

  function FallSM(opts) {
    opts = opts || {};
    this.sens = opts.sens != null ? opts.sens : 1.0;
    /* contextual descent-velocity gate (evaluated in the IEEE Access
     * revision, default OFF to preserve the evaluated deployed operating
     * point): when velGateS is set (seconds), a down posture confirms as
     * 'fall' only if a hip descent faster than gateVth frame-heights/s
     * occurred within velGateS seconds before/at the down onset —
     * deliberate slow lying/bending never shows that descent.
     * Featured operating point from the paper (Table 5): gateVth 0.30 with
     * velGateS 2 s — URFD FPs 15->10 at unchanged recall; GMDCSA-24
     * transfer FPs 40->8 (precision 0.664->0.895) at recall 0.861. */
    this.velGateS = opts.velGateS != null ? opts.velGateS : null;
    this.gateVth = opts.gateVth != null ? opts.gateVth : 0.30;
    this.reset();
  }

  FallSM.prototype.reset = function () {
    this.downSince = null;
    this.staticSince = null;
    this.hipHist = [];
    this.lastKp = null;
    this.state = 'normal';
    this.tilt = 0; this.aspect = 0; this.vel = 0; this.mv = 0;
    this.lastRapid = null;
  };

  FallSM.prototype._v = function (kps, i) {
    var k = kps[i];
    return (k && k[2] > 0.3) ? k : null;
  };

  /* kps: array of 17 [x,y,score]; W,H: frame size; now: ms timestamp */
  FallSM.prototype.step = function (kps, W, H, now) {
    var shL = this._v(kps, 5), shR = this._v(kps, 6);
    var hipL = this._v(kps, 11), hipR = this._v(kps, 12);
    if (!shL || !shR) { this.state = 'normal'; this.lastKp = kps; return this.state; }

    var shX = (shL[0] + shR[0]) / 2, shY = (shL[1] + shR[1]) / 2;
    var hpX, hpY;
    if (hipL && hipR) { hpX = (hipL[0] + hipR[0]) / 2; hpY = (hipL[1] + hipR[1]) / 2; }
    else {
      var sw = Math.hypot(shR[0] - shL[0], shR[1] - shL[1]);
      hpX = shX; hpY = shY + sw * 1.4;
    }

    var dx = shX - hpX, dy = shY - hpY;
    var tilt = Math.atan2(Math.abs(dx), Math.abs(dy)) * 180 / Math.PI;

    var xs = [], ys = [];
    for (var j = 0; j < 17; j++) {
      if (kps[j] && kps[j][2] > 0.3) { xs.push(kps[j][0]); ys.push(kps[j][1]); }
    }
    var aspect = 0;
    if (xs.length >= 2) {
      aspect = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) /
               Math.max(1, (Math.max.apply(null, ys) - Math.min.apply(null, ys)));
    }

    this.hipHist.push([hpY / H, now / 1000]);
    if (this.hipHist.length > 8) this.hipHist.shift();
    var vel = 0;
    if (this.hipHist.length >= 2) {
      var a = this.hipHist[0], z = this.hipHist[this.hipHist.length - 1];
      vel = (z[0] - a[0]) / Math.max(0.001, z[1] - a[1]);
    }

    var mv = 0;
    if (this.lastKp) {
      var sm = 0, nm = 0;
      for (var t = 0; t < ACT_IDX.length; t++) {
        var i2 = ACT_IDX[t], c = kps[i2], l = this.lastKp[i2];
        if (c && l && c[2] > 0.3 && l[2] > 0.3) {
          sm += Math.hypot((c[0] - l[0]) / W, (c[1] - l[1]) / H); nm++;
        }
      }
      mv = nm ? sm / nm : 0;
    }
    this.lastKp = kps;

    var TILT_DOWN = 52 * this.sens, ASP_DOWN = 1.0 * this.sens, VEL_DROP = 0.9 / this.sens;
    var isDown = (tilt > TILT_DOWN) || (aspect > ASP_DOWN);
    var rapid = vel > VEL_DROP;
    if (vel > this.gateVth) this.lastRapid = now;

    if (isDown) {
      if (!this.downSince) this.downSince = now;
      var confirmed = (now - this.downSince > 700);
      if (confirmed && this.velGateS != null) {
        confirmed = this.lastRapid != null &&
                    this.lastRapid >= this.downSince - this.velGateS * 1000;
      }
      this.state = confirmed ? 'fall' : 'warn';
    } else if (rapid) {
      this.state = 'warn'; this.downSince = null;
    } else {
      this.state = 'normal'; this.downSince = null;
    }

    if (this.state === 'normal') {
      if (mv < 0.0045) {
        if (!this.staticSince) this.staticSince = now;
        var ss = (now - this.staticSince) / 1000;
        if (mv < 0.0016 && ss > 12) this.state = 'inactive';
        else if (ss > 25) this.state = 'sedentary';
      } else this.staticSince = null;
    } else this.staticSince = null;

    this.tilt = tilt; this.aspect = aspect; this.vel = vel; this.mv = mv;
    return this.state;
  };

  /* Simplified REBA approximation (demo PoC, as in the paper's pose module):
   * trunk = trunk tilt in degrees, arm = upper-arm raise in degrees → level 1–4 */
  function rebaLevel(trunk, arm) {
    var r = 1;
    if (trunk > 20 || arm > 45) r = 2;
    if (trunk > 45 || arm > 90) r = 3;
    if (trunk > 60 || arm > 120) r = 4;
    return r;
  }

  /* Full 70-sequence URFD run (run_20260722_195713_full70) — headline result */
  var URFD_EVAL_FULL = {
    dataset: 'UR Fall Detection (URFD), cam0 RGB — FULL benchmark',
    model: 'MoveNet MultiPose Lightning (TF-Hub)',
    run: 'run_20260722_195713_full70',
    nFall: 30, nAdl: 40,
    counts: { TP: 23, FP: 15, FN: 7, TN: 25 },
    precision: 0.6053, recall: 0.7667, f1: 0.6765, accuracy: 0.6857,
    latencyFrames: { mean: 76.52, median: 57 },
    failureModes: 'Misses crossed thresholds only transiently (max tilt to 89°) without sustaining the 700 ms window; false alarms split into sustained deep-bending vs deliberate lying-down classes.'
  };

  /* Standing-fall subset shipped with the early validation (run_20260627_222419) */
  var URFD_EVAL = {
    dataset: 'UR Fall Detection (URFD), cam0 RGB',
    model: 'MoveNet MultiPose Lightning (TF-Hub)',
    stateMachine: 'faithful port of worksite analyzePerson(), deployed defaults (sens=1.0)',
    run: 'run_20260627_222419',
    caveat: 'URFD = clean single-subject lab footage, fixed camera. Bounds generalization; != SME shop-floor. 8-fall subset — not a population guarantee.',
    nFall: 8, nAdl: 8,
    counts: { TP: 8, FP: 3, FN: 0, TN: 5 },
    precision: 0.7273, recall: 1.0, f1: 0.8421, accuracy: 0.8125,
    latencyFrames: { mean: 102.75, median: 99.5 },
    perSequence: [
      ['fall-01', 1, 1, 150, 160], ['fall-02', 1, 1, 81, 110], ['fall-03', 1, 1, 202, 215],
      ['fall-04', 1, 1, 41, 96], ['fall-05', 1, 1, 118, 151], ['fall-06', 1, 1, 57, 100],
      ['fall-07', 1, 1, 122, 156], ['fall-08', 1, 1, 51, 91],
      ['adl-01', 0, 0, null, 150], ['adl-02', 0, 0, null, 180], ['adl-03', 0, 0, null, 180],
      ['adl-04', 0, 1, 95, 150], ['adl-05', 0, 1, 124, 180], ['adl-06', 0, 1, 193, 230],
      ['adl-07', 0, 0, null, 180], ['adl-08', 0, 0, null, 180]
    ]
  };

  global.SHineK = { FallSM: FallSM, rebaLevel: rebaLevel, URFD_EVAL: URFD_EVAL, URFD_EVAL_FULL: URFD_EVAL_FULL, ACT_IDX: ACT_IDX };
})(typeof window !== 'undefined' ? window : this);

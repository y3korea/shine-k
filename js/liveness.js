/* SHine-K liveness protocol — edge heartbeat + control-twin watchdog.
 * Closes the silent-failure gap of browser edge nodes (tab crash, reload,
 * display sleep, background throttling): the edge emits {type:'hb'} at 1 Hz
 * on the same event-only uplink; the control twin flags a node STALE after
 * 4 s of silence, swept every 500 ms, so a dead edge is detected within a
 * bounded 5 s of its last beat (1 s beat gap + 4 s window + 0.5 s sweep,
 * worst case ≤5.5 s) and raises a system-level alert on the shared bus.
 * Transport here is BroadcastChannel (real cross-tab messaging on one
 * machine); the JSON schema rides WebSocket/MQTT unchanged.
 * A browser that throttles hidden-tab timers below 1 Hz stops beating and
 * is therefore flagged — lifecycle failure modes become detectable instead
 * of silent, which is the point of the protocol.
 */
(function (global) {
  'use strict';

  var CH_NAME = 'shinek-uplink';
  var HB_MS = 1000;      // edge beat interval
  var STALE_MS = 4000;   // silence threshold
  var SWEEP_MS = 500;    // watchdog sweep period

  function channel() {
    try { return new BroadcastChannel(CH_NAME); } catch (e) { return null; }
  }

  /* ── edge side ─────────────────────────────────────────────── */
  function startEdgeHeartbeat(opts) {
    opts = opts || {};
    var node = opts.node || 'edge';
    var ch = channel();
    var seq = 0, t0 = Date.now();
    function beat() {
      var msg = {
        type: 'hb', node: node, seq: ++seq,
        up: Math.round((Date.now() - t0) / 1000),
        mode: opts.mode ? opts.mode() : undefined
      };
      if (ch) ch.postMessage(msg);
      if (opts.onEcho) opts.onEcho(msg);       // mirror into uplink inspector
      return msg;
    }
    if (ch) ch.postMessage({ type: 'hb-hello', node: node });
    var timer = setInterval(beat, opts.intervalMs || HB_MS);
    var stopped = false;
    function bye() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (ch) ch.postMessage({ type: 'hb-bye', node: node, seq: seq });
    }
    beat();
    /* clean shutdown is distinguishable from a crash (best-effort:
     * a killed tab never sends bye and is caught by the watchdog) */
    global.addEventListener('pagehide', bye);
    return { stop: bye, node: node };
  }

  /* ── control-twin side ─────────────────────────────────────── */
  function startWatchdog(opts) {
    opts = opts || {};
    var staleMs = opts.staleMs || STALE_MS;
    var ch = channel();
    var nodes = {};   // node -> {lastSeen, seq, lost, ever}
    if (ch) ch.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === 'hb' || m.type === 'hb-hello') {
        var n = nodes[m.node] || (nodes[m.node] = { lost: false, ever: false });
        var wasLost = n.lost;
        n.lastSeen = Date.now(); n.seq = m.seq || 0; n.lost = false;
        if (!n.ever) { n.ever = true; if (opts.onNode) opts.onNode(m.node); }
        else if (wasLost && opts.onRestore) opts.onRestore(m.node);
        if (opts.onBeat) opts.onBeat(m.node, m);
      } else if (m.type === 'hb-bye') {
        var b = nodes[m.node];
        if (b) { b.bye = true; b.lost = true; }
        if (opts.onBye) opts.onBye(m.node);
      }
    };
    var timer = setInterval(function () {
      var now = Date.now();
      Object.keys(nodes).forEach(function (id) {
        var n = nodes[id];
        if (!n.lost && n.lastSeen && now - n.lastSeen > staleMs) {
          n.lost = true;
          if (opts.onLoss) opts.onLoss(id, now - n.lastSeen);
        }
      });
    }, opts.sweepMs || SWEEP_MS);
    return {
      nodes: nodes,
      stop: function () { clearInterval(timer); if (ch) ch.close(); }
    };
  }

  global.SHLiveness = {
    startEdgeHeartbeat: startEdgeHeartbeat,
    startWatchdog: startWatchdog,
    HB_MS: HB_MS, STALE_MS: STALE_MS, SWEEP_MS: SWEEP_MS
  };
})(window);

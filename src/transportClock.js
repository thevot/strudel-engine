/**
 * Audible transport position — "which cycle is coming out of the speakers right now".
 *
 * Strudel's scheduler (Cyclist) plays cycle `c` at
 *   seconds_at_cps_change + latency + (c - num_cycles_at_cps_change) / cps
 * on the AudioContext clock, and the device emits that sample `outputLatency` later.
 * Visuals must follow this mapping; the time at which code was evaluated says
 * nothing about it (hot-swapping a pattern does not restart the scheduler).
 */

/** Largest plausible distance between the context clock and the speakers, in seconds. */
const MAX_OUTPUT_LAG = 1;

/** AudioContext time of the sample currently being heard. */
export function audibleTime(ctx, perfNow = globalThis.performance?.now?.()) {
  const now = ctx.currentTime;
  const stamp = ctx.getOutputTimestamp?.();
  if (stamp && stamp.contextTime > 0 && stamp.performanceTime > 0 && Number.isFinite(perfNow)) {
    const estimate = stamp.contextTime + (perfNow - stamp.performanceTime) / 1000;
    const lag = now - estimate;
    if (lag > -0.05 && lag < MAX_OUTPUT_LAG) return estimate;
  }
  return now - (ctx.outputLatency || ctx.baseLatency || 0);
}

/**
 * Tracks the scheduler's tempo anchors. The scheduler plans ahead of the speakers,
 * so after a tempo change the previous anchor stays valid until the new one is audible.
 * It must be sampled while playing (every animation frame is plenty).
 */
export function createTransportClock() {
  let segments = [];

  function sample(scheduler) {
    // While a tempo change is pending the anchor fields still describe the old tempo.
    if (!(scheduler.num_ticks_since_cps_change > 0) || !(scheduler.cps > 0)) return;
    const next = {
      time: scheduler.seconds_at_cps_change + scheduler.latency,
      cycle: scheduler.num_cycles_at_cps_change,
      cps: scheduler.cps,
    };
    if (!Number.isFinite(next.time) || !Number.isFinite(next.cycle)) return;
    const last = segments[segments.length - 1];
    if (last && last.time === next.time && last.cps === next.cps) return;
    // An anchor that goes back in cycles means the scheduler was restarted.
    if (last && next.cycle < last.cycle) segments = [];
    segments.push(next);
    if (segments.length > 8) segments.shift();
  }

  return {
    reset() { segments = []; },
    /**
     * @returns {number|null} audible cycle position (0 until the first event is heard),
     *   or null when the transport is stopped.
     */
    position(scheduler, ctx, perfNow) {
      if (!scheduler?.started || !ctx) {
        segments = [];
        return null;
      }
      sample(scheduler);
      if (segments.length === 0) return 0;
      const t = audibleTime(ctx, perfNow);
      let seg = segments[0];
      for (const s of segments) if (s.time <= t) seg = s;
      return Math.max(0, seg.cycle + (t - seg.time) * seg.cps);
    },
  };
}

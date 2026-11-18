// Talabat Rush Run: track generation + game rules. Shared by the game and the fairness bot (node tools/sim-rush.js).
(function (root) {
  'use strict';
  const C = {
    L: 1750,              // track length (units); about 90 s at the ramping speed
    V0: 14, V1: 26,       // speed at start / end
    LANE_T: 0.14,         // seconds to move one lane
    HOP_T: 0.6, HOP_H: 0.95,
    LOW_CLEAR: 0.28,      // hop height that clears cones / potholes
    BOOST_T: 2.6, BOOST_K: 1.5,
    INV_T: 1.5, HEARTS: 3,
    BIKE_HW: 0.27, BIKE_HL: 0.45,
    COIN: 100, HEART_BONUS: 1000, DELIVERED: 1000,
  };
  const KINDS = { cone: { hw: 0.24, len: 0.6, low: true }, hole: { hw: 0.32, len: 1.1, low: true }, car: { hw: 0.42, len: 2.8, low: false } };

  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const speedAt = (d) => C.V0 + (C.V1 - C.V0) * Math.min(1, Math.max(0, d / C.L));

  function generate(seed) {
    const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)];
    const obs = [], coins = [], pads = [];
    let d = 70, prevClear = [0, 1, 2], nextPad = 160 + R() * 60;
    while (d < C.L - 70) {
      const p = d / C.L, v = speedAt(d);
      // pattern choice, harder later
      const lanes = [0, 1, 2];
      let row = [null, null, null];
      const r = R();
      const lowK = () => (R() < 0.55 ? 'cone' : 'hole');
      if (p < 0.12 || r < 0.32 - p * 0.15) { row[pick(lanes)] = R() < 0.5 ? 'car' : lowK(); }
      else if (r < 0.72) { const free = pick(lanes); lanes.filter((l) => l !== free).forEach((l) => (row[l] = R() < 0.6 ? 'car' : lowK())); }
      else if (r < 0.86 && p > 0.2) { row = [lowK(), lowK(), lowK()]; }
      else { const free = pick(lanes), other = lanes.filter((l) => l !== free); row[other[0]] = 'car'; row[other[1]] = lowK(); }
      // fairness: a row must leave a clear lane, or be all low (hop over)
      const clear = [0, 1, 2].filter((l) => !row[l]);
      if (!clear.length && row.some((k) => k === 'car')) { row[pick([0, 1, 2])] = null; }
      row.forEach((k, l) => { if (k) obs.push({ d, lane: l, kind: k, ...KINDS[k] }); });
      const clr = [0, 1, 2].filter((l) => !row[l]);
      // spacing: generous early, tighter later; always >= 0.95 s of travel
      const gapT = 1.35 - 0.5 * p + R() * 0.45;
      const gap = Math.max(0.95 * v, gapT * v);
      const end = d + Math.max(...row.map((k) => (k ? KINDS[k].len : 0))); // after this row's longest obstacle
      // coins in the gap: a line in a lane that is clear for this row, leading on
      if (R() < 0.75) {
        const lane = clr.length ? pick(clr) : pick([0, 1, 2]);
        const n = 4 + Math.floor(R() * 4);
        for (let i = 0; i < n; i++) { const cd = end + 2 + i * 2.2; if (cd < end + gap - 3) coins.push({ d: cd, lane, h: 0.45 }); }
      }
      // coin arc over a low obstacle
      const lowLane = row.findIndex((k) => k === 'cone' || k === 'hole');
      if (lowLane >= 0 && R() < 0.5) {
        for (let i = -2; i <= 2; i++) { const cd = d + 0.3 + i * 1.6, u = (i + 2) / 4; coins.push({ d: cd, lane: lowLane, h: 0.45 + C.HOP_H * Math.sin(Math.PI * (0.15 + 0.7 * u)) }); }
      }
      // boost pad in a clear lane midway in the gap
      if (d > nextPad && d < C.L - 260 && clr.length) {
        pads.push({ d: end + gap * 0.4, lane: pick(clr), len: 2.4 });
        nextPad = d + 200 + R() * 80;
      }
      prevClear = clr;
      d = end + gap; // spacing is measured from the end of this row
    }
    // remove coins that sit inside an obstacle on the ground
    const ok = coins.filter((c) => c.h > 0.9 || !obs.some((o) => o.lane === c.lane && c.d > o.d - 1 && c.d < o.d + o.len + 1));
    ok.sort((a, b) => a.d - b.d); pads.sort((a, b) => a.d - b.d);
    return { seed, obs, coins: ok, pads };
  }

  function newRun(track) {
    return { track, t: 0, d: 0, lane: 1, x: 0, hopT: -1, h: 0, hearts: C.HEARTS, inv: 0, boost: 0, coins: 0,
      oi: 0, ci: 0, pi: 0, done: false, delivered: false, events: [], hits: 0 };
  }
  const laneX = (l) => l - 1;
  const score = (s) => s.coins * C.COIN + Math.floor(Math.min(s.d, C.L)) + (s.delivered ? s.hearts * C.HEART_BONUS + C.DELIVERED : 0);

  // input: 'left' | 'right' | 'hop'
  function act(s, a) {
    if (s.done) return;
    if (a === 'left' && s.lane > 0) { s.lane--; s.events.push({ e: 'lane' }); }
    else if (a === 'right' && s.lane < 2) { s.lane++; s.events.push({ e: 'lane' }); }
    else if (a === 'hop' && s.hopT < 0) { s.hopT = 0; s.events.push({ e: 'hop' }); }
  }

  function step(s, dt) {
    if (s.done) return;
    const tr = s.track;
    s.t += dt;
    const v = speedAt(s.d) * (s.boost > 0 ? C.BOOST_K : 1);
    s.v = v;
    const d0 = s.d; s.d += v * dt;
    // lateral
    const tx = laneX(s.lane), mv = dt / C.LANE_T;
    s.x += Math.max(-mv, Math.min(mv, tx - s.x));
    // hop
    if (s.hopT >= 0) { s.hopT += dt; if (s.hopT >= C.HOP_T) { s.hopT = -1; s.h = 0; s.events.push({ e: 'land' }); } else s.h = C.HOP_H * Math.sin(Math.PI * s.hopT / C.HOP_T); }
    s.inv = Math.max(0, s.inv - dt); s.boost = Math.max(0, s.boost - dt);
    // obstacles
    while (s.oi < tr.obs.length && tr.obs[s.oi].d + tr.obs[s.oi].len < s.d - C.BIKE_HL - 1) s.oi++;
    for (let i = s.oi; i < tr.obs.length; i++) {
      const o = tr.obs[i];
      if (o.d > s.d + C.BIKE_HL) break;
      if (o.hit || o.d + o.len < s.d - C.BIKE_HL) continue;
      if (Math.abs(s.x - laneX(o.lane)) >= C.BIKE_HW + o.hw) continue;
      if (o.low && s.h > C.LOW_CLEAR) continue;
      if (s.boost > 0) { o.hit = true; o.smashed = true; s.events.push({ e: 'smash', o }); continue; }
      if (s.inv > 0) continue;
      o.hit = true; s.hearts--; s.hits++; s.inv = C.INV_T; s.events.push({ e: 'hit', o });
      if (s.hearts <= 0) { s.done = true; s.events.push({ e: 'crash' }); return; }
    }
    // coins
    while (s.ci < tr.coins.length && tr.coins[s.ci].d < s.d - 1.5) s.ci++;
    for (let i = s.ci; i < tr.coins.length; i++) {
      const c = tr.coins[i];
      if (c.d > s.d + 0.7) break;
      if (c.got || c.d < s.d - 0.9) continue;
      if (Math.abs(s.x - laneX(c.lane)) < 0.5 && Math.abs(s.h + 0.45 - c.h) < 0.6) { c.got = true; s.coins++; s.events.push({ e: 'coin', c }); }
    }
    // boost pads
    while (s.pi < tr.pads.length && tr.pads[s.pi].d + tr.pads[s.pi].len < s.d - 1) s.pi++;
    for (let i = s.pi; i < tr.pads.length; i++) {
      const p = tr.pads[i];
      if (p.d > s.d) break;
      if (!p.used && s.d <= p.d + p.len + v * dt && Math.abs(s.x - laneX(p.lane)) < 0.45 && s.h < 0.3) { p.used = true; s.boost = C.BOOST_T; s.events.push({ e: 'boost' }); }
    }
    if (d0 < C.L && s.d >= C.L) { s.delivered = true; s.done = true; s.events.push({ e: 'delivered' }); }
  }

  // Fresh copy of a track (game mutates hit/got/used flags).
  function clone(tr) { return { seed: tr.seed, obs: tr.obs.map((o) => ({ ...o })), coins: tr.coins.map((c) => ({ ...c })), pads: tr.pads.map((p) => ({ ...p })) }; }

  const api = { C, KINDS, generate, newRun, step, act, score, speedAt, laneX, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RushCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

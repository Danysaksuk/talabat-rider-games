// Talabat Rush Run (endless): streamed track generation + game rules. Shared by the game and the
// fairness bot (node tools/sim-rush.js). Everything is deterministic for a given seed.
(function (root) {
  'use strict';
  const C = {
    V0: 14, V1: 26, VMAX: 32,   // speed: 14 -> 26 over the first 1,750 units, then slowly up to 32 by 6,000, then flat
    RAMP1: 1750, RAMP2: 6000,
    LANE_T: 0.14,               // seconds to move one lane
    HOP_T: 0.6, HOP_H: 0.95,
    LOW_CLEAR: 0.28,            // hop height that clears cones / potholes
    BOOST_T: 2.6, BOOST_K: 1.5,
    INV_T: 1.5, HEARTS: 3,
    BIKE_HW: 0.27, BIKE_HL: 0.45,
    COIN: 100,
    // lane-changing traffic: blinker for BLINK s, then slides one lane in MOVE s; it finishes REACT s
    // before the rider (at current speed) reaches it. Triggered TRIG = BLINK + MOVE + REACT s ahead.
    BLINK: 1.0, MOVE: 0.45, REACT: 0.75,
    AHEAD: 220,                 // track is generated at least this far ahead of the rider
    MAX_ROW_COINS: 12,          // <= 7 in a coin line + 5 in a hop arc (used by the anti-cheat bound)
  };
  C.TRIG = C.BLINK + C.MOVE + C.REACT;
  const KINDS = { cone: { hw: 0.24, len: 0.6, low: true }, hole: { hw: 0.32, len: 1.1, low: true }, car: { hw: 0.42, len: 2.8, low: false } };

  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const speedAt = (d) => (d < C.RAMP1 ? C.V0 + (C.V1 - C.V0) * Math.max(0, d) / C.RAMP1
    : C.V1 + (C.VMAX - C.V1) * Math.min(1, (d - C.RAMP1) / (C.RAMP2 - C.RAMP1)));
  const laneX = (l) => l - 1;
  // chance that a row with a car gets a lane-changer: none before 250, ~8% at 400, rising to 45% by 5,000
  const changeP = (d) => (d < 250 ? 0 : Math.min(0.45, 0.06 + 0.39 * (d - 250) / 4750));

  // An endless track: obs / coins / pads grow (in order) as extend() is called.
  function generate(seed) {
    const tr = { seed, obs: [], coins: [], pads: [], changers: [], g: { R: rng(seed), d: 70, nextPad: 0 } };
    tr.g.nextPad = 160 + tr.g.R() * 60;
    extend(tr, C.AHEAD);
    return tr;
  }

  function extend(tr, upTo) {
    const g = tr.g, R = g.R, pick = (a) => a[Math.floor(R() * a.length)];
    while (g.d < upTo) {
      const d = g.d, p = Math.min(1, d / C.RAMP1), late = Math.min(1, Math.max(0, (d - C.RAMP1) / (C.RAMP2 - C.RAMP1))), v = speedAt(d);
      const lanes = [0, 1, 2];
      let row = [null, null, null];
      const r = R();
      const lowK = () => (R() < 0.55 ? 'cone' : 'hole');
      if (p < 0.12 || r < 0.32 - p * 0.15) { row[pick(lanes)] = R() < 0.5 ? 'car' : lowK(); }
      else if (r < 0.72) { const free = pick(lanes); lanes.filter((l) => l !== free).forEach((l) => (row[l] = R() < 0.6 ? 'car' : lowK())); }
      else if (r < 0.86 && p > 0.2) { row = [lowK(), lowK(), lowK()]; }
      else { const free = pick(lanes), other = lanes.filter((l) => l !== free); row[other[0]] = 'car'; row[other[1]] = lowK(); }
      // fairness: a row must leave a clear lane, or be all low (hop over)
      if (![0, 1, 2].some((l) => !row[l]) && row.some((k) => k === 'car')) row[pick([0, 1, 2])] = null;
      const rowObs = [];
      row.forEach((k, l) => { if (k) rowObs.push({ d, lane: l, l0: l, x: laneX(l), kind: k, ...KINDS[k] }); });
      // lane-changer: a car slides into an adjacent EMPTY lane of its row. Its own lane is then free,
      // so the row always keeps an escape lane one step away.
      const R1 = R(), R2 = R();
      if (R1 < changeP(d)) {
        const cand = [];
        for (const o of rowObs) if (o.kind === 'car') for (const to of [o.lane - 1, o.lane + 1]) if (to >= 0 && to <= 2 && !row[to]) cand.push([o, to]);
        if (cand.length) { const [o, to] = cand[Math.floor(R2 * cand.length)]; o.to = to; o.t0 = -1; tr.changers.push(o); }
      }
      for (const o of rowObs) tr.obs.push(o);
      const clr = [0, 1, 2].filter((l) => !row[l]);
      // spacing: generous early, tighter later; always >= 0.95 s of travel
      const gapT = 1.35 - 0.5 * p - 0.12 * late + R() * 0.45;
      const gap = Math.max(0.95 * v, gapT * v);
      const end = d + Math.max(...row.map((k) => (k ? KINDS[k].len : 0)));
      const cs = [];
      // coins in the gap: a line in a lane that is clear for this row (and not a changer's target)
      if (R() < 0.75) {
        const safe = clr.filter((l) => !rowObs.some((o) => o.to === l));
        const lane = safe.length ? pick(safe) : clr.length ? pick(clr) : pick([0, 1, 2]);
        const n = 4 + Math.floor(R() * 4);
        for (let i = 0; i < n; i++) { const cd = end + 2 + i * 2.2; if (cd < end + gap - 3) cs.push({ d: cd, lane, h: 0.45 }); }
      }
      // coin arc over a low obstacle
      const lowLane = row.findIndex((k) => k === 'cone' || k === 'hole');
      if (lowLane >= 0 && R() < 0.5) {
        for (let i = -2; i <= 2; i++) { const cd = d + 0.3 + i * 1.6, u = (i + 2) / 4; cs.push({ d: cd, lane: lowLane, h: 0.45 + C.HOP_H * Math.sin(Math.PI * (0.15 + 0.7 * u)) }); }
      }
      // boost pad in a clear lane midway in the gap
      if (d > g.nextPad && clr.length) {
        tr.pads.push({ d: end + gap * 0.4, lane: pick(clr), len: 2.4 });
        g.nextPad = d + 200 + R() * 80;
      }
      // drop coins that sit inside an obstacle on the ground (both lanes of a changer)
      const ok = cs.filter((c) => c.h > 0.9 || !rowObs.some((o) => (o.lane === c.lane || o.to === c.lane) && c.d > o.d - 1 && c.d < o.d + o.len + 1));
      ok.sort((a, b) => a.d - b.d);
      for (const c of ok) tr.coins.push(c);
      g.d = end + gap; // spacing is measured from the end of this row
    }
  }

  function newRun(track) {
    return { track, t: 0, d: 0, lane: 1, x: 0, hopT: -1, h: 0, hearts: C.HEARTS, inv: 0, boost: 0, coins: 0, v: C.V0,
      oi: 0, ci: 0, pi: 0, li: 0, done: false, events: [], hits: 0 };
  }
  const score = (s) => s.coins * C.COIN + Math.floor(s.d);
  // where a lane-changer is at time t (lateral, in lane units)
  function carX(o, t) {
    if (o.to == null || o.t0 < 0) return laneX(o.l0);
    const k = Math.min(1, Math.max(0, (t - o.t0 - C.BLINK) / C.MOVE));
    return laneX(o.l0) + (laneX(o.to) - laneX(o.l0)) * (k * k * (3 - 2 * k));
  }

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
    if (tr.g.d < s.d + C.AHEAD) extend(tr, s.d + C.AHEAD);
    s.t += dt;
    const v = speedAt(s.d) * (s.boost > 0 ? C.BOOST_K : 1);
    s.v = v;
    s.d += v * dt;
    // lateral
    const tx = laneX(s.lane), mv = dt / C.LANE_T;
    s.x += Math.max(-mv, Math.min(mv, tx - s.x));
    // hop
    if (s.hopT >= 0) { s.hopT += dt; if (s.hopT >= C.HOP_T) { s.hopT = -1; s.h = 0; s.events.push({ e: 'land' }); } else s.h = C.HOP_H * Math.sin(Math.PI * s.hopT / C.HOP_T); }
    s.inv = Math.max(0, s.inv - dt); s.boost = Math.max(0, s.boost - dt);
    // lane-changers: trigger the blinker TRIG s before the rider gets there, then slide
    while (s.li < tr.changers.length && tr.changers[s.li].d + tr.changers[s.li].len < s.d - 5) s.li++;
    for (let i = s.li; i < tr.changers.length; i++) {
      const o = tr.changers[i];
      if (o.t0 < 0) {
        if ((o.d - (s.d + C.BIKE_HL)) / v > C.TRIG) break;
        if (o.hit || o.smashed) continue;
        o.t0 = s.t; s.events.push({ e: 'blink', o });
      }
      o.x = carX(o, s.t);
      if (o.lane !== o.to && s.t - o.t0 >= C.BLINK + C.MOVE) o.lane = o.to;
    }
    // obstacles
    while (s.oi < tr.obs.length && tr.obs[s.oi].d + tr.obs[s.oi].len < s.d - C.BIKE_HL - 1) s.oi++;
    for (let i = s.oi; i < tr.obs.length; i++) {
      const o = tr.obs[i];
      if (o.d > s.d + C.BIKE_HL) break;
      if (o.hit || o.d + o.len < s.d - C.BIKE_HL) continue;
      if (Math.abs(s.x - o.x) >= C.BIKE_HW + o.hw) continue;
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
  }

  // Fresh copy of a track (the game mutates hit/got/used flags): regenerate from the seed.
  function clone(tr) { return generate(tr.seed); }

  const api = { C, KINDS, generate, extend, newRun, step, act, score, speedAt, laneX, carX, changeP, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RushCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

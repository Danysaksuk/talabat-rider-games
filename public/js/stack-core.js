// Stack the Order: pendulum drops, sliced overhangs, combos. Shared by the game and the headless bot.
(function (root) {
  'use strict';
  const C = {
    W: 360,
    BAG_W: 132,
    BAG_CX: 180,
    BAG_H: 36,
    BOX_H: 26,
    ARM: 210,
    GAP: 10,
    G: 2400,
    PERFECT: 5,
    GROW: 16,
    GROW_EVERY: 3,
    PTS: 10,
    PTS_COMBO: 5,
    COMBO_CAP: 8,
    PERIOD0: 2.5,
    PERIOD_MIN: 0.72,
    PERIOD_DEC: 0.055,
    AMP0: 0.95,
    AMP_MAX: 1.15,
    AMP_INC: 0.006,
    SETTLE: 0.12,
    PIVOT_X: 180,
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const period = (n) => Math.max(C.PERIOD_MIN, C.PERIOD0 - n * C.PERIOD_DEC);
  const ampOf = (n) => Math.min(C.AMP_MAX, C.AMP0 + n * C.AMP_INC);
  const topY = (stack) => (stack.length ? stack[stack.length - 1].y + C.BOX_H : 0);
  // First piece is the bag: its top sits at y=0, and BOX_H is used only for stacked boxes.
  function bagTop() { return 0; }

  function pivotY(stack) {
    const top = stack.length === 1 ? bagTop() : stack[stack.length - 1].y + C.BOX_H;
    return top + C.GAP + C.ARM;
  }
  function boxPos(run) {
    const pv = pivotY(run.stack);
    return {
      x: C.PIVOT_X + C.ARM * Math.sin(run.theta),
      y: pv - C.ARM * Math.cos(run.theta),
    };
  }
  function currentTop(run) {
    const s = run.stack[run.stack.length - 1];
    const y = s.bag ? 0 : s.y + C.BOX_H;
    return { x: s.x, w: s.w, y };
  }

  function newRun() {
    return {
      stack: [{ x: C.BAG_CX, w: C.BAG_W, y: -C.BAG_H, bag: true }],
      boxW: C.BAG_W,
      combo: 0,
      perfects: 0,          // current perfect streak
      landed: 0,
      score: 0,
      t: 0,
      phase: 'swing',       // swing | fall | settle | miss | over
      side: -1,
      swingT: 0,
      theta: -ampOf(0),
      omega: Math.PI * 2 / period(0),
      amp: ampOf(0),
      fall: null,
      over: false,
    };
  }

  function startSwing(run) {
    run.phase = 'swing';
    run.amp = ampOf(run.landed);
    run.omega = Math.PI * 2 / period(run.landed);
    run.side = -run.side;
    run.swingT = 0;
    run.theta = run.side * run.amp;
    run.fall = null;
  }

  function drop(run) {
    if (run.phase !== 'swing' || run.over) return false;
    const p = boxPos(run);
    const w = run.boxW;
    const top = currentTop(run);
    const L = p.x - w / 2, R = p.x + w / 2;
    const oL = Math.max(L, top.x - top.w / 2);
    const oR = Math.min(R, top.x + top.w / 2);
    if (oR - oL <= 1) {
      run.phase = 'miss';
      run.fall = { x: p.x, y: p.y, w, vy: 0, vx: C.ARM * run.omega * Math.cos(run.theta) * (run.theta >= 0 ? -1 : 1) * 0.15, rot: 0 };
      return true;
    }
    let newW = oR - oL;
    const newX = (oL + oR) / 2;
    const perfect = Math.abs(p.x - top.x) <= C.PERFECT;
    run.phase = 'fall';
    run.fall = { x: p.x, y: p.y, w, destY: top.y + C.BOX_H / 2, destX: newX, destW: newW, vy: 0, perfect, newW, newX };
    return true;
  }

  function land(run) {
    const f = run.fall;
    let w = f.newW, x = f.newX;
    if (f.perfect) {
      run.perfects++;
      run.combo = Math.min(C.COMBO_CAP, run.combo + 1);
      run.score += C.PTS + C.PTS_COMBO * run.combo;
      if (run.perfects % C.GROW_EVERY === 0) w = Math.min(C.BAG_W, w + C.GROW);
    } else {
      run.perfects = 0;
      run.combo = 0;
      run.score += C.PTS;
    }
    const top = currentTop(run);
    run.stack.push({ x, w, y: top.y });
    run.landed++;
    run.boxW = w;
    run.phase = 'settle';
    run.settleT = 0;
    run.fall = { ...f, x, w, y: top.y + C.BOX_H / 2 };
  }

  function step(run, dt) {
    if (run.over) return;
    run.t += dt;
    if (run.phase === 'swing') {
      // theta = side * amp * cos(omega * tau), tau starts at 0 so we begin at the side.
      // Integrate with a running clock stored as run.swingT.
      if (run.swingT == null) run.swingT = 0;
      run.swingT += dt;
      run.theta = run.side * run.amp * Math.cos(run.omega * run.swingT);
      return;
    }
    if (run.phase === 'fall') {
      const f = run.fall;
      f.vy += C.G * dt;
      f.y += f.vy * dt;
      if (f.y >= f.destY) { f.y = f.destY; land(run); }
      return;
    }
    if (run.phase === 'settle') {
      run.settleT += dt;
      if (run.settleT >= C.SETTLE) { run.swingT = 0; startSwing(run); }
      return;
    }
    if (run.phase === 'miss') {
      const f = run.fall;
      f.vy += C.G * dt;
      f.y += f.vy * dt;
      f.x += (f.vx || 0) * dt;
      f.rot = (f.rot || 0) + dt * 3;
      if (f.y > currentTop(run).y + 220) { run.over = true; run.phase = 'over'; }
    }
  }

  // Best moment to drop: when the hanging box is closest to the stack centre and still approaching or at the vertex.
  function shouldDrop(run, dt) {
    if (run.phase !== 'swing') return false;
    const p = boxPos(run);
    const top = currentTop(run);
    const err = p.x - top.x;
    const nextT = (run.swingT || 0) + (dt || 1 / 120);
    const nextTh = run.side * run.amp * Math.cos(run.omega * nextT);
    const nextX = C.PIVOT_X + C.ARM * Math.sin(nextTh);
    const nextErr = nextX - top.x;
    // Drop at the closest approach this frame, as long as it still overlaps.
    const closest = Math.abs(err) <= Math.abs(nextErr);
    return closest && Math.abs(err) < top.w / 2;
  }

  const api = { C, period, ampOf, topY, pivotY, boxPos, currentTop, newRun, startSwing, drop, step, shouldDrop, land };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Stack = api;
})(typeof window !== 'undefined' ? window : globalThis);

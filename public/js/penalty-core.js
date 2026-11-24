// Penalty Shootout (Score Hero style): path-following shots, levels, keeper and obstacles.
// Shared by the game and the headless bot (node tools/sim-newgames.js).
(function (root) {
  'use strict';
  const C = {
    W: 360, H: 640,
    BALL: { x: 180, y: 575, r: 11 },
    GOAL: { x: 68, y: 108, w: 224, h: 128 },
    POST: 7,
    PTS_GOAL: 100, PTS_CORNER: 50, PTS_CURVE: 25, PTS_LEVEL: 500,
    KICKS: 5, NEED: 3,
    RESULT_T: 0.85,
    MIN_SPEED: 380, MAX_SPEED: 720,
    MIN_PATH: 130,
    CURVE_RATIO: 1.12, CURVE_DEV: 28,
    CORNER: 40,
  };
  const G = C.GOAL;
  const goalLine = G.y + G.h;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function spec(level) {
    const L = level;
    return {
      level: L,
      // keeper tuned up (reacts sooner, moves faster, wider reach, reads more shots) from level 1
      keeperDelay: Math.max(0.08, 0.37 - L * 0.026),
      keeperSpeed: 160 + L * 26,
      keeperReach: 32 + Math.min(22, L * 1.25),
      keeperSmart: Math.min(0.95, 0.32 + L * 0.055),
      wall: L >= 3 && L <= 5 ? 'static' : L >= 6 && L <= 8 ? 'jump' : null,
      cones: L >= 6 && L <= 8,
      defenders: L >= 9,
      wind: L >= 9 ? Math.min(90, 28 + (L - 9) * 8) * (L % 2 ? 1 : -1) : 0,
      zones: L >= 9,
    };
  }

  function pathLen(pts) {
    let n = 0;
    for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return n;
  }
  function pathPoint(pts, dist) {
    if (!pts.length) return { x: C.BALL.x, y: C.BALL.y };
    if (dist <= 0) return { x: pts[0].x, y: pts[0].y };
    let left = dist;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (left <= d) {
        const t = d ? left / d : 0;
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
      }
      left -= d;
    }
    const p = pts[pts.length - 1];
    return { x: p.x, y: p.y };
  }
  function curveInfo(pts) {
    const len = pathLen(pts);
    const chord = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) || 1;
    const ax = pts[0].x, ay = pts[0].y, bx = pts[pts.length - 1].x - ax, by = pts[pts.length - 1].y - ay, bl2 = bx * bx + by * by || 1;
    let dev = 0;
    for (const p of pts) {
      const t = clamp(((p.x - ax) * bx + (p.y - ay) * by) / bl2, 0, 1);
      dev = Math.max(dev, Math.hypot(p.x - (ax + bx * t), p.y - (ay + by * t)));
    }
    return { len, chord, ratio: len / chord, dev, isCurve: len / chord >= C.CURVE_RATIO || dev >= C.CURVE_DEV };
  }
  function densify(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(d / step));
      for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
    }
    return out;
  }
  function smoothPath(pts, step) {
    if (pts.length < 3) return densify(pts, step);
    // Catmull-Rom through the waypoints, then densify.
    const src = [pts[0]].concat(pts, pts[pts.length - 1]);
    const curve = [];
    for (let i = 1; i < src.length - 2; i++) {
      const p0 = src[i - 1], p1 = src[i], p2 = src[i + 1], p3 = src[i + 2];
      const segs = 8;
      for (let k = 0; k < segs; k++) {
        const t = k / segs, t2 = t * t, t3 = t2 * t;
        curve.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    curve.push(pts[pts.length - 1]);
    return densify(curve, step);
  }

  function makeKick(level, kickNo, rand) {
    const s = spec(level);
    const kick = {
      level, kickNo, ...s,
      age: 0, ft: 0, rt: 0,
      phase: 'aim',
      path: null, dist: 0, travel: 0, speed: 0, curve: false,
      ball: { x: C.BALL.x, y: C.BALL.y },
      keeperX: 180, keeperTarget: 180, keeperReactAt: s.keeperDelay,
      wall: null, cones: [], defenders: [],
      result: null,
      kseed: (level * 131 + kickNo * 17 + Math.floor(rand() * 1e9)) >>> 0,
    };
    if (s.wall === 'static') {
      const gapW = 92 - Math.min(18, (level - 3) * 5);
      const leftGap = rand() < 0.5;
      kick.wall = leftGap
        ? { x: 30 + gapW, y: 335, w: 300 - gapW, h: 26, kind: 'static' }
        : { x: 30, y: 335, w: 300 - gapW, h: 26, kind: 'static' };
    } else if (s.wall === 'jump') {
      kick.wall = { x: 108, y: 338, w: 144, h: 32, kind: 'jump', period: 1.5, phase: rand() * Math.PI * 2, amp: 78 };
    }
    if (s.cones) {
      kick.cones = [
        { x: 118 + rand() * 36, y: 430, r: 14 },
        { x: 208 + rand() * 36, y: 395, r: 14 },
      ];
      if (rand() < 0.5) kick.cones.push({ x: 160 + rand() * 40, y: 470, r: 13 });
    }
    if (s.defenders) {
      const n = level >= 12 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        kick.defenders.push({
          x0: 90 + i * 130 + rand() * 50, amp: 36 + rand() * 34,
          period: 1.35 + rand() * 0.55, phase: rand() * Math.PI * 2,
          y: 292 + i * 28, w: 26, h: 48,
        });
      }
    }
    return kick;
  }

  function wallRect(kick) {
    const w = kick.wall;
    if (!w) return null;
    let y = w.y;
    if (w.kind === 'jump') y = w.y - (0.5 + 0.5 * Math.sin(kick.age * Math.PI * 2 / w.period + w.phase)) * w.amp;
    return { x: w.x, y, w: w.w, h: w.h };
  }
  function defX(d, t) { return d.x0 + d.amp * Math.sin(t * Math.PI * 2 / d.period + d.phase); }
  function hitRect(cx, cy, r, rc) {
    const qx = clamp(cx, rc.x, rc.x + rc.w), qy = clamp(cy, rc.y, rc.y + rc.h);
    return Math.hypot(cx - qx, cy - qy) < r;
  }
  function hitCircle(cx, cy, r, ox, oy, or) { return Math.hypot(cx - ox, cy - oy) < r + or; }

  function posts() {
    const p = C.POST;
    return [
      { x: G.x - p / 2, y: G.y - p / 2, w: p, h: G.h + p },             // left post
      { x: G.x + G.w - p / 2, y: G.y - p / 2, w: p, h: G.h + p },       // right post
      { x: G.x - p / 2, y: G.y - p / 2, w: G.w + p, h: p },             // crossbar
    ];
  }
  function inMouth(x, y, r) {
    return x > G.x + C.POST - r * 0.3 && x < G.x + G.w - C.POST + r * 0.3
      && y > G.y + C.POST - r * 0.2 && y < goalLine + r * 0.2;
  }
  function inCorner(x, y) {
    const z = C.CORNER;
    const top = y < G.y + z;
    return top && (x < G.x + z || x > G.x + G.w - z);
  }
  function keeperBox(kick) {
    const reach = kick.keeperReach;
    // Covers mid-height from level 1 but stays below the top-corner band early, so a corner finish beats
    // the keeper; later they can stretch up.
    const height = Math.max(64, 44 + Math.min(90, Math.max(0, kick.level - 1) * 6));
    return { x: kick.keeperX - reach, y: goalLine - height, w: reach * 2, h: height };
  }

  function shoot(kick, path, swipeMs, rand) {
    if (kick.phase !== 'aim' || !path || path.length < 2) return false;
    const pts = path.map((p) => ({ x: p.x, y: p.y }));
    if (Math.hypot(pts[0].x - C.BALL.x, pts[0].y - C.BALL.y) > 42) return false;
    const info = curveInfo(pts);
    if (info.len < C.MIN_PATH) return false;
    const dur = Math.max(0.05, (swipeMs || 400) / 1000);
    const swipeSpeed = info.len / dur;
    const speed = clamp(swipeSpeed * 0.85, C.MIN_SPEED, C.MAX_SPEED);
    const power = clamp(info.len / 280, 0.35, 1.15) * clamp(swipeSpeed / 520, 0.5, 1.2);
    const travel = power >= 0.8 ? info.len + 8 : Math.max(40, info.len * power / 0.8);
    const dens = densify(pts, 4);
    kick.path = dens;
    kick.dist = 0;
    kick.travel = travel;
    kick.speed = speed;
    kick.curve = info.isCurve;
    kick.phase = 'flight';
    kick.ft = 0;
    kick.result = null;
    // Keeper reads the first 30% of the drawn path and projects it to the goal line.
    const p0 = dens[0], early = pathPoint(dens, info.len * 0.3);
    let predX = early.x;
    if (Math.abs(early.y - p0.y) > 1) predX = p0.x + (early.x - p0.x) * (goalLine - p0.y) / (early.y - p0.y);
    const R = rng(kick.kseed || 1);
    const smart = kick.keeperSmart;
    if (R() > smart) predX = 180 + (R() - 0.5) * 100;
    predX += (R() - 0.5) * 2 * (1 - smart) * 90;
    kick.keeperTarget = clamp(predX, G.x + 10, G.x + G.w - 10);
    kick.keeperReactAt = kick.keeperDelay;
    return true;
  }

  function resolve(kick, kind) {
    if (kick.result) return;
    const b = kick.ball;
    const goal = kind === 'goal';
    const corner = goal && inCorner(b.x, b.y);
    const pts = (goal ? C.PTS_GOAL : 0) + (corner ? C.PTS_CORNER : 0) + (goal && kick.curve ? C.PTS_CURVE : 0);
    kick.result = { kind, goal, corner, curve: !!(goal && kick.curve), pts, x: b.x, y: b.y };
    kick.phase = 'result';
    kick.rt = 0;
  }

  function stepKick(kick, dt) {
    kick.age += dt;
    if (kick.phase === 'result') {
      kick.rt += dt;
      if (kick.rt >= C.RESULT_T) kick.phase = 'done';
      return;
    }
    if (kick.phase === 'done') return;
    if (kick.phase !== 'flight') return;

    kick.ft += dt;
    kick.dist += kick.speed * dt;
    const p = pathPoint(kick.path, Math.min(kick.dist, kick.travel));
    const x = p.x + kick.wind * kick.ft, y = p.y;
    kick.ball = { x, y };
    const r = C.BALL.r;

    if (kick.ft >= kick.keeperReactAt) {
      const dx = kick.keeperTarget - kick.keeperX;
      kick.keeperX += Math.sign(dx) * Math.min(Math.abs(dx), kick.keeperSpeed * dt);
    }

    const wr = wallRect(kick);
    if (wr && hitRect(x, y, r, wr)) return resolve(kick, 'blocked');
    for (const c of kick.cones) if (hitCircle(x, y, r, c.x, c.y, c.r)) return resolve(kick, 'blocked');
    for (const d of kick.defenders) {
      const dx = defX(d, kick.age);
      if (hitRect(x, y, r, { x: dx - d.w / 2, y: d.y - d.h, w: d.w, h: d.h })) return resolve(kick, 'blocked');
    }
    // The goal frame lives on the goal plane (end of the path). Mid-flight the ball is
    // still approaching, so only pitch obstacles can end the shot early.
    if (kick.dist >= kick.travel) {
      for (const po of posts()) if (hitRect(x, y, r * 0.8, po)) return resolve(kick, y < G.y + 16 ? 'over' : 'post');
      if (inMouth(x, y, r) && hitRect(x, y, r, keeperBox(kick))) return resolve(kick, 'save');
      if (inMouth(x, y, r)) return resolve(kick, 'goal');
      if (y < G.y) return resolve(kick, 'over');
      if (x < G.x - 6 || x > G.x + G.w + 6 || x < -20 || x > C.W + 20) return resolve(kick, 'wide');
      return resolve(kick, 'short');
    }
  }

  function newRun(seed) {
    const rand = rng(seed || 1);
    return { seed: seed || 1, rand, level: 1, kickNo: 0, goals: 0, totalGoals: 0, levelsCleared: 0, score: 0, corners: 0, curves: 0, t: 0, over: false, kick: makeKick(1, 0, rand) };
  }

  function afterKick(run) {
    const r = run.kick.result;
    if (!r) return;
    if (r.goal) {
      run.goals++; run.totalGoals++; run.score += r.pts;
      if (r.corner) run.corners++;
      if (r.curve) run.curves++;
    }
    run.kickNo++;
    if (run.kickNo < C.KICKS) {
      run.kick = makeKick(run.level, run.kickNo, run.rand);
      return;
    }
    if (run.goals >= C.NEED) {
      run.score += C.PTS_LEVEL;
      run.levelsCleared++;
      run.level++;
      run.kickNo = 0;
      run.goals = 0;
      run.kick = makeKick(run.level, 0, run.rand);
    } else {
      run.over = true;
    }
  }

  function step(run, dt) {
    if (run.over) return;
    run.t += dt;
    const phase = run.kick.phase;
    stepKick(run.kick, dt);
    if (phase !== 'done' && run.kick.phase === 'done') afterKick(run);
  }

  function simulate(kick, path, swipeMs, rand) {
    const k = clone(kick);
    if (!shoot(k, path, swipeMs, rand)) return k;
    let t = 0;
    while (k.phase !== 'done' && t < 6) { stepKick(k, 1 / 120); t += 1 / 120; }
    return k;
  }

  function planPath(kick, preferLeft) {
    const B = C.BALL;
    const wr = wallRect(kick);
    const estT = 0.9;
    if (preferLeft == null) {
      if (wr) preferLeft = (wr.x + wr.w / 2) > 180;
      else if (kick.defenders && kick.defenders.length) preferLeft = defX(kick.defenders[0], kick.age + estT * 0.45) >= 180;
      else preferLeft = (kick.keeperX || 180) >= 180;
    }
    const cornerY = G.y + 24;
    const cornerX = preferLeft ? G.x + 28 : G.x + G.w - 28;
    const tx = clamp(cornerX - (kick.wind || 0) * estT, G.x + 20, G.x + G.w - 20);
    const laneX = preferLeft ? 44 : C.W - 44;
    // Stay in a side lane until past every pitch obstacle, so the final curve never cuts back through a wall.
    let passY = 230;
    if (kick.wall) passY = Math.min(passY, kick.wall.y - (kick.wall.amp || 0) - 30);
    for (const d of kick.defenders || []) passY = Math.min(passY, d.y - d.h - 24);
    const pts = [
      { x: B.x, y: B.y },
      { x: laneX, y: 500 },
      { x: laneX, y: 380 },
      { x: laneX, y: passY },
    ];
    if (kick.keeperSmart >= 0.55) {
      const fakeX = (preferLeft ? G.x + G.w - 50 : G.x + 50) - (kick.wind || 0) * estT * 0.3;
      pts.push({ x: clamp(fakeX, G.x + 16, G.x + G.w - 16), y: passY });
    }
    pts.push({ x: tx, y: Math.min(passY, goalLine - 16) });
    pts.push({ x: tx, y: cornerY });
    return densify(pts, 6);
  }

  function botTry(kick, rand) {
    const delays = [0, 0.12, 0.25, 0.4, 0.55, 0.75, 1.0, 1.25, 1.55];
    const sides = [true, false];
    for (const delay of delays) {
      for (const left of sides) {
        const k = clone(kick);
        if (delay) stepKick(k, delay);
        const path = planPath(k, left);
        const swipeMs = Math.max(180, pathLen(path) / 650 * 1000);
        const r = simulate(k, path, swipeMs);
        if (r.result && r.result.goal) return { delay, path, swipeMs, result: r.result, left };
      }
    }
    const path = planPath(kick, true);
    return { delay: 0, path, swipeMs: Math.max(180, pathLen(path) / 650 * 1000), result: null };
  }

  const api = { C, spec, makeKick, wallRect, defX, shoot, stepKick, newRun, step, afterKick, simulate, planPath, botTry, pathLen, pathPoint, curveInfo, densify, clone, posts, inMouth, inCorner, keeperBox };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Penalty = api;
})(typeof window !== 'undefined' ? window : globalThis);

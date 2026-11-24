// Penalty difficulty report (headless): goal rate per level for several shot styles, plus how far the skilled bot gets.
// Usage: node tools/pen-difficulty.js [core path]   (default ../public/js/penalty-core.js)
const path = require('path');
const P = require(path.resolve(process.argv[2] || path.join(__dirname, '../public/js/penalty-core.js')));
const C = P.C, G = C.GOAL, B = C.BALL, GL = G.y + G.h;
const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const quad = (a, c, b, n = 24) => { const o = []; for (let i = 0; i <= n; i++) { const u = i / n; o.push({ x: (1 - u) ** 2 * a.x + 2 * u * (1 - u) * c.x + u * u * b.x, y: (1 - u) ** 2 * a.y + 2 * u * (1 - u) * c.y + u * u * b.y }); } return o; };
const shotMs = (pts, R) => Math.max(180, P.pathLen(pts) / 650 * 1000) * (0.85 + R() * 0.4);
function fire(kick, pts, ms) { const r = P.simulate(kick, P.densify(pts, 6), ms); return r.result; }
// Shot styles (no look-ahead: what a player would draw)
const styles = {
  // skilled bot: searches timing + side with the simulator (upper bound)
  bot: (k) => { const t = P.botTry(k); const kk = P.clone(k); if (t.delay) P.stepKick(kk, t.delay); return fire(kk, t.path, t.swipeMs); },
  // a well-curved shot to a top corner through the side lane (the planned path, fixed timing, random side)
  cornerCurve: (k, R) => { const kk = P.clone(k); const p = P.planPath(kk, R() < 0.5); return fire(kk, p, shotMs(p, R)); },
  // straight to a top corner
  cornerStraight: (k, R) => { const left = R() < 0.5; const t = { x: left ? G.x + 22 + R() * 14 : G.x + G.w - 22 - R() * 14, y: G.y + 16 + R() * 18 }; const p = [{ x: B.x, y: B.y }, t]; return fire(k, p, shotMs(p, R)); },
  // central / mid-height
  central: (k, R) => { const t = { x: 140 + R() * 80, y: G.y + 50 + R() * 70 }; const p = [{ x: B.x, y: B.y }, t]; return fire(k, p, shotMs(p, R)); },
  // casual: anywhere in the mouth with a random bend
  casual: (k, R) => { const t = { x: G.x + 14 + R() * (G.w - 28), y: G.y + 14 + R() * (G.h - 22) }; const c = { x: (B.x + t.x) / 2 + (R() - 0.5) * 220, y: (B.y + t.y) / 2 }; const p = quad({ x: B.x, y: B.y }, c, t); return fire(k, p, shotMs(p, R)); },
};
const LEVELS = [1, 3, 6, 9, 12], N = 600;
const rows = {};
for (const [name, fn] of Object.entries(styles)) {
  rows[name] = LEVELS.map((L) => {
    let g = 0; const R = rng(1234 + L * 7);
    for (let i = 0; i < N; i++) { const k = P.makeKick(L, i % 5, R); const r = fn(k, R); if (r && r.goal) g++; }
    return Math.round(g / N * 100);
  });
}
console.log('goal rate %   ' + LEVELS.map((L) => ('L' + L).padStart(5)).join(''));
for (const [n, v] of Object.entries(rows)) console.log(n.padEnd(14) + v.map((x) => String(x).padStart(5)).join(''));
// full runs with the skilled bot
const reach = [];
for (let s = 0; s < 40; s++) {
  const run = P.newRun((s * 2654435761 + 99) >>> 0); let t = 0;
  while (!run.over && run.level <= 20 && t < 900) {
    if (run.kick.phase === 'aim') { const tr = P.botTry(run.kick); if (tr.delay) P.stepKick(run.kick, tr.delay); if (!P.shoot(run.kick, tr.path, tr.swipeMs)) break; }
    P.stepKick(run.kick, 1 / 120); if (run.kick.phase === 'done') P.afterKick(run); t += 1 / 120;
  }
  reach.push(run.levelsCleared);
}
const ge10 = reach.filter((x) => x >= 10).length;
console.log(`skilled bot, 40 seeds: cleared L10+ on ${ge10}/40, median levels cleared ${reach.slice().sort((a, b) => a - b)[20]}, min ${Math.min(...reach)}, max ${Math.max(...reach)}`);

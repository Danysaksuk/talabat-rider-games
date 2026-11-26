// Super Over difficulty report: hit rate per over for players with different timing accuracy.
// Usage: node tools/so-difficulty.js   (uses superover-core.js; nothing is changed)
// A player is modelled as a Gaussian tap error around the ideal contact moment (sigma ms, small late bias).
'use strict';
const SO = require('../public/js/superover-core.js');
const C = SO.C;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(42);
const gauss = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const PROFILES = [['sharp', 40], ['decent', 70], ['casual', 110]];
const N = 20000;
const pct = (x) => (100 * x).toFixed(0).padStart(3) + '%';
// per-ball outcome odds (independent of the innings)
console.log('Per-ball outcomes by over (N=' + N + ' balls per cell). hit = any runs; 6/4 = boundary share; out = bowled');
console.log('over  travel   target | ' + PROFILES.map(([n, s]) => `${n} s=${s}ms: hit  six four  out  E[runs/6b] P(chase)`).join(' | '));
for (let o = 1; o <= C.OVERS; o++) {
  let tSum = 0; const kinds = {};
  const cols = PROFILES.map(([, sig]) => {
    let hit = 0, six = 0, four = 0, out = 0, runs = 0; const per = [];
    for (let i = 0; i < N; i++) {
      const d = SO.makeDelivery(o, R); if (sig === 40) { tSum += d.T; kinds[d.type] = (kinds[d.type] || 0) + 1; }
      const v = SO.judge(gauss() * sig + 8, o);
      let r = 0;
      if (!v || v.kind === 'early-out') out++;
      else if (v.kind === 'hit') { hit++; r = v.runs; if (r === 6) six++; if (r === 4) four++; }
      runs += r; per.push(r);
    }
    // chase probability: sum of 6 sampled balls >= target (a wicket simply scores 0 here)
    let chase = 0; for (let k = 0; k < 4000; k++) { let s = 0; for (let b = 0; b < 6; b++) s += per[(R() * N) | 0]; if (s >= C.TARGETS[o - 1]) chase++; }
    return `${pct(hit / N)} ${pct(six / N)} ${pct(four / N)} ${pct(out / N)}  ${(runs / N * 6).toFixed(1).padStart(5)}     ${pct(chase / 4000)}`;
  });
  console.log(`${String(o).padStart(3)}  ${(tSum / N * 1000).toFixed(0).padStart(5)}ms  ${String(C.TARGETS[o - 1]).padStart(4)}   | ` + cols.join('   | '));
  if (o === C.OVERS) console.log('delivery mix (over 10):', JSON.stringify(kinds));
}
// full innings
console.log('\nFull innings (2000 per profile): mean score, mean over reached, % finishing all 10 overs');
for (const [n, sig] of PROFILES) {
  let tot = 0, ov = 0, won = 0;
  for (let k = 0; k < 2000; k++) {
    let fin = null; const g = SO.createGame({ rand: R, on: (e, d) => { if (e === 'finish') fin = d; } });
    let now = 0, planned = null; g.nextBall(0);
    while (!fin) {
      if (g.phase === 'flight' && g.swing < 0) { if (planned === null) planned = g.del.hitAt + gauss() * sig + 8; if (now >= planned) g.tap(planned); } else if (g.phase !== 'flight') planned = null;
      g.update(1 / 60, now, true); now += 1000 / 60;
    }
    tot += fin.runs; ov += fin.over; if (fin.won) won++;
  }
  console.log(`  ${n.padEnd(7)} s=${sig}ms: score ${(tot / 2000).toFixed(0)}, over ${(ov / 2000).toFixed(1)}, all 10 overs ${pct(won / 2000)}`);
}

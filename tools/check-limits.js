// Verifies the server's plausibility rules (rules.js) accept every legitimately reachable score
// and reject typical tampering. Usage: node tools/check-limits.js
const R = require('../public/js/rush-core.js');
const { check } = require('../rules.js');
let fails = 0;
const ok = (name, cond, info) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : '')); };
const CD = 2.9; // countdown before play

// Rush: perfect runs (every coin, every boost pad) on 5000 tracks; check every moment + the final bonus.
let worst = 1e9, maxScore = 0;
for (let i = 1; i <= 5000; i++) {
  const tr = R.generate((i * 2654435761) >>> 0);
  let d = 0, t = 0, ci = 0, pi = 0, boost = 0, coins = 0;
  while (d < R.C.L) {
    const v = R.speedAt(d) * (boost > 0 ? R.C.BOOST_K : 1); d += v / 120; t += 1 / 120; boost -= 1 / 120;
    while (pi < tr.pads.length && tr.pads[pi].d <= d) { boost = R.C.BOOST_T; pi++; }
    while (ci < tr.coins.length && tr.coins[ci].d <= d + 0.7) { coins++; ci++; }
    const ms = (t + CD) * 1000, sc = Math.floor(coins * 100 + Math.min(d, R.C.L));
    if (ms >= 4000 && check('rush', sc, ms)) { worst = -1; break; }
  }
  const final = coins * 100 + R.C.L + 3 * R.C.HEART_BONUS + R.C.DELIVERED;
  maxScore = Math.max(maxScore, final);
  if (check('rush', final, (t + CD) * 1000)) worst = -1;
}
ok('rush: every perfect run on 5000 tracks is accepted at every moment, incl. the delivery bonus', worst !== -1, 'max legit score ' + maxScore);
ok('rush: tampered 7,700 at 4.2 s rejected', check('rush', 7700, 4200) !== null);
ok('rush: bonus-sized score before 80 s rejected', check('rush', 620 * 60 + 3000, 60000) !== null);
ok('rush: 61,000 rejected (over max)', check('rush', 61000, 120000) !== null);

// Hoops: perfect = swish every 0.38 s for 60 s with the combo ramp.
let hoops = 0; for (let n = 1; n <= Math.floor(60 / 0.38) + 1; n++) hoops += 3 * Math.min(5, 1 + Math.floor((n - 1) / 2));
ok('hoops: perfect run accepted', check('hoops', hoops, (60 + CD) * 1000) === null, 'max legit ' + hoops);
ok('hoops: 1,000 at 56 s rejected (too short)', check('hoops', 1000, 56000) !== null);
ok('hoops: 2,350 at 61 s rejected (faster than possible)', check('hoops', 2350, 61000) !== null);

// Super Over: perfect innings, a six every ball at the fastest possible pace.
let t = CD + 0.8, okAll = true;
for (let over = 1; over <= 10; over++) for (let b = 0; b < 6; b++) {
  const T = (1.15 - 0.058 * (over - 1)) * 0.96 * 0.95; t += 1.1 + T;
  const balls = (over - 1) * 6 + b + 1;
  if (check('superover', 6 * balls, t * 1000) && t * 1000 >= 5000) okAll = false;
  t += 1.15; // the 2.2 s over-end banners are ignored, which makes this check stricter
}
ok('superover: perfect 360 innings accepted at every ball', okAll);
ok('superover: 30 runs at 6 s rejected (only 1 ball possible)', check('superover', 30, 6000) !== null);
ok('superover: 120 runs at 40 s rejected', check('superover', 120, 40000) !== null);
process.exit(fails ? 1 : 0);

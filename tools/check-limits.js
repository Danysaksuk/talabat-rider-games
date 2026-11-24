// Verifies the server's plausibility rules (rules.js) accept every legitimately reachable score
// and reject typical tampering. Usage: node tools/check-limits.js
const R = require('../public/js/rush-core.js');
const { check } = require('../rules.js');
let fails = 0;
const ok = (name, cond, info) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : '')); };
const CD = 2.9; // countdown before play

// Rush (endless): perfect runs (every coin, every boost pad, never hit) on 2000 tracks for 10 min each;
// the score must be accepted at every moment.
let worst = -1e9, maxPps = 0;
for (let i = 1; i <= 2000; i++) {
  const tr = R.generate((i * 2654435761) >>> 0);
  let d = 0, t = 0, ci = 0, pi = 0, boost = 0, coins = 0;
  while (t < 600) {
    if (tr.g.d < d + 300) R.extend(tr, d + 300);
    const v = R.speedAt(d) * (boost > 0 ? R.C.BOOST_K : 1); d += v / 120; t += 1 / 120; boost -= 1 / 120;
    while (pi < tr.pads.length && tr.pads[pi].d <= d) { boost = R.C.BOOST_T; pi++; }
    while (ci < tr.coins.length && tr.coins[ci].d <= d + 0.7) { coins++; ci++; }
    const ms = (t + CD) * 1000, sc = Math.floor(coins * 100 + d);
    if (t > 5) maxPps = Math.max(maxPps, sc / (t + CD));
    if (ms >= 4000 && check('rush', sc, ms)) { worst = sc; break; }
  }
}
ok('rush: every perfect 10-min run on 2000 tracks is accepted at every moment', worst === -1e9, 'peak legit pace ' + Math.round(maxPps) + ' pts/s vs cap 1950');
ok('rush: tampered 9,000 at 4.2 s rejected', check('rush', 9000, 4200) !== null);
ok('rush: 200,000 at 60 s rejected', check('rush', 200000, 60000) !== null);
ok('rush: 3,000 at 3 s rejected (too short)', check('rush', 3000, 3000) !== null);

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

// Penalty: a perfect level is 1,375 points (5 x 175 + 500) in >= 7 s of play, plus countdown.
ok('penalty: perfect first level accepted', check('penalty', 1375, (7 + CD) * 1000) === null);
ok('penalty: 12 perfect levels at 90 s accepted', check('penalty', 1375 * 12, 90000) === null);
ok('penalty: 5,000 at 8 s rejected (faster than possible)', check('penalty', 5000, 8000) !== null);
ok('penalty: 1,000 at 5 s rejected (too short)', check('penalty', 1000, 5000) !== null);

// Stack: 50 pts/box at the 0.39 s late-game cycle is 128/s, well under the 180/s cap.
ok('stack: 80 perfect boxes at 40 s accepted', check('stack', 50 * 80, 40000) === null);
ok('stack: 0 at 3.2 s (instant miss after countdown) accepted', check('stack', 0, 3200) === null);
ok('stack: 8,000 at 6 s rejected', check('stack', 8000, 6000) !== null);
ok('stack: 200 at 2 s rejected (too short)', check('stack', 200, 2000) !== null);
process.exit(fails ? 1 : 0);


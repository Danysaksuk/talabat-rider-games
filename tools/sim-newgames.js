// Headless bots for Penalty Shootout and Stack the Order.
// Checks that each game is beatable and that legit scores stay inside rules.js caps.
// Usage: node tools/sim-newgames.js
'use strict';
const P = require('../public/js/penalty-core.js');
const S = require('../public/js/stack-core.js');
const SO = require('../public/js/superover-core.js');
const { check } = require('../rules.js');
const CD = 2.9; // shell countdown, included in server-measured run time
let fails = 0;
const ok = (name, cond, info) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : '')); };

function playPenalty(seed, maxLevel) {
  const run = P.newRun(seed);
  let t = 0, rejected = null, maxPps = 0, peak = { score: 0, t: 0, level: 1 };
  while (!run.over && run.level <= maxLevel && t < 400) {
    if (run.kick.phase === 'aim') {
      const try_ = P.botTry(run.kick);
      if (try_.delay) { P.stepKick(run.kick, try_.delay); t += try_.delay; }
      if (!P.shoot(run.kick, try_.path, try_.swipeMs)) break;
    }
    P.stepKick(run.kick, 1 / 120);
    if (run.kick.phase === 'done') P.afterKick(run);
    t += 1 / 120;
    const ms = (t + CD) * 1000;
    if (t > 2) maxPps = Math.max(maxPps, run.score / (t + CD));
    if (ms >= 7000 && check('penalty', run.score, ms)) { rejected = { score: run.score, t: t + CD, level: run.level, why: check('penalty', run.score, ms) }; break; }
    if (run.score > peak.score) peak = { score: run.score, t: t + CD, level: run.level };
  }
  return { run, t, rejected, maxPps, peak };
}

function playStack(maxBoxes) {
  const run = S.newRun();
  let t = 0, rejected = null, maxPps = 0;
  while (!run.over && run.landed < maxBoxes && t < 180) {
    if (S.shouldDrop(run, 1 / 120)) S.drop(run);
    S.step(run, 1 / 120);
    t += 1 / 120;
    const ms = (t + CD) * 1000;
    if (t > 1) maxPps = Math.max(maxPps, run.score / (t + CD));
    if (ms >= 3000 && check('stack', run.score, ms)) { rejected = { score: run.score, t: t + CD, landed: run.landed }; break; }
  }
  return { run, t, rejected, maxPps };
}

// ---- Penalty ----
let cleared9 = 0, worst = null, peakPps = 0, best = { score: 0 };
for (let i = 1; i <= 20; i++) {
  const r = playPenalty((i * 2654435761) >>> 0, 14);
  if (r.run.levelsCleared >= 8) cleared9++;
  if (r.rejected && !worst) worst = r.rejected;
  peakPps = Math.max(peakPps, r.maxPps);
  if (r.run.score > best.score) best = { score: r.run.score, level: r.run.level, t: r.t, cleared: r.run.levelsCleared };
}
ok('penalty: bot clears level 9 on every seed (20/20)', cleared9 === 20, `best ${best.score} at L${best.level} in ${best.t && best.t.toFixed(1)}s`);
ok('penalty: every bot score is accepted by the cap', !worst, worst ? JSON.stringify(worst) : `peak legit pace ${Math.round(peakPps)} pts/s vs cap 220`);
ok('penalty: tampered 5,000 at 8 s rejected', check('penalty', 5000, 8000) !== null);
ok('penalty: 40,000 at 60 s rejected', check('penalty', 40000, 60000) !== null);
ok('penalty: 1,000 at 5 s rejected (too short)', check('penalty', 1000, 5000) !== null);
ok('penalty: a mid-run 2,000 at 20 s is accepted', check('penalty', 2000, 20000) === null);

// ---- Stack ----
const st = playStack(100);
ok('stack: bot stacks at least 80 boxes without a miss', st.run.landed >= 80, `landed ${st.run.landed} score ${st.run.score} in ${st.t.toFixed(1)}s`);
ok('stack: every bot score is accepted by the cap', !st.rejected, st.rejected ? JSON.stringify(st.rejected) : `peak legit pace ${Math.round(st.maxPps)} pts/s vs cap 180`);
const miss = S.newRun();
S.drop(miss);
let mt = 0;
while (!miss.over && mt < 5) { S.step(miss, 1 / 120); mt += 1 / 120; }
ok('stack: dropping at once misses the bag and ends the run at 0', miss.over && miss.score === 0 && miss.landed === 0, `t=${mt.toFixed(2)}s`);
ok('stack: a 0-score miss after the countdown is accepted', check('stack', 0, (mt + CD) * 1000) === null);
ok('stack: tampered 8,000 at 6 s rejected', check('stack', 8000, 6000) !== null);
ok('stack: 30,000 at 40 s rejected', check('stack', 30000, 40000) !== null);
ok('stack: 200 at 2 s rejected (too short)', check('stack', 200, 2000) !== null);
ok('stack: a mid-run 800 at 12 s is accepted', check('stack', 800, 12000) === null);

// ---------- Super Over ----------
// mulberry32: seeded rand so innings are reproducible
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// play one innings at 60 fps; errMs(rand) = tap offset from the ideal contact moment (null = no swing)
function playSuperOver(seed, errMs) {
  const R = rng(seed); let fin = null, rejected = null, maxRate = 0;
  const g = SO.createGame({ rand: R, on: (ev, d) => { if (ev === 'finish') fin = d; } });
  const dt = 1 / 60; let now = CD * 1000, t = 0, planned = null;
  g.nextBall(800);
  while (!fin && t < 1200) {
    if (g.phase === 'flight' && g.swing < 0) {
      if (planned === null) { const e = errMs(R); planned = e === null ? Infinity : g.del.hitAt + e; }
      if (now >= planned) g.tap(planned);
    } else if (g.phase !== 'flight') planned = null;
    const before = g.ball + g.over * 10;
    g.update(dt, now, true); now += dt * 1000; t += dt;
    if (g.ball + g.over * 10 !== before) {
      const ms = now - 0; // server time includes the countdown
      if (ms >= 5000 && check('superover', g.runs, ms)) { rejected = { runs: g.runs, s: ms / 1000, over: g.over, why: check('superover', g.runs, ms) }; break; }
      maxRate = Math.max(maxRate, g.runs / (ms / 1000));
    }
  }
  return { fin, rejected, runs: g.runs, over: g.over, wickets: g.wickets, t: now / 1000, maxRate };
}
{
  const perfect = playSuperOver(1, () => 0);
  ok('superover: perfect bot completes all 10 overs, 60 sixes', perfect.fin && perfect.fin.won && perfect.runs === 360, JSON.stringify({ runs: perfect.runs, over: perfect.over, t: perfect.t.toFixed(1) }));
  ok('superover: a perfect innings is accepted by the cap at every ball', !perfect.rejected, perfect.rejected ? JSON.stringify(perfect.rejected) : `final ${perfect.runs} at ${perfect.t.toFixed(1)}s`);
  let rej = null;
  for (let sd = 2; sd < 40 && !rej; sd++) { const r = playSuperOver(sd, (R) => (R() - 0.5) * 2 * 120); if (r.rejected) rej = r.rejected; }
  ok('superover: noisy bots (38 seeds) never trip the cap', !rej, rej ? JSON.stringify(rej) : '');
  const none = playSuperOver(3, () => null);
  ok('superover: never swinging is all out in over 1 with 0 runs', none.fin && none.runs === 0 && none.over === 1 && none.wickets === 2, JSON.stringify({ runs: none.runs, over: none.over }));
  ok('superover: 0 after two balls is accepted', check('superover', 0, none.t * 1000) === null, `${none.t.toFixed(1)}s`);
  ok('superover: tampered 360 at 20 s rejected', check('superover', 360, 20000) !== null);
  ok('superover: 400 at 300 s rejected (over max)', check('superover', 400, 300000) !== null);
  ok('superover: 30 at 4 s rejected (too short)', check('superover', 30, 4000) !== null);
}
process.exit(fails ? 1 : 0);

// Fairness bot for Talabat Rush Run. It plays many seeded tracks with human-like limits:
//  - plans only on rows it has been able to see for 0.25 s (reaction delay), within 1.5 s ahead
//  - hop timing has random +/-80 ms error
// It uses the exact same rules code as the game (public/js/rush-core.js).
// A track is fair if the bot never takes a hit. Usage: node tools/sim-rush.js [runs]
const R = require('../public/js/rush-core.js');
const RUNS = Number(process.argv[2]) || 300, DT = 1 / 60, LOOK = 1.5, DELAY = 0.25, JITTER = 0.08;

function rowsOf(tr) {
  const m = new Map();
  for (const o of tr.obs) { if (!m.has(o.d)) m.set(o.d, { d: o.d, end: o.d, lanes: [null, null, null] }); const r = m.get(o.d); r.lanes[o.lane] = o; r.end = Math.max(r.end, o.d + o.len); }
  return [...m.values()].sort((a, b) => a.d - b.d);
}

function play(seed, mode, rand) {
  const tr = R.generate(seed), s = R.newRun(R.clone(tr)), rows = rowsOf(s.track);
  let k = 0, hopAt = null;
  while (!s.done && s.t < 200) {
    if (mode === 'bot') {
      const v = R.speedAt(s.d) * (s.boost > 0 ? R.C.BOOST_K : 1);
      while (k < rows.length && rows[k].end < s.d - R.C.BIKE_HL) k++;
      const seen = s.d + v * (LOOK - DELAY);
      // plan lanes for visible rows: prefer clear lanes, then fewest moves
      const vis = rows.slice(k, k + 4).filter((r) => r.d < seen);
      // too close to the next row to change lanes safely: stay and commit
      const locked = vis.length > 0 && (vis[0].d - (s.d + R.C.BIKE_HL)) / v < 0.3;
      const tRow0 = vis.length ? (vis[0].d - (s.d + R.C.BIKE_HL)) / v : 9;
      let best = null;
      (function dfs(i, lane, cost, path) {
        if (i === vis.length) { if (!best || cost < best.cost) best = { cost, path }; return; }
        for (let l = 0; l < 3; l++) {
          if (i === 0 && l !== s.lane && (locked || tRow0 < 0.3 + R.C.LANE_T * Math.abs(l - s.lane))) continue;
          const o = vis[i].lanes[l];
          if (o && !o.low) continue;
          dfs(i + 1, l, cost + Math.abs(l - lane) + (o ? 0.6 : 0), path.concat(l));
        }
      })(0, s.lane, 0, []);
      const passedPrev = k === 0 || s.d - R.C.BIKE_HL > rows[k - 1].end + 0.2;
      if (best && best.path.length && passedPrev && !locked) {
        const want = best.path[0];
        if (want < s.lane) R.act(s, 'left'); else if (want > s.lane) R.act(s, 'right');
      }
      const r = rows[k];
      if (r && r.d < seen && s.hopT < 0 && Math.abs(s.x - (s.lane - 1)) < 0.05) {
        const o = r.lanes[s.lane];
        if (o && o.low) {
          if (hopAt == null) hopAt = 0.2 + (rand() * 2 - 1) * JITTER;
          if ((o.d - (s.d + R.C.BIKE_HL)) / v <= hopAt) { R.act(s, 'hop'); hopAt = null; }
        }
      }
    }
    R.step(s, DT);
  }
  return { s, total: tr.coins.length };
}

let x = 7; const rand = () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296);
let unfair = 0, idleHits = 0, coinsMax = 0, maxScore = 0, botScores = [], times = [];
for (let i = 1; i <= RUNS; i++) {
  const seed = (i * 2654435761) >>> 0;
  const { s, total } = play(seed, 'bot', rand);
  if (s.hits) { unfair++; if (unfair <= 5) console.log('bot hit on seed', seed, 'hits', s.hits, 'at d', Math.round(s.d)); }
  times.push(s.t); botScores.push(R.score(s));
  coinsMax = Math.max(coinsMax, total);
  maxScore = Math.max(maxScore, total * R.C.COIN + R.C.L + R.C.HEARTS * R.C.HEART_BONUS + R.C.DELIVERED);
  idleHits += play(seed, 'idle', rand).s.hits;
}
times.sort((a, b) => a - b); botScores.sort((a, b) => a - b);
console.log(JSON.stringify({ runs: RUNS, botRunsWithHits: unfair, idleAvgHits: +(idleHits / RUNS).toFixed(2),
  runSeconds: { min: +times[0].toFixed(1), median: +times[RUNS >> 1].toFixed(1), max: +times[RUNS - 1].toFixed(1) },
  botScoreMedian: botScores[RUNS >> 1], maxCoinsOnTrack: coinsMax, theoreticalMaxScore: maxScore }));
process.exit(unfair ? 1 : 0);

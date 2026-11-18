// QA autopilot for Rush Run (runs in the page). Same planner as tools/sim-rush.js, without the reaction delay.
window.__autopilot = function () {
  const R = window.RushCore;
  let k = 0, rows = null, lastTrack = null;
  setInterval(() => {
    const s = window.__rush.run(), tr = window.__rush.track();
    if (!s || s.done) return;
    if (tr !== lastTrack) { lastTrack = tr; k = 0; const m = new Map(); for (const o of tr.obs) { if (!m.has(o.d)) m.set(o.d, { d: o.d, end: o.d, lanes: [null, null, null] }); const r = m.get(o.d); r.lanes[o.lane] = o; r.end = Math.max(r.end, o.d + o.len); } rows = [...m.values()].sort((a, b) => a.d - b.d); }
    const v = R.speedAt(s.d) * (s.boost > 0 ? R.C.BOOST_K : 1);
    while (k < rows.length && rows[k].end < s.d - R.C.BIKE_HL) k++;
    const seen = s.d + v * 1.5, vis = rows.slice(k, k + 4).filter((r) => r.d < seen);
    const tRow0 = vis.length ? (vis[0].d - (s.d + R.C.BIKE_HL)) / v : 9, locked = tRow0 < 0.3;
    let best = null;
    (function dfs(i, lane, cost, path) {
      if (i === vis.length) { if (!best || cost < best.cost) best = { cost, path }; return; }
      for (let l = 0; l < 3; l++) {
        if (i === 0 && l !== s.lane && (locked || tRow0 < 0.3 + R.C.LANE_T * Math.abs(l - s.lane))) continue;
        const o = vis[i].lanes[l]; if (o && !o.low) continue;
        dfs(i + 1, l, cost + Math.abs(l - lane) + (o ? 0.6 : 0), path.concat(l));
      }
    })(0, s.lane, 0, []);
    const passedPrev = k === 0 || s.d - R.C.BIKE_HL > rows[k - 1].end + 0.2;
    if (best && best.path.length && passedPrev && !locked) { const w = best.path[0]; if (w < s.lane) window.__rush.act('left'); else if (w > s.lane) window.__rush.act('right'); }
    const r = rows[k];
    if (r && s.hopT < 0 && Math.abs(s.x - (s.lane - 1)) < 0.05) { const o = r.lanes[s.lane]; if (o && o.low && (o.d - (s.d + R.C.BIKE_HL)) / v <= 0.2) window.__rush.act('hop'); }
  }, 8);
};

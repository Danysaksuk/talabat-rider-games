// Super Over (cricket tap-timing chase): rules, deliveries, timing windows, scoring and flow.
// Shared by the 3D renderer (superover.js), the 2D fallback (superover-2d.js) and the headless
// bot/sims (node tools/sim-newgames.js). Timings here are what rules.js' anti-cheat cap assumes.
(function (root) {
  'use strict';
  const C = {
    OVERS: 10, TARGETS: [12, 15, 17, 18, 20, 22, 24, 26, 28, 30], WICKETS: 2,
    CONTACT_D: 0.6, STUMP_D: -0.25, REL_D: 19,
    RUNUP: 1.1, RESULT: 1.15, BANNER: 2.2,
    // timing windows (ms, absolute offset from the ideal contact moment)
    WIN: { perfect: 45, good: 90, two: 130, one: 175, beaten: 240 },
    PERFECT_LATE: 35, PERFECT_FROM: 4,   // the six window tightens from over 4
  };

  function makeDelivery(over, rand) {
    const R = rand || Math.random, o = over, r = R();
    let type = r < 0.55 ? 'good' : 'full';
    if (o >= 3 && R() < 0.22) type = 'yorker';
    if (o >= 4 && R() < 0.2) type = 'bouncer';
    if (o >= 5 && R() < 0.2) type = 'slower';
    let T = (1.15 - 0.058 * (o - 1)) * (0.96 + R() * 0.08);
    const spec = { good: [6, 0.8], full: [3.5, 0.5], yorker: [0.9, 0.15], bouncer: [11, 1.65], slower: [5.5, 0.85] }[type];
    if (type === 'yorker') T *= 0.95;
    if (type === 'slower') T *= 1.38;
    const x0 = 0.35, xEnd = (R() - 0.5) * 0.25;
    return { type, T, bounceD: spec[0], hEnd: spec[1], x0, xEnd, bounced: false };
  }
  // ball state at time s seconds after release (x lateral m, h height m, d distance from the bat end m)
  function ballAt(d0, s) {
    const vd = (C.REL_D - C.CONTACT_D) / d0.T, d = C.REL_D - vd * s;
    const tb = (C.REL_D - d0.bounceD) / vd;
    const u = Math.min(1, s / d0.T);
    const x = d0.x0 + (d0.xEnd - d0.x0) * Math.min(1.1, u);
    let h;
    if (s < tb) { const k = s / tb; h = 2.2 * (1 - k) - 0.5 * k * (1 - k); }
    else { const t2 = d0.T - tb, vb = (d0.hEnd + 4.9 * t2 * t2) / t2, q = s - tb; h = Math.max(0, vb * q - 4.9 * q * q); }
    return { x, h, d, vd };
  }
  // tap offset (ms, + = late) -> verdict; null = too late to matter (resolves as bowled)
  function judge(delta, over) {
    const W = C.WIN, perfect = (over || 1) >= C.PERFECT_FROM ? C.PERFECT_LATE : W.perfect;
    if (delta < -W.beaten) return { kind: 'early-out', delta };
    if (delta > W.beaten) return null;
    const a = Math.abs(delta);
    let r, label;
    if (a <= perfect) { r = 6; label = 'PERFECT!'; }
    else if (a <= W.good) { r = 4; label = 'GOOD!'; }
    else if (a <= W.two) { r = 2; label = delta < 0 ? 'EARLY' : 'LATE'; }
    else if (a <= W.one) { r = 1; label = delta < 0 ? 'EARLY' : 'LATE'; }
    else { r = 0; label = delta < 0 ? 'TOO EARLY' : 'TOO LATE'; }
    return { kind: r ? 'hit' : 'beaten', runs: r, label, side: delta < 0 ? -1 : 1, delta };
  }
  function launch(v, rand) {
    const side = v.side * (0.6 + (rand || Math.random)() * 0.4);
    if (v.runs === 6) return { vx: side * 6, vd: 30, vh: 17 };
    if (v.runs === 4) return { vx: side * 14, vd: 22, vh: 2 };
    if (v.runs === 2) return { vx: side * 9, vd: 12, vh: 3 };
    return { vx: side * 6, vd: 7, vh: 2 };
  }

  // A game: call update(dt, nowMs, playing) every frame and tap(timeStampMs) on input. `now` is the
  // performance.now() clock (same as event.timeStamp). Events go to on(name, data) for sound/visuals.
  function createGame(opts) {
    const o = opts || {}, R = o.rand || Math.random, emit = (n, d) => { if (o.on) o.on(n, d); };
    const g = {};
    g.reset = function () {
      Object.assign(g, { over: 1, ball: 0, runs: 0, wickets: 0, overRuns: 0, overBalls: [], phase: 'wait', phaseT: 0, del: null, hit: null, swing: -1, msg: null, banner: null, chased: false, done: false });
    };
    g.nextBall = function (delayMs) {
      g.phase = 'runup'; g.phaseT = -(delayMs || 0) / 1000;
      g.del = makeDelivery(g.over, R); g.hit = null; g.swing = -1; g.msg = null;
      emit('ball', g.del);
    };
    g.tap = function (ts) {
      if (g.swing >= 0 || g.phase !== 'flight') return false; // taps during run-up are ignored
      g.swing = ts;
      const v = judge(ts - g.del.hitAt, g.over);
      emit('swing', v);
      if (!v) return true;                                      // already past: resolved as bowled
      if (v.kind !== 'early-out') v.at = Math.max(ts, g.del.hitAt);
      g.del.verdict = v;
      return true;
    };
    // Auto-pause: a ball in flight is re-bowled (not counted) if no swing yet and it hasn't reached the bat.
    g.pause = function (now) {
      if (g.phase === 'flight' && g.swing < 0 && now < g.del.hitAt) { g.phase = 'runup'; g.phaseT = 0; g.del.bounced = false; g.del.releaseAt = g.del.hitAt = undefined; g.msg = null; emit('rebowl'); }
    };
    function resolve(kind, r, label) {
      g.ball++;
      if (kind === 'out') {
        g.wickets++; g.overBalls.push('W');
        g.msg = { big: 'BOWLED!', small: (label ? label + ' · ' : '') + (g.wickets >= C.WICKETS ? 'All out' : '1 wicket left'), col: '#FF3B3B', t: 0 };
      } else {
        g.runs += r; g.overRuns += r; g.overBalls.push(r ? String(r) : '•');
        if (r === 6) g.msg = { big: 'SIX!', small: label, col: '#FFD23F', t: 0 };
        else if (r === 4) g.msg = { big: 'FOUR!', small: label, col: '#fff', t: 0 };
        else if (r) g.msg = { big: r + (r === 1 ? ' RUN' : ' RUNS'), small: label, col: '#fff', t: 0 };
        else g.msg = { big: 'DOT BALL', small: label || 'Beaten!', col: '#ccc', t: 0 };
      }
      emit('result', { kind, runs: r, label, msg: g.msg });
      if (kind !== 'out' && !g.chased && g.overRuns >= C.TARGETS[g.over - 1]) {
        g.chased = true; g.banner = { txt: 'TARGET CHASED!', sub: 'Keep scoring, every run counts', t: 0, col: '#2ecc71' };
        emit('chased', g.banner);
      }
      g.phase = 'result'; g.phaseT = 0;
    }
    function finish() {
      const won = g.over >= C.OVERS && g.wickets < C.WICKETS;
      g.phase = 'done'; g.done = true;
      emit('finish', { runs: g.runs, won, over: g.over });
    }
    function afterResult() {
      if (g.wickets >= C.WICKETS) return finish();
      if (g.ball >= 6) {
        const tgt = C.TARGETS[g.over - 1];
        if (g.overRuns < tgt) {
          g.wickets++;
          g.banner = { txt: 'CHASE FAILED', sub: `Needed ${tgt}, scored ${g.overRuns}. Wicket lost!`, t: 0, col: '#FF3B3B' };
          emit('chaseFailed', g.banner);
          if (g.wickets >= C.WICKETS) { g.phase = 'banner'; g.phaseT = 0; return; }
        } else if (!g.banner || g.banner.t > 2) { g.banner = { txt: `OVER ${g.over} DONE`, sub: `${g.overRuns} runs (target ${tgt})`, t: 0, col: '#2ecc71' }; emit('overDone', g.banner); }
        if (g.over >= C.OVERS) { g.phase = 'banner'; g.phaseT = 0; return; }
        g.over++; g.ball = 0; g.overRuns = 0; g.overBalls = []; g.chased = false;
        g.banner.sub += ` · Over ${g.over} target: ${C.TARGETS[g.over - 1]}`;
        emit('newOver', g.banner);
        g.phase = 'banner'; g.phaseT = 0; return;
      }
      g.nextBall(0);
    }
    g.update = function (dt, now, playing) {
      if (g.msg) g.msg.t += dt; if (g.banner) g.banner.t += dt;
      if (!playing) return;
      g.phaseT += dt;
      if (g.phase === 'runup' && g.phaseT >= C.RUNUP) {
        g.phase = 'flight'; g.del.releaseAt = now; g.del.hitAt = now + g.del.T * 1000; g.phaseT = 0;
        emit('release', g.del);
      }
      if (g.phase === 'flight') {
        const del = g.del, s = (now - del.releaseAt) / 1000;
        const b = ballAt(del, s);
        if (!del.bounced && b.h <= 0.001 && s > 0.1) { del.bounced = true; emit('bounce', b); }
        const v = del.verdict;
        if (v && v.kind === 'hit' && now >= v.at) {
          const c = ballAt(del, del.T);
          g.hit = Object.assign({ x: c.x, h: Math.max(0.4, c.h), d: C.CONTACT_D, t: 0 }, launch(v, R));
          emit('bat', v);
          resolve('runs', v.runs, v.label);
        } else if (now >= del.hitAt + C.WIN.beaten) {
          del.stumpsHit = !(v && v.kind === 'beaten');
          del.passS = s;
          if (v && v.kind === 'beaten') resolve('runs', 0, v.label === 'TOO LATE' ? 'Beaten! Too late' : 'Beaten! Too early');
          else resolve('out', 0, v && v.kind === 'early-out' ? 'Way too early' : (g.swing >= 0 ? 'Way too late' : 'No swing'));
        }
      }
      const h = g.hit;
      if (h) {
        h.t += dt; h.x += h.vx * dt; h.d += h.vd * dt; h.vh -= 9.8 * dt; h.h += h.vh * dt;
        if (h.h < 0) { h.h = 0; h.vh = -h.vh * 0.4; h.vd *= 0.85; h.vx *= 0.85; }
      }
      if (g.phase === 'result' && g.phaseT >= C.RESULT) afterResult();
      else if (g.phase === 'banner' && g.phaseT >= C.BANNER) {
        if (g.wickets >= C.WICKETS || (g.over >= C.OVERS && g.ball >= 6)) finish(); else { g.banner.t = Math.max(g.banner.t, 2.0); g.nextBall(0); }
      }
    };
    g.state = () => ({ over: g.over, ball: g.ball, runs: g.runs, wickets: g.wickets, phase: g.phase, overRuns: g.overRuns, hitAt: g.del && g.del.hitAt });
    g.reset();
    return g;
  }

  const api = { C, makeDelivery, ballAt, judge, launch, createGame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SuperOver = api;
})(typeof window !== 'undefined' ? window : globalThis);

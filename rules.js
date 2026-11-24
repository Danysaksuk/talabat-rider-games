'use strict';
// Score plausibility rules, derived from the real gameplay maxima (see tools/check-limits.js).
// All times are server-measured from run-token issue, which includes the ~2.9 s 3-2-1 countdown.
const S = (ms) => ms / 1000;

const GAMES = {
  // Hoops: 60 s timer; server minimum 58 s (clock-drift slack). Max = a swish every 0.38 s reload
  // with the x5 combo = 2,310 in 158 throws, i.e. <= 37 points per second played.
  hoops: { name: 'Basketball Shootout', minMs: 58000, max: 2400,
    cap: (ms) => 37 * Math.min(S(ms), 75) },
  // Super Over: first ball resolves >= 5.37 s after the token (countdown 2.9 + delay 0.8 + run-up 1.1
  // + fastest delivery 0.57), then one ball per >= 2.82 s (result 1.15 + run-up 1.1 + 0.57).
  // Max 6 runs per ball, 60 balls.
  superover: { name: 'Super Over', minMs: 5000, max: 360,
    balls: (ms) => (S(ms) < 4.8 ? 0 : Math.min(60, Math.floor((S(ms) - 4.8) / 2.8) + 1)),
    cap(ms) { return 6 * this.balls(ms); } },
  // Rush (endless): no finish, so the cap is points per second, derived from the rules in rush-core.js:
  //  - distance: at most VMAX x BOOST_K = 32 x 1.5 = 48 points/s
  //  - coins: rows are always >= 0.95 s of track-speed travel apart, so even boosted the whole time a rider
  //    passes <= 1.5 / 0.95 = 1.58 rows/s; each row carries <= 12 coins (line <= 7 + hop arc 5) of 100 =
  //    <= 1,895 points/s
  //  => <= 1,943 points/s, rounded up to 1,950/s of server-measured time (which also includes the 2.9 s
  //     countdown and any pause). The fairness bot's real pace is ~280/s. The absolute max only guards
  //     against nonsense (~43 min at the cap).
  rush: { name: 'Talabat Rush Run', minMs: 4000, max: 5000000,
    cap: (ms) => 1950 * S(ms) },
  // Penalty: 5 kicks/level, 3 to advance. Max 175/goal (100 + 50 corner + 25 curve) + 500
  // per level. Fastest cycle is about 1.4 s (min flight to the mouth + 0.85 s result), so
  // a perfect level is <= 1,375 in 7 s, i.e. <= 200 points per second. minMs covers 5
  // short misses after the 2.9 s countdown. The absolute max is about 30 min at the cap.
  penalty: { name: 'Penalty Shootout', minMs: 7000, max: 400000,
    cap: (ms) => 220 * S(ms) },
  // Stack: 10 per box + 5 x combo (capped at 8) = 50 max per box. Late swings allow a
  // drop about every 0.39 s, i.e. <= 130 points per second. An instant first-box miss
  // plus countdown is just over 3 s.
  stack: { name: 'Stack the Order', minMs: 3000, max: 400000,
    cap: (ms) => 180 * S(ms) },
};

// Returns null when the score is plausible, else a reason.
function check(game, score, ms) {
  const g = GAMES[game];
  if (!g) return 'Unknown game';
  if (!Number.isInteger(score) || score < 0) return 'Invalid score';
  if (ms < g.minMs) return 'Run too short';
  if (score > g.max || score > g.cap(ms)) return 'Score rejected';
  return null;
}
module.exports = { GAMES, check };

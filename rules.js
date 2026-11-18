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
  // Rush: best possible pace (every coin and every boost pad) is 580 points/s; the 4,000 delivery + heart
  // bonus needs the full track, which takes >= 82.5 s of riding (85 s with the countdown).
  rush: { name: 'Talabat Rush Run', minMs: 4000, max: 60000,
    cap: (ms) => 620 * S(ms) + (S(ms) >= 80 ? 4000 : 0) },
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

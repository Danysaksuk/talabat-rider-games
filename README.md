# Talabat Rider Games

Five phone-first mini games with one shared leaderboard, served by a single Node app.

| Game | Path | How it scores |
|---|---|---|
| Basketball Shootout | `/hoops` | 60 s. Swipe up to shoot. A make is 2 points, and a swish adds 1. Both are multiplied by the combo (x1 to x5). The hoop starts moving at 20 s and speeds up at 40 s. |
| Super Over | `/superover` | Tap-timing cricket over up to 10 overs. Score = total runs. Missing an over's target costs a wicket, and 2 wickets end the game. |
| Talabat Rush Run | `/rush` | Endless 3D lane runner. Score = coins x 100 plus distance. The run ends when 3 hearts are lost. |
| Penalty Shootout | `/penalty` | Draw a curve from the ball. 5 kicks per level, 3 goals to advance. Score = 100 per goal, plus corner and curve bonuses, plus 500 per level cleared. |
| Stack the Order | `/stack` | Drop swinging boxes onto the bag. Overhang is sliced off. Score = 10 per box plus a combo bonus for perfects. |

Other pages: `/` (Rider ID gate + game picker) and `/leaderboard` (one tab per game: Hoops (default), Super Over, Rush Run, Penalty, Stack; top 20, auto-refreshes every 10 s). There is no combined overall ranking: each game has its own winner.

## Run locally

```bash
npm install
ADMIN_PIN=1234 npm start          # http://localhost:3000
```

With no `DATABASE_URL`, scores are saved to `data/scores.json`.

## Environment

| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `DATABASE_URL` | Postgres connection string. When set, scores go to Postgres. The table `rg_scores` is created automatically. |
| `ADMIN_PIN` | Turns on the admin endpoints below. Leave it unset to disable them. |
| `DATA_FILE` | Optional path for the JSON fallback |

Run a **single instance** only. Run tokens and the leaderboard cache live in memory, and the database is only used for persistence.

## API

- `POST /api/run {riderId, game, nickname?}` → `{token}`. Call it at game start.
- `POST /api/score {riderId, game, score, token, nickname?}` → `{best, rank, total, improved}`. The server keeps the best score per rider per game.
- `GET /api/leaderboard?game=hoops|superover|rush|penalty|stack&riderId=` (defaults to hoops) → `{top[20], me, total}`
- `GET /api/me?riderId=` returns this rider's best and rank in each game.
- `GET /api/export?pin=ADMIN_PIN&game=hoops|superover|rush|penalty|stack` downloads that game's ranking as CSV (`game,rank,rider_id,nickname,best,plays,best_at_utc`). Without `game`, it exports every game, ranked separately.
- `POST /api/reset?pin=ADMIN_PIN` wipes all scores.

Anti-cheat (rules in `rules.js`, verified by `node tools/check-limits.js`):
- A score needs a one-time run token that matches the rider and game, and tokens expire after 30 min.
- Each game has a minimum run length and a hard maximum, set from the real gameplay maxima:

  | Game | Min run | Max score | Score-vs-time cap |
  |---|---|---|---|
  | Hoops | 58 s | 2,400 (perfect run 2,310) | ≤ 37 points per second played (counted up to 75 s) |
  | Super Over | 5 s | 360 | runs ≤ 6 × balls that could have been bowled in the elapsed time |
  | Rush | 4 s | 5,000,000 | ≤ 1,950 points per second |
  | Penalty | 7 s | 400,000 | ≤ 220 points per second |
  | Stack | 3 s | 400,000 | ≤ 180 points per second |

- Nicknames: `/api/run` never creates a rider or changes a name. A rider is created by its first accepted score, and is bound to that phone's device secret (`rg_device` in localStorage, stored hashed). Only that phone can change the nickname, through an accepted score. Tags and angle brackets are stripped.
- Writes are limited to 240 per minute per IP. The limit is generous because event Wi-Fi puts many riders behind one IP.
- Errors are returned as JSON with no stack traces.
- Limits: a client that waits out the clock can still send an inflated score up to the cap. Fully stopping that would need server-side replay of the game. Check the top scores in the CSV export (it includes plays) before naming winners.

Games auto-pause when the tab is hidden, the window loses focus or a phone is turned to landscape, then resume with a 3-2-1. In Super Over a ball in flight is re-bowled.

## Deploy on Render

`render.yaml` defines a free Node web service (`npm ci`, `npm start`) and a free Postgres database wired to `DATABASE_URL`. It sets `NODE_ENV=production` and asks for `ADMIN_PIN` (`sync: false`) when the Blueprint is created.

## QA tools

- `node tools/sim-rush.js 3000` is the Rush Run fairness bot. It plays 3,000 random tracks with a 0.25 s reaction delay, a 1.5 s look-ahead and ±80 ms hop timing error, using the game's own rules code. It must take zero hits.
- `node tools/sim-newgames.js` runs the Penalty and Stack bots and checks their scores against the caps.
- `python3 tools/qa.py http://localhost:3000 <gate|api|hoops|superover|rush|board|desktop|ratelimit>` runs the Playwright end-to-end checks. Start the server with `ADMIN_PIN=4826`. Screenshots go to `screenshots/`.
- `python3 tools/qa-newgames.py http://localhost:3000` is the Penalty + Stack Playwright smoke (desktop and mobile screenshots under `screenshots/newgames/`).

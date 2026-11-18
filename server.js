'use strict';
// Talabat Rider Games: static games + leaderboard API (single instance).
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'scores.json');

// Per-game anti-cheat rules (min run length, max score, score-vs-time caps) live in rules.js.
const RULES = require('./rules');
const GAMES = RULES.GAMES;
const GAME_IDS = Object.keys(GAMES);
const RIDER_RE = /^[0-9]{1,7}$/;
const ADMIN_RIDER = String(process.env.ADMIN_RIDER_ID || '4826'); // test ID: plays normally, never saved
const TOKEN_TTL_MS = 30 * 60 * 1000;

// ---------- storage: in-memory authoritative, persisted to Postgres or JSON ----------
// riders: Map riderId -> { nickname, scores: { game: { best, plays, at } } }
const riders = new Map();
let store;

function riderRec(id) {
  let r = riders.get(id);
  if (!r) { r = { nickname: '', dev: '', scores: {} }; riders.set(id, r); }
  return r;
}
// Device secrets are stored hashed; a rider is bound to the device that first scored for it.
const devHash = (v) => { const s = String(v || ''); return /^[a-f0-9]{32,64}$/.test(s) ? crypto.createHash('sha256').update(s).digest('hex') : ''; };

function jsonStore() {
  let timer = null;
  return {
    kind: 'json file',
    async load() {
      try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        for (const [id, r] of Object.entries(data.riders || {})) riders.set(id, r);
      } catch (e) { if (e.code !== 'ENOENT') console.error('load failed', e.message); }
    },
    save() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        const tmp = DATA_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ riders: Object.fromEntries(riders) }));
        fs.renameSync(tmp, DATA_FILE);
      }, 300);
    },
    async upsert() { this.save(); },
    async reset() { this.save(); },
  };
}

function pgStore() {
  const { Pool } = require('pg');
  const host = (() => { try { return new URL(DATABASE_URL).hostname; } catch { return ''; } })();
  const needSsl = host.includes('.') && host !== 'localhost' && host !== '127.0.0.1' && process.env.PGSSLMODE !== 'disable';
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: needSsl ? { rejectUnauthorized: false } : false, max: 5 });
  return {
    kind: 'postgres',
    async load() {
      await pool.query(`CREATE TABLE IF NOT EXISTS rg_scores (
        rider_id TEXT NOT NULL, game TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '',
        best INTEGER NOT NULL, plays INTEGER NOT NULL DEFAULT 0, at BIGINT NOT NULL,
        PRIMARY KEY (rider_id, game))`);
      await pool.query(`ALTER TABLE rg_scores ADD COLUMN IF NOT EXISTS dev TEXT NOT NULL DEFAULT ''`);
      const { rows } = await pool.query('SELECT * FROM rg_scores');
      for (const row of rows) {
        const r = riderRec(row.rider_id);
        if (row.nickname) r.nickname = row.nickname;
        if (row.dev) r.dev = row.dev;
        r.scores[row.game] = { best: row.best, plays: row.plays, at: Number(row.at) };
      }
    },
    async upsert(id, game) {
      const r = riders.get(id); const s = r.scores[game];
      await pool.query(`INSERT INTO rg_scores (rider_id, game, nickname, best, plays, at, dev) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (rider_id, game) DO UPDATE SET nickname=$3, best=$4, plays=$5, at=$6, dev=$7`,
        [id, game, r.nickname, s.best, s.plays, s.at, r.dev]);
      await pool.query('UPDATE rg_scores SET nickname=$2, dev=$3 WHERE rider_id=$1', [id, r.nickname, r.dev]);
    },
    async reset() { await pool.query('DELETE FROM rg_scores'); },
  };
}

// ---------- ranking ----------
function board(game) {
  const rows = [];
  for (const [id, r] of riders) {
    const s = r.scores[game];
    if (s) rows.push({ riderId: id, nickname: r.nickname, score: s.best, plays: s.plays, at: s.at });
  }
  // Higher score first; ties go to whoever got there first.
  rows.sort((a, b) => b.score - a.score || a.at - b.at || (a.riderId < b.riderId ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// ---------- helpers ----------
const normId = (v) => String(v || '').trim().toUpperCase();
const cleanNick = (v) => String(v || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
const tokens = new Map(); // token -> { riderId, game, start, used }

function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now(); const k = req.ip;
    let h = hits.get(k);
    if (!h || now - h.start > windowMs) { h = { start: now, n: 0 }; hits.set(k, h); }
    if (++h.n > max) return res.status(429).json({ error: 'Too many requests, slow down.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [t, v] of tokens) if (now - v.start > TOKEN_TTL_MS) tokens.delete(t); }, 60000).unref();

function pinOk(req) {
  const pin = String(req.query.pin || req.get('x-admin-pin') || '');
  if (!ADMIN_PIN || pin.length !== ADMIN_PIN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(ADMIN_PIN));
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
// Event Wi-Fi often puts many riders behind one IP, so limits are generous.
const writeLimit = limiter(240, 60000);
const readLimit = limiter(600, 60000);

app.post('/api/run', writeLimit, (req, res) => {
  const riderId = normId(req.body && req.body.riderId);
  const game = String(req.body && req.body.game);
  if (!RIDER_RE.test(riderId)) return res.status(400).json({ error: 'Invalid rider ID' });
  if (!GAMES[game]) return res.status(400).json({ error: 'Unknown game' });
  // No rider record and no nickname change here: riders are only created by an accepted score.
  const token = crypto.randomBytes(16).toString('hex');
  tokens.set(token, { riderId, game, start: Date.now(), used: false });
  res.json({ token });
});

app.post('/api/score', writeLimit, async (req, res) => {
  const b = req.body || {};
  const riderId = normId(b.riderId);
  const game = String(b.game);
  const score = Number(b.score);
  const t = tokens.get(String(b.token || ''));
  if (!t) return res.status(403).json({ error: 'Invalid or expired run token' });
  if (t.used) return res.status(403).json({ error: 'Run token already used' });
  if (t.riderId !== riderId || t.game !== game) return res.status(403).json({ error: 'Token does not match this run' });
  t.used = true;
  if (riderId === ADMIN_RIDER) return res.json({ ok: true, admin: true, score, best: score, improved: false, rank: '-', total: board(game).length });
  const bad = RULES.check(game, score, Date.now() - t.start);
  if (bad) return res.status(bad === 'Invalid score' ? 400 : 422).json({ error: bad });

  const isNew = !riders.has(riderId);
  const r = riderRec(riderId);
  const nick = cleanNick(b.nickname), dev = devHash(b.device);
  if (isNew || !r.dev) r.dev = dev;          // bind the rider to the first device that scores
  if (nick && (isNew || (dev && dev === r.dev))) r.nickname = nick; // only that device may rename
  const prev = r.scores[game];
  const improved = !prev || score > prev.best;
  r.scores[game] = improved ? { best: score, plays: (prev ? prev.plays : 0) + 1, at: Date.now() }
                            : { ...prev, plays: prev.plays + 1 };
  try { await store.upsert(riderId, game); } catch (e) { console.error('save failed', e.message); }
  const rows = board(game);
  const me = rows.find((x) => x.riderId === riderId);
  res.json({ ok: true, score, best: r.scores[game].best, improved, rank: me.rank, total: rows.length });
});

app.get('/api/leaderboard', readLimit, (req, res) => {
  const game = String(req.query.game || 'hoops');
  if (!GAMES[game]) return res.status(400).json({ error: 'Unknown game' });
  const rows = board(game);
  const riderId = normId(req.query.riderId);
  const me = riderId && riderId !== ADMIN_RIDER ? rows.find((x) => x.riderId === riderId) || null : null;
  const strip = (x) => ({ rank: x.rank, riderId: x.riderId, nickname: x.nickname, score: x.score });
  res.json({ game, total: rows.length, top: rows.slice(0, 20).map(strip), me: me && strip(me), at: Date.now() });
});

app.get('/api/me', readLimit, (req, res) => {
  const riderId = normId(req.query.riderId);
  if (!RIDER_RE.test(riderId)) return res.status(400).json({ error: 'Invalid rider ID' });
  const out = {};
  for (const g of GAME_IDS) {
    const me = board(g).find((x) => x.riderId === riderId);
    out[g] = me ? { best: me.score, rank: me.rank } : null;
  }
  res.json({ riderId, games: out });
});

app.get('/api/export', (req, res) => {
  if (!pinOk(req)) return res.status(403).json({ error: 'Bad PIN' });
  // Per-game ranking. ?game=hoops|superover|rush exports one game; no game exports all three, one block per game.
  const game = req.query.game ? String(req.query.game) : '';
  if (game && !GAMES[game]) return res.status(400).json({ error: 'Unknown game' });
  const esc = (v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = ['game,rank,rider_id,nickname,best,plays,best_at_utc'];
  for (const g of game ? [game] : GAME_IDS) {
    for (const x of board(g)) lines.push([g, x.rank, x.riderId, x.nickname, x.score, x.plays, new Date(x.at).toISOString()].map(esc).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="rider-games-${game || 'all-games'}.csv"`);
  res.send(lines.join('\n') + '\n');
});

app.post('/api/reset', async (req, res) => {
  if (!pinOk(req)) return res.status(403).json({ error: 'Bad PIN' });
  riders.clear(); tokens.clear();
  await store.reset();
  res.json({ ok: true });
});

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
// JSON errors only (no stack traces), e.g. for malformed JSON bodies.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? 'Request too large' : status < 500 ? 'Bad request' : 'Server error' });
});

(async () => {
  store = DATABASE_URL ? pgStore() : jsonStore();
  await store.load();
  app.listen(PORT, () => console.log(`Rider Games on :${PORT} (storage: ${store.kind}, riders: ${riders.size}, admin: ${ADMIN_PIN ? 'on' : 'off'})`));
})().catch((e) => { console.error(e); process.exit(1); });

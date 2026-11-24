// Penalty Shootout: draw a curve, beat the keeper. Uses Penalty core + RG.shell.
(function () {
  'use strict';
  const cv = document.getElementById('c'), cx = cv.getContext('2d');
  const logo = new Image(); logo.src = '/img/talabat-logo.png';
  const P = window.Penalty, C = P.C, G = C.GOAL;

  let W = 360, H = 700, scale = 1, top = 44, bot = 6;
  RG.fit(cv, 360, (i) => { W = i.W; H = i.H; scale = i.scale; top = Math.max(40, H * 0.06); });
  const fx = (x) => x * W / C.W;
  const fy = (y) => top + y * (H - top - bot) / C.H;
  const fxy = (x, y) => [fx(x), fy(y)];
  function fromCss(cx0, cy0) {
    const r = cv.getBoundingClientRect();
    const sx = (cx0 - r.left) / r.width * W, sy = (cy0 - r.top) / r.height * H;
    return { x: sx * C.W / W, y: (sy - top) * C.H / (H - top - bot) };
  }

  let run = P.newRun((Math.random() * 1e9) >>> 0), ended = false, pops = [], flash = 0, netKick = 0, hintT = 3;
  let drawPts = null, drawT0 = 0, shake = 0, crowd = [];
  for (let i = 0; i < 220; i++) crowd.push({ x: Math.random(), y: Math.random(), c: ['#FF5A00', '#fff', '#FFD23F', '#3fa9f5', '#e84393', '#1d1d1f', '#2ecc71'][i % 7] });

  const sh = RG.shell({
    game: 'penalty', title: '⚽ Penalty Shootout',
    how: '• <b>Draw a curve</b> from the ball to the goal. The ball follows your line.<br>• A longer, faster swipe gives more power. A bad curve goes wide or over the bar.<br>• Each level is <b>5 kicks</b>. Score at least <b>3 goals</b> to go up. Fail a level (under 3 out of 5) and the run ends.<br>• Walls, cones, defenders and wind come in as you climb. Top corners and curve shots score a bonus.',
    onReset: reset, onStart: () => { hintT = 3; },
  });
  if (!sh) return;
  function reset() {
    run = P.newRun((Math.random() * 1e9) >>> 0);
    ended = false; pops = []; flash = 0; netKick = 0; hintT = 3; drawPts = null; shake = 0;
  }

  const S = {
    kick: () => { RG.noise({ d: 0.12, v: 0.28, f: 400, f2: 180, q: 1.2, filter: 'lowpass' }); RG.tone({ f: 140, f2: 70, d: 0.14, type: 'sine', v: 0.22 }); },
    goal: () => { RG.sfx.win(); RG.noise({ d: 0.7, v: 0.22, f: 1600, q: 0.5, a: 0.08 }); },
    save: () => { RG.noise({ d: 0.2, v: 0.3, f: 700, q: 1.4 }); RG.tone({ f: 180, f2: 90, d: 0.3, type: 'triangle', v: 0.16 }); },
    post: () => { RG.tone({ f: 520, d: 0.18, type: 'triangle', v: 0.22 }); RG.tone({ f: 1040, d: 0.08, type: 'square', v: 0.08 }); },
    block: () => RG.noise({ d: 0.16, v: 0.28, f: 280, q: 1.2, filter: 'lowpass' }),
    miss: () => RG.tone({ f: 220, f2: 130, d: 0.35, type: 'sine', v: 0.14 }),
    whistle: () => RG.tone({ f: 1480, d: 0.22, type: 'square', v: 0.07 }),
  };

  function pop(txt, sub, col, x, y) { pops.push({ txt, sub, col, x, y, t: 0 }); }
  function onResult(r) {
    const [x, y] = fxy(r.x, r.y);
    if (r.goal) {
      S.goal(); flash = 0.35; netKick = 1;
      const sub = [r.corner ? 'TOP CORNER +50' : '', r.curve ? 'CURVE +25' : ''].filter(Boolean).join(' · ') || '+100';
      pop(r.corner ? 'TOP CORNER!' : 'GOAL!', sub, r.corner ? '#FFD23F' : '#fff', x, y);
    } else {
      const map = { save: 'SAVED!', blocked: 'BLOCKED!', post: 'POST!', over: 'OVER!', wide: 'WIDE!', short: 'TOO WEAK!' };
      pop(map[r.kind] || 'MISS', '', '#FF6B6B', x, y);
      if (r.kind === 'save') S.save();
      else if (r.kind === 'post') S.post();
      else if (r.kind === 'blocked') S.block();
      else S.miss();
      shake = r.kind === 'post' ? 0.28 : 0.16;
    }
  }

  // ---------- input ----------
  cv.addEventListener('pointerdown', (e) => {
    if (sh.state !== 'play' || run.over || run.kick.phase !== 'aim') return;
    const p = fromCss(e.clientX, e.clientY);
    if (Math.hypot(p.x - C.BALL.x, p.y - C.BALL.y) > 90) return;
    drawPts = [{ x: C.BALL.x, y: C.BALL.y }, p];
    drawT0 = e.timeStamp;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawPts) return;
    const p = fromCss(e.clientX, e.clientY);
    const last = drawPts[drawPts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= 4) drawPts.push(p);
  });
  function endDraw(e) {
    if (!drawPts) return;
    const pts = drawPts; drawPts = null;
    if (e) { const p = fromCss(e.clientX, e.clientY); const last = pts[pts.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) pts.push(p); }
    const ms = Math.max(40, (e && e.timeStamp ? e.timeStamp : performance.now()) - drawT0);
    if (P.shoot(run.kick, pts, ms)) S.kick();
  }
  cv.addEventListener('pointerup', endDraw);
  cv.addEventListener('pointercancel', () => { drawPts = null; });

  // ---------- loop ----------
  let lastKind = null;
  function update(dt) {
    if (sh.state === 'play' && !run.over) {
      const ph = run.kick.phase;
      P.step(run, dt);
      const r = run.kick.result;
      if (r && r.kind !== lastKind && (ph === 'flight' || ph === 'aim')) { lastKind = r.kind; onResult(r); }
      if (run.kick.phase === 'aim') lastKind = null;
      if (run.over && !ended) {
        ended = true;
        RG.sfx.over();
        const lvl = run.levelsCleared, line = `Reached level ${run.level} · ${run.totalGoals} goal${run.totalGoals === 1 ? '' : 's'} · ${lvl} level${lvl === 1 ? '' : 's'} cleared`;
        sh.end(run.score, { title: lvl ? 'Great run!' : 'Game over', line, delay: 900 });
      }
    }
    flash = Math.max(0, flash - dt);
    netKick = Math.max(0, netKick - dt * 2);
    shake = Math.max(0, shake - dt);
    hintT = Math.max(0, hintT - dt);
    for (const p of pops) p.t += dt;
    pops = pops.filter((p) => p.t < 1.15);
  }

  // ---------- draw helpers ----------
  function rr(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
  function stadium(tt) {
    const sky = cx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#143056'); sky.addColorStop(0.35, '#1d4a6e'); sky.addColorStop(1, '#0d2a18');
    cx.fillStyle = sky; cx.fillRect(0, 0, W, H);
    // floodlights
    cx.fillStyle = 'rgba(255,245,200,.07)';
    cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(W * 0.35, 0); cx.lineTo(W * 0.48, H * 0.7); cx.lineTo(0, H); cx.fill();
    cx.beginPath(); cx.moveTo(W, 0); cx.lineTo(W * 0.65, 0); cx.lineTo(W * 0.52, H * 0.7); cx.lineTo(W, H); cx.fill();
    // stands sit just above the crossbar, below the HUD
    const standBot = fy(G.y) - 6, standTop = Math.max(112, standBot - 58);
    cx.fillStyle = '#1a2430'; cx.fillRect(0, standTop, W, Math.max(8, standBot - standTop));
    for (const p of crowd) {
      cx.fillStyle = p.c;
      cx.globalAlpha = 0.75;
      const cy = standBot - 6 - p.y * Math.max(10, standBot - standTop - 12);
      if (cy > standTop + 2) cx.fillRect(p.x * W, cy, 3, 5);
    }
    cx.globalAlpha = 1;
    // pitch
    const pitchTop = fy(G.y + G.h - 10);
    const grass = cx.createLinearGradient(0, pitchTop, 0, H);
    grass.addColorStop(0, '#2f8a3a'); grass.addColorStop(1, '#1e6a2a');
    cx.fillStyle = grass; cx.fillRect(0, pitchTop, W, H - pitchTop);
    cx.fillStyle = 'rgba(255,255,255,.07)';
    const stripe = (H - pitchTop) / 8;
    for (let i = 0; i < 8; i += 2) cx.fillRect(0, pitchTop + i * stripe, W, stripe);
    // penalty markings
    cx.strokeStyle = 'rgba(255,255,255,.55)'; cx.lineWidth = 2;
    const [bx, by] = fxy(C.BALL.x, C.BALL.y);
    cx.beginPath(); cx.arc(bx, by, 28, 0, 7); cx.stroke();
    cx.beginPath(); cx.moveTo(fx(40), fy(goalLine())); cx.lineTo(fx(C.W - 40), fy(goalLine())); cx.stroke();
    // center logo faded on the pitch
    if (logo.complete && logo.naturalWidth) {
      cx.globalAlpha = 0.18;
      const lw = 90, lh = lw * logo.naturalHeight / logo.naturalWidth;
      cx.drawImage(logo, W / 2 - lw / 2, fy(400) - lh / 2, lw, lh);
      cx.globalAlpha = 1;
    }
  }
  function goalLine() { return G.y + G.h; }
  function drawGoal() {
    const [x0, y0] = fxy(G.x, G.y), [x1, y1] = fxy(G.x + G.w, G.y + G.h);
    const pw = Math.max(5, fx(C.POST) - fx(0));
    // net
    cx.save();
    cx.beginPath(); cx.rect(x0, y0, x1 - x0, y1 - y0); cx.clip();
    const bulge = netKick * 10;
    cx.strokeStyle = 'rgba(230,245,255,.55)'; cx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = x0 + (x1 - x0) * i / 10;
      cx.beginPath(); cx.moveTo(x, y0); cx.lineTo(x + (x - W / 2) * 0.04, y1 + bulge); cx.stroke();
    }
    for (let i = 0; i <= 7; i++) {
      const y = y0 + (y1 - y0) * i / 7 + bulge * i / 7;
      cx.beginPath(); cx.moveTo(x0, y); cx.lineTo(x1, y); cx.stroke();
    }
    cx.restore();
    // target zones
    if (run.kick.zones) {
      cx.fillStyle = 'rgba(255,210,63,.22)'; cx.strokeStyle = 'rgba(255,210,63,.85)'; cx.lineWidth = 2;
      const z = C.CORNER;
      [[G.x + 6, G.y + 6], [G.x + G.w - z - 6, G.y + 6]].forEach(([x, y]) => {
        rr(fx(x), fy(y), fx(x + z) - fx(x), fy(y + z) - fy(y), 8); cx.fill(); cx.stroke();
      });
    }
    // posts & bar
    cx.fillStyle = '#f4f7fb';
    cx.fillRect(x0 - pw / 2, y0 - pw / 2, pw, y1 - y0 + pw);
    cx.fillRect(x1 - pw / 2, y0 - pw / 2, pw, y1 - y0 + pw);
    cx.fillRect(x0 - pw / 2, y0 - pw / 2, x1 - x0 + pw, pw);
    cx.fillStyle = '#d0d6de';
    cx.fillRect(x0 - pw / 2 + 2, y0 - pw / 2 + 2, pw - 2, y1 - y0 + pw - 2);
  }
  function drawKeeper(k, tt) {
    const kb = P.keeperBox(k);
    const [x, y] = fxy(k.keeperX, goalLine() - 6);
    const lean = (k.keeperX - 180) / 80;
    const dive = k.phase === 'flight' && k.ft >= k.keeperReactAt;
    cx.save();
    cx.translate(x, y);
    cx.rotate(lean * 0.35);
    const s = Math.max(0.85, (fy(G.y + G.h) - fy(G.y)) / 128);
    // legs
    cx.fillStyle = '#1d1d1f';
    cx.fillRect(-8 * s, -10 * s, 6 * s, 18 * s + (dive ? 4 : 0));
    cx.fillRect(2 * s, -10 * s, 6 * s, 18 * s + (dive ? 4 : 0));
    // body
    cx.fillStyle = '#FF5A00';
    rr(-11 * s, -36 * s, 22 * s, 28 * s, 5); cx.fill();
    cx.fillStyle = '#fff'; cx.font = '900 ' + Math.round(7 * s) + 'px Poppins'; cx.textAlign = 'center';
    cx.fillRect(-6 * s, -24 * s, 12 * s, 3 * s);
    // head
    cx.fillStyle = '#e8b894'; cx.beginPath(); cx.arc(0, -44 * s, 8 * s, 0, 7); cx.fill();
    // gloves
    cx.fillStyle = '#FFD23F';
    cx.beginPath(); cx.arc(-16 * s - lean * 8, -28 * s, 6 * s, 0, 7); cx.fill();
    cx.beginPath(); cx.arc(16 * s - lean * 8, -28 * s, 6 * s, 0, 7); cx.fill();
    cx.restore();
    // reach ghost (debug-free: a subtle shadow)
    void kb; void tt;
  }
  function drawWall(k) {
    const wr = P.wallRect(k);
    if (!wr) return;
    const [x, y] = fxy(wr.x, wr.y), w = fx(wr.x + wr.w) - x, h = fy(wr.y + wr.h) - y;
    const jump = k.wall && k.wall.kind === 'jump';
    cx.fillStyle = '#c24400'; cx.fillRect(x, y + h, w, 5);
    const g = cx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#FF7A2E'); g.addColorStop(1, '#FF5A00');
    cx.fillStyle = g; rr(x, y, w, h, 4); cx.fill();
    cx.fillStyle = '#fff'; cx.font = '900 11px Poppins'; cx.textAlign = 'center';
    if (w > 60) cx.fillText(jump ? 'JUMP!' : 'TALABAT', x + w / 2, y + h * 0.68);
    cx.strokeStyle = 'rgba(255,255,255,.35)'; cx.lineWidth = 2; cx.stroke();
  }
  function drawCones(k) {
    for (const c of k.cones) {
      const [x, y] = fxy(c.x, c.y), r = Math.max(8, fx(c.r) - fx(0));
      cx.fillStyle = 'rgba(0,0,0,.25)'; cx.beginPath(); cx.ellipse(x, y + 2, r * 1.1, r * 0.35, 0, 0, 7); cx.fill();
      cx.fillStyle = '#FF5A00';
      cx.beginPath(); cx.moveTo(x, y - r * 2.2); cx.lineTo(x + r, y + r * 0.3); cx.lineTo(x - r, y + r * 0.3); cx.closePath(); cx.fill();
      cx.fillStyle = '#fff'; cx.fillRect(x - r * 0.7, y - r * 0.5, r * 1.4, 3);
    }
  }
  function drawDefs(k) {
    for (const d of k.defenders) {
      const dx = P.defX(d, k.age);
      const [x, y] = fxy(dx, d.y);
      const s = (fy(d.y) - fy(d.y - d.h)) / 48;
      cx.fillStyle = 'rgba(0,0,0,.25)'; cx.beginPath(); cx.ellipse(x, y + 2, 12 * s, 4 * s, 0, 0, 7); cx.fill();
      cx.fillStyle = '#1d4e89'; cx.fillRect(x - 6 * s, y - 22 * s, 5 * s, 16 * s); cx.fillRect(x + 1 * s, y - 22 * s, 5 * s, 16 * s);
      cx.fillStyle = '#fff'; rr(x - 9 * s, y - 44 * s, 18 * s, 24 * s, 4); cx.fill();
      cx.fillStyle = '#e8b894'; cx.beginPath(); cx.arc(x, y - 50 * s, 7 * s, 0, 7); cx.fill();
    }
  }
  function drawBall(b, spin) {
    const [x, y] = fxy(b.x, b.y), r = Math.max(7, (fy(b.y) - fy(b.y - C.BALL.r)));
    cx.fillStyle = 'rgba(0,0,0,.28)'; cx.beginPath(); cx.ellipse(x, fy(Math.min(C.H - 8, b.y + 18)), r * 1.15, r * 0.35, 0, 0, 7); cx.fill();
    const g = cx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#c8c8c8');
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
    cx.strokeStyle = '#1d1d1f'; cx.lineWidth = Math.max(1, r * 0.08);
    cx.save(); cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.clip();
    const a = spin || 0;
    for (let i = 0; i < 5; i++) {
      const ang = a + i * Math.PI * 2 / 5;
      cx.beginPath(); cx.arc(x + Math.cos(ang) * r * 0.45, y + Math.sin(ang) * r * 0.45, r * 0.28, 0, 7); cx.stroke();
    }
    cx.restore();
  }
  function drawPath(pts, alpha, col) {
    if (!pts || pts.length < 2) return;
    cx.strokeStyle = col || 'rgba(255,90,0,.9)'; cx.lineWidth = 3.5; cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.globalAlpha = alpha == null ? 1 : alpha;
    cx.beginPath();
    pts.forEach((p, i) => { const [x, y] = fxy(p.x, p.y); i ? cx.lineTo(x, y) : cx.moveTo(x, y); });
    cx.stroke();
    const last = pts[pts.length - 1], [lx, ly] = fxy(last.x, last.y);
    cx.fillStyle = '#FFD23F'; cx.beginPath(); cx.arc(lx, ly, 5, 0, 7); cx.fill();
    cx.globalAlpha = 1;
  }
  function windFlag(k, tt) {
    if (!k.wind) return;
    const dir = k.wind > 0 ? 1 : -1;
    const x = dir > 0 ? W - 54 : 54, y = top + 58;
    cx.fillStyle = 'rgba(0,0,0,.45)'; rr(x - 42, y - 22, 84, 36, 12); cx.fill();
    cx.fillStyle = '#fff'; cx.font = '700 9px Poppins'; cx.textAlign = 'center';
    cx.fillText('WIND', x, y - 8);
    const flap = Math.sin(tt * 8) * 4;
    cx.strokeStyle = '#FFD23F'; cx.lineWidth = 3; cx.beginPath();
    cx.moveTo(x - 16 * dir, y + 6); cx.quadraticCurveTo(x, y + 6 + flap, x + 18 * dir, y + 6 - flap);
    cx.stroke();
    cx.fillStyle = '#FFD23F';
    cx.beginPath(); cx.moveTo(x + 18 * dir, y + 6 - flap); cx.lineTo(x + 10 * dir, y + 1 - flap); cx.lineTo(x + 10 * dir, y + 11 - flap); cx.fill();
  }
  function hud() {
    const y = 78;
    cx.fillStyle = 'rgba(0,0,0,.5)';
    rr(54, y - 20, 78, 44, 12); cx.fill();
    rr(W - 132, y - 20, 78, 44, 12); cx.fill();
    rr(W / 2 - 64, y - 24, 128, 50, 14); cx.fill();
    cx.fillStyle = '#FFD9C2'; cx.font = '700 10px Poppins'; cx.textAlign = 'left';
    cx.fillText('SCORE', 64, y - 4);
    cx.textAlign = 'right'; cx.fillText('LEVEL', W - 64, y - 4);
    cx.fillStyle = '#fff'; cx.font = '900 18px Poppins';
    cx.textAlign = 'left'; cx.fillText(run.score.toLocaleString('en-US'), 64, y + 16);
    cx.textAlign = 'right'; cx.fillText(String(run.level), W - 64, y + 16);
    cx.textAlign = 'center'; cx.fillStyle = '#FFD9C2'; cx.font = '700 9px Poppins';
    cx.fillText('GOALS  ' + run.goals + ' / ' + C.NEED, W / 2, y - 6);
    // 5 kick dots
    for (let i = 0; i < C.KICKS; i++) {
      const x = W / 2 - 32 + i * 16;
      const done = i < run.kickNo, current = i === run.kickNo && !run.over;
      cx.fillStyle = done ? '#2ecc71' : current ? '#FFD23F' : 'rgba(255,255,255,.28)';
      cx.beginPath(); cx.arc(x, y + 14, current ? 6 : 5, 0, 7); cx.fill();
    }
  }

  function render(now) {
    const tt = now / 1000, k = run.kick;
    cx.setTransform(scale, 0, 0, scale, 0, 0);
    if (shake) { cx.translate((Math.random() - 0.5) * 8 * shake, (Math.random() - 0.5) * 6 * shake); }
    stadium(tt);
    drawGoal();
    drawWall(k);
    drawCones(k);
    drawDefs(k);
    drawKeeper(k, tt);
    if (k.path && k.phase !== 'aim') drawPath(k.path, k.phase === 'flight' ? 0.45 : 0.2, 'rgba(255,255,255,.55)');
    if (drawPts) drawPath(drawPts, 1, '#FF5A00');
    const ball = (k.phase === 'flight' || k.phase === 'result') ? k.ball : C.BALL;
    drawBall(ball, k.ft * 14);
    windFlag(k, tt);
    hud();
    if (flash > 0) { cx.fillStyle = 'rgba(255,210,63,' + (flash * 0.35) + ')'; cx.fillRect(0, 0, W, H); }
    for (const p of pops) {
      const a = 1 - p.t / 1.15, y = p.y - p.t * 40;
      cx.globalAlpha = a; cx.textAlign = 'center';
      cx.font = '900 28px Poppins'; cx.lineWidth = 5; cx.strokeStyle = '#7a2600'; cx.strokeText(p.txt, p.x, y); cx.fillStyle = p.col; cx.fillText(p.txt, p.x, y);
      if (p.sub) { cx.font = '800 13px Poppins'; cx.strokeText(p.sub, p.x, y + 20); cx.fillStyle = '#FFD23F'; cx.fillText(p.sub, p.x, y + 20); }
      cx.globalAlpha = 1;
    }
    if (sh.state === 'play' && !run.over && k.phase === 'aim' && !drawPts && (run.level === 1 && run.kickNo < 2 || hintT > 0)) {
      const [bx, by] = fxy(C.BALL.x, C.BALL.y);
      cx.globalAlpha = 0.55 + 0.45 * Math.sin(tt * 5);
      cx.fillStyle = 'rgba(0,0,0,.55)'; rr(W / 2 - 130, by - 78, 260, 30, 15); cx.fill();
      cx.fillStyle = '#fff'; cx.font = '800 14px Poppins'; cx.textAlign = 'center';
      cx.fillText('Draw a curve from the ball', W / 2, by - 58);
      cx.globalAlpha = 1;
    }
  }

  RG.loop((dt, now) => { update(dt); render(now); });
  window.__penalty = {
    state: () => ({ level: run.level, kickNo: run.kickNo, goals: run.goals, score: run.score, phase: run.kick.phase, over: run.over, t: run.t, totalGoals: run.totalGoals, levelsCleared: run.levelsCleared }),
    shoot: (path, ms) => P.shoot(run.kick, path, ms),
    bot: () => {
      if (run.kick.phase !== 'aim') return false;
      const try_ = P.botTry(run.kick);
      if (try_.delay) P.stepKick(run.kick, try_.delay);
      return P.shoot(run.kick, try_.path, try_.swipeMs);
    },
  };
})();

// Basketball Shootout: swipe-to-throw funfair booth with 3D ball physics.
(function () {
  'use strict';
  const cv = document.getElementById('c'), cx = cv.getContext('2d');
  const logo = new Image(); logo.src = '/img/talabat-logo.png';

  // ---- world constants (metres; x right, y up, z away from player) ----
  const G = 9.8, BR = 0.11, RIM_R = 0.26, RIM_T = 0.018, HOOP_Y = 1.6, HOOP_Z = 4.2;
  const BOARD_Z = HOOP_Z + RIM_R + 0.1, BOARD_W = 0.9, BOARD_Y0 = HOOP_Y - 0.15, BOARD_Y1 = HOOP_Y + 0.85;
  const FLOOR_Y = -1.25, WALL_Z = 5.6, CAM_D = 2.2, CAM_Y = 0.9;
  const ANG = 62 * Math.PI / 180, GAME_T = 60;
  // Ideal launch speed for a swish at the rim centre (+2 cm) with the fixed launch angle.
  const DZ = HOOP_Z + 0.02, DY = HOOP_Y;
  const V_IDEAL = Math.sqrt((G * DZ * DZ) / (2 * Math.cos(ANG) ** 2 * (DZ * Math.tan(ANG) - DY)));
  const S0 = 1.5; // px/ms swipe speed that maps to the ideal shot

  let W = 360, H = 700, F = 600, HZ = 300, scale = 1, cssScale = 1;
  RG.fit(cv, 360, (i) => {
    W = i.W; H = i.H; scale = i.scale; cssScale = i.cssW / W;
    F = Math.min(H * 0.965, 360 * 1.75);
    HZ = H * 0.83 - CAM_Y * F / CAM_D;
  });
  const proj = (x, y, z) => { const s = F / (z + CAM_D); return [W / 2 + x * s, HZ - (y - CAM_Y) * s, s]; };

  // ---- state ----
  let t = 0, score = 0, streak = 0, best = 0, makes = 0, shots = 0, swishes = 0;
  let balls = [], pops = [], hint = '', hintT = 0, reload = 0, ended = false, lastBeep = 99;
  let hx = 0, hvx = 0, phase = 0, amp = 0, omega = 0, netKick = 0, shake = 0;
  const sh = RG.shell({
    game: 'hoops', title: '🏀 Basketball Shootout',
    how: '• <b>Swipe up</b> on the ball to shoot. A quicker flick shoots further, and the swipe angle aims left or right.<br>• <b>60 seconds.</b> Make baskets in a row for a combo multiplier (up to x5).<br>• A clean <b>swish</b> scores a bonus.<br>• At 20 s the hoop starts moving, and at 40 s it gets faster.',
    onReset: reset, onStart: () => {},
  });
  if (!sh) return;
  function reset() {
    t = 0; score = 0; streak = 0; best = 0; makes = 0; shots = 0; swishes = 0;
    balls = []; pops = []; hint = ''; reload = 0; ended = false; lastBeep = 99;
    hx = 0; hvx = 0; phase = 0; amp = 0; omega = 0;
  }
  const mult = () => Math.min(5, 1 + Math.floor(Math.max(0, streak - 1) / 2));

  // ---- sounds ----
  const S = {
    throw: () => RG.noise({ d: 0.12, v: 0.15, f: 900, f2: 2400, q: 0.7 }),
    rim: (k) => { RG.tone({ f: 420, d: 0.18, type: 'triangle', v: 0.12 + 0.2 * k }); RG.tone({ f: 1130, d: 0.08, type: 'square', v: 0.04 + 0.05 * k }); },
    board: () => RG.noise({ d: 0.1, v: 0.25, f: 300, q: 2, filter: 'lowpass' }),
    net: () => RG.noise({ d: 0.25, v: 0.22, f: 3000, f2: 1200, q: 0.8 }),
    make: (m) => [0, 4, 7].forEach((st, i) => RG.tone({ f: 523 * Math.pow(2, (st + (m - 1) * 2) / 12), d: 0.14, type: 'square', v: 0.1, delay: i * 0.06 })),
    bounce: () => RG.tone({ f: 120, f2: 70, d: 0.12, type: 'sine', v: 0.25 }),
    tick: () => RG.tone({ f: 1000, d: 0.05, type: 'square', v: 0.08 }),
    buzzer: () => RG.tone({ f: 180, d: 0.7, type: 'sawtooth', v: 0.2 }),
  };

  // ---- input: swipe ----
  let pts = null;
  cv.addEventListener('pointerdown', (e) => {
    if (sh.state !== 'play' || t >= GAME_T) return;
    pts = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released pointer */ }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pts) return;
    pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (pts.length > 40) pts.shift();
    if (pts[0].y - e.clientY > H * cssScale * 0.42) release(e); // long drag auto-throws
  });
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', () => { pts = null; });

  function release(e) {
    if (!pts) return;
    const p = pts; pts = null;
    p.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    const a = p[0], b = p[p.length - 1];
    const dy = a.y - b.y, dx = b.x - a.x;
    if (dy < 25) return; // not an upward swipe
    // speed over the last ~100 ms of the gesture (the flick), in CSS px per ms
    let k = p.length - 1; while (k > 0 && b.t - p[k - 1].t < 100) k--;
    const q = p[Math.max(0, Math.min(k, p.length - 2))];
    const span = Math.max(16, b.t - q.t);
    let spd = Math.hypot(b.x - q.x, b.y - q.y) / span;
    const avg = Math.hypot(dx, dy) / Math.max(40, b.t - a.t);
    spd = Math.max(spd, avg);
    throwBall(spd / S0, dx / dy);
  }

  function throwBall(rel, slope) {
    if (sh.state !== 'play' || t >= GAME_T || reload > 0) return;
    // Power: a generous sweet spot, then errors grow outside it.
    const e = Math.log(Math.max(0.05, rel));
    const ein = Math.max(-0.3, Math.min(0.3, e)), ex = e - ein;
    const kpow = Math.exp(0.04 * ein + 0.4 * ex);
    const v = V_IDEAL * kpow, vz = v * Math.cos(ANG), vy = v * Math.sin(ANG);
    const tf = DZ / vz;
    // Aim: where the swipe line crosses the hoop's screen height, in world metres at hoop depth.
    const [, bsy] = proj(0, 0, 0), [, hsy, hs] = proj(0, HOOP_Y, HOOP_Z);
    const xs = slope * (bsy - hsy); // logical px at hoop height
    const xw = xs / hs;
    // Aim assist: a swipe near the hoop you SEE is steered to where the hoop WILL BE when the ball
    // arrives (the sine motion predicted over the flight time), so moving-hoop shots are makeable.
    const future = amp * Math.sin(phase + omega * tf);
    const err = xw - hx, DEAD = 0.2;
    const xf = Math.abs(err) < DEAD ? future + err * 0.2 : future + err - Math.sign(err) * DEAD * 0.8;
    balls.push({ x: 0, y: 0, z: 0, vx: xf / tf, vy, vz, spin: 0, age: 0, rim: false, board: false, scored: false, done: false, k: kpow, xe: xf - future, bounces: 0 });
    shots++; reload = 0.38; S.throw();
  }

  // ---- physics ----
  function stepBall(b, dt) {
    const py = b.y;
    b.vy -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.spin += b.vz * dt * 3;
    // rim (torus) collision, relative to moving hoop
    const dx = b.x - hx, dz = b.z - HOOP_Z, q = Math.hypot(dx, dz) || 1e-6;
    const rx = hx + RIM_R * dx / q, rz = HOOP_Z + RIM_R * dz / q;
    let nx = b.x - rx, ny = b.y - HOOP_Y, nz = b.z - rz;
    const d = Math.hypot(nx, ny, nz);
    if (d < BR + RIM_T) {
      nx /= d; ny /= d; nz /= d;
      b.x = rx + nx * (BR + RIM_T); b.y = HOOP_Y + ny * (BR + RIM_T); b.z = rz + nz * (BR + RIM_T);
      const rvx = b.vx - hvx, vn = rvx * nx + b.vy * ny + b.vz * nz;
      if (vn < 0) {
        const tx = rvx - vn * nx, ty = b.vy - vn * ny, tz = b.vz - vn * nz;
        const e = 0.52, f = 0.86;
        b.vx = hvx + tx * f - e * vn * nx; b.vy = ty * f - e * vn * ny; b.vz = tz * f - e * vn * nz;
        if (-vn > 0.4) S.rim(Math.min(1, -vn / 4));
        b.rim = true;
      }
    }
    // backboard
    if (b.vz > 0 && b.z + BR > BOARD_Z && b.z < BOARD_Z && Math.abs(b.x - hx) < BOARD_W + BR * 0.5 && b.y > BOARD_Y0 - BR && b.y < BOARD_Y1 + BR) {
      b.z = BOARD_Z - BR; b.vz = -b.vz * 0.5; b.vx = hvx + (b.vx - hvx) * 0.85; b.vy *= 0.9;
      b.board = true; S.board();
    }
    // net drag inside the cylinder under the rim
    const qn = Math.hypot(b.x - hx, b.z - HOOP_Z);
    if (b.y < HOOP_Y && b.y > HOOP_Y - 0.42 && qn < RIM_R) {
      b.vx += (hx - b.x) * 6 * dt; b.vz += (HOOP_Z - b.z) * 6 * dt; b.vy *= 1 - 3 * dt;
      b.vx *= 1 - 4 * dt; b.vz *= 1 - 4 * dt;
    }
    // basket: centre passes down through the ring
    if (!b.scored && py > HOOP_Y && b.y <= HOOP_Y && b.vy < 0 && qn < RIM_R - 0.02) { b.scored = true; made(b); }
    // floor / wall
    if (b.y - BR < FLOOR_Y && b.vy < 0) {
      b.y = FLOOR_Y + BR; b.vy = -b.vy * 0.55; b.vx *= 0.8; b.vz *= 0.8; b.bounces++;
      if (b.vy > 1) S.bounce();
    }
    if (b.z + BR > WALL_Z && b.vz > 0) { b.z = WALL_Z - BR; b.vz = -b.vz * 0.4; }
  }

  function made(b) {
    streak++; makes++;
    const m = mult(), swish = !b.rim && !b.board;
    if (swish) swishes++;
    const pts_ = (2 + (swish ? 1 : 0)) * m;
    score += pts_; best = Math.max(best, streak);
    netKick = 1;
    S.net(); S.make(m);
    const [sx, sy] = proj(hx, HOOP_Y, HOOP_Z);
    pops.push({ x: sx, y: sy - 40, txt: `+${pts_}`, sub: swish ? 'SWISH!' : (m > 1 ? `x${m} COMBO` : 'NICE!'), t: 0, col: swish ? '#FFD23F' : '#fff' });
  }

  function missed(b) {
    if (b.scored) return;
    streak = 0;
    if (Math.abs(Math.log(b.k)) > 0.025 && !(b.rim && Math.abs(Math.log(b.k)) < 0.05)) hint = b.k < 1 ? 'Too soft: flick faster' : 'Too hard: flick softer';
    else if (Math.abs(b.xe) > 0.1) hint = b.xe < 0 ? 'A bit left: aim right' : 'A bit right: aim left';
    else hint = 'So close!';
    hintT = 1.8;
  }

  // ---- update ----
  function update(dt) {
    if (sh.started && (sh.state === 'paused' || sh.state === 'countdown')) return; // auto-paused: freeze everything
    if (sh.state === 'play') {
      if (t < GAME_T) {
        t = Math.min(GAME_T, t + dt);
        const left = Math.ceil(GAME_T - t);
        if (left <= 10 && left < lastBeep && left > 0) { lastBeep = left; S.tick(); }
        if (t >= GAME_T) { S.buzzer(); pts = null; }
      }
      // hoop movement
      let tgtAmp = 0, per = 4.5;
      if (t >= 20) { tgtAmp = 0.45; per = 4.5; }
      if (t >= 40) { tgtAmp = 0.55; per = 3.0; }
      amp += (tgtAmp - amp) * Math.min(1, dt * 1.2);
      omega = 2 * Math.PI / per;
      phase += omega * dt;
      const nhx = amp * Math.sin(phase);
      hvx = dt > 0 ? (nhx - hx) / dt : 0; hx = nhx;
      reload = Math.max(0, reload - dt);
      if (t >= GAME_T && !ended && balls.every((b) => b.done || b.scored || b.z < 0)) {
        ended = true;
        sh.end(score, { title: "Time's up!", line: `${makes} baskets from ${shots} shots · ${swishes} swishes · best streak ${best}` });
      }
    }
    const SUB = 6, h = dt / SUB;
    for (const b of balls) {
      for (let i = 0; i < SUB; i++) stepBall(b, h);
      b.age += dt;
      if (!b.done && (b.age > 2.6 || (b.bounces > 0 && !b.scored && b.y < HOOP_Y - 0.6) || b.z < -1)) { b.done = true; missed(b); }
    }
    balls = balls.filter((b) => b.age < 3.2);
    pops.forEach((p) => (p.t += dt)); pops = pops.filter((p) => p.t < 1.1);
    hintT -= dt; netKick = Math.max(0, netKick - dt * 2.5);
  }

  // ---- render ----
  function bulbs(y, n, x0, x1, tt) {
    for (let i = 0; i < n; i++) {
      const x = x0 + (x1 - x0) * i / (n - 1);
      const on = (Math.floor(tt * 4) + i) % 3 !== 0;
      cx.fillStyle = on ? '#FFE27A' : '#8a6a2a';
      if (on) { cx.shadowColor = '#FFD23F'; cx.shadowBlur = 8; }
      cx.beginPath(); cx.arc(x, y, 3.2, 0, 7); cx.fill(); cx.shadowBlur = 0;
    }
  }
  function drawBooth(tt) {
    // back wall stripes
    const [, wallTop] = proj(0, 3.6, WALL_Z), [, wallBot] = proj(0, FLOOR_Y, WALL_Z);
    cx.fillStyle = '#2b0f05'; cx.fillRect(0, 0, W, H);
    const sw = 30;
    for (let x = -sw, i = 0; x < W + sw; x += sw, i++) { cx.fillStyle = i % 2 ? '#FFF1E2' : '#FF6A14'; cx.fillRect(x, wallTop, sw, wallBot - wallTop); }
    const g = cx.createLinearGradient(0, wallTop, 0, wallBot);
    g.addColorStop(0, 'rgba(40,10,0,.55)'); g.addColorStop(0.5, 'rgba(40,10,0,.1)'); g.addColorStop(1, 'rgba(40,10,0,.6)');
    cx.fillStyle = g; cx.fillRect(0, wallTop, W, wallBot - wallTop);
    // floor
    const fg = cx.createLinearGradient(0, wallBot, 0, H);
    fg.addColorStop(0, '#5a2a12'); fg.addColorStop(1, '#a5582a');
    cx.fillStyle = fg; cx.fillRect(0, wallBot, W, H - wallBot);
    cx.strokeStyle = 'rgba(0,0,0,.18)'; cx.lineWidth = 1;
    for (let i = -6; i <= 6; i++) { const [x0, y0] = proj(i * 0.5, FLOOR_Y, WALL_Z), [x1, y1] = proj(i * 0.9, FLOOR_Y, -0.5); cx.beginPath(); cx.moveTo(x0, y0); cx.lineTo(x1, y1); cx.stroke(); }
    // side curtains
    for (const side of [0, 1]) {
      const x = side ? W - 26 : 0;
      const cg = cx.createLinearGradient(x, 0, x + 26, 0);
      cg.addColorStop(side ? 1 : 0, '#7a0f1a'); cg.addColorStop(side ? 0 : 1, '#c4243a');
      cx.fillStyle = cg; cx.fillRect(x, 0, 26, H);
      cx.fillStyle = '#FFD23F'; cx.fillRect(side ? x : x + 22, 0, 4, H);
    }
    // awning
    const aw = H * 0.085;
    for (let i = 0; i < 9; i++) {
      const x0 = i * W / 8 - W / 16, x1 = x0 + W / 8;
      cx.fillStyle = i % 2 ? '#fff' : '#FF5A00';
      cx.beginPath(); cx.moveTo(x0, 0); cx.lineTo(x1, 0); cx.lineTo(x1, aw);
      cx.arc((x0 + x1) / 2, aw, (x1 - x0) / 2, 0, Math.PI); cx.closePath(); cx.fill();
    }
    bulbs(aw + 22, 11, 30, W - 30, tt);
  }
  function drawBoard() {
    const [x0, y0] = proj(hx - BOARD_W, BOARD_Y1, BOARD_Z), [x1, y1] = proj(hx + BOARD_W, BOARD_Y0, BOARD_Z);
    const [px, , ps] = proj(hx, 0, BOARD_Z + 0.2), [, py0] = proj(hx, BOARD_Y0, BOARD_Z + 0.2), [, py1] = proj(hx, FLOOR_Y, BOARD_Z + 0.2);
    cx.fillStyle = '#333'; cx.fillRect(px - 0.06 * ps, py0, 0.12 * ps, py1 - py0);
    cx.fillStyle = 'rgba(255,255,255,.95)'; roundRect(x0, y0, x1 - x0, y1 - y0, 6); cx.fill();
    cx.strokeStyle = '#FF5A00'; cx.lineWidth = 4; cx.stroke();
    const [ix0, iy0] = proj(hx - 0.3, HOOP_Y + 0.45, BOARD_Z), [ix1, iy1] = proj(hx + 0.3, HOOP_Y + 0.02, BOARD_Z);
    cx.lineWidth = 3; cx.strokeRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    if (logo.complete && logo.naturalWidth) {
      const lw = (x1 - x0) * 0.42, lh = lw * logo.naturalHeight / logo.naturalWidth;
      cx.drawImage(logo, (x0 + x1) / 2 - lw / 2, y0 + (iy0 - y0) / 2 - lh / 2, lw, lh);
    }
  }
  function ringPts(y, r, z0) { const a = []; for (let i = 0; i <= 32; i++) { const th = i / 32 * Math.PI * 2; a.push(proj(hx + Math.cos(th) * r, y, z0 + Math.sin(th) * r)); } return a; }
  function drawRim(front) {
    const p = ringPts(HOOP_Y, RIM_R, HOOP_Z);
    cx.strokeStyle = '#E8410B'; cx.lineWidth = Math.max(2.5, RIM_T * 2 * p[0][2]); cx.lineCap = 'round';
    cx.beginPath();
    // sin(th) < 0 => nearer the player (front half)
    for (let i = 0; i <= 32; i++) { const th = i / 32 * Math.PI * 2, isFront = Math.sin(th) < 0; if (isFront === front) cx.lineTo(p[i][0], p[i][1]); else cx.moveTo(p[i][0], p[i][1]); }
    cx.stroke();
    if (!front) { // bracket to board
      const [ax, ay] = proj(hx, HOOP_Y, HOOP_Z + RIM_R), [bx, by] = proj(hx, HOOP_Y, BOARD_Z);
      cx.beginPath(); cx.moveTo(ax, ay); cx.lineTo(bx, by); cx.stroke();
    }
  }
  function drawNet() {
    const sway = netKick * 0.08;
    const top = ringPts(HOOP_Y, RIM_R, HOOP_Z), bot = ringPts(HOOP_Y - 0.42 - netKick * 0.1, RIM_R * (0.6 - sway), HOOP_Z);
    const mid = ringPts(HOOP_Y - 0.21 - netKick * 0.05, RIM_R * 0.8, HOOP_Z);
    cx.strokeStyle = 'rgba(255,255,255,.9)'; cx.lineWidth = 1.2;
    cx.beginPath();
    for (let i = 0; i < 32; i += 2) {
      cx.moveTo(top[i][0], top[i][1]); cx.lineTo(mid[(i + 2) % 32][0], mid[(i + 2) % 32][1]); cx.lineTo(bot[i][0], bot[i][1]);
      cx.moveTo(top[i][0], top[i][1]); cx.lineTo(mid[(i + 30) % 32][0], mid[(i + 30) % 32][1]); cx.lineTo(bot[i][0], bot[i][1]);
    }
    cx.stroke();
    cx.beginPath(); mid.forEach((p, i) => (i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]))); cx.stroke();
    cx.beginPath(); bot.forEach((p, i) => (i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]))); cx.stroke();
  }
  function drawBall(x, y, z, spin, alpha) {
    if (z < -1.6) return;
    const [sx, sy, s] = proj(x, y, z), r = BR * s;
    cx.globalAlpha = alpha == null ? 1 : alpha;
    const g = cx.createRadialGradient(sx - r * 0.35, sy - r * 0.35, r * 0.1, sx, sy, r);
    g.addColorStop(0, '#FFA05C'); g.addColorStop(0.6, '#FF5A00'); g.addColorStop(1, '#B83A00');
    cx.fillStyle = g; cx.beginPath(); cx.arc(sx, sy, r, 0, 7); cx.fill();
    cx.save(); cx.beginPath(); cx.arc(sx, sy, r, 0, 7); cx.clip();
    cx.strokeStyle = 'rgba(40,10,0,.75)'; cx.lineWidth = Math.max(1, r * 0.07);
    const c = Math.cos(spin) * r;
    cx.beginPath(); cx.moveTo(sx - r, sy + c * 0.15); cx.quadraticCurveTo(sx, sy + c * 0.6, sx + r, sy + c * 0.15); cx.stroke();
    cx.beginPath(); cx.moveTo(sx - r, sy - c); cx.lineTo(sx + r, sy - c); cx.stroke();
    cx.beginPath(); cx.ellipse(sx, sy, r * 0.45, r, 0, 0, 7); cx.stroke();
    cx.restore(); cx.globalAlpha = 1;
  }
  function drawShadow(b) {
    if (b.z < -1.6) return;
    const [sx, sy, s] = proj(b.x, FLOOR_Y, b.z);
    const h = Math.max(0, b.y - FLOOR_Y), a = Math.max(0, 0.35 - h * 0.08);
    cx.fillStyle = `rgba(0,0,0,${a})`; cx.beginPath(); cx.ellipse(sx, sy, BR * s * 1.1, BR * s * 0.35, 0, 0, 7); cx.fill();
  }
  function roundRect(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
  function drawCounter() {
    const top = H * 0.83 + BR * F / CAM_D * 0.9;
    cx.fillStyle = '#7a3b14'; cx.fillRect(0, top, W, 10);
    const g = cx.createLinearGradient(0, top + 10, 0, H); g.addColorStop(0, '#FF5A00'); g.addColorStop(1, '#C94300');
    cx.fillStyle = g; cx.fillRect(0, top + 10, W, H - top);
    cx.fillStyle = '#fff'; cx.font = '900 18px Poppins'; cx.textAlign = 'center';
    if (H - top > 40) cx.fillText('TALABAT HOOPS', W / 2, Math.min(H - 14, top + 42));
  }
  function hud() {
    const y = H * 0.085 + 50;
    cx.textAlign = 'left'; cx.fillStyle = 'rgba(0,0,0,.55)';
    roundRect(34, y - 20, 96, 44, 12); cx.fill(); roundRect(W - 130, y - 20, 96, 44, 12); cx.fill();
    roundRect(W / 2 - 44, y - 24, 88, 52, 14); cx.fill();
    cx.fillStyle = '#FFD9C2'; cx.font = '700 10px Poppins';
    cx.fillText('SCORE', 44, y - 5); cx.textAlign = 'right'; cx.fillText('COMBO', W - 44, y - 5);
    cx.fillStyle = '#fff'; cx.font = '900 20px Poppins';
    cx.textAlign = 'left'; cx.fillText(score, 44, y + 16);
    const m = mult(); cx.textAlign = 'right'; cx.fillStyle = m > 1 ? '#FFD23F' : '#fff'; cx.fillText('x' + m + (m >= 3 ? ' 🔥' : ''), W - 44, y + 16);
    const left = Math.max(0, GAME_T - t), urgent = left <= 10 && sh.state === 'play';
    cx.textAlign = 'center'; cx.font = '900 30px Poppins';
    cx.fillStyle = urgent && Math.floor(left * 4) % 2 ? '#FF3B3B' : '#fff';
    cx.fillText(Math.ceil(left) + '', W / 2, y + 14);
    if (sh.state === 'play' && t >= 18 && t < 20.5) { cx.font = '800 13px Poppins'; cx.fillStyle = '#FFD23F'; cx.fillText(t < 20 ? 'Hoop starts moving in ' + Math.ceil(20 - t) + '…' : 'Moving hoop!', W / 2, y + 48); }
    if (sh.state === 'play' && t >= 38 && t < 40.5) { cx.font = '800 13px Poppins'; cx.fillStyle = '#FFD23F'; cx.fillText(t < 40 ? 'Faster hoop in ' + Math.ceil(40 - t) + '…' : 'Faster!', W / 2, y + 48); }
  }

  function render(now) {
    const tt = now / 1000;
    cx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBooth(tt);
    for (const b of balls) if (b.z > HOOP_Z - 1) drawShadow(b);
    drawBoard();
    drawRim(false);
    const behind = (b) => b.y < HOOP_Y && b.z > HOOP_Z - RIM_R - BR && b.z < BOARD_Z;
    const sorted = balls.slice().sort((a, b) => b.z - a.z);
    for (const b of sorted) if (behind(b)) drawBall(b.x, b.y, b.z, b.spin, b.age > 2.6 ? Math.max(0, (3.2 - b.age) / 0.6) : 1);
    drawNet(); drawRim(true);
    for (const b of sorted) if (!behind(b)) drawBall(b.x, b.y, b.z, b.spin, b.age > 2.6 ? Math.max(0, (3.2 - b.age) / 0.6) : 1);
    drawCounter();
    // ball waiting on the counter
    if (t < GAME_T || sh.state !== 'play') {
      const k = reload > 0 ? 1 - reload / 0.38 : 1;
      drawBall(-0.9 + 0.9 * easeOut(k), 0, 0, 0, 1);
      if (sh.state === 'play' && shots < 2) { cx.fillStyle = 'rgba(255,255,255,' + (0.6 + 0.4 * Math.sin(tt * 6)) + ')'; cx.font = '800 15px Poppins'; cx.textAlign = 'center'; const [bx, by] = proj(0, 0, 0); cx.fillText('↑ Swipe up to shoot', bx, by - 60); }
    }
    hud();
    for (const p of pops) {
      const a = 1 - p.t / 1.1, y = p.y - p.t * 50;
      cx.globalAlpha = a; cx.textAlign = 'center';
      cx.font = '900 30px Poppins'; cx.lineWidth = 5; cx.strokeStyle = '#7a2600'; cx.strokeText(p.txt, p.x, y); cx.fillStyle = p.col; cx.fillText(p.txt, p.x, y);
      cx.font = '900 15px Poppins'; cx.strokeText(p.sub, p.x, y + 22); cx.fillStyle = '#FFD23F'; cx.fillText(p.sub, p.x, y + 22);
      cx.globalAlpha = 1;
    }
    if (hintT > 0 && sh.state === 'play') {
      cx.globalAlpha = Math.min(1, hintT); cx.font = '800 15px Poppins'; cx.textAlign = 'center';
      const [, by] = proj(0, 0, 0);
      cx.fillStyle = 'rgba(0,0,0,.55)'; roundRect(W / 2 - 110, by - 112, 220, 30, 15); cx.fill();
      cx.fillStyle = '#fff'; cx.fillText(hint, W / 2, by - 92); cx.globalAlpha = 1;
    }
  }
  const easeOut = (k) => 1 - (1 - k) * (1 - k);

  RG.loop((dt, now) => { update(dt); render(now); });
  // test hook (QA)
  // slopeFor(x): swipe slope (dx/dy) that points at world x on the hoop's screen line, i.e. aiming at what you see.
  const slopeFor = (x) => { const [, bsy] = proj(0, 0, 0), [, hsy, hs] = proj(0, HOOP_Y, HOOP_Z); return (x * hs) / (bsy - hsy); };
  window.__hoops = { throwBall, slopeFor, state: () => ({ t, score, streak, makes, shots, hx, hvx }), V_IDEAL };
})();

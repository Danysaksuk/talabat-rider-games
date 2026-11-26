// Stack the Order: drop swinging Talabat boxes onto the rider's bag. Uses Stack core + RG.shell.
(function () {
  'use strict';
  const cv = document.getElementById('c'), cx = cv.getContext('2d');
  const logo = new Image(); logo.src = '/img/talabat-logo.png';
  const S = window.Stack, C = S.C;

  let W = 360, H = 700, scale = 1, cam = 0;
  RG.fit(cv, 360, (i) => { W = i.W; H = i.H; scale = i.scale; });
  const zoom = () => Math.min(1.05, (H - 80) / 520);
  const sx = (x) => x * W / C.W;
  const sy = (y) => H - 88 - (y - cam) * zoom();

  let run = S.newRun(), ended = false, pops = [], flash = 0, hintT = 3, camT = 0, padHeld = false;
  const sh = RG.shell({
    game: 'stack', title: '📦 Stack the Order',
    how: '• A box swings above the bag. <b>Tap</b>, press <b>Space</b> or the <b>joystick button</b> to drop it.<br>• Any overhang is sliced off. Land it flush for a <b>perfect</b> and a combo.<br>• Every <b>3 perfects</b> in a row grows the box back.<br>• The swing speeds up as you climb. Miss the bag completely and the run ends.',
    onReset: reset, onStart: () => { hintT = 3; },
  });
  if (!sh) return;
  function reset() { run = S.newRun(); ended = false; pops = []; flash = 0; hintT = 3; cam = 0; camT = 0; padHeld = false; wasPhase = 'swing'; lastLanded = 0; lastPerfects = 0; }

  const Sound = {
    drop: () => RG.noise({ d: 0.1, v: 0.2, f: 500, f2: 200, q: 1, filter: 'lowpass' }),
    land: () => { RG.tone({ f: 240, d: 0.1, type: 'triangle', v: 0.16 }); RG.noise({ d: 0.08, v: 0.16, f: 400, q: 1.4, filter: 'lowpass' }); },
    perfect: (n) => [0, 4, 7].forEach((st, i) => RG.tone({ f: 523 * Math.pow(2, (st + Math.min(8, n)) / 12), d: 0.12, type: 'square', v: 0.1, delay: i * 0.05 })),
    slice: () => RG.noise({ d: 0.12, v: 0.18, f: 2200, f2: 800, q: 0.8 }),
    grow: () => RG.sfx.win(),
    miss: () => { RG.tone({ f: 180, f2: 90, d: 0.45, type: 'sine', v: 0.2 }); RG.sfx.over(); },
  };

  function pop(txt, sub, col, x, y) { pops.push({ txt, sub, col, x, y, t: 0 }); }
  let wasPhase = 'swing', lastLanded = 0, lastPerfects = 0;
  function react() {
    if (run.phase === 'fall' && wasPhase === 'swing') Sound.drop();
    if (run.phase === 'settle' && wasPhase === 'fall') {
      const last = run.stack[run.stack.length - 1];
      const [x, y] = [sx(last.x), sy(last.y + C.BOX_H)];
      const grew = run.perfects > 0 && run.perfects % C.GROW_EVERY === 0 && run.perfects !== lastPerfects;
      if (run.combo > 0 && run.perfects > lastPerfects) {
        Sound.perfect(run.combo);
        if (grew) Sound.grow();
        pop('PERFECT!', (grew ? 'WIDTH UP!  ' : '') + 'x' + run.combo + '  +' + (C.PTS + C.PTS_COMBO * run.combo), '#FFD23F', x, y);
        flash = 0.25;
      } else {
        Sound.land();
        if (last.w + 0.5 < C.BAG_W && run.landed > 1) Sound.slice();
        pop('+' + C.PTS, '', '#fff', x, y);
      }
      lastLanded = run.landed;
      lastPerfects = run.perfects;
    }
    if (run.phase === 'miss' && wasPhase !== 'miss' && wasPhase !== 'over') Sound.miss();
    wasPhase = run.phase;
  }

  function dropNow() {
    if (sh.state !== 'play' || run.over) return;
    if (S.drop(run)) hintT = 0;
  }
  cv.addEventListener('pointerdown', (e) => { dropNow(); e.preventDefault(); });
  window.addEventListener('keydown', (e) => {
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); dropNow(); }
  });
  function pollPad() {
    const pads = navigator.getGamepads && navigator.getGamepads();
    const p = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
    const pressed = !!(p && p.buttons[0] && p.buttons[0].pressed);
    if (pressed && !padHeld) dropNow();
    padHeld = pressed;
  }

  function update(dt) {
    pollPad();
    if (sh.state === 'play' && !ended) {
      S.step(run, dt);
      react();
      if (run.over && !ended) {
        ended = true;
        const n = run.landed;
        sh.end(run.score, { title: n >= 20 ? 'Sky high!' : 'Game over', line: `${n} box${n === 1 ? '' : 'es'} stacked`, delay: 1000 });
      }
    }
    const target = Math.max(0, S.currentTop(run).y - 70);
    cam += (target - cam) * Math.min(1, dt * 4);
    camT += dt;
    flash = Math.max(0, flash - dt);
    hintT = Math.max(0, hintT - dt);
    for (const p of pops) p.t += dt;
    pops = pops.filter((p) => p.t < 1.1);
  }

  function rr(x, y, w, h, r) { const rad = Math.min(r, w / 2, h / 2); cx.beginPath(); cx.moveTo(x + rad, y); cx.arcTo(x + w, y, x + w, y + h, rad); cx.arcTo(x + w, y + h, x, y + h, rad); cx.arcTo(x, y + h, x, y, rad); cx.arcTo(x, y, x + w, y, rad); cx.closePath(); }

  function sky() {
    const dusk = Math.min(1, cam / 700);
    const g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, dusk > 0.4 ? '#0b1630' : '#6ec8f0');
    g.addColorStop(0.45, dusk > 0.4 ? '#1a2a55' : '#b9e4f7');
    g.addColorStop(1, dusk > 0.4 ? '#3a2a48' : '#ffe2c4');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    // sun / moon
    const sunY = 130 + dusk * 70;
    cx.fillStyle = dusk > 0.45 ? 'rgba(255,255,230,.85)' : 'rgba(255,210,80,.9)';
    cx.beginPath(); cx.arc(W * 0.72, sunY, dusk > 0.45 ? 16 : 26, 0, 7); cx.fill();
    if (dusk > 0.5) {
      cx.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 0; i < 30; i++) {
        const x = ((i * 73) % 360) * W / 360, y = ((i * 47) % 220);
        cx.globalAlpha = 0.4 + (i % 5) * 0.12;
        cx.fillRect(x, y, 2, 2);
      }
      cx.globalAlpha = 1;
    }
  }
  function skyline() {
    const base = sy(0) + cam * 0.18 * zoom();
    const ground = Math.min(H - 20, base + 20);
    const bld = [
      // x, w, h, shade — Dubai-ish silhouette, Burj Khalifa near centre-right
      [8, 28, 90, '#2a3a55'], [40, 36, 140, '#24324c'], [82, 24, 70, '#2c3e5a'],
      [112, 18, 210, '#1b2a44'], // burj
      [128, 10, 170, '#1b2a44'],
      [150, 44, 120, '#24324c'], [200, 30, 88, '#2a3a55'],
      [236, 22, 160, '#1e2f4a'], // sail-ish later
      [270, 50, 110, '#24324c'], [326, 28, 76, '#2a3a55'],
    ];
    const shift = (cam * 0.12) % 20;
    for (const [x, w, h, col] of bld) {
      cx.fillStyle = col;
      const X = sx(x) - shift, Y = ground - h * zoom() * 0.95, WW = sx(x + w) - sx(x);
      cx.fillRect(X, Y, WW, ground - Y + 2);
    }
    // Burj tip
    const bx = sx(121) - shift, by = ground - 210 * zoom() * 0.95;
    cx.fillStyle = '#1b2a44';
    cx.beginPath(); cx.moveTo(bx + 4, by); cx.lineTo(bx + 8, by - 46 * zoom()); cx.lineTo(bx + 12, by); cx.fill();
    // Burj Al Arab sail
    const sx0 = sx(236) - shift, sy0 = ground - 160 * zoom() * 0.95, sw = sx(258) - sx(236);
    cx.fillStyle = '#1e2f4a';
    cx.beginPath(); cx.moveTo(sx0, ground); cx.quadraticCurveTo(sx0 + sw * 1.6, sy0 + 20, sx0 + sw * 0.2, sy0); cx.lineTo(sx0, sy0 + 20); cx.closePath(); cx.fill();
    // ground / water
    const sand = cx.createLinearGradient(0, ground - 4, 0, H);
    sand.addColorStop(0, '#e8c79a'); sand.addColorStop(0.45, '#d2a56a'); sand.addColorStop(1, '#1a6ea8');
    cx.fillStyle = sand; cx.fillRect(0, ground - 2, W, H - (ground - 2));
  }
  function drawBag() {
    const bag = run.stack[0];
    const x = sx(bag.x), topY = sy(0), w = sx(bag.x + bag.w / 2) - sx(bag.x - bag.w / 2), h = Math.max(28, C.BAG_H * zoom() * 1.15);
    const gx = x - w * 0.08, gy = topY + 10;
    // scooter
    cx.fillStyle = '#1d1d1f';
    cx.beginPath(); cx.arc(gx - w * 0.22, gy + 16, 9, 0, 7); cx.fill();
    cx.beginPath(); cx.arc(gx + w * 0.38, gy + 16, 9, 0, 7); cx.fill();
    cx.strokeStyle = '#3a3a40'; cx.lineWidth = 4;
    cx.beginPath(); cx.moveTo(gx - w * 0.22, gy + 8); cx.lineTo(gx + w * 0.22, gy - 2); cx.lineTo(gx + w * 0.36, gy - 20); cx.stroke();
    // rider, left of the bag
    const rx = x - w * 0.5 - 6, ry = gy - 6;
    cx.fillStyle = '#1d1d1f'; cx.beginPath(); cx.arc(rx - 16, ry - 28, 8, 0, 7); cx.fill(); // helmet
    cx.fillStyle = '#e8b894'; cx.beginPath(); cx.arc(rx - 16, ry - 26, 5, 0, 7); cx.fill();
    cx.fillStyle = '#FF5A00'; rr(rx - 24, ry - 18, 16, 20, 4); cx.fill();
    cx.fillStyle = '#1d1d1f'; rr(rx - 24, ry + 2, 7, 12, 2); cx.fill(); rr(rx - 15, ry + 2, 7, 12, 2); cx.fill();
    // soft delivery bag with a handle
    const g = cx.createLinearGradient(x - w / 2, topY - h, x + w / 2, topY);
    g.addColorStop(0, '#FF7A2E'); g.addColorStop(1, '#D44500');
    cx.fillStyle = g; rr(x - w / 2 + 8, topY - h, w - 8, h + 6, 10); cx.fill();
    cx.strokeStyle = '#b83a00'; cx.lineWidth = 2.5;
    cx.beginPath(); cx.arc(x + 4, topY - h + 2, 12, Math.PI, 0); cx.stroke();
    if (logo.complete && logo.naturalWidth && w > 40) {
      const lw = w * 0.42, lh = lw * logo.naturalHeight / logo.naturalWidth;
      cx.drawImage(logo, x - lw / 2 + 4, topY - h / 2 - lh / 2, lw, lh);
    }
  }
  function drawBox(x, y, w, h, rot, alpha) {
    cx.save();
    cx.translate(sx(x), sy(y + C.BOX_H / 2));
    if (rot) cx.rotate(rot);
    cx.globalAlpha = alpha == null ? 1 : alpha;
    const ww = (sx(x + w / 2) - sx(x - w / 2)), hh = C.BOX_H * zoom();
    // side
    cx.fillStyle = '#c24400';
    cx.beginPath(); cx.moveTo(-ww / 2 + 6, -hh / 2); cx.lineTo(ww / 2, -hh / 2 - 5); cx.lineTo(ww / 2, hh / 2 - 5); cx.lineTo(-ww / 2 + 6, hh / 2); cx.fill();
    const g = cx.createLinearGradient(-ww / 2, -hh / 2, ww / 2, hh / 2);
    g.addColorStop(0, '#FF8A3D'); g.addColorStop(1, '#FF5A00');
    cx.fillStyle = g; rr(-ww / 2, -hh / 2, ww, hh, 4); cx.fill();
    cx.strokeStyle = 'rgba(255,255,255,.35)'; cx.lineWidth = 1.5; cx.stroke();
    cx.fillStyle = 'rgba(255,255,255,.7)'; cx.fillRect(-ww * 0.2, -2, ww * 0.4, 3);
    if (logo.complete && logo.naturalWidth && ww > 28) {
      const lw = Math.min(46, ww * 0.5), lh = lw * logo.naturalHeight / logo.naturalWidth;
      cx.drawImage(logo, -lw / 2, -lh / 2 - 1, lw, lh);
    }
    cx.restore();
  }
  function drawStack() {
    // back-to-front from bottom
    for (let i = 1; i < run.stack.length; i++) {
      const b = run.stack[i];
      drawBox(b.x, b.y, b.w, C.BOX_H, 0, 1);
    }
  }
  function drawSwing() {
    const pvY = S.pivotY(run.stack);
    const px = sx(C.PIVOT_X), py = sy(pvY);
    // crane arm
    cx.strokeStyle = 'rgba(40,40,48,.85)'; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(px - 80, py - 8); cx.lineTo(px + 80, py - 8); cx.stroke();
    cx.fillStyle = '#2a2a32'; cx.fillRect(px - 6, py - 16, 12, 14);
    if (run.phase === 'swing') {
      const p = S.boxPos(run);
      cx.strokeStyle = '#3a3a44'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(px, py); cx.lineTo(sx(p.x), sy(p.y)); cx.stroke();
      drawBox(p.x, p.y - C.BOX_H / 2, run.boxW, C.BOX_H, run.theta * 0.15, 1);
    } else if (run.fall) {
      const f = run.fall;
      if (run.phase === 'fall' || run.phase === 'miss') {
        if (run.phase === 'fall') {
          cx.strokeStyle = 'rgba(58,58,68,.35)'; cx.lineWidth = 2;
          cx.beginPath(); cx.moveTo(px, py); cx.lineTo(sx(f.x), sy(f.y)); cx.stroke();
        }
        drawBox(f.x, f.y - C.BOX_H / 2, f.w, C.BOX_H, f.rot || 0, 1);
      }
    }
  }
  function hud() {
    const topY = 78;
    cx.fillStyle = 'rgba(0,0,0,.5)';
    rr(54, topY - 20, 78, 44, 12); cx.fill();
    rr(W - 132, topY - 20, 78, 44, 12); cx.fill();
    rr(W / 2 - 50, topY - 24, 100, 50, 14); cx.fill();
    cx.fillStyle = '#FFD9C2'; cx.font = '700 10px Poppins'; cx.textAlign = 'left';
    cx.fillText('SCORE', 64, topY - 4);
    cx.textAlign = 'right'; cx.fillText('COMBO', W - 64, topY - 4);
    cx.fillStyle = '#fff'; cx.font = '900 18px Poppins';
    cx.textAlign = 'left'; cx.fillText(run.score.toLocaleString('en-US'), 64, topY + 16);
    cx.textAlign = 'right'; cx.fillStyle = run.combo > 0 ? '#FFD23F' : '#fff';
    cx.fillText((run.combo ? 'x' + run.combo : '–') + (run.combo >= 3 ? ' 🔥' : ''), W - 64, topY + 16);
    cx.textAlign = 'center'; cx.fillStyle = '#FFD9C2'; cx.font = '700 9px Poppins';
    cx.fillText('BOXES', W / 2, topY - 6);
    cx.fillStyle = '#fff'; cx.font = '900 20px Poppins';
    cx.fillText(String(run.landed), W / 2, topY + 18);
  }

  function render(now) {
    const tt = now / 1000;
    cx.setTransform(scale, 0, 0, scale, 0, 0);
    sky();
    skyline();
    drawBag();
    drawStack();
    drawSwing();
    hud();
    if (flash > 0) { cx.fillStyle = 'rgba(255,210,63,' + (flash * 0.35) + ')'; cx.fillRect(0, 0, W, H); }
    for (const p of pops) {
      const a = 1 - p.t / 1.1, y = p.y - p.t * 46;
      cx.globalAlpha = a; cx.textAlign = 'center';
      cx.font = '900 26px Poppins'; cx.lineWidth = 5; cx.strokeStyle = '#7a2600'; cx.strokeText(p.txt, p.x, y); cx.fillStyle = p.col; cx.fillText(p.txt, p.x, y);
      if (p.sub) { cx.font = '800 13px Poppins'; cx.strokeText(p.sub, p.x, y + 20); cx.fillStyle = '#FFD23F'; cx.fillText(p.sub, p.x, y + 20); }
      cx.globalAlpha = 1;
    }
    if (sh.state === 'play' && run.phase === 'swing' && run.landed === 0 && hintT > 0) {
      cx.globalAlpha = 0.55 + 0.45 * Math.sin(tt * 5);
      const hy = H * 0.38;
      cx.fillStyle = 'rgba(0,0,0,.55)'; rr(W / 2 - 118, hy, 236, 32, 16); cx.fill();
      cx.fillStyle = '#fff'; cx.font = '800 15px Poppins'; cx.textAlign = 'center';
      cx.fillText('Tap to drop the box', W / 2, hy + 22);
      cx.globalAlpha = 1;
    }
  }

  RG.loop((dt, now) => { update(dt); render(now); });
  window.__stack = {
    state: () => ({ score: run.score, landed: run.landed, combo: run.combo, perfects: run.perfects, phase: run.phase, over: run.over, t: run.t, boxW: run.boxW, theta: run.theta }),
    drop: dropNow,
  };
})();

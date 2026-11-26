// Super Over 2D fallback renderer (no WebGL / ?q=2d). Rules live in superover-core.js.
(function () {
  'use strict';
  const SO = window.SuperOver, { OVERS, TARGETS, CONTACT_D, STUMP_D, REL_D } = SO.C;
  const cv = document.getElementById('c'), cx = cv.getContext('2d');
  const logo = new Image(); logo.src = '/img/talabat-logo.png';
  const CAM_D = 6, CAM_H = 5.5;

  let W = 360, H = 700, F = 400, HZ = 200, scale = 1;
  RG.fit(cv, 360, (i) => { W = i.W; H = i.H; scale = i.scale; F = Math.min(432, H * 0.55); HZ = H * 0.8 - CAM_H * F / CAM_D; });
  const proj = (x, h, d) => { const s = F / (d + CAM_D); return [W / 2 + x * s, HZ - (h - CAM_H) * s, s]; };

  // crowd texture (static per load)
  const crowd = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), c: ['#FF5A00', '#fff', '#FFD23F', '#3fa9f5', '#e84393', '#1d1d1f'][Math.floor(Math.random() * 6)] }));

  let over, ball, runs, wickets, overRuns, overBalls, phase, phaseT, del, hit, swing, msg, banner, chased, fx = [], flash = 0;
  const S = {
    bat: (k) => { RG.noise({ d: 0.09, v: 0.5 * k, f: 1800, q: 1.5 }); RG.tone({ f: 260, f2: 140, d: 0.1, type: 'triangle', v: 0.3 * k }); },
    whoosh: () => RG.noise({ d: 0.18, v: 0.12, f: 600, f2: 2000, q: 0.6 }),
    bounce: () => RG.noise({ d: 0.05, v: 0.12, f: 400, q: 2 }),
    stumps: () => { RG.noise({ d: 0.3, v: 0.4, f: 900, q: 1 }); RG.tone({ f: 200, f2: 90, d: 0.4, type: 'sawtooth', v: 0.15 }); },
    cheer: (k) => { RG.noise({ d: 1.4 * k, v: 0.25 * k, f: 1400, q: 0.5, a: 0.15 }); RG.noise({ d: 1.2 * k, v: 0.15 * k, f: 3000, q: 0.7, a: 0.2 }); },
    groan: () => RG.tone({ f: 220, f2: 140, d: 0.6, type: 'sine', v: 0.15 }),
  };
  const game = SO.createGame({
    on: (ev, d) => {
      if (ev === 'swing') S.whoosh();
      else if (ev === 'bounce') S.bounce();
      else if (ev === 'bat') S.bat(d.runs >= 4 ? 1 : 0.6);
      else if (ev === 'result') {
        if (d.kind === 'out') { S.stumps(); S.groan(); flash = 0.4; }
        else if (d.runs === 6) { S.cheer(1); burst(); } else if (d.runs === 4) S.cheer(0.6);
      } else if (ev === 'chased') RG.sfx.win();
      else if (ev === 'chaseFailed') S.groan();
      else if (ev === 'finish') sh.end(d.runs, { title: d.won ? 'Super Over champion!' : 'Innings over', line: `${d.runs} runs · reached over ${d.over} of ${OVERS}`, delay: 600 });
    },
  });
  function sync() { ({ over, ball, runs, wickets, overRuns, overBalls, phase, phaseT, del, hit, swing, msg, banner, chased } = game); }
  const sh = RG.shell({
    game: 'superover', title: '<span class="kick"><img class="tlogo" src="/img/talabat-logo.png" alt="talabat" width="69" height="24">RIDER CUP</span>Super Over',
    how: '• <b>Tap</b> (or press Space) to swing as the ball reaches your bat.<br>• Perfect timing hits a <b>SIX</b>, good timing a <b>FOUR</b>, early or late gets 1 or 2.<br>• Miss badly or don\'t swing and you\'re <b>out</b>. 2 wickets and it\'s game over.<br>• Score each over\'s <b>target</b>, or you lose a wicket. Targets start at 12, 15 and 17 and climb each over; from over 4 a SIX needs tighter timing. Bowling gets faster and trickier every over.',
    onReset: () => { game.reset(); fx = []; flash = 0; sync(); }, onStart: () => { game.nextBall(800); sync(); },
    // Auto-pause: a ball in flight is re-bowled (not counted), so hiding the tab never costs a wicket.
    onPause: () => { game.pause(performance.now()); sync(); },
  });
  if (!sh) return;
  sync();
  const ballAt = SO.ballAt;
  function tap(ts) { if (sh.state !== 'play') return; game.tap(ts); sync(); }
  cv.addEventListener('pointerdown', (e) => tap(e.timeStamp));
  window.addEventListener('keydown', (e) => { if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); tap(e.timeStamp); } });
  function burst() {
    const cols = ['#FF5A00', '#FFD23F', '#fff', '#3fa9f5', '#e84393'];
    for (let k = 0; k < 3; k++) {
      const ox = W * (0.25 + 0.25 * k), oy = HZ * (0.45 + 0.2 * Math.random());
      for (let i = 0; i < 26; i++) { const a = Math.random() * 7, v = 60 + Math.random() * 90; fx.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: -k * 0.15, c: cols[(i + k) % 5] }); }
    }
  }
  function update(dt, now) {
    flash = Math.max(0, flash - dt);
    fx.forEach((p) => { p.t += dt; if (p.t > 0) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 80 * dt; } }); fx = fx.filter((p) => p.t < 1.4);
    game.update(dt, now, sh.state === 'play'); sync();
  }

  // ---------- render ----------
  function render(now) {
    cx.setTransform(scale, 0, 0, scale, 0, 0);
    // sky + stadium
    const sky = cx.createLinearGradient(0, 0, 0, HZ);
    sky.addColorStop(0, '#060b24'); sky.addColorStop(1, '#1b2a5e');
    cx.fillStyle = sky; cx.fillRect(0, 0, W, H);
    // floodlights
    for (const fxp of [0.1, 0.9]) {
      const lx = W * fxp, ly = HZ * 0.42;
      const g = cx.createRadialGradient(lx, ly, 2, lx, ly, 120); g.addColorStop(0, 'rgba(255,255,230,.9)'); g.addColorStop(0.15, 'rgba(255,255,200,.35)'); g.addColorStop(1, 'rgba(255,255,200,0)');
      cx.fillStyle = g; cx.fillRect(lx - 120, ly - 120, 240, 240);
      cx.fillStyle = '#ccd'; cx.fillRect(lx - 14, ly - 8, 28, 14);
      cx.fillStyle = '#333a55'; cx.fillRect(lx - 2, ly + 6, 4, HZ - ly);
    }
    // crowd stands
    const sTop = HZ * 0.62;
    cx.fillStyle = '#20193a'; cx.fillRect(0, sTop, W, HZ - sTop + 2);
    const tt = now / 1000, cheering = msg && msg.t < 1.6 && (msg.big === 'SIX!' || msg.big === 'FOUR!');
    for (const c of crowd) {
      const jy = cheering ? Math.sin(tt * 18 + c.x * 40) * 2 : 0;
      cx.fillStyle = c.c; cx.fillRect(c.x * W, sTop + 4 + c.y * (HZ - sTop - 10) + jy, 3, 3);
    }
    cx.fillStyle = '#FF5A00'; cx.fillRect(0, HZ - 6, W, 6);
    if (logo.complete && logo.naturalWidth) for (let x = 4; x < W; x += 46) cx.drawImage(logo, x, HZ - 5.5, 12.6, 4.4);
    // outfield with mowing bands
    cx.fillStyle = '#2f8f3c'; cx.fillRect(0, HZ, W, H - HZ);
    for (let i = 0; i < 16; i++) {
      const d0 = 60 - i * 4, d1 = d0 - 4;
      const [, y0] = proj(0, 0, d0), [, y1] = proj(0, 0, Math.max(-CAM_D + 0.5, d1));
      cx.fillStyle = i % 2 ? '#2f8f3c' : '#36a046'; cx.fillRect(0, y0, W, y1 - y0 + 1);
    }
    const [, yb] = proj(0, 0, -2); cx.fillStyle = '#36a046'; cx.fillRect(0, yb, W, H - yb);
    // pitch
    quad(-1.5, -3, 1.5, 22, '#d8b98a');
    quad(-1.5, -3, -1.42, 22, '#c9a874'); quad(1.42, -3, 1.5, 22, '#c9a874');
    // creases
    line(-1.5, 1.2, 1.5, 1.2, '#fff', 2); line(-1.5, 17.8, 1.5, 17.8, '#fff', 1);
    line(-1.3, -1.2, -1.3, 1.2, '#fff', 1.5); line(1.3, -1.2, 1.3, 1.2, '#fff', 1.5);
    // far stumps
    stumps(19.0, false, 0);
    // bowler
    drawBowler(now);
    // ball (before batsman if far)
    const bs = ballState(now);
    if (bs && bs.d > 0.35) drawBall(bs);
    drawBatsman(now);
    if (bs && bs.d <= 0.35) drawBall(bs);
    stumps(STUMP_D, del && del.stumpsHit && phase !== 'flight', del && del.passS != null ? (now - del.releaseAt) / 1000 - del.passS : 0);
    if (hit) drawBall({ x: hit.x, h: hit.h, d: hit.d });
    fx.forEach((p) => { if (p.t > 0) { cx.globalAlpha = Math.max(0, 1 - p.t / 1.4); cx.fillStyle = p.c; cx.fillRect(p.x, p.y, 3, 3); } }); cx.globalAlpha = 1;
    if (flash > 0) { cx.fillStyle = `rgba(255,40,40,${flash * 0.5})`; cx.fillRect(0, 0, W, H); }
    hud();
  }
  function ballState(now) {
    if (!del || !del.releaseAt || hit) return null;
    if (phase !== 'flight' && phase !== 'result') return null;
    let s = (now - del.releaseAt) / 1000;
    if (del.passS != null) s = Math.min(s, del.passS + 0.35);
    return ballAt(del, s);
  }
  function drawBall(b) {
    if (b.d < -CAM_D + 0.6) return;
    const [sx, sy, s] = proj(b.x, b.h, b.d), [shx, shy] = proj(b.x, 0, b.d);
    const r = Math.max(2, 0.11 * s);
    cx.fillStyle = 'rgba(0,0,0,.3)'; cx.beginPath(); cx.ellipse(shx, shy, r, r * 0.4, 0, 0, 7); cx.fill();
    cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(sx, sy, r, 0, 7); cx.fill();
    cx.strokeStyle = '#d0021b'; cx.lineWidth = Math.max(0.6, r * 0.25); cx.beginPath(); cx.arc(sx, sy, r * 0.7, -0.6, 0.6); cx.stroke();
  }
  function quad(x0, d0, x1, d1, col) {
    const a = proj(x0, 0, d0), b = proj(x1, 0, d0), c = proj(x1, 0, d1), d = proj(x0, 0, d1);
    cx.fillStyle = col; cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.lineTo(c[0], c[1]); cx.lineTo(d[0], d[1]); cx.fill();
  }
  function line(x0, d0, x1, d1, col, w) {
    const a = proj(x0, 0, d0), b = proj(x1, 0, d1);
    cx.strokeStyle = col; cx.lineWidth = w; cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.stroke();
  }
  function stumps(d, broken, since) {
    for (let i = -1; i <= 1; i++) {
      const x = i * 0.11;
      const [bx, by, s] = proj(x, 0, d);
      let [tx, ty] = proj(x, 0.71, d);
      cx.save();
      if (broken) { const k = Math.min(1, since * 3); cx.translate(bx, by); cx.rotate(i * 0.5 * k + 0.15 * k); cx.translate(-bx, -by); }
      cx.strokeStyle = '#f4e3c1'; cx.lineWidth = Math.max(1, 0.05 * s); cx.beginPath(); cx.moveTo(bx, by); cx.lineTo(tx, ty); cx.stroke();
      cx.restore();
    }
    if (!broken) { const [ax, ay] = proj(-0.13, 0.73, d), [bx2, by2] = proj(0.13, 0.73, d); cx.strokeStyle = '#FF5A00'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(ax, ay); cx.lineTo(bx2, by2); cx.stroke(); }
  }
  function drawBowler(now) {
    let d = 20.2, armA = 0, run = 0;
    if (phase === 'runup' && phaseT > 0) { const k = phaseT / 1.1; d = 27 - 6.8 * k; run = k; armA = k > 0.75 ? (k - 0.75) * 4 * Math.PI : 0; }
    else if (phase === 'flight') { const s = (now - del.releaseAt) / 1000; d = 20.2 - Math.min(1.2, s * 3); armA = Math.PI + Math.min(1, s * 3) * 1.2; }
    const [x, y, s] = proj(0.35, 0, d);
    const hgt = 1.8 * s, bob = Math.sin(run * 30) * hgt * 0.04;
    cx.fillStyle = '#1b2a5e'; cx.fillRect(x - hgt * 0.1, y - hgt * 0.45 + bob, hgt * 0.08, hgt * 0.45); cx.fillRect(x + hgt * 0.02, y - hgt * 0.45 + bob, hgt * 0.08, hgt * 0.45);
    cx.fillStyle = '#3fa9f5'; cx.fillRect(x - hgt * 0.13, y - hgt * 0.85 + bob, hgt * 0.26, hgt * 0.42);
    cx.fillStyle = '#c68e60'; cx.beginPath(); cx.arc(x, y - hgt * 0.93 + bob, hgt * 0.09, 0, 7); cx.fill();
    cx.strokeStyle = '#3fa9f5'; cx.lineWidth = Math.max(1.5, hgt * 0.07);
    const sx = x + hgt * 0.1, sy = y - hgt * 0.78 + bob;
    cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx + Math.sin(armA) * hgt * 0.35, sy + Math.cos(armA) * hgt * 0.35); cx.stroke();
  }
  function drawBatsman(now) {
    const [x, y, s] = proj(-0.45, 0, 0.3);
    const h = 1.75 * s;
    // legs + pads
    cx.fillStyle = '#f2f2f2'; cx.fillRect(x - h * 0.12, y - h * 0.42, h * 0.1, h * 0.42); cx.fillRect(x + h * 0.03, y - h * 0.42, h * 0.1, h * 0.42);
    // body (talabat orange jersey from behind)
    cx.fillStyle = '#FF5A00'; roundRect(x - h * 0.17, y - h * 0.82, h * 0.34, h * 0.44, h * 0.06); cx.fill();
    cx.fillStyle = '#fff'; cx.font = `900 ${Math.round(h * 0.12)}px Poppins`; cx.textAlign = 'center'; cx.fillText('10', x, y - h * 0.56);
    // helmet
    cx.fillStyle = '#1d1d1f'; cx.beginPath(); cx.arc(x, y - h * 0.9, h * 0.1, 0, 7); cx.fill();
    cx.fillStyle = '#FF5A00'; cx.fillRect(x - h * 0.1, y - h * 0.93, h * 0.2, h * 0.025);
    // bat: rest angle, swing sweeps across
    let a = -0.5;
    if (swing >= 0) { const k = Math.min(1, (now - swing) / 220); a = -0.5 + k * 3.4; }
    const hx = x + h * 0.14, hy = y - h * 0.5;
    cx.save(); cx.translate(hx, hy); cx.rotate(a);
    cx.fillStyle = '#e8c88a'; roundRect(-h * 0.035, 0, h * 0.07, h * 0.48, h * 0.02); cx.fill();
    cx.fillStyle = '#333'; cx.fillRect(-h * 0.02, -h * 0.12, h * 0.04, h * 0.14);
    cx.restore();
    cx.fillStyle = '#FF5A00'; cx.beginPath(); cx.arc(hx, hy, h * 0.045, 0, 7); cx.fill();
  }
  function roundRect(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
  function hud() {
    const top = 58;
    cx.fillStyle = 'rgba(0,0,0,.6)'; roundRect(10, top, W - 20, 76, 16); cx.fill();
    cx.textAlign = 'left'; cx.fillStyle = '#FFD9C2'; cx.font = '700 10px Poppins';
    cx.fillText(`OVER ${over}/${OVERS}  ·  BALL ${Math.min(6, ball + (phase === 'runup' || phase === 'flight' ? 1 : 0))}/6`, 22, top + 18);
    cx.fillStyle = '#fff'; cx.font = '900 30px Poppins'; cx.fillText(runs, 22, top + 52);
    const rw = cx.measureText(runs + '').width;
    cx.font = '700 12px Poppins'; cx.fillStyle = '#FFD9C2'; cx.fillText('RUNS', 28 + rw, top + 50);
    for (let i = 0; i < 2; i++) { cx.fillStyle = i < 2 - wickets ? '#FF5A00' : 'rgba(255,255,255,.2)'; cx.beginPath(); cx.arc(30 + i * 18, top + 66, 6, 0, 7); cx.fill(); }
    cx.fillStyle = '#FFD9C2'; cx.font = '700 9px Poppins'; cx.fillText('WICKETS LEFT', 66, top + 69);
    const tgt = TARGETS[over - 1], need = Math.max(0, tgt - overRuns);
    cx.textAlign = 'right'; cx.font = '700 10px Poppins'; cx.fillText('THIS OVER', W - 22, top + 18);
    cx.fillStyle = '#fff'; cx.font = '900 20px Poppins'; cx.fillText(`${overRuns} / ${tgt}`, W - 22, top + 42);
    cx.font = '700 11px Poppins'; cx.fillStyle = need ? '#FFD23F' : '#2ecc71'; cx.fillText(need ? `Need ${need} off ${6 - ball}` : 'Target chased', W - 22, top + 58);
    for (let i = 0; i < 6; i++) {
      const v = overBalls[i], bx = W - 22 - (5 - i) * 18 - 7, by = top + 68;
      cx.fillStyle = v === 'W' ? '#FF3B3B' : v === '6' ? '#FFD23F' : v === '4' ? '#FF5A00' : v ? '#555' : 'rgba(255,255,255,.12)';
      cx.beginPath(); cx.arc(bx, by, 7, 0, 7); cx.fill();
      if (v) { cx.fillStyle = v === '6' ? '#1d1d1f' : '#fff'; cx.font = '900 8px Poppins'; cx.textAlign = 'center'; cx.fillText(v, bx, by + 3); }
    }
    if (msg && msg.t < 1.5) {
      const k = Math.min(1, msg.t * 6), a = msg.t > 1.1 ? (1.5 - msg.t) / 0.4 : 1;
      cx.globalAlpha = a; cx.textAlign = 'center';
      cx.font = `900 ${Math.round(46 * (0.6 + 0.4 * k))}px Poppins`; cx.lineWidth = 6; cx.strokeStyle = '#1d1d1f';
      cx.strokeText(msg.big, W / 2, H * 0.42, W - 30); cx.fillStyle = msg.col; cx.fillText(msg.big, W / 2, H * 0.42, W - 30);
      cx.font = '900 16px Poppins'; cx.lineWidth = 4; cx.strokeText(msg.small, W / 2, H * 0.42 + 28, W - 30); cx.fillStyle = '#fff'; cx.fillText(msg.small, W / 2, H * 0.42 + 28, W - 30);
      cx.globalAlpha = 1;
    }
    if (banner && banner.t < 2.4) {
      const a = Math.min(1, banner.t * 5, (2.4 - banner.t) * 3);
      cx.globalAlpha = a; cx.fillStyle = 'rgba(0,0,0,.75)'; roundRect(20, H * 0.55, W - 40, 64, 16); cx.fill();
      cx.textAlign = 'center'; cx.fillStyle = banner.col; cx.font = '900 20px Poppins'; cx.fillText(banner.txt, W / 2, H * 0.55 + 28, W - 56);
      cx.fillStyle = '#fff'; cx.font = '500 12px Poppins'; cx.fillText(banner.sub, W / 2, H * 0.55 + 49, W - 56); cx.globalAlpha = 1;
    }
    if (sh.state === 'play' && over === 1 && ball < 2 && (phase === 'runup' || phase === 'flight')) {
      cx.textAlign = 'center'; cx.fillStyle = 'rgba(255,255,255,.85)'; cx.font = '900 14px Poppins';
      cx.fillText('Tap when the ball reaches your bat', W / 2, H - 24);
    }
  }

  RG.loop((dt, now) => { update(dt, now); render(now); });
  window.__so = { state: game.state, tap, renderer: '2d' };
})();

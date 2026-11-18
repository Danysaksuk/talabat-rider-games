// Talabat Rush Run: retro pixel-art pseudo-3D lane runner. Rules live in rush-core.js.
(function () {
  'use strict';
  const RC = window.RushCore, C = RC.C;
  const cv = document.getElementById('c'), cx = cv.getContext('2d');
  const off = document.createElement('canvas'), g = off.getContext('2d');
  let IW = 180, IH = 360, K = 2, F = 170, HZ = 140, CAMH = 3, HUDY = 30;
  const ZB = 3.2, ZFAR = 140;

  function resize() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    K = Math.max(2, Math.round(cv.width / 180));
    IW = Math.ceil(cv.width / K); IH = Math.ceil(cv.height / K);
    off.width = IW; off.height = IH;
    F = IW * 0.95; HZ = Math.round(IH * 0.4); CAMH = (0.86 - 0.4) * IH * ZB / F;
    HUDY = Math.ceil((58 * dpr) / K);
  }
  window.addEventListener('resize', resize); resize();

  // ---------- pixel sprites ----------
  function sprite(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); fn((a, b, cw, ch, col) => { x.fillStyle = col; x.fillRect(a, b, cw, ch); }); return c; }
  const O = '#FF5A00', OD = '#C24400', OL = '#FF8A3D', WH = '#ffffff', BK = '#111018', GR = '#55506a', RD = '#ff2a4a', NV = '#1d1b4a', YL = '#FFD23F';
  function bikeSprite(frame) {
    const JK = '#d94a00', HM = '#26223d', BX = '#FF6A14';
    return sprite(22, 32, (p) => {
      // mirrors + handlebar
      p(0, 6, 2, 2, '#9aa3c7'); p(20, 6, 2, 2, '#9aa3c7'); p(1, 8, 1, 2, GR); p(20, 8, 1, 2, GR);
      p(1, 10, 3, 2, BK); p(18, 10, 3, 2, BK);
      // arms + shoulders (jacket)
      p(3, 9, 4, 2, JK); p(15, 9, 4, 2, JK); p(4, 6, 14, 5, JK); p(4, 6, 14, 1, O);
      // helmet
      p(7, 0, 8, 7, HM); p(8, 0, 6, 1, '#4a4470'); p(10, 0, 2, 6, O); p(7, 6, 8, 1, BK);
      // legs + shoes
      p(4, 21, 3, 5, NV); p(15, 21, 3, 5, NV); p(4, 26, 3, 2, BK); p(15, 26, 3, 2, BK);
      // rear wheel + fender
      p(9, 23, 4, 9, BK); p(8, 21, 6, 2, GR);
      for (let y = 25 + frame; y < 31; y += 2) p(10, y, 2, 1, GR);
      p(9, 22, 4, 1, RD); p(9, 24, 4, 1, YL);
      // delivery box
      p(5, 9, 12, 12, BX); p(5, 9, 12, 1, OL); p(5, 9, 1, 12, OD); p(16, 9, 1, 12, OD); p(5, 20, 12, 1, OD);
      p(10, 11, 2, 6, WH); p(8, 12, 6, 1, WH); p(11, 16, 3, 1, WH);
    });
  }
  const BIKE = [bikeSprite(0), bikeSprite(1)];
  function carSprite(body, roof, taxi) {
    return sprite(32, 22, (p) => {
      p(7, 0, 18, 3, roof); if (taxi) p(13, 0, 6, 1, RD);
      p(6, 2, 20, 6, '#1b2a5e'); p(8, 3, 2, 1, '#3fa9f5'); p(10, 4, 2, 1, '#3fa9f5'); p(12, 5, 2, 1, '#3fa9f5');
      p(1, 8, 30, 9, body); p(1, 8, 30, 1, 'rgba(255,255,255,.35)');
      p(2, 10, 5, 3, RD); p(25, 10, 5, 3, RD); p(3, 11, 3, 1, '#ffb3c0'); p(26, 11, 3, 1, '#ffb3c0');
      p(13, 12, 6, 3, taxi ? YL : WH); p(1, 16, 30, 2, '#222'); p(3, 17, 5, 5, BK); p(24, 17, 5, 5, BK);
    });
  }
  const CARS = [carSprite('#ff2e88', '#c41d68'), carSprite('#19d3e6', '#0e9aa8'), carSprite('#f1e3c6', '#d8c49c', true), carSprite('#7b5cff', '#5a3fd6'), carSprite('#e8e8f0', '#b8b8c8')];
  const CONE = sprite(9, 11, (p) => { p(4, 0, 1, 1, O); p(3, 1, 3, 2, O); p(3, 3, 3, 2, WH); p(2, 5, 5, 2, O); p(1, 7, 7, 1, WH); p(1, 8, 7, 1, O); p(0, 9, 9, 2, '#2a2a33'); });
  const COIN = [8, 6, 4, 2, 4, 6].map((w) => sprite(8, 8, (p) => { const x0 = (8 - w) / 2; p(x0, 1, w, 6, '#d49a00'); p(x0 + (w > 2 ? 1 : 0), 0, Math.max(1, w - 2), 8, '#d49a00'); if (w > 2) { p(x0 + 1, 1, w - 2, 6, YL); if (w > 4) p(x0 + 2, 2, 1, 2, WH); } }));
  const HEART = sprite(7, 6, (p) => { p(1, 0, 2, 1, RD); p(4, 0, 2, 1, RD); p(0, 1, 7, 2, RD); p(1, 3, 5, 1, RD); p(2, 4, 3, 1, RD); p(3, 5, 1, 1, RD); p(1, 1, 1, 1, '#ffb3c0'); });
  const HEART0 = sprite(7, 6, (p) => { p(1, 0, 2, 1, GR); p(4, 0, 2, 1, GR); p(0, 1, 7, 2, GR); p(1, 3, 5, 1, GR); p(2, 4, 3, 1, GR); p(3, 5, 1, 1, GR); });

  // backdrop: Dubai-ish skyline (deterministic)
  const SKY = sprite(480, 80, (p) => {
    const sil = '#1c0f3d', win = ['#FFD23F', '#19d3e6', '#ff2e88'];
    let x = 0, n = 0;
    while (x < 480) {
      const w = 10 + ((n * 37) % 18), h = 18 + ((n * 53) % 40);
      p(x, 80 - h, w, h, sil);
      for (let wy = 80 - h + 3; wy < 78; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (((wx * 7 + wy * 13 + n) % 5) === 0) p(wx, wy, 1, 1, win[(wx + wy) % 3]);
      x += w + 2; n++;
    }
    // Burj Khalifa
    const bx = 300; p(bx, 20, 12, 60, sil); p(bx + 2, 10, 8, 10, sil); p(bx + 4, 2, 4, 8, sil); p(bx + 5, -10, 2, 14, sil); p(bx - 4, 45, 20, 35, sil);
    for (let y = 22; y < 78; y += 5) p(bx + 5, y, 2, 1, '#19d3e6');
    // Burj Al Arab sail
    const sx = 90; for (let y = 0; y < 50; y++) p(sx + Math.floor(y * y / 160), 30 + y, 3 + Math.floor(y / 3), 1, sil); p(sx, 26, 1, 54, sil);
  });
  const STARS = Array.from({ length: 70 }, (_, i) => [(i * 97) % 1000 / 1000, ((i * 61) % 1000) / 1000, i % 3]);

  // ---------- state ----------
  let run = null, track = null, camX = 0, shake = 0, pops = [], banner = null, trail = [], endT = -1, flashT = 0, idleT = 0;
  const sh = RG.shell({
    game: 'rush', title: '🛵 Talabat Rush Run',
    how: '• <b>Swipe left / right</b> to change lanes and <b>swipe up</b> to hop (arrow keys and Space work too).<br>• Hop over <b>cones and potholes</b>. Parked <b>cars</b> are too tall, so go round them.<br>• Grab <b>coins</b> (+100). Ride over <b>green arrows</b> for a boost that smashes through anything.<br>• 3 hearts. Reach the <b>DROP-OFF</b> arch in about 90 s for a bonus for each heart left.',
    onReset: newRun, onStart: () => {},
  });
  if (!sh) return;
  function newRun() {
    track = RC.clone(RC.generate((Math.random() * 4294967295) >>> 0));
    run = RC.newRun(track); camX = 0; shake = 0; pops = []; banner = null; trail = []; endT = -1; flashT = 0;
  }
  newRun();

  // ---------- sound ----------
  const S = {
    coin: () => { RG.tone({ f: 988, d: 0.05, type: 'square', v: 0.08 }); RG.tone({ f: 1319, d: 0.12, type: 'square', v: 0.08, delay: 0.05 }); },
    hop: () => RG.tone({ f: 260, f2: 620, d: 0.14, type: 'square', v: 0.1 }),
    land: () => RG.noise({ d: 0.06, v: 0.12, f: 300, q: 1, filter: 'lowpass' }),
    lane: () => RG.noise({ d: 0.05, v: 0.06, f: 2500, q: 1 }),
    hit: () => { RG.noise({ d: 0.3, v: 0.45, f: 700, q: 0.8, filter: 'lowpass' }); RG.tone({ f: 160, f2: 50, d: 0.3, type: 'sawtooth', v: 0.18 }); },
    smash: () => RG.noise({ d: 0.15, v: 0.3, f: 1500, q: 0.8 }),
    boost: () => { RG.tone({ f: 200, f2: 900, d: 0.45, type: 'sawtooth', v: 0.12 }); RG.tone({ f: 400, f2: 1800, d: 0.45, type: 'square', v: 0.05 }); },
  };

  // ---------- input ----------
  let sw = null;
  function act(a) { if (sh.state === 'play' && run && !run.done) RC.act(run, a); }
  cv.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY, used: false }; });
  cv.addEventListener('pointermove', (e) => {
    if (!sw || sw.used) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    sw.used = true;
    if (Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? 'left' : 'right'); else if (dy < 0) act('hop');
  });
  const endSw = () => { sw = null; };
  cv.addEventListener('pointerup', endSw); cv.addEventListener('pointercancel', endSw);
  window.addEventListener('keydown', (e) => {
    const m = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'hop', KeyW: 'hop', Space: 'hop' }[e.code];
    if (m) { e.preventDefault(); if (!e.repeat) act(m); }
  });

  // ---------- update ----------
  function update(dt) {
    idleT += dt;
    if (sh.state === 'play' && run && !run.done) {
      // fixed 120 Hz rule steps for consistency with the fairness bot
      run._acc = (run._acc || 0) + dt;
      while (run._acc >= 1 / 120 && !run.done) { RC.step(run, 1 / 120); run._acc -= 1 / 120; }
      for (const ev of run.events) handle(ev);
      run.events.length = 0;
    }
    if (run.done && endT >= 0) {
      endT += dt;
      if (endT > (run.delivered ? 1.8 : 1.3) && sh.state === 'play') {
        const sc = RC.score(run);
        sh.end(sc, run.delivered
          ? { title: 'DELIVERED! 🛵', line: `${run.coins} coins · ${run.hearts} ♥ left · +${run.hearts * C.HEART_BONUS + C.DELIVERED} delivery bonus`, delay: 0 }
          : { title: 'Crashed!', line: `${run.coins} coins · ${Math.floor(run.d)} m ridden`, delay: 0 });
      }
    }
    camX += (run.x * 0.55 - camX) * Math.min(1, dt * 8);
    shake = Math.max(0, shake - dt); flashT = Math.max(0, flashT - dt);
    pops.forEach((p) => (p.t += dt)); pops = pops.filter((p) => p.t < 0.8);
    if (banner) { banner.t += dt; if (banner.t > banner.dur) banner = null; }
    if (run.boost > 0) { trail.push({ x: run.x, h: run.h, d: run.d }); if (trail.length > 14) trail.shift(); } else if (trail.length) trail.shift();
  }
  function handle(ev) {
    switch (ev.e) {
      case 'coin': S.coin(); { const p = projObj(RC.laneX(ev.c.lane), ev.c.h, ev.c.d); if (p) pops.push({ x: p.x, y: p.y, txt: '+100', t: 0, c: YL }); } break;
      case 'hop': S.hop(); break;
      case 'land': S.land(); break;
      case 'lane': S.lane(); break;
      case 'hit': S.hit(); shake = 0.3; flashT = 0.25; banner = { txt: 'OUCH!', sub: run.hearts === 1 ? 'LAST HEART!' : '-1 HEART', t: 0, dur: 0.9, c: RD }; if (navigator.vibrate) navigator.vibrate(80); break;
      case 'smash': S.smash(); shake = 0.12; break;
      case 'boost': S.boost(); banner = { txt: 'BOOST!', sub: 'SMASH THROUGH!', t: 0, dur: 1, c: '#2bff88' }; break;
      case 'crash': endT = 0; RG.sfx.over(); banner = { txt: 'CRASHED!', sub: '', t: 0, dur: 9, c: RD }; break;
      case 'delivered': endT = 0; RG.sfx.win(); banner = { txt: 'DELIVERED!', sub: `+${run.hearts * C.HEART_BONUS + C.DELIVERED} BONUS`, t: 0, dur: 9, c: YL }; break;
    }
  }

  // ---------- projection ----------
  function camD() { return run.d - ZB; }
  function projObj(x, h, d) {
    const z = d - camD(); if (z < 0.4 || z > ZFAR) return null;
    const s = F / z; return { x: IW / 2 + (x - camX) * s, y: HZ + (CAMH - h) * s, s, z };
  }

  // ---------- render ----------
  function render() {
    const sx = shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0, sy = shake > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    g.save(); g.translate(sx, sy);
    drawSky(); drawRoad(); drawSprites(); drawTrail();
    g.restore();
    if (flashT > 0) { g.fillStyle = `rgba(255,42,74,${flashT * 1.2})`; g.fillRect(0, 0, IW, IH); }
    if (run.boost > 0) speedLines();
    drawHUD();
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.imageSmoothingEnabled = false;
    cx.drawImage(off, 0, 0, IW * K, IH * K);
  }
  function drawSky() {
    const gr = g.createLinearGradient(0, 0, 0, HZ);
    gr.addColorStop(0, '#07041a'); gr.addColorStop(0.6, '#2a0f4d'); gr.addColorStop(1, '#6b1a6e');
    g.fillStyle = gr; g.fillRect(0, 0, IW, HZ);
    for (const [x, y, k] of STARS) { if (y * HZ > HZ - 30) continue; g.fillStyle = k ? '#ffffff' : '#9fd8ff'; g.fillRect(Math.floor(x * IW), Math.floor(y * (HZ - 30)), 1, 1); }
    // retro sun
    const r = Math.round(IW * 0.2), cxs = Math.round(IW / 2 - camX * 3), cys = HZ - 10;
    for (let y = -r; y < 0; y++) {
      if (y > -r * 0.55 && ((y + r) % 5) >= 3) continue;
      const w = Math.round(Math.sqrt(r * r - y * y));
      const k = (y + r) / r; g.fillStyle = k < 0.4 ? '#FFD23F' : k < 0.7 ? '#ff8a3d' : '#ff2e88';
      g.fillRect(cxs - w, cys + y, w * 2, 1);
    }
    const ox = Math.round(-((camX * 8) % 480) - 140);
    g.drawImage(SKY, ox, HZ - 80); g.drawImage(SKY, ox + 480, HZ - 80);
  }
  function drawRoad() {
    const cd = camD();
    const pads = track.pads, holes = track.obs.filter((o) => o.kind === 'hole' && !o.smashed && o.d > cd && o.d < cd + ZFAR);
    let pz = null;
    for (let y = HZ; y < IH; y++) {
      const z = CAMH * F / (y - HZ + 0.5);
      if (z > ZFAR) { g.fillStyle = '#1a0b36'; g.fillRect(0, y, IW, 1); continue; }
      const d = cd + z, s = F / z, X = (x) => IW / 2 + (x - camX) * s;
      const dz = pz == null ? 0.5 : pz - z; pz = z;
      // ground with neon grid
      const gridH = (d % 6 + 6) % 6 < Math.max(dz, 0.12);
      g.fillStyle = gridH ? '#a0249a' : '#150a33'; g.fillRect(0, y, IW, 1);
      if (!gridH) { g.fillStyle = '#5b1f7a'; for (let gx = 3; gx <= 13; gx += 2.5) { g.fillRect(Math.floor(X(gx)), y, 1, 1); g.fillRect(Math.floor(X(-gx)), y, 1, 1); } }
      // sidewalks
      const seg = Math.floor(d / 2) % 2 === 0;
      g.fillStyle = Math.floor(d / 1.5) % 2 ? '#2d2756' : '#332c60';
      g.fillRect(Math.floor(X(-2.7)), y, Math.ceil(X(-1.7) - X(-2.7)), 1); g.fillRect(Math.floor(X(1.7)), y, Math.ceil(X(2.7) - X(1.7)), 1);
      // curbs
      g.fillStyle = seg ? '#ff2e88' : '#f2f2ff';
      g.fillRect(Math.floor(X(-1.7)), y, Math.ceil(X(-1.5) - X(-1.7)), 1); g.fillRect(Math.floor(X(1.5)), y, Math.ceil(X(1.7) - X(1.5)), 1);
      // asphalt
      g.fillStyle = Math.floor(d / 4) % 2 ? '#29224a' : '#2e2752';
      g.fillRect(Math.floor(X(-1.5)), y, Math.ceil(X(1.5) - X(-1.5)), 1);
      // finish line checker at the drop-off
      if (d > C.L - 0.6 && d < C.L + 0.6) { for (let i = 0; i < 12; i++) { g.fillStyle = (i + (d > C.L ? 1 : 0)) % 2 ? '#fff' : '#111'; g.fillRect(Math.floor(X(-1.5 + i * 0.25)), y, Math.ceil(0.25 * s), 1); } }
      // lane dashes
      if ((d % 3.2 + 3.2) % 3.2 < 1.7) { g.fillStyle = YL; const lw = Math.max(1, Math.round(0.07 * s)); g.fillRect(Math.round(X(-0.5) - lw / 2), y, lw, 1); g.fillRect(Math.round(X(0.5) - lw / 2), y, lw, 1); }
      // boost pads
      for (const p of pads) {
        if (p.used || d < p.d || d > p.d + p.len) continue;
        const lx = RC.laneX(p.lane), x0 = X(lx - 0.4), x1 = X(lx + 0.4);
        g.fillStyle = '#0f8a45'; g.fillRect(Math.floor(x0), y, Math.ceil(x1 - x0), 1);
        g.fillStyle = '#5dff9e';
        const u = (d - p.d) * 1.6;
        for (let px = Math.floor(x0); px < x1; px++) { const xl = Math.abs(((px - (x0 + x1) / 2) / s)); if (((u + xl * 1.6 + idleT * 3) % 1) < 0.4) g.fillRect(px, y, 1, 1); }
      }
      // potholes
      for (const o of holes) {
        if (d < o.d || d > o.d + o.len) continue;
        const u = (d - o.d) / o.len, hw = o.hw * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
        const lx = RC.laneX(o.lane), x0 = X(lx - hw), x1 = X(lx + hw);
        g.fillStyle = '#4b416e'; g.fillRect(Math.floor(x0) - 1, y, Math.ceil(x1 - x0) + 2, 1);
        g.fillStyle = '#05030c'; g.fillRect(Math.floor(x0), y, Math.ceil(x1 - x0), 1);
      }
    }
    // horizon haze
    const hz = g.createLinearGradient(0, HZ, 0, HZ + 18); hz.addColorStop(0, 'rgba(107,26,110,.9)'); hz.addColorStop(1, 'rgba(107,26,110,0)');
    g.fillStyle = hz; g.fillRect(0, HZ, IW, 18);
  }
  function blit(img, p, worldW, h0, alpha) {
    const w = Math.max(1, Math.round(worldW * p.s)), h = Math.max(1, Math.round(w * img.height / img.width));
    if (alpha != null) g.globalAlpha = alpha;
    g.drawImage(img, Math.round(p.x - w / 2), Math.round(p.y - h - (h0 || 0)), w, h);
    g.globalAlpha = 1;
  }
  function drawSprites() {
    const cd = camD(), list = [];
    // buildings + lamps (deterministic from index)
    const b0 = Math.floor(cd / 9), b1 = Math.floor((cd + ZFAR) / 9);
    for (let i = b0; i <= b1; i++) for (const side of [-1, 1]) {
      const hsh = ((i * 73856093) ^ (side * 19349663)) >>> 0;
      const w = 2 + (hsh % 15) / 10, h = 3 + (hsh % 70) / 10, x = side * (3.2 + w / 2), d = i * 9 + (hsh % 4);
      list.push({ d, draw: () => building(x, d, w, h, hsh) });
    }
    for (let i = Math.floor(cd / 12); i <= Math.floor((cd + ZFAR) / 12); i++) for (const side of [-1, 1]) { const d = i * 12 + 6; list.push({ d, draw: () => lamp(side * 1.95, d, side) }); }
    for (const o of track.obs) { if (o.d + o.len < cd + 0.5 || o.d > cd + ZFAR || o.kind === 'hole' || o.smashed) continue; list.push({ d: o.kind === 'car' ? o.d + 0.5 : o.d, draw: () => obstacle(o) }); }
    for (let i = run.ci > 4 ? run.ci - 4 : 0; i < track.coins.length; i++) { const c = track.coins[i]; if (c.d > cd + 70) break; if (c.got || c.d < cd + 0.5) continue; list.push({ d: c.d, draw: () => coin(c) }); }
    if (C.L > cd && C.L < cd + ZFAR) list.push({ d: C.L, draw: arch });
    list.push({ d: run.d, draw: bike });
    list.sort((a, b) => b.d - a.d);
    for (const it of list) it.draw();
  }
  function building(x, d, w, h, hsh) {
    const p0 = projObj(x - w / 2, 0, d), p1 = projObj(x + w / 2, h, d); if (!p0 || !p1) return;
    const cols = ['#1f1450', '#251a5e', '#170f3d', '#2b1650'];
    g.fillStyle = cols[hsh % 4]; g.fillRect(Math.round(p0.x), Math.round(p1.y), Math.max(1, Math.round(p1.x - p0.x)), Math.round(p0.y - p1.y));
    const s = p0.s;
    if (s > 4) {
      const wc = ['#FFD23F', '#19d3e6', '#ff8a3d'][hsh % 3];
      for (let wy = 0.6; wy < h - 0.4; wy += 0.7) for (let wx = 0.3; wx < w - 0.3; wx += 0.6) {
        if (((Math.floor(wx * 10) * 7 + Math.floor(wy * 10) * 3 + hsh) % 5) > 1) continue;
        g.fillStyle = wc; g.fillRect(Math.round(p0.x + wx * s), Math.round(p0.y - wy * s), Math.max(1, Math.round(0.25 * s)), Math.max(1, Math.round(0.3 * s)));
      }
    }
    // neon sign strip on top
    const neon = ['#ff2e88', '#19d3e6', '#FFD23F', O][(hsh >> 3) % 4];
    g.fillStyle = neon; g.fillRect(Math.round(p0.x), Math.round(p1.y), Math.max(1, Math.round(p1.x - p0.x)), Math.max(1, Math.round(0.15 * s)));
    if ((hsh >> 5) % 5 === 0 && s > 3) { // talabat sign
      g.fillStyle = O; const sw = Math.round(1.6 * s), shh = Math.max(2, Math.round(0.5 * s)), sx = Math.round((p0.x + p1.x) / 2 - sw / 2), sy = Math.round(p1.y + 0.4 * s);
      g.fillRect(sx, sy, sw, shh);
      if (shh >= 8) { g.fillStyle = WH; g.font = '8px "Press Start 2P"'; g.textAlign = 'center'; g.fillText('talabat', sx + sw / 2, sy + shh / 2 + 4, sw - 2); }
    }
  }
  function lamp(x, d, side) {
    const pb = projObj(x, 0, d), pt = projObj(x, 2.6, d); if (!pb || !pt) return;
    const s = pb.s;
    g.fillStyle = '#3a3360'; g.fillRect(Math.round(pb.x), Math.round(pt.y), Math.max(1, Math.round(0.08 * s)), Math.round(pb.y - pt.y));
    const hx = Math.round(pb.x - side * 0.4 * s);
    g.fillRect(Math.min(hx, Math.round(pb.x)), Math.round(pt.y), Math.abs(Math.round(pb.x) - hx) + 1, Math.max(1, Math.round(0.08 * s)));
    g.fillStyle = '#9ff6ff'; g.fillRect(hx - Math.round(0.12 * s), Math.round(pt.y) + 1, Math.max(1, Math.round(0.24 * s)), Math.max(1, Math.round(0.1 * s)));
    g.fillStyle = 'rgba(159,246,255,.25)'; const gw = Math.max(1, Math.round(0.14 * s)); g.fillRect(hx - gw, Math.round(pt.y) - gw + 1, gw * 2, gw * 2);
  }
  function obstacle(o) {
    const p = projObj(RC.laneX(o.lane), 0, o.d); if (!p) return;
    if (o.kind === 'cone') blit(CONE, p, 0.5);
    else if (o.kind === 'car') { const img = CARS[Math.floor(o.d) % CARS.length]; blit(img, p, 0.9); }
  }
  function coin(c) {
    const p = projObj(RC.laneX(c.lane), c.h, c.d); if (!p) return;
    const f = Math.floor(idleT * 10 + c.d) % COIN.length;
    blit(COIN[f], p, 0.36, -0.18 * p.s);
  }
  function arch() {
    const pl = projObj(-1.85, 0, C.L), pr = projObj(1.85, 0, C.L), pt = projObj(0, 3.1, C.L); if (!pl || !pr || !pt) return;
    const s = pl.s, pw = Math.max(1, Math.round(0.25 * s));
    const blink = Math.floor(idleT * 4) % 2;
    g.fillStyle = blink ? '#ff2e88' : '#19d3e6';
    g.fillRect(Math.round(pl.x - pw / 2), Math.round(pt.y), pw, Math.round(pl.y - pt.y));
    g.fillRect(Math.round(pr.x - pw / 2), Math.round(pt.y), pw, Math.round(pr.y - pt.y));
    const bh = Math.max(2, Math.round(0.7 * s));
    g.fillStyle = O; g.fillRect(Math.round(pl.x - pw / 2), Math.round(pt.y), Math.round(pr.x - pl.x + pw), bh);
    g.fillStyle = YL; g.fillRect(Math.round(pl.x - pw / 2), Math.round(pt.y + bh - 1), Math.round(pr.x - pl.x + pw), 1);
    if (bh >= 9) { g.fillStyle = WH; g.textAlign = 'center'; const fs = bh >= 20 ? 16 : 8; g.font = fs + 'px "Press Start 2P"'; g.fillText('DROP-OFF', IW / 2 + (0 - camX) * s, Math.round(pt.y + bh / 2 + fs / 2), Math.round(pr.x - pl.x - 4)); }
  }
  function bike() {
    const p = projObj(run.x, 0, run.d); if (!p) return;
    const ph = projObj(run.x, run.h, run.d);
    if (run.inv > 0 && Math.floor(run.inv * 12) % 2 === 0 && !run.done) return;
    const scale = Math.max(1, Math.round((0.62 * p.s) / 22));
    const w = 22 * scale, h = 32 * scale;
    if (run.h > 0.02) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(Math.round(p.x - w * 0.3), Math.round(p.y - scale), Math.round(w * 0.6), 2 * scale); }
    const lean = Math.max(-1, Math.min(1, (RC.laneX(run.lane) - run.x) * 3));
    const img = BIKE[Math.floor(run.d * 2) % 2];
    // lean: shear rows
    const x0 = Math.round(ph.x - w / 2), y0 = Math.round(ph.y - h);
    for (let r = 0; r < 32; r++) {
      const shift = Math.round(lean * (1 - r / 32) * 3) * scale;
      g.drawImage(img, 0, r, 22, 1, x0 + shift, y0 + r * scale, w, scale);
    }
    // tail light glow
    g.fillStyle = 'rgba(255,42,74,.35)'; g.fillRect(x0 + 7 * scale, y0 + 21 * scale, 8 * scale, 3 * scale);
  }
  function drawTrail() {
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i], k = (i + 1) / trail.length;
      const p = projObj(t.x, t.h, t.d - (trail.length - i) * 0.25 + (run.d - t.d)); if (!p) continue;
      const w = Math.max(1, Math.round(0.08 * p.s)), hh = Math.max(1, Math.round(0.35 * p.s));
      g.globalAlpha = k * 0.7;
      g.fillStyle = '#ff2e88'; g.fillRect(Math.round(p.x - 0.28 * p.s), Math.round(p.y - hh), w, hh);
      g.fillStyle = '#19d3e6'; g.fillRect(Math.round(p.x + 0.28 * p.s - w), Math.round(p.y - hh), w, hh);
    }
    g.globalAlpha = 1;
  }
  function speedLines() {
    for (let i = 0; i < 10; i++) {
      const y = (i * 37 + Math.floor(idleT * 400)) % IH, side = i % 2;
      g.fillStyle = i % 3 ? 'rgba(25,211,230,.6)' : 'rgba(255,46,136,.6)';
      g.fillRect(side ? IW - 14 - (i % 4) * 3 : 2 + (i % 4) * 3, y, 1, 12);
    }
  }
  function text(t, x, y, col, size, align) {
    g.font = (size || 8) + 'px "Press Start 2P"'; g.textAlign = align || 'left';
    g.fillStyle = '#000'; g.fillText(t, x + 1, y + 1); g.fillStyle = col; g.fillText(t, x, y);
  }
  function drawHUD() {
    const y = HUDY, sc = RC.score(run);
    g.fillStyle = 'rgba(7,4,26,.55)'; g.fillRect(0, y - 4, IW, 40);
    text('SCORE', 4, y + 6, '#19d3e6'); text(String(sc).padStart(6, '0'), 4, y + 17, WH);
    text('COINS', IW - 4, y + 6, YL, 8, 'right');
    g.drawImage(COIN[0], IW - 4 - 8 * 5 - 10, y + 10); text(String(run.coins).padStart(3, '0'), IW - 4, y + 17, WH, 8, 'right');
    for (let i = 0; i < C.HEARTS; i++) g.drawImage(i < run.hearts ? HEART : HEART0, 4 + i * 9, y + 22);
    // progress to drop-off
    const bx = 36, bw = IW - 36 - 14, k = Math.min(1, run.d / C.L);
    g.fillStyle = '#3a3360'; g.fillRect(bx, y + 24, bw, 3);
    g.fillStyle = O; g.fillRect(bx, y + 24, Math.round(bw * k), 3);
    g.fillStyle = WH; g.fillRect(bx + Math.round(bw * k) - 1, y + 22, 3, 7);
    g.fillStyle = YL; g.fillRect(bx + bw + 2, y + 21, 2, 8); g.fillStyle = '#ff2e88'; g.fillRect(bx + bw + 4, y + 21, 5, 4);
    for (const p of pops) text(p.txt, Math.round(p.x), Math.round(p.y - p.t * 30), p.c, 8, 'center');
    if (banner) {
      const big = IW >= 176 ? 16 : 8, by = Math.round(IH * 0.3);
      if (banner.t < 0.8 || banner.dur > 2 || Math.floor(banner.t * 8) % 2 === 0) { text(banner.txt, IW / 2, by, banner.c, big, 'center'); if (banner.sub) text(banner.sub, IW / 2, by + 14, WH, 8, 'center'); }
    }
    if (sh.state === 'play' && run.d < 60) { text('SWIPE < > TO STEER', IW / 2, IH - 22, WH, 8, 'center'); text('SWIPE ^ TO HOP', IW / 2, IH - 10, WH, 8, 'center'); }
  }

  RG.loop((dt) => { update(dt); render(); });
  window.__rush = { run: () => run, act: (a) => act(a), track: () => track };
})();

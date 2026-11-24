// Penalty Shootout: 3D night-stadium renderer (three.js). Rules, levels, scoring and the keeper
// all live in penalty-core.js and are untouched; this file only draws them and maps input.
//
// Mapping: the core is a 2D plane (360 x 640). Below the goal line (y >= 236) a core point is a spot
// on the pitch; above it, a spot on the goal face. Input rays from a fixed "base" camera are
// intersected with those two surfaces, so a line drawn on screen becomes the same core path as
// before, and the ball is drawn on the camera ray through its core point: it follows the drawn
// line on screen exactly while flying through 3D space.
import * as THREE from '/vendor/three.min.js?v=5';

(function main() {
  'use strict';
  const P = window.Penalty, C = P.C, G = C.GOAL, RG = window.RG;
  const GL = G.y + G.h;                                   // goal line in core units
  const GOAL_W = 7.32, GOAL_H = 2.56, BALL_D = 18, BR = 0.115;
  // Core points map to ball-centre positions: the pitch surface is the plane y = BR (a rolling ball's
  // centre) and the goal face runs from BR at the goal line up to the crossbar.
  const SX = GOAL_W / G.w, SH = (GOAL_H - BR) / G.h, SZ = BALL_D / (C.BALL.y - GL);
  const wX = (x) => (x - 180) * SX, wZ = (y) => (y - GL) * SZ, wH = (y) => BR + (GL - y) * SH;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const $ = (id) => document.getElementById(id);
  const qParam = new URLSearchParams(location.search).get('q');   // high | low | (auto)

  // ---------- game shell ----------
  let run = P.newRun((Math.random() * 1e9) >>> 0), ended = false, hintT = 4;
  const sh = RG.shell({
    game: 'penalty', title: '<span class="kick"><img class="tlogo" src="/img/talabat-logo.png" alt="talabat" width="69" height="24">RIDER CUP</span>Penalty Shootout',
    how: '• <b>Draw a curve</b> from the ball to the goal. The ball follows your line.<br>• A longer line gives more power, and a quick swipe adds pace. A bad curve goes wide or over the bar.<br>• Each level is <b>5 kicks</b>. Score at least <b>3 goals</b> to go up. Fail a level (under 3 out of 5) and the run ends.<br>• Walls, cones, defenders and wind come in as you climb. Top corners and curve shots score a bonus.',
    onReset: reset, onStart: () => { hintT = 4; SFX.whistle(); },
  });
  if (!sh) return;

  // ---------- renderer ----------
  const cv = $('c'), fx = $('fx'), fctx = fx.getContext('2d');
  const DPR = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: DPR < 2, powerPreference: 'high-performance' });
  let qual = qParam === 'low' ? 0 : 2;
  const qLock = qParam === 'low' || qParam === 'high';
  const pixelRatio = () => (qual === 2 ? Math.min(DPR, 2) : qual === 1 ? Math.min(DPR, 1.25) : Math.min(DPR, 0.85));
  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#0a0f1f');
  scene.background = new THREE.Color('#03050b');
  scene.fog = new THREE.Fog(FOG, 75, 190);
  const camera = new THREE.PerspectiveCamera(40, 0.5, 0.1, 500);
  const baseCam = new THREE.PerspectiveCamera(40, 0.5, 0.1, 500);   // fixed: input mapping + flight projection
  const camLook = new THREE.Vector3();
  let cssW = 360, cssH = 700, baseFov = 40;

  // Frame the shot from 9 m behind the ball, 4.1 m up: pick pitch and FOV so the ball sits near the
  // bottom (ndc -0.66) and the crossbar a third down (ndc +0.34) on any aspect. On a 390x844 phone the
  // goal then spans ~80% of the width; wider kiosk screens just see more of the stadium.
  function fitCamera(aspect) {
    const yb = 0.66, yx = 0.34, zc = BALL_D + 9, h = 4.1;
    const pb = Math.atan2(h - BR, zc - BALL_D), px = Math.atan2(h - GOAL_H, zc);
    let lo = px, hi = pb;
    for (let i = 0; i < 48; i++) { const t = (lo + hi) / 2; if (Math.tan(pb - t) * yx + Math.tan(px - t) * yb > 0) lo = t; else hi = t; }
    const th = (lo + hi) / 2, best = { zc, h, th, f: yb / Math.tan(pb - th) };
    void aspect;
    baseFov = 2 * Math.atan(1 / best.f) * 180 / Math.PI;
    baseCam.position.set(0, best.h, best.zc);
    camLook.set(0, best.h - best.zc * Math.tan(best.th), 0);
    baseCam.fov = baseFov; baseCam.aspect = aspect; baseCam.lookAt(camLook);
    baseCam.updateProjectionMatrix(); baseCam.updateMatrixWorld();
  }
  function resize() {
    const r = cv.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    fitCamera(camera.aspect);
    camera.fov = baseFov; camera.updateProjectionMatrix();
    const fr = Math.min(DPR, 2);
    fx.width = Math.round(cssW * fr); fx.height = Math.round(cssH * fr);
    fctx.setTransform(fr, 0, 0, fr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- core <-> world <-> screen ----------
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _pv = new THREE.Vector3(), _T = new THREE.Vector3();
  function screenToCore(clientX, clientY) {
    const r = fx.getBoundingClientRect();
    const nx = (clientX - r.left) / r.width * 2 - 1, ny = -((clientY - r.top) / r.height * 2 - 1);
    const o = baseCam.position;
    _v.set(nx, ny, 0.5).unproject(baseCam); _d.copy(_v).sub(o).normalize();
    if (_d.y < -1e-5) {
      const t = (BR - o.y) / _d.y, z = o.z + _d.z * t;
      if (z >= 0) return { x: 180 + (o.x + _d.x * t) / SX, y: GL + z / SZ };
    }
    if (_d.z < -1e-5) { const t = -o.z / _d.z; return { x: 180 + (o.x + _d.x * t) / SX, y: GL - (o.y + _d.y * t - BR) / SH }; }
    return null;
  }
  function coreSurface(x, y, out) { return y >= GL ? out.set(wX(x), BR, wZ(y)) : out.set(wX(x), wH(y), 0); }
  function toScreen(v, cam) { _pv.copy(v).project(cam); return { x: (_pv.x + 1) / 2 * cssW, y: (1 - _pv.y) / 2 * cssH, z: _pv.z }; }
  // Lift above the pitch of the camera ray through pitch point (x, BR, groundZ) where it crosses depth atZ.
  function rayHeightAt(groundZ, atZ) {
    const o = baseCam.position; const t = (atZ - o.z) / (groundZ - o.z);
    return Math.max(0, (o.y - BR) * (1 - t));
  }
  // Ball in flight: on the camera ray through its core point, at a depth that eases from the spot to the goal.
  function ballFromCore(k, out) {
    coreSurface(k.ball.x, k.ball.y, _T);
    const s = k.travel ? clamp(k.dist / k.travel, 0, 1) : 0;
    const zLin = BALL_D * (1 - s);
    const zd = Math.max(_T.z, 0.55 * _T.z + 0.45 * zLin);
    const o = baseCam.position;
    if (zd - _T.z < 1e-4) out.copy(_T);
    else { const t = (zd - o.z) / (_T.z - o.z); out.set(o.x + (_T.x - o.x) * t, o.y + (_T.y - o.y) * t, zd); }
    out.y = Math.max(out.y, BR);
    return out;
  }

  // ---------- helpers ----------
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const Yv = new THREE.Vector3(0, 1, 0);
  const part = (g, c, p, r, s) => ({ g, c, p, r, s });
  function seg(a, b, r1, r2, c, n) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    return { g: new THREE.CylinderGeometry(r2, r1, L, n || 7), c, p: A.clone().add(B).multiplyScalar(0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(Yv, d.normalize()) };
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function merge(parts) {
    const pos = [], nor = [], col = [], uv = [], idx = []; let off = 0; const c = new THREE.Color();
    for (const pt of parts) {
      const g = pt.g;
      if (pt.q) _q.copy(pt.q); else _q.setFromEuler(_e.set(...(pt.r || [0, 0, 0])));
      const s = pt.s == null ? 1 : pt.s;
      _m.compose(_p.set(...(pt.p || [0, 0, 0])), _q, Array.isArray(s) ? _s.set(...s) : _s.set(s, s, s));
      g.applyMatrix4(_m);
      const Pa = g.attributes.position, Na = g.attributes.normal, Ua = g.attributes.uv; c.set(pt.c);
      for (let i = 0; i < Pa.count; i++) {
        pos.push(Pa.getX(i), Pa.getY(i), Pa.getZ(i)); nor.push(Na.getX(i), Na.getY(i), Na.getZ(i)); col.push(c.r, c.g, c.b);
        uv.push(Ua ? Ua.getX(i) : 0, Ua ? Ua.getY(i) : 0);
      }
      const I = g.index;
      if (I) for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + off); else for (let i = 0; i < Pa.count; i++) idx.push(i + off);
      off += Pa.count; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    return out;
  }
  const glowTex = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,248,225,.75)'); gr.addColorStop(0.45, 'rgba(255,235,190,.18)'); gr.addColorStop(1, 'rgba(255,230,180,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const blobTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(0.6, 'rgba(0,0,0,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight('#b9c8ff', '#1b2a16', 1.35));
  const key = new THREE.DirectionalLight('#fff6e6', 2.4); key.position.set(4, 18, 30); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffd2a8', 1.4); rim.position.set(-10, 16, -30); scene.add(rim);
  const charMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  // ---------- sky ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#010207') }, mid: { value: new THREE.Color('#111a3a') }, glow: { value: new THREE.Color('#ff8a3d') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 glow; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(mid, top, smoothstep(0.0, 0.45, h)); c += glow * pow(1.0 - abs(h), 14.0) * 0.08; gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
  }));
  scene.add(sky);
  {
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, e = 0.2 + Math.random() * 1.2; pos[i * 3] = Math.cos(a) * Math.cos(e) * 380; pos[i * 3 + 1] = Math.sin(e) * 380; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 380; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sky.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#cfd8ff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));
  }

  // ---------- pitch ----------
  const fontsReady = document.fonts ? Promise.race([Promise.all(['500 40px Poppins', '700 40px Poppins', '900 40px Poppins'].map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}) : Promise.resolve();
  // official logo (cream wordmark on the orange flag): always drawn at its own aspect ratio, never recoloured
  const LOGO = new Image(); LOGO.src = '/img/talabat-logo.png';
  const LOGO_AR = 420 / 146;
  const logoReady = (LOGO.decode ? LOGO.decode() : new Promise((r) => { LOGO.onload = r; })).catch(() => {});
  const assetsReady = Promise.all([fontsReady, logoReady]);
  const logoOk = () => LOGO.complete && LOGO.naturalWidth > 0;
  function drawLogo(g, cx0, cy0, h) { if (!logoOk()) return; const w = h * LOGO.naturalWidth / LOGO.naturalHeight; g.drawImage(LOGO, cx0 - w / 2, cy0 - h / 2, w, h); }
  const PX0 = -40, PZ0 = -9, PW = 80, PH = 64;
  function drawPitch(g, W, H) {
    const k = W / PW, px = (x) => (x - PX0) * k, pz = (z) => (z - PZ0) * k;
    for (let z = PZ0, i = 0; z < PZ0 + PH; z += 4, i++) { g.fillStyle = i % 2 ? '#1d6a2b' : '#277d38'; g.fillRect(0, pz(z), W, 4 * k + 1); }
    g.fillStyle = 'rgba(0,0,0,.07)';
    for (let x = PX0, i = 0; x < PX0 + PW; x += 6, i++) if (i % 2) g.fillRect(px(x), 0, 6 * k, H);
    for (let i = 0; i < 26000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(180,255,170,.05)'; g.fillRect(Math.random() * W, Math.random() * H, 2, 2 + Math.random() * 3); }
    for (const [x, z, r, a] of [[-16, -3, 30, 0.2], [16, -3, 30, 0.2], [0, 12, 26, 0.14], [0, 2, 12, 0.12]]) {
      const gr = g.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), r * k);
      gr.addColorStop(0, `rgba(255,250,225,${a})`); gr.addColorStop(1, 'rgba(255,250,225,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    const ed = g.createLinearGradient(0, 0, W, 0);
    ed.addColorStop(0, 'rgba(0,0,0,.45)'); ed.addColorStop(0.25, 'rgba(0,0,0,0)'); ed.addColorStop(0.75, 'rgba(0,0,0,0)'); ed.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = ed; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(246,250,255,.9)'; g.lineWidth = 0.12 * k; g.lineCap = 'square';
    const line = (pts) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z)))); g.stroke(); };
    line([[-34, 0], [34, 0]]); line([[-34, 0], [-34, PZ0 + PH]]); line([[34, 0], [34, PZ0 + PH]]);
    line([[-9.16, 0], [-9.16, 5.5], [9.16, 5.5], [9.16, 0]]);
    line([[-20.16, 0], [-20.16, 16.5], [20.16, 16.5], [20.16, 0]]);
    const a0 = Math.asin(5.5 / 9.15);
    g.beginPath(); g.arc(px(0), pz(11), 9.15 * k, a0, Math.PI - a0); g.stroke();
    g.fillStyle = 'rgba(246,250,255,.92)';
    for (const z of [11, BALL_D]) { g.beginPath(); g.arc(px(0), pz(z), 0.14 * k, 0, 7); g.fill(); }
    g.beginPath(); g.arc(px(-34), pz(0), 1 * k, 0, Math.PI / 2); g.stroke();
    g.beginPath(); g.arc(px(34), pz(0), 1 * k, Math.PI / 2, Math.PI); g.stroke();
    // painted logo mats either side of the goal, behind the line (texture is 25.6 px/m on both axes, so no stretch)
    for (const x of [-14, 14]) drawLogo(g, px(x), pz(-2.6), 2.3 * k);
  }
  const pitchTex = canvasTex(2048, 1638, drawPitch);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: pitchTex }));
  pitch.position.set(PX0 + PW / 2, 0, PZ0 + PH / 2);
  scene.add(pitch);
  assetsReady.then(() => { drawPitch(pitchTex.image.getContext('2d'), pitchTex.image.width, pitchTex.image.height); pitchTex.needsUpdate = true; });
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0d1a12' }));
  surround.position.y = -0.02; scene.add(surround);

  // ---------- LED boards ----------
  // LED tile: the official logo as a texture, tiled with spacing (repeat is set from the board size so it is never stretched)
  function drawLed(g, W, H) {
    g.fillStyle = '#0c1430'; g.fillRect(0, 0, W, H);
    drawLogo(g, W * 0.22, H * 0.5, H * 0.74);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${H * 0.4}px Poppins`; g.fillStyle = '#ffffff'; g.fillText('RIDER CUP', W * 0.66, H * 0.53);
    g.fillStyle = '#ff5a00'; g.fillRect(W * 0.66 - H * 1.6, H * 0.8, H * 3.2, H * 0.06);
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  }
  const LED_W = 1024, LED_H = 96;
  const ledTex = canvasTex(LED_W, LED_H, drawLed, true);
  const darkMat = new THREE.MeshLambertMaterial({ color: '#141a28' });
  const ledTexes = [], LED_BASE = 0.9;
  function ledBoard(w, h, x, y, z) {
    const t1 = ledTex.clone(); t1.repeat.set(w / (h * LED_W / LED_H), 1); t1.needsUpdate = true; ledTexes.push(t1);
    const mat = new THREE.MeshBasicMaterial({ map: t1, color: new THREE.Color(LED_BASE, LED_BASE, LED_BASE) });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18), [darkMat, darkMat, darkMat, darkMat, mat, darkMat]);
    m.position.set(x, y, z); scene.add(m);
    return { mat, t1 };
  }
  const boards = [ledBoard(56, 0.95, 0, 0.475, -5.2)];
  assetsReady.then(() => {
    drawLed(ledTex.image.getContext('2d'), LED_W, LED_H);
    ledTexes.forEach((t) => { t.needsUpdate = true; });
  });
  let ledGoalT = 0;

  // ---------- stands, crowd, roof, floodlights ----------
  // Lower bowl under a cantilever roof: the roof's front edge (and its floodlight banks) sits just
  // under the scoreboard in the portrait framing.
  const ROWS = 16, RIB = 6, ROOF_Y = 6.4, ROOF_Z = -6.6, ROOF_BACK_Y = 13, ROOF_BACK_Z = -30, crowdSpots = [];
  {
    const parts = [];
    parts.push(part(new THREE.BoxGeometry(80, 1.25, 0.5), '#10141f', [0, 0.62, -6.9]));
    parts.push(part(new THREE.BoxGeometry(80, 0.08, 0.52), '#ff5a00', [0, 1.22, -6.88]));
    for (let k = 0; k < ROWS; k++) {
      const z = -7.4 - k * 0.86, y = 1.25 + k * 0.46;
      parts.push(part(new THREE.BoxGeometry(80, 0.46 + (k === RIB ? 0.4 : 0), 0.86), k % 2 ? '#1a2030' : '#222a3c', [0, y - 0.23, z]));
      if (k === RIB) continue;
      for (let x = -31; x <= 31; x += 0.5) {
        if (Math.random() < 0.05) continue;
        crowdSpots.push([x + (Math.random() - 0.5) * 0.14, y, z + 0.18 + (Math.random() - 0.5) * 0.1, 0.92 + Math.random() * 0.16]);
      }
    }
    const backZ = -7.4 - ROWS * 0.86 - 0.4;
    parts.push(part(new THREE.BoxGeometry(80, ROOF_BACK_Y + 1, 1), '#0b0e17', [0, (ROOF_BACK_Y + 1) / 2, backZ]));
    const rl = Math.hypot(ROOF_BACK_Z - ROOF_Z, ROOF_BACK_Y - ROOF_Y), ra = Math.atan2(ROOF_BACK_Y - ROOF_Y, ROOF_Z - ROOF_BACK_Z);
    parts.push(part(new THREE.BoxGeometry(90, 0.5, rl), '#0c0f19', [0, (ROOF_Y + ROOF_BACK_Y) / 2 + 0.25, (ROOF_Z + ROOF_BACK_Z) / 2], [ra, 0, 0]));
    parts.push(part(new THREE.BoxGeometry(90, 0.9, 0.35), '#1b2133', [0, ROOF_Y + 0.25, ROOF_Z + 0.1]));
    parts.push(part(new THREE.BoxGeometry(90, 0.1, 0.37), '#ff5a00', [0, ROOF_Y - 0.17, ROOF_Z + 0.11]));
    for (let x = -40; x <= 40; x += 8) parts.push(seg([x, ROOF_Y + 0.6, ROOF_Z], [x, ROOF_BACK_Y + 2.5, ROOF_BACK_Z + 6], 0.1, 0.1, '#151a28', 5));
    scene.add(new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true })));
  }
  const RIB_Y = 1.25 + RIB * 0.46 - 0.05, RIB_Z = -7.4 - RIB * 0.86 + 0.35;
  // crowd: instanced billboards, silhouettes drawn in the fragment shader, animated in the vertex shader
  const crowdU = { uTime: { value: 0 }, uExcite: { value: 0 }, uGroan: { value: 0 }, uFog: { value: FOG }, uFlash: { value: 0 } };
  const crowdMat = new THREE.ShaderMaterial({
    uniforms: crowdU,
    vertexShader: `
      uniform float uTime; uniform float uExcite; uniform float uGroan;
      varying vec2 vUv; varying vec3 vCol; varying float vSeed; varying float vArms; varying float vFog;
      void main(){
        vUv = uv;
        vec4 w0 = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float seed = fract(sin(dot(w0.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vSeed = seed;
        float bob = sin(uTime * (1.6 + seed * 2.0) + seed * 40.0) * 0.025;
        float jump = uExcite * max(0.0, sin(uTime * (8.0 + seed * 5.0) + seed * 30.0)) * (0.18 + seed * 0.3);
        vArms = step(0.45, uExcite * (0.55 + seed)) + step(0.93, seed) * step(0.5, sin(uTime * 0.7 + seed * 50.0));
        vec3 p = position; p.y += bob + jump - uGroan * 0.06 * seed;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vFog = smoothstep(30.0, 120.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uFog; uniform float uTime; uniform float uFlash;
      varying vec2 vUv; varying vec3 vCol; varying float vSeed; varying float vArms; varying float vFog;
      float box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
      void main(){
        vec2 p = vUv * vec2(0.6, 1.0) - vec2(0.3, 0.0);
        float head = length((p - vec2(0.0, 0.79)) * vec2(1.0, 0.92)) - 0.1;
        float body = box(p - vec2(0.0, 0.36), vec2(0.15, 0.3)) - 0.06;
        float arms = 10.0;
        if (vArms > 0.5) {
          float s = sin(uTime * 7.0 + vSeed * 20.0) * 0.04;
          arms = min(box(p - vec2(-0.21 + s, 0.8), vec2(0.035, 0.17)), box(p - vec2(0.21 - s, 0.8), vec2(0.035, 0.17)));
        }
        float d = min(min(head, body), arms);
        if (d > 0.0) discard;
        vec3 col = vCol;
        if (head < 0.0 && body > 0.0) col = mix(vec3(0.62, 0.42, 0.3), vec3(0.25, 0.15, 0.1), vSeed);
        col *= 0.42 + 0.58 * clamp(p.y * 1.1 + 0.15, 0.0, 1.0);
        col += uFlash * 0.25 * step(0.6, vSeed) * vec3(1.0, 0.6, 0.3);
        if (vSeed > 0.985 && vArms > 0.5 && p.y > 0.93) col = vec3(3.0);
        col = mix(col, uFog, vFog * 0.75);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const crowd = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.6, 1.0).translate(0, 0.5, 0), crowdMat, crowdSpots.length);
  {
    const pal = ['#ff5a00', '#ff5a00', '#ff7a2e', '#ff5a00', '#ffffff', '#f2f2f2', '#1d1d1f', '#2a3a7a', '#d81e3a', '#ffd23f', '#1aa6a6', '#6d7a8c', '#ff5a00', '#e8e2d8'];
    const col = new THREE.Color();
    crowdSpots.forEach(([x, y, z, s], i) => {
      _m.compose(_p.set(x, y, z), _q.identity(), _s.set(s, s, s)); crowd.setMatrixAt(i, _m);
      crowd.setColorAt(i, col.set(pal[(Math.random() * pal.length) | 0]).multiplyScalar(0.75 + Math.random() * 0.25));
    });
    crowd.frustumCulled = false; scene.add(crowd);
  }
  const CROWD_N = crowdSpots.length;
  // floodlight banks under the roof edge: panels, glow sprites and soft beams
  const beams = [], glows = [];
  {
    const panelTex = canvasTex(128, 48, (g, W, H) => {
      g.fillStyle = '#20263a'; g.fillRect(0, 0, W, H);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) { g.fillStyle = '#fffdf2'; g.fillRect(4 + c * 15.5, 4 + r * 14.5, 12, 11); }
    });
    const beamTex = canvasTex(8, 128, (g, W, H) => {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,248,225,.0)'); gr.addColorStop(0.6, 'rgba(255,248,225,.35)'); gr.addColorStop(1, 'rgba(255,248,225,1)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    });
    const panelMat = new THREE.MeshBasicMaterial({ map: panelTex, fog: false });
    const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: '#fff1d6', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    for (const x of [-21, -10.5, 0, 10.5, 21]) {
      const pos = new THREE.Vector3(x, ROOF_Y - 0.55, ROOF_Z + 0.3);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.3, 0.2), panelMat);
      panel.position.copy(pos); panel.rotation.x = -0.75; scene.add(panel);
      const sp = new THREE.Sprite(glowMat); sp.position.copy(pos).add(new THREE.Vector3(0, -0.1, 0.5)); sp.scale.set(11, 11, 1); scene.add(sp); glows.push(sp);
      const tgt = new THREE.Vector3(x * 0.4, 0, 9), dir = pos.clone().sub(tgt), L = dir.length();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 8, L, 18, 1, true), beamMat);
      beam.position.copy(pos).add(tgt).multiplyScalar(0.5); beam.quaternion.setFromUnitVectors(Yv, dir.normalize());
      scene.add(beam); beams.push(beam);
    }
    const lampMat = new THREE.SpriteMaterial({ map: glowTex, color: '#ffe2b8', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    for (let x = -39; x <= 39; x += 2.5) { if ([-21, -10.5, 0, 10.5, 21].some((v) => Math.abs(v - x) < 2.6)) continue; const sp = new THREE.Sprite(lampMat); sp.position.set(x, ROOF_Y - 0.3, ROOF_Z + 0.35); sp.scale.set(1.4, 1.4, 1); scene.add(sp); }
  }
  const boardRib = ledBoard(70, 0.7, 0, RIB_Y, RIB_Z);
  boards.push(boardRib);

  // ---------- goal + net ----------
  const NET_TOP = 2.3, NET_TZ = -1.5, NET_BZ = -2.2, PR = 0.06;
  {
    const white = '#ffffff';
    scene.add(new THREE.Mesh(merge([
      seg([-3.66, 0, 0], [-3.66, GOAL_H + PR, 0], PR, PR, white, 12), seg([3.66, 0, 0], [3.66, GOAL_H + PR, 0], PR, PR, white, 12),
      seg([-3.66 - PR, GOAL_H, 0], [3.66 + PR, GOAL_H, 0], PR, PR, white, 12),
    ]), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#4a5260' })));
    const grey = '#8f98a8', r = 0.022;
    scene.add(new THREE.Mesh(merge([
      seg([-3.66, GOAL_H, 0], [-3.66, NET_TOP, NET_TZ], r, r, grey, 5), seg([3.66, GOAL_H, 0], [3.66, NET_TOP, NET_TZ], r, r, grey, 5),
      seg([-3.66, NET_TOP, NET_TZ], [-3.66, 0, NET_BZ], r, r, grey, 5), seg([3.66, NET_TOP, NET_TZ], [3.66, 0, NET_BZ], r, r, grey, 5),
      seg([-3.66, NET_TOP, NET_TZ], [3.66, NET_TOP, NET_TZ], r, r, grey, 5), seg([-3.66, 0, NET_BZ], [3.66, 0, NET_BZ], r, r, grey, 5),
    ]), charMat));
  }
  const netTex = canvasTex(64, 64, (g) => {
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64); g.stroke();
  }, true);
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, color: '#e9eef6', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const NETU = 1 / 0.14;
  function netQuad(a, b, c, d, nu, nv) {   // a top-left, b top-right, c bottom-right, d bottom-left
    const g = new THREE.PlaneGeometry(1, 1, nu, nv), Pa = g.attributes.position, Ua = g.attributes.uv;
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), Cc = new THREE.Vector3(...c), D = new THREE.Vector3(...d);
    const wTop = A.distanceTo(B), hL = A.distanceTo(D), t = new THREE.Vector3(), bt = new THREE.Vector3();
    for (let i = 0; i < Pa.count; i++) {
      const u = Ua.getX(i), v = Ua.getY(i);
      t.lerpVectors(A, B, u); bt.lerpVectors(D, Cc, u); t.lerp(bt, 1 - v);
      Pa.setXYZ(i, t.x, t.y, t.z); Ua.setXY(i, u * wTop * NETU, v * hL * NETU);
    }
    return g;
  }
  const netBack = new THREE.Mesh(netQuad([-3.66, NET_TOP, NET_TZ], [3.66, NET_TOP, NET_TZ], [3.66, 0, NET_BZ], [-3.66, 0, NET_BZ], 36, 14), netMat);
  netBack.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const netBase = Float32Array.from(netBack.geometry.attributes.position.array);
  scene.add(netBack);
  scene.add(new THREE.Mesh(netQuad([-3.66, NET_TOP, NET_TZ], [3.66, NET_TOP, NET_TZ], [3.66, GOAL_H, 0], [-3.66, GOAL_H, 0], 20, 4), netMat));
  for (const sx of [-1, 1]) scene.add(new THREE.Mesh(netQuad([sx * 3.66, NET_TOP, NET_TZ], [sx * 3.66, GOAL_H, 0], [sx * 3.66, 0, 0], [sx * 3.66, 0, NET_BZ], 6, 8), netMat));
  let rip = null;
  function updateNet(dt) {
    if (!rip) return;
    rip.t += dt;
    const Pa = netBack.geometry.attributes.position, B = netBase, fade = Math.exp(-rip.t * 2.4);
    for (let i = 0; i < Pa.count; i++) {
      const x = B[i * 3], y = B[i * 3 + 1], d = Math.hypot(x - rip.x, y - rip.y);
      const w = rip.a * fade * (Math.exp(-d * d / 0.7) + 0.35 * Math.sin(d * 6 - rip.t * 18) * Math.exp(-d * 0.7));
      Pa.setZ(i, B[i * 3 + 2] - w);
    }
    Pa.needsUpdate = true;
    if (fade < 0.01) { Pa.array.set(B); Pa.needsUpdate = true; rip = null; }
  }
  // target zones (level 9+): broadcast-style glowing rings in the top corners. A dark disc behind each ring
  // keeps it readable against the crowd; an additive halo pulses on top.
  function drawRing(g) {
    const c = 128;
    const bg = g.createRadialGradient(c, c, 40, c, c, 112); bg.addColorStop(0, 'rgba(8,12,26,.72)'); bg.addColorStop(0.82, 'rgba(8,12,26,.55)'); bg.addColorStop(1, 'rgba(8,12,26,0)');
    g.fillStyle = bg; g.beginPath(); g.arc(c, c, 112, 0, 7); g.fill();
    g.lineWidth = 18; g.strokeStyle = '#ffb000'; g.beginPath(); g.arc(c, c, 92, 0, 7); g.stroke();
    g.lineWidth = 7; g.strokeStyle = '#fff6cf'; g.beginPath(); g.arc(c, c, 92, 0, 7); g.stroke();
    g.lineWidth = 4; g.strokeStyle = 'rgba(255,210,63,.9)'; g.setLineDash([10, 9]); g.beginPath(); g.arc(c, c, 70, 0, 7); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#FFD23F'; g.font = '900 54px Poppins'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+50', c, c + 4);
  }
  const ringTex = canvasTex(256, 256, drawRing);
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, fog: false });
  const haloMat = new THREE.MeshBasicMaterial({ map: glowTex, color: '#ffc21a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const RING_D = 1.0;
  const zones = [G.x + 6, G.x + G.w - C.CORNER - 6].map((x) => {
    const grp = new THREE.Group();
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(RING_D * 1.9, RING_D * 1.9), haloMat); halo.renderOrder = 3; grp.add(halo);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(RING_D, RING_D), ringMat); ring.renderOrder = 4; grp.add(ring);
    grp.position.set(wX(x + C.CORNER / 2), Math.min(GOAL_H - RING_D * 0.5 - 0.04, wH(G.y + 6 + C.CORNER / 2)), 0.06);
    grp.visible = false; grp.userData.ring = ring; scene.add(grp); return grp;
  });
  zones.forEach((z) => { z.userData.halo = z.children[0]; });
  assetsReady.then(() => { const g = ringTex.image.getContext('2d'); g.clearRect(0, 0, 256, 256); drawRing(g); ringTex.needsUpdate = true; });

  // ---------- wind: flags on the board line + stand, drifting particles (level 9+) ----------
  const flagTex = canvasTex(256, 160, (g, W, H) => { g.fillStyle = '#0c1430'; g.fillRect(0, 0, W, H); g.fillStyle = '#ff5a00'; g.fillRect(0, H - 14, W, 14); });
  assetsReady.then(() => { const g = flagTex.image.getContext('2d'); drawLogo(g, 128, 72, 64); flagTex.needsUpdate = true; });
  const flagMats = [new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }), new THREE.MeshLambertMaterial({ color: '#ff5a00', side: THREE.DoubleSide })];
  const poleParts = [];
  const FL = 0.95, FH = 0.6, FNU = 10, FNV = 4;
  const flags = [[-4.15, 0.95, -5.32, 1.45, 0], [4.15, 0.95, -5.32, 1.45, 0], [-2.5, RIB_Y + 0.35, RIB_Z, 1.2, 1], [2.5, RIB_Y + 0.35, RIB_Z, 1.2, 1]].map(([x, y, z, ph, mi]) => {
    poleParts.push(part(new THREE.CylinderGeometry(0.025, 0.03, ph, 6), '#d9dee8', [x, y + ph / 2, z]));
    const geo = new THREE.PlaneGeometry(FL, FH, FNU, FNV); geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Mesh(geo, flagMats[mi]); m.position.set(x, y + ph - FH / 2 - 0.02, z); scene.add(m);
    return { m, ph: Math.random() * 6 };
  });
  scene.add(new THREE.Mesh(merge(poleParts), charMat));
  let windVis = 0;
  function updateFlags(t, wind) {
    const a = clamp(Math.abs(wind) / 90, 0, 1), dir = wind < 0 ? -1 : 1, lift = 0.25 + 0.75 * a;
    for (const f of flags) {
      const Pa = f.m.geometry.attributes.position;
      for (let j = 0; j <= FNV; j++) for (let i = 0; i <= FNU; i++) {
        const u = i / FNU, v = j / FNV, idx = j * (FNU + 1) + i;
        const len = u * FL * (0.55 + 0.45 * lift);
        const droop = (1 - lift) * u * u * FH * 0.9;
        const wave = Math.sin(u * 7 - t * (3 + 9 * a) + f.ph) * u * (0.05 + 0.14 * a);
        Pa.setXYZ(idx, dir * len, (0.5 - v) * FH * (1 - 0.15 * u * (1 - lift)) - droop, wave);
      }
      Pa.needsUpdate = true; f.m.geometry.computeVertexNormals();
    }
  }
  const WP = 110, windPos = new Float32Array(WP * 3), windSpd = new Float32Array(WP);
  for (let i = 0; i < WP; i++) { windPos[i * 3] = (Math.random() - 0.5) * 18; windPos[i * 3 + 1] = 0.2 + Math.random() * 4.5; windPos[i * 3 + 2] = -5 + Math.random() * 20; windSpd[i] = 0.7 + Math.random() * 0.6; }
  const windGeo = new THREE.BufferGeometry(); windGeo.setAttribute('position', new THREE.BufferAttribute(windPos, 3).setUsage(THREE.DynamicDrawUsage));
  const windMat = new THREE.PointsMaterial({ size: 0.12, map: glowTex, color: '#dff4ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const windPts = new THREE.Points(windGeo, windMat); windPts.frustumCulled = false; windPts.visible = false; scene.add(windPts);
  function updateWind(dt, t, wind) {
    updateFlags(t, wind);
    windVis += ((wind ? 1 : 0) - windVis) * Math.min(1, dt * 3);
    windPts.visible = windVis > 0.01; if (!windPts.visible) return;
    windMat.opacity = 0.7 * windVis;
    const vx = wind * SX * 3;
    for (let i = 0; i < WP; i++) {
      let x = windPos[i * 3] + vx * windSpd[i] * dt;
      if (x > 9) x -= 18; else if (x < -9) x += 18;
      windPos[i * 3] = x; windPos[i * 3 + 1] += Math.sin(t * 2 + i) * 0.12 * dt;
    }
    windGeo.attributes.position.needsUpdate = true;
  }

  // ---------- ball ----------
  const ballTex = canvasTex(512, 256, (g, W, H) => {
    g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, W, H);
    const phi = (1 + Math.sqrt(5)) / 2, vs = [];
    for (const a of [-1, 1]) for (const b of [-phi, phi]) vs.push([0, a, b], [a, b, 0], [b, 0, a]);
    vs.forEach(([x, y, z], i) => {
      const l = Math.hypot(x, y, z), lat = Math.asin(y / l), lon = Math.atan2(z, x);
      const u = (lon + Math.PI) / (2 * Math.PI) * W, v = (Math.PI / 2 - lat) / Math.PI * H, ry = H * 0.075, rx = Math.min(W * 0.25, ry / Math.max(0.2, Math.cos(lat)));
      g.fillStyle = i % 3 === 0 ? '#ff5a00' : '#1d1d1f';
      for (const du of [-W, 0, W]) { g.beginPath(); g.ellipse(u + du, v, rx, ry, 0, 0, 7); g.fill(); }
    });
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BR, 22, 16), new THREE.MeshLambertMaterial({ map: ballTex, emissive: '#2a2a2a' }));
  scene.add(ball);
  const BALL_REST = new THREE.Vector3(0, BR, BALL_D);
  ball.position.copy(BALL_REST);

  // ---------- players ----------
  const KIT = {
    rider: { shirt: '#ff5a00', trim: '#ffffff', shorts: '#16161a', socks: '#ff5a00', boots: '#f4f4f4', skin: '#b97a50', hair: '#1a120c' },
    keeper: { shirt: '#c6f432', trim: '#1d1d1f', shorts: '#1d1d1f', socks: '#c6f432', boots: '#ff2a6a', skin: '#9a6644', hair: '#20140c', glove: '#ffffff' },
    opp: { shirt: '#2152d8', trim: '#ffffff', shorts: '#f4f4f4', socks: '#2152d8', boots: '#111111', skin: '#8d5a3b', hair: '#140c08' },
  };
  function torsoParts(k, y0) {
    return [
      part(new THREE.CylinderGeometry(0.21, 0.165, 0.56, 10), k.shirt, [0, y0 + 0.28, 0], 0, [1, 1, 0.62]),
      part(new THREE.CylinderGeometry(0.171, 0.171, 0.05, 10), k.trim, [0, y0 + 0.02, 0], 0, [1, 1, 0.64]),
      part(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 8), k.trim, [0, y0 + 0.56, 0.02], 0, [1.2, 1, 1]),
      part(new THREE.SphereGeometry(0.09, 8, 6), k.shirt, [-0.2, y0 + 0.5, 0]), part(new THREE.SphereGeometry(0.09, 8, 6), k.shirt, [0.2, y0 + 0.5, 0]),
      seg([0, y0 + 0.54, 0], [0, y0 + 0.65, 0], 0.055, 0.05, k.skin),
      part(new THREE.SphereGeometry(0.11, 12, 10), k.skin, [0, y0 + 0.74, 0.005], 0, [0.92, 1.06, 1]),
      part(new THREE.SphereGeometry(0.117, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), k.hair, [0, y0 + 0.765, -0.012], [-0.3, 0, 0]),
      part(new THREE.BoxGeometry(0.05, 0.03, 0.03), '#120c08', [-0.04, y0 + 0.76, 0.1]), part(new THREE.BoxGeometry(0.05, 0.03, 0.03), '#120c08', [0.04, y0 + 0.76, 0.1]),
    ];
  }
  function humanGeo(k, pose) {
    const L = [];
    for (const sx of [-1, 1]) {
      const x = 0.11 * sx;
      L.push(part(new THREE.BoxGeometry(0.12, 0.09, 0.27), k.boots, [x, 0.045, 0.04]));
      L.push(seg([x, 0.08, 0], [x, 0.5, 0], 0.05, 0.065, k.socks));
      L.push(seg([x, 0.48, 0], [x, 0.86, 0], 0.068, 0.088, k.skin));
      L.push(seg([x, 0.8, 0], [x, 0.97, 0], 0.1, 0.1, k.shorts));
      const shd = [0.22 * sx, 1.52, 0];
      let el, ha;
      if (pose === 'wall') { el = [0.25 * sx, 1.25, 0.07]; ha = [0.05 * sx, 1.0, 0.15]; }
      else if (pose === 'wall2') { el = [0.26 * sx, 1.27, 0.12]; ha = [-0.07 * sx, 1.36, 0.17]; }
      else { el = [0.42 * sx, 1.36, 0.05]; ha = [0.6 * sx, 1.24, 0.1]; }
      L.push(seg(shd, el, 0.05, 0.055, k.shirt));
      L.push(seg(el, ha, 0.036, 0.045, k.skin));
      L.push(part(new THREE.SphereGeometry(0.048, 6, 5), k.skin, ha));
    }
    L.push(part(new THREE.BoxGeometry(0.4, 0.2, 0.25), k.shorts, [0, 0.95, 0]));
    return merge(L.concat(torsoParts(k, 1.02)));
  }
  function rig(k) {
    const mk = (parts) => new THREE.Mesh(merge(parts), charMat);
    const root = new THREE.Group(), hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    hips.add(mk([part(new THREE.BoxGeometry(0.4, 0.2, 0.25), k.shorts, [0, 0, 0])]));
    const torso = new THREE.Group(); torso.position.y = 0.07; hips.add(torso);
    torso.add(mk(torsoParts(k, 0)));
    const legs = [], knees = [], arms = [], elbows = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(0.11 * sx, -0.04, 0); hips.add(leg);
      leg.add(mk([seg([0, 0.03, 0], [0, -0.14, 0], 0.1, 0.1, k.shorts), seg([0, -0.1, 0], [0, -0.44, 0], 0.088, 0.068, k.skin)]));
      const knee = new THREE.Group(); knee.position.y = -0.44; leg.add(knee);
      knee.add(mk([seg([0, 0, 0], [0, -0.4, 0], 0.065, 0.05, k.socks), part(new THREE.BoxGeometry(0.12, 0.09, 0.27), k.boots, [0, -0.43, 0.04])]));
      const arm = new THREE.Group(); arm.position.set(0.22 * sx, 0.5, 0); torso.add(arm);
      arm.add(mk([seg([0, 0, 0], [0, -0.28, 0], 0.055, 0.05, k.shirt)]));
      const el = new THREE.Group(); el.position.y = -0.28; arm.add(el);
      el.add(mk([seg([0, 0, 0], [0, -0.25, 0], 0.045, 0.036, k.glove ? k.shirt : k.skin),
        part(new THREE.SphereGeometry(k.glove ? 0.068 : 0.048, 8, 6), k.glove || k.skin, [0, -0.3, 0], 0, k.glove ? [1, 1.25, 0.7] : 1)]));
      legs.push(leg); knees.push(knee); arms.push(arm); elbows.push(el);
    }
    scene.add(root);
    return { root, hips, torso, legs, knees, arms, elbows };
  }
  const keeper = rig(KIT.keeper);
  const kicker = rig(KIT.rider);
  kicker.root.position.set(-0.6, 0, BALL_D + 0.65); kicker.root.rotation.y = Math.PI;
  {
    // same shirt for everyone: RIDER 10 on the kicker's back (faces the camera)
    const num = '10', nick = 'RIDER';
    const paint = (g) => {
      g.clearRect(0, 0, 128, 128); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 17px Poppins'; g.fillText(nick, 64, 20);
      g.font = '900 72px Poppins'; g.fillText(num, 64, 78);
    };
    const t = canvasTex(128, 128, paint);
    fontsReady.then(() => { paint(t.image.getContext('2d')); t.needsUpdate = true; });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false }));
    back.position.set(0, 0.32, -0.135); back.rotation.y = Math.PI; kicker.torso.add(back);
  }
  // wall players: 4 looks (skin, hair, two arm poses); height and stance vary per player
  const WALL_LOOKS = [['#8d5a3b', '#140c08', 'wall'], ['#d6a27a', '#3a2414', 'wall2'], ['#5a3520', '#0d0806', 'wall2'], ['#b98058', '#1c120a', 'wall']];
  const wallMeshes = WALL_LOOKS.map(([skin, hair, pose]) => { const m = new THREE.InstancedMesh(humanGeo(Object.assign({}, KIT.opp, { skin, hair }), pose), charMat, 16); m.count = 0; m.frustumCulled = false; scene.add(m); return m; });
  // keeper x-ray: a soft lime silhouette drawn only where something (wall, defender) stands in front of him
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#d8ff4a', transparent: true, opacity: 0.5, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false });
  const ghosts = [];
  { const ms = []; keeper.root.traverse((o) => { if (o.isMesh) ms.push(o); }); ms.forEach((o) => { const g = new THREE.Mesh(o.geometry, ghostMat); g.renderOrder = 6; g.visible = false; o.add(g); ghosts.push(g); }); }
  // JUMP cue: a sign that pops over the jumping wall just before each jump
  const jumpTex = canvasTex(256, 112, () => {});
  function drawJump(g) {
    g.clearRect(0, 0, 256, 112);
    g.fillStyle = '#0c1430'; g.strokeStyle = '#ff5a00'; g.lineWidth = 8;
    g.beginPath(); if (g.roundRect) g.roundRect(8, 8, 240, 96, 48); else g.rect(8, 8, 240, 96); g.fill(); g.stroke();
    g.fillStyle = '#ffd23f';
    for (const cx0 of [52, 204]) for (const dy of [0, 22]) { g.beginPath(); g.moveTo(cx0 - 18, 70 - dy); g.lineTo(cx0, 52 - dy); g.lineTo(cx0 + 18, 70 - dy); g.lineTo(cx0 + 18, 80 - dy); g.lineTo(cx0, 62 - dy); g.lineTo(cx0 - 18, 80 - dy); g.closePath(); g.fill(); }
    g.fillStyle = '#ffffff'; g.font = '900 44px Poppins'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('JUMP', 128, 60);
  }
  drawJump(jumpTex.image.getContext('2d'));
  assetsReady.then(() => { drawJump(jumpTex.image.getContext('2d')); jumpTex.needsUpdate = true; });
  const jumpSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: jumpTex, transparent: true, depthTest: false, fog: false }));
  jumpSign.scale.set(1.5, 0.66, 1); jumpSign.renderOrder = 7; jumpSign.visible = false; scene.add(jumpSign);
  const defMesh = new THREE.InstancedMesh(humanGeo(KIT.opp, 'block'), charMat, 3); defMesh.count = 0; defMesh.frustumCulled = false; scene.add(defMesh);
  const coneMesh = new THREE.InstancedMesh(merge([
    part(new THREE.CylinderGeometry(0.035, 0.26, 0.85, 14), '#ff5a00', [0, 0.47, 0]),
    part(new THREE.CylinderGeometry(0.13, 0.17, 0.16, 14), '#ffffff', [0, 0.5, 0]),
    part(new THREE.CylinderGeometry(0.075, 0.1, 0.1, 14), '#ffffff', [0, 0.72, 0]),
    part(new THREE.BoxGeometry(0.6, 0.05, 0.6), '#d94a00', [0, 0.025, 0]),
  ]), charMat, 3);
  coneMesh.count = 0; coneMesh.frustumCulled = false; scene.add(coneMesh);
  const shadowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }), 28);
  shadowMesh.frustumCulled = false; shadowMesh.renderOrder = 1; scene.add(shadowMesh);

  // ---------- particles: sparks + confetti ----------
  const SPARKS = 160;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARKS * 3).fill(-50), sparkCol = new Float32Array(SPARKS * 3), sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.16, map: glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sparks.frustumCulled = false; scene.add(sparks);
  let sparkAlive = 0;
  const _col = new THREE.Color();
  function burst(at, n, colors, speed) {
    for (let i = 0, made = 0; i < SPARKS && made < n; i++) {
      if (sparkLife[i] > 0) continue;
      made++;
      sparkPos[i * 3] = at.x; sparkPos[i * 3 + 1] = at.y; sparkPos[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, sp = speed * (0.4 + Math.random() * 0.8);
      sparkVel[i * 3] = Math.cos(a) * Math.cos(e) * sp; sparkVel[i * 3 + 1] = Math.abs(Math.sin(e)) * sp + 1.5; sparkVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp * 0.6 + 1;
      _col.set(colors[(Math.random() * colors.length) | 0]); sparkCol[i * 3] = _col.r; sparkCol[i * 3 + 1] = _col.g; sparkCol[i * 3 + 2] = _col.b;
      sparkLife[i] = 0.6 + Math.random() * 0.7;
    }
    sparkAlive = 2;
  }
  function updateSparks(dt) {
    if (sparkAlive <= 0) return;
    sparkAlive -= dt;
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) { sparkPos[i * 3 + 1] = -50; continue; }
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 6 * dt;
      for (let j = 0; j < 3; j++) { sparkPos[i * 3 + j] += sparkVel[i * 3 + j] * dt; sparkCol[i * 3 + j] *= 0.975; }
    }
    sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true;
  }
  const CONF = 260, CONF_COLS = ['#ff5a00', '#ffffff', '#ffd23f', '#ff7a2e', '#2ee66b', '#3fa9f5'];
  const confMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.06), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONF);
  confMesh.frustumCulled = false; confMesh.visible = false; scene.add(confMesh);
  const conf = [];
  for (let i = 0; i < CONF; i++) {
    conf.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 });
    confMesh.setColorAt(i, _col.set(CONF_COLS[i % CONF_COLS.length]));
    _m.makeScale(0, 0, 0); confMesh.setMatrixAt(i, _m);
  }
  let confAlive = 0;
  function confetti(n, cx, cz) {
    const max = qual === 0 ? Math.min(n, 90) : n;
    for (let i = 0, made = 0; i < CONF && made < max; i++) {
      const c = conf[i]; if (c.life > 0) continue; made++;
      c.p.set(cx + (Math.random() - 0.5) * 12, 4 + Math.random() * 6, cz + (Math.random() - 0.5) * 8);
      c.v.set((Math.random() - 0.5) * 2, -0.8 - Math.random() * 1.2, (Math.random() - 0.5) * 2);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); c.w.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
      c.life = 3 + Math.random() * 2;
    }
    confAlive = 5.5; confMesh.visible = true;
  }
  function updateConfetti(dt, t) {
    if (confAlive <= 0) { confMesh.visible = false; return; }
    confAlive -= dt;
    for (let i = 0; i < CONF; i++) {
      const c = conf[i];
      if (c.life <= 0) { _m.makeScale(0, 0, 0); confMesh.setMatrixAt(i, _m); continue; }
      c.life -= dt; c.p.addScaledVector(c.v, dt); c.p.x += Math.sin(t * 3 + i) * dt * 0.6;
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      if (c.p.y < 0.02) { c.p.y = 0.02; c.v.set(0, 0, 0); c.w.set(0, 0, 0); }
      _m.compose(c.p, _q.setFromEuler(c.r), _s.set(1, 1, 1)); confMesh.setMatrixAt(i, _m);
    }
    confMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- audio: synthesized stadium (WebAudio, no samples) ----------
  const AU = { ctx: null };
  function auInit() {
    try {
      if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = AU.ctx = new AC();
      AU.master = ctx.createGain(); AU.master.gain.value = RG.muted ? 0 : 0.85; AU.master.connect(ctx.destination);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      AU.buf = buf;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.6;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(AU.master); src.start();
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.27; lg.gain.value = 160; lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      AU.crowd = g; AU.crowdLP = lp; AU.bed = 0.07;
      g.gain.setTargetAtTime(AU.bed, ctx.currentTime, 0.8);
    } catch (e) { AU.ctx = null; }
  }
  const on = () => AU.ctx && !RG.muted;
  function nz(o) {
    if (!on()) return;
    const ctx = AU.ctx, t = ctx.currentTime + (o.delay || 0), d = o.d || 0.2, a = o.a || 0.005;
    const src = ctx.createBufferSource(); src.buffer = AU.buf;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1; f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + d);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.v || 0.3, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(f); f.connect(g); g.connect(AU.master); src.start(t, Math.random()); src.stop(t + a + d + 0.05);
  }
  function os(o) {
    if (!on()) return;
    const ctx = AU.ctx, t = ctx.currentTime + (o.delay || 0), d = o.d || 0.2, a = o.a || 0.005;
    const s = ctx.createOscillator(); s.type = o.type || 'sine'; s.frequency.setValueAtTime(o.f, t);
    if (o.f2) s.frequency.exponentialRampToValueAtTime(o.f2, t + d);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.v || 0.2, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    let out = g;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; g.connect(f); out = f; }
    s.connect(g); out.connect(AU.master); s.start(t); s.stop(t + a + d + 0.05);
  }
  function swell(level, hold) {
    if (!AU.ctx) return;
    const t = AU.ctx.currentTime, g = AU.crowd.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(level, t + 0.18); g.setTargetAtTime(AU.bed, t + 0.25 + hold, hold * 0.7 + 0.3);
    const f = AU.crowdLP.frequency; f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.linearRampToValueAtTime(level > 0.3 ? 4200 : 1400, t + 0.2); f.setTargetAtTime(1600, t + 0.4 + hold, hold);
  }
  // A formant-filtered sawtooth gliding g-o-aa-l: a synthesized stadium-announcer "GOAL!".
  function voiceGoal(delay) {
    if (!on()) return;
    const ctx = AU.ctx, t = ctx.currentTime + delay, D = 1.55;
    const s = ctx.createOscillator(); s.type = 'sawtooth';
    s.frequency.setValueAtTime(165, t); s.frequency.linearRampToValueAtTime(215, t + 0.22); s.frequency.linearRampToValueAtTime(196, t + 1.1); s.frequency.linearRampToValueAtTime(150, t + D);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.6; vg.gain.value = 5; vib.connect(vg); vg.connect(s.frequency);
    const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.32, t + 0.06); out.gain.setValueAtTime(0.32, t + D - 0.35); out.gain.exponentialRampToValueAtTime(0.0001, t + D);
    const FORM = [
      { pts: [[320, 0], [480, 0.08], [760, 0.45], [700, 1.1], [380, D - 0.1]], q: 7, v: 1 },
      { pts: [[900, 0], [840, 0.08], [1180, 0.45], [1100, 1.1], [900, D - 0.1]], q: 9, v: 0.5 },
      { pts: [[2450, 0], [2500, 0.3], [2550, 1.0], [2400, D - 0.1]], q: 10, v: 0.22 },
    ];
    for (const fm of FORM) {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = fm.q;
      fm.pts.forEach(([hz, at], i) => (i ? f.frequency.linearRampToValueAtTime(hz, t + at) : f.frequency.setValueAtTime(hz, t)));
      const g = ctx.createGain(); g.gain.value = fm.v * 3; s.connect(f); f.connect(g); g.connect(out);
    }
    out.connect(AU.master); s.start(t); vib.start(t); s.stop(t + D + 0.05); vib.stop(t + D + 0.05);
  }
  const SFX = {
    kick: () => { os({ f: 150, f2: 45, d: 0.16, v: 0.7 }); nz({ type: 'lowpass', f: 1400, d: 0.05, v: 0.45 }); },
    net: () => { nz({ type: 'highpass', f: 2600, d: 0.32, v: 0.22, a: 0.01 }); nz({ f: 650, q: 1.5, d: 0.18, v: 0.14 }); },
    goal: (big) => {
      swell(big ? 0.62 : 0.5, big ? 2.6 : 2.0);
      nz({ f: 1100, q: 0.6, a: 0.12, d: 2.4, v: 0.3 }); nz({ f: 2700, q: 1.3, a: 0.2, d: 1.8, v: 0.12 });
      voiceGoal(0.12);
      [233, 311].forEach((f) => os({ type: 'sawtooth', f, d: 0.65, v: 0.09, a: 0.03, lp: 1500, delay: 0.05 }));
    },
    save: () => { nz({ type: 'lowpass', f: 600, d: 0.12, v: 0.55 }); os({ f: 95, f2: 60, d: 0.15, v: 0.4 }); nz({ f: 520, f2: 300, q: 1.2, a: 0.15, d: 1.2, v: 0.22 }); swell(0.2, 0.8); },
    post: () => { os({ f: 1180, d: 0.8, v: 0.26 }); os({ f: 2950, d: 0.45, v: 0.1 }); os({ f: 4210, d: 0.25, v: 0.06 }); os({ type: 'triangle', f: 560, d: 0.5, v: 0.12 }); nz({ f: 460, f2: 280, q: 1.1, a: 0.2, d: 1.3, v: 0.24, delay: 0.1 }); swell(0.22, 0.9); },
    block: () => { nz({ type: 'lowpass', f: 420, d: 0.15, v: 0.5 }); nz({ f: 480, f2: 300, q: 1.2, a: 0.15, d: 0.9, v: 0.18 }); },
    miss: () => { nz({ f: 440, f2: 250, q: 1.1, a: 0.2, d: 1.1, v: 0.22 }); swell(0.16, 0.6); },
    whistle: () => {
      if (!on()) return;
      const ctx = AU.ctx, t = ctx.currentTime, s = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
      s.frequency.value = 2900; m.frequency.value = 32; mg.gain.value = 220; m.connect(mg); mg.connect(s.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.setValueAtTime(0.09, t + 0.38); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
      s.connect(g); g.connect(AU.master); s.start(t); m.start(t); s.stop(t + 0.5); m.stop(t + 0.5);
    },
    fanfare: () => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { const d = i === 3 ? 0.7 : 0.16; os({ type: 'sawtooth', f, d, v: 0.1, a: 0.02, lp: 2400, delay: i * 0.11 }); os({ type: 'sawtooth', f: f / 2, d, v: 0.06, a: 0.02, lp: 1200, delay: i * 0.11 }); });
      swell(0.42, 1.5);
    },
    pb: () => { [784, 988, 1175, 1568].forEach((f, i) => os({ type: 'triangle', f, d: 0.22, v: 0.16, delay: i * 0.07 })); },
    rank: () => os({ type: 'triangle', f: 1320, d: 0.12, v: 0.08 }),
    over: () => { [523, 440, 349, 262].forEach((f, i) => os({ type: 'triangle', f, d: 0.25, v: 0.2, delay: i * 0.15 })); },
  };
  ['playBtn', 'againBtn'].forEach((id) => { const b = $(id); if (b) b.addEventListener('click', auInit); });
  document.addEventListener('pointerdown', auInit, { passive: true });

  // ---------- HUD ----------
  const hud = $('hud'), sbLvl = $('sbLvl'), sbScore = $('sbScore'), sbGoals = $('sbGoals'), rankEl = $('rank'), windEl = $('wind'), zonesChip = $('zonesChip'), hintEl = $('hint'), pbEl = $('pb');
  const dots = Array.from(document.querySelectorAll('#kd i'));
  const hudCache = {};
  function setText(el, key, v, bump) {
    if (hudCache[key] === v) return;
    const had = key in hudCache; hudCache[key] = v; el.textContent = v;
    if (bump && had) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
  function banner(txt, sub, col, cls) {
    if (pbTimer > 0) { pbTimer = 0; pbEl.classList.remove('show'); } // never stack the PB pill on a result banner
    const b = $('banner'); b.className = ''; b.style.setProperty('--c', col || '#FF5A00');
    b.firstElementChild.textContent = txt; b.lastElementChild.textContent = sub || ''; void b.offsetWidth; b.className = 'show' + (cls ? ' ' + cls : '');
  }
  function flash(op) { $('flash').animate([{ opacity: op }, { opacity: 0 }], { duration: 700, easing: 'ease-out' }); }
  // Live rank: the server keeps one all-time best per rider (no daily board), so the chip ranks the
  // current run against everyone else's best on /api/leaderboard (top 20 + total).
  let lb = null, pbShown = false, lastRankTxt = '', pbTimer = 0, pbDelay = 0;
  async function loadBoard() {
    try {
      const d = await RG.api('/api/leaderboard?game=penalty&riderId=' + encodeURIComponent(sh.rider.id));
      const others = (d.top || []).filter((r) => r.riderId !== sh.rider.id);
      lb = { d, others, best: d.me ? d.me.score : 0, truncated: d.total - (d.me ? 1 : 0) > others.length };
    } catch (e) { lb = null; }
    return lb;
  }
  function liveRank(score) {
    if (!lb) return null;
    const above = lb.others.filter((o) => o.score >= score).length;
    return { rank: above + 1, plus: lb.truncated && above === lb.others.length };
  }
  let hist = [], streak = 0;
  const pendingGoal = () => { const k = run.kick; return k.result && k.phase === 'result' && k.result.goal ? k.result : null; };
  const shownScore = () => run.score + (pendingGoal() ? pendingGoal().pts : 0);
  function updateHud() {
    const st = sh.state, k = run.kick;
    hud.classList.toggle('off', !(st === 'play' || st === 'countdown' || st === 'paused'));
    const sc = shownScore();
    setText(sbScore, 'score', sc.toLocaleString('en-US'), true);
    setText(sbLvl, 'lvl', String(run.level), true);
    setText(sbGoals, 'goals', (run.goals + (pendingGoal() ? 1 : 0)) + '/' + C.NEED, false);
    const key = hist.join('') + '|' + run.over;
    if (hudCache.dots !== key) {
      hudCache.dots = key;
      dots.forEach((d, i) => { d.className = i < hist.length ? (hist[i] ? 'g' : 'm') : (i === hist.length && !run.over ? 'c' : ''); });
    }
    let rt = 'Score to rank';
    const lr = sc > 0 ? liveRank(sc) : null;
    if (lr) rt = '#' + lr.rank + (lr.plus ? '+' : '') + ' on the board';
    else if (sc > 0) rt = sc.toLocaleString('en-US') + ' pts';
    if (rt !== lastRankTxt) {
      const improved = lastRankTxt.startsWith('#') && rt.startsWith('#') && parseInt(rt.slice(1), 10) < parseInt(lastRankTxt.slice(1), 10);
      lastRankTxt = rt; rankEl.textContent = rt;
      if (improved) { rankEl.classList.remove('up'); void rankEl.offsetWidth; rankEl.classList.add('up'); SFX.rank(); }
    }
    if (!pbShown && lb && lb.best > 0 && sc > lb.best && st === 'play') {
      pbShown = true; pbDelay = 1.1; // shown once the result banner has cleared: one thing on screen at a time
    }
    const w = Math.round(k.wind || 0);
    windEl.classList.toggle('hide', !w);
    if (w) {
      // shown as km/h (display scale only) with 1-3 strength bars; the arrow points the way the ball drifts
      setText(windEl.querySelector('b'), 'wind', String(Math.round(Math.abs(w) * 0.4)), false);
      const bars = Math.abs(w) < 45 ? 1 : Math.abs(w) < 70 ? 2 : 3, dir = w < 0 ? '-1' : '1';
      if (hudCache.windUi !== bars + dir) { hudCache.windUi = bars + dir; windEl.dataset.dir = dir; windEl.querySelectorAll('s').forEach((e, i) => e.classList.toggle('on', i < bars)); }
    }
    zonesChip.classList.toggle('hide', !k.zones);
    const showHint = st === 'play' && !run.over && k.phase === 'aim' && !drawPts && (run.level === 1 && run.kickNo < 2 || hintT > 0);
    hintEl.classList.toggle('hide', !showHint);
  }
  // End screen: leaderboard position panel inside the shell's game-over card.
  async function endBoard(score) {
    const over = $('over'); if (!over) return;
    let box = $('ovBoard');
    if (!box) { box = document.createElement('div'); box.id = 'ovBoard'; box.className = 'pboard'; over.insertBefore(box, over.querySelector('.row')); }
    box.innerHTML = ''; box.style.display = 'none';
    const res = sh.lastResult, runId = sh.runId;
    const l = await loadBoard(); if (!l || sh.state !== 'over' || runId !== sh.runId) return;
    const d = l.d, esc = RG.esc, top = d.top || [];
    const admin = !res || res.admin || !d.me;
    const me = admin
      ? { rank: 1 + top.filter((x) => x.score >= score).length, nickname: sh.rider.nick || 'You', riderId: sh.rider.id, score, test: true }
      : d.me;
    let rows;
    if (admin) {
      rows = top.slice(0, 3).map((x) => Object.assign({}, x));
      rows.forEach((x) => { if (x.rank >= me.rank) x.rank++; });
      rows.push(Object.assign({ me: true }, me)); rows.sort((a, b) => a.rank - b.rank);
    } else rows = top.slice(0, 3).map((x) => (x.riderId === me.riderId ? Object.assign({ me: true }, x) : x));
    rows = rows.filter((r) => r.rank <= 3);
    if (!rows.some((r) => r.me)) rows.push(null, Object.assign({ me: true }, me));
    const medal = (n) => `<span class="md md${n}">${n}</span>`;
    const head = admin ? `TEST RUN · WOULD BE #${me.rank}` : `YOUR POSITION · #${me.rank} OF ${d.total}`;
    box.innerHTML = `<div class="ph"><span>${head}</span></div>` + rows.map((r) => (r
      ? `<div class="pr${r.me ? ' me' : ''}"><span class="k">${r.rank <= 3 ? medal(r.rank) : '#' + r.rank}</span><span class="n">${esc(r.me ? (r.nickname || 'You') + ' (you)' : (r.nickname || 'Rider ' + r.riderId))}</span><span class="s">${Number(r.score).toLocaleString('en-US')}</span></div>`
      : '<div class="gap">· · ·</div>')).join('');
    box.style.display = '';
  }

  // ---------- input: draw the curve ----------
  let drawPts = null, drawScr = null, drawT0 = 0;
  // Power comes from the drawn length: a slow, deliberate drag (or a pause mid-drag) is treated like a
  // normal swipe (same pace the bot/sims use, 650 core px/s); a genuinely quick flick still adds pace.
  // penalty-core is untouched: the same (path, ms) still gives the same result.
  const swipeMs = (pts, realMs) => Math.max(40, Math.min(realMs, Math.max(180, P.pathLen(pts) / 650 * 1000)));
  const localXY = (e) => { const r = fx.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  fx.addEventListener('pointerdown', (e) => {
    if (sh.state !== 'play' || run.over || run.kick.phase !== 'aim') return;
    const p = screenToCore(e.clientX, e.clientY); if (!p) return;
    const bs = toScreen(BALL_REST, baseCam), [lx, ly] = localXY(e);
    if (Math.hypot(p.x - C.BALL.x, p.y - C.BALL.y) > 90 && Math.hypot(lx - bs.x, ly - bs.y) > 70) return;
    drawPts = [{ x: C.BALL.x, y: C.BALL.y }, p]; drawScr = [[bs.x, bs.y], [lx, ly]];
    drawT0 = e.timeStamp;
    try { fx.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  fx.addEventListener('pointermove', (e) => {
    if (!drawPts) return;
    const p = screenToCore(e.clientX, e.clientY); if (!p) return;
    const last = drawPts[drawPts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= 4) { drawPts.push(p); drawScr.push(localXY(e)); }
  });
  function endDraw(e) {
    if (!drawPts) return;
    const pts = drawPts; drawPts = null; drawScr = null;
    if (e) { const p = screenToCore(e.clientX, e.clientY); const last = pts[pts.length - 1]; if (p && Math.hypot(p.x - last.x, p.y - last.y) >= 2) pts.push(p); }
    const ms = swipeMs(pts, (e && e.timeStamp ? e.timeStamp : performance.now()) - drawT0);
    P.shoot(run.kick, pts, ms);
  }
  fx.addEventListener('pointerup', endDraw);
  fx.addEventListener('pointercancel', () => { drawPts = null; drawScr = null; });

  // ---------- per-kick visual state ----------
  const PUSH = 0.5; // gentle goal push-in (was a full push): keeps the banner the single focus
  let curKick = null, curLevel = 1, prevPhase = 'aim', kickT = 9, camPush = 0, pushTarget = 0, shake = 0, excite = 0, groan = 0, attract = 1;
  const ballPrev = new THREE.Vector3(), ballVel = new THREE.Vector3(), impact = new THREE.Vector3(0, 1.2, 0);
  const post = { v: new THREE.Vector3(), inNet: false, hitNet: false, active: false };
  const spinAxis = new THREE.Vector3(1, 0, 0);
  let spinRate = 0, trail = [], seenResult = null;
  const kp = { x: 0, dive: 0, dir: 0, h: 0.5 };
  function reset() {
    run = P.newRun((Math.random() * 1e9) >>> 0);
    ended = false; hintT = 4; drawPts = null; drawScr = null; hist = []; streak = 0; pbShown = false; lastRankTxt = '';
    curKick = null; curLevel = 1; seenResult = null; trail = []; post.active = false; camPush = 0; pushTarget = 0;
    pbEl.classList.remove('show'); pbDelay = 0; pbTimer = 0;
    const box = $('ovBoard'); if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    loadBoard();
  }
  loadBoard();
  const LEVEL_NOTES = { 3: 'A WALL STEPS IN', 6: 'JUMPING WALL + CONES', 9: 'DEFENDERS + WIND', 12: 'TWO DEFENDERS' };
  function onNewKick(k) {
    curKick = k; trail = []; post.active = false; seenResult = null; pushTarget = 0;
    ball.position.copy(BALL_REST); ball.rotation.set(0, 0, 0); spinRate = 0;
    kp.dive = 0; kp.dir = 0;
    if (run.level !== curLevel) {
      const up = run.level > curLevel; curLevel = run.level; hist = [];
      if (up) {
        banner('LEVEL ' + run.level, '+500 · ' + (LEVEL_NOTES[run.level] || 'KEEPER GETS SHARPER'), '#2152d8', 'lvl');
        SFX.fanfare(); SFX.whistle(); confetti(200, 0, 3); excite = 1;
      }
    }
  }
  const RESULT_TXT = { save: 'SAVED!', blocked: 'BLOCKED!', post: 'OFF THE POST!', over: 'OVER THE BAR!', wide: 'WIDE!', short: 'TOO WEAK!' };
  function onResult(r) {
    hist.push(r.goal ? 1 : 0);
    if (r.goal) {
      streak++;
      const bonus = (r.corner ? 50 : 0) + (r.curve ? 25 : 0);
      const subs = [bonus ? '+' + bonus + ' BONUS' : '', streak >= 3 ? streak + ' IN A ROW' : ''].filter(Boolean);
      banner(r.corner ? 'TOP CORNER!' : r.curve ? 'WHAT A CURVE!' : 'GOAL!', subs.join(' · '), r.corner ? '#e0a800' : '#FF5A00');
      SFX.goal(r.corner || streak >= 3); flash(r.corner ? 0.6 : 0.4);
      excite = 1; groan = 0; ledGoalT = 1.4; pushTarget = PUSH; shake = 0.2;
      impact.copy(ball.position);
      burst(ball.position, r.corner ? 120 : 80, ['#ffd23f', '#ff7a2e', '#ffffff', '#ff5a00'], 5);
      confetti(r.corner ? 160 : 90, impact.x * 0.5, 2);
    } else {
      streak = 0;
      banner(RESULT_TXT[r.kind] || 'MISS', r.kind === 'save' ? 'THE KEEPER READ IT' : '', r.kind === 'save' ? '#2152d8' : '#d81e3a');
      if (r.kind === 'save') SFX.save(); else if (r.kind === 'post') SFX.post(); else if (r.kind === 'blocked') SFX.block(); else SFX.miss();
      shake = r.kind === 'post' ? 0.45 : r.kind === 'save' || r.kind === 'blocked' ? 0.25 : 0.12;
      groan = 1; excite = Math.max(excite, 0.15);
      if (r.kind === 'post' || r.kind === 'save' || r.kind === 'blocked') burst(ball.position, 26, ['#ffffff', '#cfe3ff'], 2.5);
    }
    startPost(r);
  }
  function startPost(r) {
    const v = ballVel.clone(), sp = Math.max(8, v.length());
    const keeperWX = wX(curKick.keeperX);
    switch (r.kind) {
      case 'goal': post.v.set(v.x * 0.25, Math.min(v.y, 1) * 0.3, -Math.max(9, sp * 0.6)); break;
      case 'save': post.v.set((Math.sign(ball.position.x - keeperWX) || 1) * 4.5, 3.2, 7); break;
      case 'post': post.v.set(-Math.sign(ball.position.x) * 2.5 - v.x * 0.3, 2.2, 8); break;
      case 'blocked': post.v.set((Math.random() - 0.5) * 3, 3.6, 6.5); break;
      case 'over': case 'wide': post.v.set(v.x * 0.6, Math.max(v.y, 1.5), -Math.max(10, sp * 0.7)); break;
      default: post.v.set(v.x * 0.2, 0, -Math.min(3, sp * 0.2));
    }
    post.inNet = r.kind === 'goal'; post.hitNet = false; post.active = true;
  }
  function stepPost(dt) {
    const b = ball.position;
    post.v.y -= 9.8 * dt; b.addScaledVector(post.v, dt);
    if (post.inNet) {
      b.x = clamp(b.x, -3.55, 3.55); b.y = Math.min(b.y, GOAL_H - 0.12);
      const backZ = lerp(NET_BZ, NET_TZ, clamp(b.y / NET_TOP, 0, 1));
      if (b.z < backZ + BR) {
        b.z = backZ + BR;
        if (!post.hitNet) { post.hitNet = true; rip = { x: b.x, y: b.y, t: 0, a: 0.42 }; SFX.net(); }
        post.v.z = Math.abs(post.v.z) * 0.06; post.v.x *= 0.5;
      }
    }
    if (b.y < BR) { b.y = BR; if (post.v.y < 0) post.v.y = -post.v.y * 0.42; post.v.x *= 0.82; post.v.z *= 0.82; }
    spinRate *= 0.97;
  }

  // ---------- animation: keeper, kicker, obstacles ----------
  function poseCrouch(R, c, t, moving) {
    R.hips.position.y = 0.95 - c * 0.26;
    R.torso.rotation.x = c * 0.38;
    R.legs.forEach((l, i) => { const sx = i ? 1 : -1, sw = moving ? Math.sin(t * 16 + i * Math.PI) * 0.35 : 0; l.rotation.set(-c * 0.75 + sw, 0, sx * 0.14); });
    R.knees.forEach((k) => { k.rotation.x = c * 1.25; });
  }
  function animKeeper(k, t, dt) {
    const R = keeper, boxH = P.keeperBox(k).h * SH;
    const crouch = 0.25 + 0.55 * clamp((1.9 - boxH) / 1.1, 0, 1);
    const kx = wX(k.keeperX), moving = Math.abs(kx - kp.x) > dt * 0.4;
    kp.x = kx;
    let dive = 0, dir = kp.dir, h = kp.h;
    if (k.phase !== 'aim') {
      const s = k.travel ? clamp(k.dist / k.travel, 0, 1) : 0;
      const tx = k.result ? k.result.x : k.ball.x, ty = k.result ? k.result.y : k.ball.y;
      if (k.phase === 'flight' && s > 0.45) { dir = Math.sign(tx - k.keeperX); h = clamp(wH(Math.min(GL, ty)), 0.3, 2.6); }
      const reach = Math.abs(tx - k.keeperX) * SX;
      const want = k.phase === 'flight' ? ease((s - 0.62) / 0.38) * 0.8 : 1;
      dive = reach < 0.45 ? want * 0.35 : want;
    }
    kp.dive += (dive - kp.dive) * Math.min(1, dt * 14); kp.dir = dir; kp.h = h;
    const dv = kp.dive, side = kp.dir || 0, high = clamp(h / 2.2, 0, 1);
    poseCrouch(R, crouch * (1 - dv), t, moving && dv < 0.2);
    const bounce = k.phase === 'aim' ? Math.abs(Math.sin(t * 5.5)) * 0.03 : 0;
    const lift = side ? dv * (0.15 + high * 0.55) : dv * (0.2 + high * 0.5);
    R.root.position.set(kx + side * dv * 1.1, bounce + lift, 0.3);
    R.root.rotation.set(0, 0, -side * dv * lerp(1.35, 0.85, high));
    R.arms.forEach((a, i) => { const sx = i ? 1 : -1; a.rotation.set(-0.25 * (1 - dv), 0, sx * lerp(0.55 + Math.sin(t * 3 + i) * 0.05, 2.75, dv)); });
    R.elbows.forEach((e) => { e.rotation.x = -0.5 * (1 - dv); });
  }
  function animKicker(t, dt) {
    const R = kicker; kickT += dt;
    const kt = kickT;
    R.root.position.z = BALL_D + 0.65 - (kt < 0.6 ? ease(kt / 0.2) * 0.35 : 0.35 * (1 - ease((kt - 0.6) / 0.6)));
    poseCrouch(R, 0.15, t, false);
    if (kt < 0.6) {
      const a = kt < 0.12 ? ease(kt / 0.12) : 1, b = kt < 0.12 ? 0 : ease((kt - 0.12) / 0.16);
      R.legs[0].rotation.x = lerp(0.9 * a, -1.3, b); R.knees[0].rotation.x = lerp(1.4 * a, 0.15, b);
      R.torso.rotation.x = lerp(0.1, -0.15, b);
      R.arms[0].rotation.set(0, 0, -0.9 * a); R.arms[1].rotation.set(0, 0, 0.9 * a + 0.3 * b);
    } else {
      R.torso.rotation.x = 0.12 + Math.sin(t * 1.7) * 0.02;
      R.arms.forEach((a, i) => { a.rotation.set(0, 0, (i ? 1 : -1) * 0.18); });
    }
    R.elbows.forEach((e) => { e.rotation.x = -0.35; });
  }
  let shadowN = 0;
  function addShadow(x, z, w, d) { _m.compose(_p.set(x, 0.015, z), _q.identity(), _s.set(w, 1, d || w)); shadowMesh.setMatrixAt(shadowN++, _m); }
  function animObstacles(k, t) {
    shadowN = 0;
    const wr = P.wallRect(k);
    const counts = [0, 0, 0, 0];
    let warn = 0;
    if (wr && k.wall) {
      const w = k.wall, x0 = wX(w.x), x1 = wX(w.x + w.w), n = clamp(Math.round((x1 - x0) / 0.62), 1, 16), st = (x1 - x0) / n;
      const zw = wZ(w.y + w.h) - 0.2, lift = w.kind === 'jump' ? rayHeightAt(wZ(wr.y + wr.h), zw) : 0;
      if (w.kind === 'jump') {
        // wall bottoms out at sin = -1; warn (and squat) in the ~0.4 s before take-off
        const th = (((k.age * Math.PI * 2 / w.period + w.phase) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        warn = clamp(1 - Math.abs(th - (Math.PI * 1.5 - 0.15)) / 0.85, 0, 1);
      }
      const squat = 1 - 0.09 * warn * warn;
      const hs = (k.kseed || 1) >>> 0;
      for (let i = 0; i < n; i++) {
        const h1 = Math.sin((hs % 997) + i * 12.9898) * 43758.5453, r1 = h1 - Math.floor(h1);
        const h2 = Math.sin((hs % 991) + i * 78.233) * 12543.123, r2 = h2 - Math.floor(h2);
        const look = Math.floor(r1 * 4) % 4, tall = 0.93 + r2 * 0.13;
        const x = x0 + st * (i + 0.5) + (r2 - 0.5) * 0.08;
        _m.compose(_p.set(x, lift, zw + (r1 - 0.5) * 0.12), _q.setFromEuler(_e.set(0, (r1 - 0.5) * 0.28 + Math.sin(t * 2 + i * 1.3) * 0.04, (r2 - 0.5) * 0.06)), _s.set(1, tall * squat, 1));
        wallMeshes[look].setMatrixAt(counts[look]++, _m);
        addShadow(x, zw, 0.75 - Math.min(0.3, lift * 0.3), 0.5);
      }
      if (w.kind === 'jump') {
        jumpSign.position.set((x0 + x1) / 2, lift + 2.35 + 0.08 * Math.sin(t * 12), zw);
        jumpSign.material.opacity = warn; jumpSign.scale.set(1.5 * (0.85 + 0.2 * warn), 0.66 * (0.85 + 0.2 * warn), 1);
      }
    }
    jumpSign.visible = warn > 0.02 && k.phase === 'aim';
    wallMeshes.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; });
    const ghostOn = !!(k.wall || (k.defenders && k.defenders.length));
    if (ghosts[0].visible !== ghostOn) ghosts.forEach((g) => { g.visible = ghostOn; });
    const defs = k.defenders || [];
    defs.forEach((d, i) => {
      const x = wX(P.defX(d, k.age)), z = wZ(d.y) - 0.15, bob = Math.abs(Math.sin(k.age * 9 + i)) * 0.05;
      const vx = Math.cos(k.age * Math.PI * 2 / d.period + d.phase);
      _m.compose(_p.set(x, bob, z), _q.setFromEuler(_e.set(0, vx * 0.25, vx * 0.05)), _s.set(1, 1, 1));
      defMesh.setMatrixAt(i, _m); addShadow(x, z, 0.9, 0.55);
    });
    defMesh.count = defs.length; defMesh.instanceMatrix.needsUpdate = true;
    const cones = k.cones || [];
    cones.forEach((c, i) => { _m.compose(_p.set(wX(c.x), 0, wZ(c.y)), _q.identity(), _s.set(1, 1, 1)); coneMesh.setMatrixAt(i, _m); addShadow(wX(c.x), wZ(c.y), 0.75); });
    coneMesh.count = cones.length; coneMesh.instanceMatrix.needsUpdate = true;
    zones.forEach((z, i) => {
      z.visible = !!k.zones; if (!z.visible) return;
      const p = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.2);
      z.userData.ring.scale.setScalar(1 + 0.05 * p);
      z.userData.halo.scale.setScalar(0.9 + 0.25 * p);
      z.lookAt(camera.position.x, camera.position.y, camera.position.z);
    });
    haloMat.opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4));
    addShadow(keeper.root.position.x, 0.3, 0.9 + kp.dive * 0.8, 0.5);
    addShadow(kicker.root.position.x, kicker.root.position.z, 0.8, 0.5);
    const bh = ball.position.y; addShadow(ball.position.x, ball.position.z, 0.36 + bh * 0.08);
    shadowMesh.count = shadowN; shadowMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- overlay: curve preview, flight ghost, ball trail, hint ----------
  function strokePath(pts, w, col) {
    if (pts.length < 2) return;
    fctx.beginPath(); fctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; fctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
    fctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    fctx.lineWidth = w; fctx.strokeStyle = col; fctx.stroke();
  }
  function drawOverlay(t) {
    fctx.clearRect(0, 0, cssW, cssH);
    fctx.lineCap = 'round'; fctx.lineJoin = 'round';
    const k = run.kick;
    if (k.path && (k.phase === 'flight' || k.phase === 'result')) {
      const a = k.phase === 'flight' ? 0.5 : Math.max(0, 0.5 - k.rt);
      if (a > 0.01) {
        const pts = [];
        for (let i = 0; i < k.path.length; i += 3) { const s = toScreen(coreSurface(k.path[i].x, k.path[i].y, _T), camera); pts.push([s.x, s.y]); }
        fctx.setLineDash([2, 9]); strokePath(pts, 3, `rgba(255,255,255,${a})`); fctx.setLineDash([]);
      }
    }
    if (trail.length > 1) {
      const pts = trail.map((v) => toScreen(v, camera));
      for (let i = 1; i < pts.length; i++) {
        const f = i / pts.length;
        fctx.beginPath(); fctx.moveTo(pts[i - 1].x, pts[i - 1].y); fctx.lineTo(pts[i].x, pts[i].y);
        fctx.lineWidth = 1 + f * 7; fctx.strokeStyle = `rgba(255,${(150 + f * 80) | 0},${(40 + f * 120) | 0},${(f * 0.75).toFixed(3)})`; fctx.stroke();
      }
    }
    if (drawScr && drawScr.length > 1) {
      fctx.shadowColor = 'rgba(255,90,0,.9)'; fctx.shadowBlur = 16;
      strokePath(drawScr, 13, 'rgba(255,90,0,.45)');
      fctx.shadowBlur = 0;
      strokePath(drawScr, 4.5, '#fff');
      const last = drawPts[drawPts.length - 1], [ex, ey] = drawScr[drawScr.length - 1];
      const inG = P.inMouth(last.x, last.y, C.BALL.r), corner = inG && P.inCorner(last.x, last.y);
      const col = !inG ? '#ff3b4e' : corner ? '#FFD23F' : '#2ee66b', rr = 13 + Math.sin(t * 10) * 2;
      fctx.lineWidth = 3; fctx.strokeStyle = col;
      fctx.beginPath(); fctx.arc(ex, ey, rr, 0, 7); fctx.stroke();
      fctx.beginPath();
      fctx.moveTo(ex - rr - 5, ey); fctx.lineTo(ex - rr + 5, ey); fctx.moveTo(ex + rr - 5, ey); fctx.lineTo(ex + rr + 5, ey);
      fctx.moveTo(ex, ey - rr - 5); fctx.lineTo(ex, ey - rr + 5); fctx.moveTo(ex, ey + rr - 5); fctx.lineTo(ex, ey + rr + 5);
      fctx.stroke();
      const pw = clamp(P.pathLen(drawPts) / 280, 0, 1.15) / 1.15, bs = drawScr[0];
      fctx.fillStyle = 'rgba(10,15,29,.7)'; fctx.fillRect(bs[0] + 26, bs[1] - 30, 8, 44);
      fctx.fillStyle = pw > 0.68 ? '#2ee66b' : '#FFD23F'; fctx.fillRect(bs[0] + 27, bs[1] + 13 - 42 * pw, 6, 42 * pw);
    }
    if (!hintEl.classList.contains('hide')) {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24, x = (1 - u) * (1 - u) * 180 + 2 * u * (1 - u) * 20 + u * u * (G.x + 26), y = (1 - u) * (1 - u) * 575 + 2 * u * (1 - u) * 330 + u * u * (G.y + 24);
        const s = toScreen(coreSurface(x, y, _T), camera); pts.push([s.x, s.y]);
      }
      fctx.setLineDash([6, 8]); fctx.lineDashOffset = -t * 30; strokePath(pts, 3, 'rgba(255,255,255,.75)'); fctx.setLineDash([]);
      const u = (t * 0.6) % 1, i = Math.min(23, (u * 24) | 0), f = u * 24 - i, hx = lerp(pts[i][0], pts[i + 1][0], f), hy = lerp(pts[i][1], pts[i + 1][1], f);
      fctx.fillStyle = 'rgba(255,255,255,.95)'; fctx.beginPath(); fctx.arc(hx, hy, 9, 0, 7); fctx.fill();
      fctx.strokeStyle = 'rgba(255,90,0,.9)'; fctx.lineWidth = 3; fctx.beginPath(); fctx.arc(hx, hy, 14 + Math.sin(t * 8) * 2, 0, 7); fctx.stroke();
    }
  }

  // ---------- quality governor: drop resolution/effects if the device can't hold ~60 fps ----------
  let fpsFrames = 0, fpsMs = 0, fpsAvg = 0, lastMs = performance.now(), warm = 0;
  function setQuality(q) {
    qual = q;
    beams.forEach((b) => { b.visible = q === 2; });
    crowd.count = q === 0 ? Math.floor(CROWD_N * 0.6) : CROWD_N;
    resize();
  }
  if (qual === 0) setQuality(0);
  function governor() {
    const now = performance.now(), d = now - lastMs; lastMs = now;
    if (document.hidden || d > 400) return;
    warm += d; if (warm < 1500) return;
    fpsFrames++; fpsMs += d;
    if (fpsMs >= 2500) {
      fpsAvg = fpsFrames * 1000 / fpsMs; fpsFrames = 0; fpsMs = 0;
      if (!qLock && qual > 0 && fpsAvg < 48) setQuality(qual - 1);
    }
  }

  // ---------- main loop ----------
  const _look = new THREE.Vector3(), _cp = new THREE.Vector3(), _att = new THREE.Vector3();
  let mutedSeen = null;
  function frame(dt, t) {
    governor();
    let k = run.kick, ts = 1;
    if (sh.state === 'play' && !run.over) {
      // slow-mo on goals: the result phase runs at 40% for its first moments (only ever lengthens a run)
      if (k.phase === 'result' && k.result && k.result.goal && k.rt < 0.4) ts = 0.4;
      P.step(run, dt * ts);
      if (run.over && !ended) {
        ended = true; SFX.over();
        const lvl = run.levelsCleared, score = run.score;
        const line = `Reached level ${run.level} · ${run.totalGoals} goal${run.totalGoals === 1 ? '' : 's'} · ${lvl} level${lvl === 1 ? '' : 's'} cleared`;
        const p = sh.end(score, { title: lvl ? 'Great run!' : 'Game over', line, delay: 1400 });
        if (p && p.then) p.then(() => endBoard(score)).catch(() => {});
      }
    }
    k = run.kick;
    if (k !== curKick) onNewKick(k);
    if (prevPhase === 'aim' && k.phase === 'flight') { kickT = 0; SFX.kick(); trail = []; }
    prevPhase = k.phase;
    if (k.result && seenResult !== k.result) { seenResult = k.result; onResult(k.result); }
    hintT = Math.max(0, hintT - dt);
    const vdt = sh.state === 'play' ? dt * ts : dt;
    if (AU.master && mutedSeen !== RG.muted) { mutedSeen = RG.muted; AU.master.gain.setTargetAtTime(RG.muted ? 0 : 0.85, AU.ctx.currentTime, 0.03); }

    // ball
    if (k.phase === 'flight') {
      ballPrev.copy(ball.position);
      ballFromCore(k, ball.position);
      if (vdt > 0) ballVel.copy(ball.position).sub(ballPrev).divideScalar(vdt);
      const sp = ballVel.length();
      if (sp > 0.1) { spinAxis.set(ballVel.z, 0, -ballVel.x).normalize(); spinAxis.y = k.curve ? 0.6 : 0.1; spinAxis.normalize(); spinRate = sp / BR * 0.35; }
      trail.push(ball.position.clone()); if (trail.length > 22) trail.shift();
    } else if (post.active && (k.phase === 'result' || k.phase === 'done')) {
      if (sh.state === 'play' || run.over) stepPost(vdt);
      if (trail.length) trail.shift();
    } else if (k.phase === 'aim') { ball.position.copy(BALL_REST); trail = []; }
    if (spinRate > 0.01) ball.rotateOnWorldAxis(spinAxis, -spinRate * vdt);

    animKeeper(k, t, vdt);
    animKicker(t, vdt);
    animObstacles(k, t);
    updateNet(vdt);
    updateSparks(vdt);
    updateConfetti(dt, t);
    updateWind(dt, t, sh.state === 'play' ? (k.wind || 0) : 0);

    // crowd + LEDs
    excite = Math.max(0, excite - dt * 0.33); groan = Math.max(0, groan - dt * 0.7);
    crowdU.uTime.value = t; crowdU.uExcite.value = excite; crowdU.uGroan.value = groan; crowdU.uFlash.value = Math.max(0, excite - 0.6);
    ledGoalT = Math.max(0, ledGoalT - dt);
    // goals: the boards just glow brighter for a moment (the banner stays the single focus)
    const glow = LED_BASE + 0.45 * Math.min(1, ledGoalT / 0.6) * (0.75 + 0.25 * Math.cos(ledGoalT * 9));
    for (const b of boards) {
      b.mat.color.setScalar(glow);
      b.t1.offset.x = (b.t1.offset.x + dt * (0.035 + 0.12 * Math.min(1, ledGoalT))) % 1;
    }

    // camera: attract orbit on menus, push-in on goals, shake on hits
    const att = sh.state === 'ready' || sh.state === 'over' ? 1 : 0;
    attract += (att - attract) * Math.min(1, dt * 2.2);
    if (k.phase === 'aim') pushTarget = 0;
    camPush += (pushTarget - camPush) * Math.min(1, dt * (pushTarget ? 2.2 : 6));
    shake = Math.max(0, shake - dt);
    _cp.copy(baseCam.position); _look.copy(camLook);
    if (camPush > 0.001) {
      _cp.lerp(_att.set(impact.x * 0.55, impact.y + 1.4, impact.z + 8.5), camPush * 0.5);
      _look.lerp(_att.set(impact.x * 0.8, impact.y * 0.8, impact.z), camPush * 0.6);
    }
    if (attract > 0.001) {
      const a = Math.sin(t * 0.13) * 0.42, R = baseCam.position.z * 0.9;
      _cp.lerp(_att.set(Math.sin(a) * R, baseCam.position.y + 2.5, Math.cos(a) * R), attract);
      _look.lerp(_att.set(0, 1.6, 0), attract);
    }
    if (shake > 0) { const s = shake * shake * 0.35; _cp.x += (Math.random() - 0.5) * s; _cp.y += (Math.random() - 0.5) * s; }
    camera.position.copy(_cp); camera.lookAt(_look);
    const fov = baseFov * (1 - 0.14 * camPush) * (1 + 0.15 * attract);
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);

    if (pbDelay > 0) { pbDelay -= dt; if (pbDelay <= 0) { pbEl.classList.add('show'); pbTimer = 2.4; SFX.pb(); } }
    if (pbTimer > 0) { pbTimer -= dt; if (pbTimer <= 0) pbEl.classList.remove('show'); }
    updateHud();
    renderer.render(scene, camera);
    drawOverlay(t);
  }
  RG.loop((dt, now) => frame(dt, now / 1000));

  // ---------- test hooks (Playwright / Arcade QA) ----------
  function findShot(kind) {
    const k = run.kick; if (k.phase !== 'aim') return false;
    for (const ms of [420, 300, 650, 900]) {
      for (let ty = 40; ty <= 330; ty += 9) {
        for (let tx = -20; tx <= 380; tx += 9) {
          const mk = (x, y) => P.densify([{ x: C.BALL.x, y: C.BALL.y }, { x, y }], 6);
          const is = (x, y) => { const r = P.simulate(k, mk(x, y), ms); return r.result && r.result.kind === kind; };
          // robust pick: neighbours must agree, so frame-rate (dt) jitter cannot flip the outcome
          if (is(tx, ty) && is(tx - 7, ty) && is(tx + 7, ty) && is(tx, ty - 7) && is(tx, ty + 7)) { P.shoot(k, mk(tx, ty), ms); return { tx, ty, ms }; }
        }
      }
    }
    return false;
  }
  window.__penalty = {
    state: () => ({ level: run.level, kickNo: run.kickNo, goals: run.goals, score: run.score, phase: run.kick.phase, over: run.over, t: run.t, totalGoals: run.totalGoals, levelsCleared: run.levelsCleared, result: run.kick.result }),
    shoot: (path, ms) => P.shoot(run.kick, path, ms),
    bot: () => {
      if (run.kick.phase !== 'aim') return false;
      const try_ = P.botTry(run.kick);
      if (try_.delay) P.stepKick(run.kick, try_.delay);
      return P.shoot(run.kick, try_.path, try_.swipeMs);
    },
    find: findShot,
    coreToScreen: (x, y) => { const s = toScreen(coreSurface(x, y, new THREE.Vector3()), baseCam); const r = fx.getBoundingClientRect(); return { x: s.x + r.left, y: s.y + r.top }; },
    screenToCore: (x, y) => screenToCore(x, y),
    ballScreen: () => { const s = toScreen(ball.position, camera); const r = fx.getBoundingClientRect(); return { x: s.x + r.left, y: s.y + r.top }; },
    camSettled: () => camera.position.distanceTo(baseCam.position) < 0.01 && Math.abs(camera.fov - baseFov) < 0.01,
    jumpCue: () => (jumpSign.visible ? jumpSign.material.opacity : 0),
    quality: () => qual, setQuality: (q) => setQuality(q), fps: () => fpsAvg,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, crowd: crowd.count, pixelRatio: renderer.getPixelRatio(), quality: qual, fov: baseFov, cam: baseCam.position.toArray() }),
  };
})();

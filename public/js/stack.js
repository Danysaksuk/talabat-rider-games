// Stack the Order: 3D street-to-skyline renderer (three.js). Swing physics, perfect tolerance, combos,
// growth and scoring all live in stack-core.js and are untouched; this file only draws a run and maps input.
//
// World: core x (0..360, pivot at 180) maps to x = (cx - 180) * KX; core heights map to y = cy * KY, so the
// bag's top face (core bagTop, y = 0) sits at y = 0 and is exactly BAG_W wide. Boxes are drawn taller than the
// core's flat slabs (KY > KX) so they read as boxes; only horizontal alignment matters for the rules, and that
// is 1:1. The pendulum is drawn rigid (rope + hook = ARM * KX), so the hanging box's x is exactly the core x.
import * as THREE from '/vendor/three.min.js?v=5';

(function main() {
  'use strict';
  const S = window.Stack, C = S.C, RG = window.RG;
  const KX = 0.01, HB = 0.42, KY = HB / C.BOX_H;            // world units per core unit
  const BOX_D = 0.92, BAG_H = 0.95, BAG_D = 1.18, GROUND = -1.92;
  const ROPE = C.ARM * KX, SLING = 0.3, GAPV = 0.34;          // hook point at ROPE from the pivot; box hangs SLING below it
  const wx = (x) => (x - C.PIVOT_X) * KX;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const $ = (id) => document.getElementById(id);
  const qParam = new URLSearchParams(location.search).get('q');   // high | low | (auto)

  // ---------- game shell ----------
  let run = S.newRun(), ended = false;
  const sh = RG.shell({
    game: 'stack', title: '<span class="kick"><img class="tlogo" src="/img/talabat-logo.png" alt="talabat" width="69" height="24">RIDER GAMES</span>Stack the Order',
    how: '• A box swings from the crane. <b>Tap</b>, press <b>Space</b>, <b>Enter</b> or the <b>gamepad button</b> to drop it.<br>• Any overhang is sliced off. Land it flush for a <b>PERFECT</b> and a combo.<br>• Every <b>3 perfects</b> in a row grows the box back.<br>• The swing speeds up as you climb. Miss the stack completely and the run ends.',
    onReset: () => reset(), onStart: () => { hintT = 3; SFX.start(); },
  });
  if (!sh) return;

  // ---------- renderer ----------
  const cv = $('c');
  const DPR = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: DPR < 2, powerPreference: 'high-performance' });
  let qual = qParam === 'low' ? 0 : 2;
  const qLock = qParam === 'low' || qParam === 'high';
  const pixelRatio = () => (qual === 2 ? Math.min(DPR, 2) : qual === 1 ? Math.min(DPR, 1.25) : Math.min(DPR, 0.85));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#3a2a55', 60, 190);
  const camera = new THREE.PerspectiveCamera(50, 0.5, 0.1, 600);
  let cssW = 360, cssH = 700, baseFov = 50, camDist = 14;
  function resize() {
    const r = cv.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    // keep the full swing (about +-2.6 world units) in view on a portrait phone; wider screens frame by height
    baseFov = camera.aspect < 0.75 ? 52 : camera.aspect < 1.2 ? 46 : 40;
    const halfW = Math.tan(baseFov * Math.PI / 360) * camera.aspect;
    camDist = Math.max(11.5, 3.15 / halfW);
    camera.fov = baseFov; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- helpers ----------
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const Yv = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const part = (g, c, p, r, s) => ({ g, c, p, r, s });
  function seg(a, b, r1, r2, c, n) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    return { g: new THREE.CylinderGeometry(r2, r1, L, n || 8), c, p: A.clone().add(B).multiplyScalar(0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(Yv, d.normalize()) };
  }
  // merge coloured parts into one vertex-coloured mesh (one draw call per prop)
  function merge(parts) {
    const pos = [], nor = [], col = [], idx = []; let off = 0; const c = new THREE.Color();
    for (const pt of parts) {
      const g = pt.g;
      if (pt.q) _q.copy(pt.q); else _q.setFromEuler(_e.set(...(pt.r || [0, 0, 0])));
      const s = pt.s == null ? 1 : pt.s;
      _m.compose(_p.set(...(pt.p || [0, 0, 0])), _q, Array.isArray(s) ? _s.set(...s) : _s.set(s, s, s));
      g.applyMatrix4(_m);
      const Pa = g.attributes.position, Na = g.attributes.normal; c.set(pt.c);
      for (let i = 0; i < Pa.count; i++) { pos.push(Pa.getX(i), Pa.getY(i), Pa.getZ(i)); nor.push(Na.getX(i), Na.getY(i), Na.getZ(i)); col.push(c.r, c.g, c.b); }
      const I = g.index;
      if (I) for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + off); else for (let i = 0; i < Pa.count; i++) idx.push(i + off);
      off += Pa.count; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setIndex(idx);
    return out;
  }
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const glowTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,.7)'); gr.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const blobTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });

  // ---------- logo + fonts ----------
  const LOGO = new Image(); LOGO.src = '/img/talabat-logo.png';
  const LOGO_AR = 420 / 146;
  const logoTex = new THREE.Texture(LOGO); logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = 8;
  (LOGO.decode ? LOGO.decode() : new Promise((r) => { LOGO.onload = r; })).then(() => { logoTex.needsUpdate = true; }).catch(() => {});
  const logoMat = new THREE.MeshLambertMaterial({ map: logoTex, transparent: true, alphaTest: 0.05 });
  const logoGeo = new THREE.PlaneGeometry(1, 1 / LOGO_AR);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight('#ffd9b8', '#3a2a4a', 1.5); scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffd0a0', 2.1); key.position.set(9, 10, 12); scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight('#9fb4ff', 0.6); fill.position.set(-8, 4, 6); scene.add(fill);

  // ---------- sky: sunset -> twilight -> starry night as the tower climbs ----------
  const PAL = [   // [at boxes, top, mid, horizon, key light, hemi sky, window glow, cloud tint]
    [0, '#2c3576', '#b8607a', '#ffb070', '#ffc79a', '#ffd9b8', 0.55, '#ffb08a'],
    [15, '#121848', '#4b3a86', '#e07a6a', '#d6a0c0', '#c8b8e8', 0.8, '#d48aa0'],
    [30, '#040822', '#14204e', '#3d3270', '#a8b8ff', '#8ea0d8', 1.0, '#5a5a8a'],
    [50, '#01020c', '#070d2a', '#1e1a42', '#9fb0ff', '#7080b8', 1.0, '#2a2c50'],
  ].map((p) => ({ n: p[0], top: new THREE.Color(p[1]), mid: new THREE.Color(p[2]), hor: new THREE.Color(p[3]), key: new THREE.Color(p[4]), hemi: new THREE.Color(p[5]), win: p[6], cloud: new THREE.Color(p[7]) }));
  const skyU = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 14), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(hor, mid, smoothstep(-0.02, 0.16, h)); c = mix(c, top, smoothstep(0.16, 0.6, h)); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
  }));
  scene.add(sky);
  const starMat = new THREE.PointsMaterial({ color: '#e6ecff', size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false });
  {
    const n = 320, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = -Math.PI * 0.95 + Math.random() * Math.PI * 0.9, e = 0.12 + Math.random() * 1.3; pos[i * 3] = Math.cos(a) * Math.cos(e) * 380; pos[i * 3 + 1] = Math.sin(e) * 380; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 380; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sky.add(new THREE.Points(g, starMat));
  }
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffcf80', fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }));
  sun.scale.set(80, 80, 1); sun.position.set(-50, 8, -330); sky.add(sun);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#dfe6ff', fog: false, depthWrite: false, transparent: true, opacity: 0 }));
  moon.scale.set(22, 22, 1); moon.position.set(-90, 150, -320); sky.add(moon);

  // ---------- Dubai skyline (two parallax layers) with lit windows ----------
  const winTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#1a2036'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) {
      const r = Math.random(); g.fillStyle = r < 0.42 ? '#ffd28a' : r < 0.55 ? '#fff0c8' : r < 0.62 ? '#8fb8ff' : '#262d48'; g.fillRect(x, y, 4, 5);
    }
  }, true);
  const skyline = [];
  function layer(z, par, list, tint) {
    const grp = new THREE.Group(); grp.position.z = z; scene.add(grp);
    const mat = new THREE.MeshBasicMaterial({ map: winTex, color: tint });
    const dark = new THREE.MeshBasicMaterial({ color: '#141a30' });
    for (const [x, w, h, d] of list) {
      const t = winTex.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(w / 2.2)), Math.max(1, Math.round(h / 4.4)));
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d || w), [mat.clone(), mat.clone(), dark, dark, mat.clone(), mat.clone()]);
      m.material.forEach((mm) => { if (mm.map) mm.map = t; });
      m.position.set(x, GROUND + h / 2, 0); grp.add(m);
    }
    const mats = grp.children.flatMap((m) => m.material.filter((mm) => mm.map)); mats.forEach((mm) => { mm.userData.tint = mm.color.clone(); });
    skyline.push({ grp, par, mats });
    return grp;
  }
  const far = layer(-110, 0, [[-40, 9, 14], [-30, 7, 20], [-20, 9, 16], [-10, 6, 22], [-1, 7, 15], [20, 8, 18], [30, 9, 13], [40, 8, 21]], '#9aa2cc');
  // Burj-style tower: stacked setbacks and a spire, centre-right of the frame
  {
    const parts = [], col = '#232b4a';
    [[4, 7], [3.2, 6], [2.4, 5], [1.8, 4], [1.2, 3], [0.8, 2.5]].reduce((y, [w, h]) => { parts.push(part(new THREE.BoxGeometry(w, h, w), col, [0, y + h / 2, 0])); return y + h; }, 0);
    parts.push(seg([0, 27.5, 0], [0, 40, 0], 0.3, 0.04, col, 6));
    const burj = new THREE.Mesh(merge(parts), new THREE.MeshBasicMaterial({ vertexColors: true }));
    burj.position.set(10, GROUND, 0); far.add(burj);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 26, 4.1), new THREE.MeshBasicMaterial({ map: (() => { const t = winTex.clone(); t.needsUpdate = true; t.repeat.set(1, 7); return t; })(), color: '#ffe0b0' }));
    strip.position.set(10, GROUND + 13, 0.1); far.add(strip); strip.material.userData.tint = strip.material.color.clone(); skyline[0].mats.push(strip.material);
    const tip = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff4a3a', fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }));
    tip.scale.set(3, 3, 1); tip.position.set(10, GROUND + 40, 0); far.add(tip);
  }
  layer(-52, 0, [[-17, 6, 15], [-10, 5, 21], [-3, 5, 11], [4, 4, 17], [14, 6, 13], [21, 5, 23]], '#7a82ac');
  layer(-25, 0, [[-9.5, 4, 7], [-5, 3.6, 10], [-0.5, 4, 5.5], [4, 3.6, 8.5], [8.5, 4, 6.5]], '#565d82');
  // warm clouds, drifting slowly
  const cloudTex = canvasTex(256, 128, (g) => {
    for (let i = 0; i < 14; i++) {
      const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40, r = 22 + Math.random() * 30, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    }
  });
  const clouds = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: '#ffb08a', fog: false, depthWrite: false, transparent: true, opacity: 0.8 }));
    s.scale.set(46 + i * 6, 20 + i * 2, 1); s.position.set(-90 + i * 32, 22 + (i % 3) * 16, -170 - (i % 2) * 20); scene.add(s); clouds.push(s);
  }

  // ---------- street ----------
  {
    const road = canvasTex(256, 256, (g) => {
      g.fillStyle = '#2a2a33'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
      g.fillStyle = '#e8e2d0'; for (let x = 0; x < 256; x += 64) g.fillRect(x, 150, 34, 6);
    }, true);
    road.repeat.set(12, 1);
    const st = new THREE.Mesh(new THREE.PlaneGeometry(160, 16), new THREE.MeshLambertMaterial({ map: road }));
    st.rotation.x = -Math.PI / 2; st.position.set(0, GROUND, 1); scene.add(st);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(160, 0.18, 6), new THREE.MeshLambertMaterial({ color: '#8a7f78' }));
    walk.position.set(0, GROUND + 0.09, -10); scene.add(walk);
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(400, 200), new THREE.MeshLambertMaterial({ color: '#2a2436' }));
    lot.rotation.x = -Math.PI / 2; lot.position.set(0, GROUND - 0.01, -113); scene.add(lot);
    // a few street lamps with warm glows
    const lp = [];
    for (const x of [-9, 7, 20, -22]) { lp.push(seg([x, GROUND, -7.6], [x, GROUND + 4.2, -7.6], 0.07, 0.05, '#2b2b36', 6), seg([x, GROUND + 4.2, -7.6], [x + 0.8, GROUND + 4.3, -7.6], 0.04, 0.04, '#2b2b36', 5)); }
    scene.add(new THREE.Mesh(merge(lp), vcMat));
    for (const x of [-9, 7, 20, -22]) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffc070', depthWrite: false, blending: THREE.AdditiveBlending, transparent: true })); s.scale.set(1.6, 1.6, 1); s.position.set(x + 0.8, GROUND + 4.2, -7.5); scene.add(s); }
  }

  // ---------- scooter + thermal bag (bag top face = core bagTop, y = 0, exactly BAG_W wide) ----------
  const BAG_W = C.BAG_W * KX;
  {
    const O = '#FF5A00', OD = '#d94a00', K = '#1c1c22', G = '#3a3a44', M = '#b9bcc6', WR = 0.36, wy = GROUND + WR;
    const p = [];
    const wheel = (x) => { p.push(part(new THREE.CylinderGeometry(WR, WR, 0.26, 18), K, [x, wy, 0], [Math.PI / 2, 0, 0])); p.push(part(new THREE.CylinderGeometry(WR * 0.55, WR * 0.55, 0.28, 14), M, [x, wy, 0], [Math.PI / 2, 0, 0])); };
    wheel(-0.3); wheel(1.95);
    p.push(part(new THREE.BoxGeometry(1.5, 0.44, 0.62), O, [-0.05, GROUND + 0.6, 0]));         // rear cowl
    p.push(part(new THREE.BoxGeometry(0.75, 0.1, 0.5), K, [0.72, GROUND + 0.84, 0]));          // seat (front of the bag)
    p.push(part(new THREE.BoxGeometry(0.6, 0.1, 0.56), G, [1.2, GROUND + 0.45, 0]));            // floorboard
    p.push(part(new THREE.BoxGeometry(0.2, 1.05, 0.58), O, [1.62, GROUND + 0.95, 0], [0, 0, -0.32]));   // leg shield
    p.push(seg([1.8, GROUND + 1.3, 0], [2.0, wy, 0], 0.05, 0.05, G, 8));                        // fork
    p.push(part(new THREE.BoxGeometry(0.62, 0.14, 0.4), O, [1.98, wy + 0.38, 0]));             // front fender
    p.push(seg([1.78, GROUND + 1.25, 0], [1.68, GROUND + 1.72, 0], 0.06, 0.06, G, 8));          // steering column
    p.push(seg([1.68, GROUND + 1.72, -0.42], [1.68, GROUND + 1.72, 0.42], 0.035, 0.035, K, 6)); // handlebar
    p.push(part(new THREE.BoxGeometry(0.18, 0.2, 0.3), O, [1.74, GROUND + 1.66, 0]));          // headset
    p.push(part(new THREE.SphereGeometry(0.07, 10, 8), '#fff2a0', [1.85, GROUND + 1.6, 0]));   // headlight
    p.push(seg([1.6, GROUND + 1.74, 0.35], [1.5, GROUND + 2.0, 0.42], 0.015, 0.015, K, 5));     // mirror stalk
    p.push(part(new THREE.BoxGeometry(0.06, 0.1, 0.14), K, [1.5, GROUND + 2.03, 0.42]));
    p.push(part(new THREE.BoxGeometry(0.08, 0.1, 0.36), '#e0242f', [-0.82, GROUND + 0.68, 0]));  // tail light
    p.push(part(new THREE.BoxGeometry(1.36, 0.06, 1.0), G, [0, -BAG_H - 0.04, 0]));             // rack
    p.push(seg([-0.55, -BAG_H - 0.06, 0.3], [-0.45, GROUND + 0.8, 0.28], 0.03, 0.03, G, 5), seg([-0.55, -BAG_H - 0.06, -0.3], [-0.45, GROUND + 0.8, -0.28], 0.03, 0.03, G, 5), seg([0.55, -BAG_H - 0.06, 0.3], [0.45, GROUND + 0.8, 0.28], 0.03, 0.03, G, 5), seg([0.55, -BAG_H - 0.06, -0.3], [0.45, GROUND + 0.8, -0.28], 0.03, 0.03, G, 5));
    p.push(part(new THREE.BoxGeometry(0.5, 0.06, 0.14), M, [-0.55, GROUND + 0.5, 0.25]));       // exhaust
    const scooter = new THREE.Mesh(merge(p), vcMat); scene.add(scooter);
    // insulated bag: body, lid seam, straps
    const b = [];
    b.push(part(new THREE.BoxGeometry(BAG_W, BAG_H - 0.04, BAG_D), O, [0, -BAG_H / 2 - 0.02, 0]));
    b.push(part(new THREE.BoxGeometry(BAG_W, 0.05, BAG_D), OD, [0, -0.025, 0]));                 // lid: top face at y = 0, exactly BAG_W wide
    b.push(part(new THREE.BoxGeometry(BAG_W + 0.03, 0.035, BAG_D + 0.03), '#2a1a12', [0, -0.12, 0]));   // zip seam
    for (const x of [-BAG_W * 0.36, BAG_W * 0.36]) b.push(part(new THREE.BoxGeometry(0.07, BAG_H - 0.02, BAG_D + 0.03), '#262028', [x, -BAG_H / 2 - 0.01, 0]));
    for (const z of [-BAG_D / 2 - 0.016, BAG_D / 2 + 0.016]) b.push(part(new THREE.BoxGeometry(BAG_W * 0.8, 0.03, 0.02), '#ff8a3d', [0, -BAG_H + 0.1, z]));
    const bag = new THREE.Mesh(merge(b), vcMat); scene.add(bag);
    const bl = new THREE.Mesh(logoGeo, logoMat); bl.scale.setScalar(0.74); bl.position.set(0, -BAG_H * 0.55, BAG_D / 2 + 0.018); scene.add(bl);
    const sh0 = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.4), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    sh0.rotation.x = -Math.PI / 2; sh0.position.set(0.8, GROUND + 0.01, 0); scene.add(sh0);
  }

  // ---------- cardboard boxes ----------
  const KRAFT = '#d39a5c';
  const sideTex = canvasTex(256, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#dca46a'); gr.addColorStop(1, '#c48a4e'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(90,50,10,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 1); }
    g.strokeStyle = 'rgba(110,62,20,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 18); g.lineTo(w, 18); g.stroke();   // flap crease
    g.strokeStyle = 'rgba(255,230,190,.25)'; g.beginPath(); g.moveTo(0, 21); g.lineTo(w, 21); g.stroke();
    g.fillStyle = '#FF5A00'; g.fillRect(w / 2 - 14, 0, 28, 30); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(w / 2 - 14, 0, 28, 3);   // tape over the flaps
    g.strokeStyle = 'rgba(80,40,10,.45)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  });
  const topTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#d8a066'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(90,50,10,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 1); }
    g.fillStyle = '#FF5A00'; g.fillRect(w / 2 - 14, 0, 28, h);                      // tape along the seam
    g.strokeStyle = 'rgba(100,55,15,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.strokeStyle = 'rgba(80,40,10,.45)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  });
  const endTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c38a50'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(110,62,20,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 18); g.lineTo(w, 18); g.stroke();
    g.strokeStyle = 'rgba(80,40,10,.45)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  });
  const boxMats = [endTex, endTex, topTex, endTex, sideTex, sideTex].map((t) => new THREE.MeshLambertMaterial({ map: t }));
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // a box = group (position) + body (scaled w x HB x D) + logo decal (unscaled, fits the width)
  function makeBox(w) {
    const g = new THREE.Group(), body = new THREE.Mesh(boxGeo, boxMats), lg = new THREE.Mesh(logoGeo, logoMat);
    lg.position.z = BOX_D / 2 + 0.004; g.add(body, lg); g.userData = { body, lg };
    setBoxW(g, w); return g;
  }
  function setBoxW(g, w) {
    g.userData.w = w; g.userData.body.scale.set(Math.max(0.01, w), HB, BOX_D);
    const lw = Math.min(0.62, w * 0.62); g.userData.lg.scale.setScalar(lw); g.userData.lg.visible = lw > 0.12;
  }
  const stackGrp = new THREE.Group(); scene.add(stackGrp);
  let boxes = [];                                     // landed meshes, index = stack index (1..)

  // ---------- gantry crane: steel column, beam that rides up with the stack, trolley, cable, hook ----------
  const latTex = canvasTex(64, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = '#2a2f3c'; g.lineWidth = 7;
    g.strokeRect(3.5, -4, w - 7, h + 8); g.lineWidth = 5; g.beginPath(); g.moveTo(4, 0); g.lineTo(w - 4, h / 2); g.lineTo(4, h); g.moveTo(4, h / 2); g.lineTo(w - 4, h / 2); g.stroke();
  }, true);
  const steel = (rx, ry) => { const t = latTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.4, side: THREE.DoubleSide }); };
  const COL_X = -3.35, COL_Z = -1.3;
  const column = new THREE.Group(); scene.add(column);
  for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 120, 0.08), new THREE.MeshLambertMaterial({ color: '#30353f' })); m.position.set(COL_X + dx, GROUND + 60, COL_Z + dz); column.add(m); }
  for (const [rx, rz, x, z, ry] of [[0.6, 0, COL_X, COL_Z + 0.3, 0], [0.6, 0, COL_X, COL_Z - 0.3, 0], [0, 0.6, COL_X + 0.3, COL_Z, Math.PI / 2], [0, 0.6, COL_X - 0.3, COL_Z, Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 120), steel(1, 100)); m.position.set(x, GROUND + 60, z); m.rotation.y = ry; column.add(m);
  }
  const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 1.2), new THREE.MeshLambertMaterial({ color: '#4a4a52' })); foot.position.set(COL_X, GROUND + 0.15, COL_Z); scene.add(foot);
  const BEAM_L = 5.2, BEAM_X0 = COL_X - 0.4;
  const beam = new THREE.Group(); scene.add(beam);
  {
    const p = [];
    for (const [y, z] of [[0.18, 0.2], [0.18, -0.2], [0.52, 0.2], [0.52, -0.2]]) p.push(part(new THREE.BoxGeometry(BEAM_L, 0.07, 0.07), '#2c313c', [BEAM_X0 + BEAM_L / 2, y, z]));
    p.push(part(new THREE.BoxGeometry(0.62, 0.62, 1.7), '#2c313c', [COL_X, 0.35, (COL_Z) / 2], null, [1, 1, 1]));     // knee joint to the column
    p.push(part(new THREE.BoxGeometry(0.5, 0.26, 0.5), '#FF5A00', [0, 0.06, 0]));                           // trolley
    p.push(part(new THREE.BoxGeometry(0.56, 0.06, 0.56), '#1c1c22', [0, -0.08, 0]));
    beam.add(new THREE.Mesh(merge(p), vcMat));
    for (const z of [0.2, -0.2]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(BEAM_L, 0.34), steel(BEAM_L / 0.5, 1)); m.position.set(BEAM_X0 + BEAM_L / 2, 0.35, z); beam.add(m); }
  }
  // pendulum: pivot (under the trolley) -> cable -> hook block -> hook point -> two slings -> box
  const pend = new THREE.Group(); scene.add(pend);
  // brushed-steel cable and slings with a faint emissive lift so they read against the dark lit-window skyline
  const cableMat = new THREE.MeshLambertMaterial({ color: '#d9dee6', emissive: '#6f7a8c', emissiveIntensity: 0.55 });
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1, 8), cableMat);
  const hookBlock = new THREE.Mesh(merge([
    part(new THREE.BoxGeometry(0.26, 0.3, 0.24), '#FF5A00', [0, 0, 0]),
    part(new THREE.CylinderGeometry(0.1, 0.1, 0.26, 12), '#2a2a32', [0, 0.06, 0], [Math.PI / 2, 0, 0]),
    seg([0, -0.15, 0], [0, -0.22, 0], 0.03, 0.03, '#2a2a32', 6),
    seg([0, -0.22, 0], [0.07, -0.3, 0], 0.028, 0.028, '#2a2a32', 6), seg([0.07, -0.3, 0], [0.03, -0.38, 0], 0.028, 0.028, '#2a2a32', 6),
    seg([0.03, -0.38, 0], [-0.05, -0.34, 0], 0.028, 0.028, '#2a2a32', 6),
  ]), vcMat);
  hookBlock.scale.setScalar(1.35); pend.add(cable, hookBlock);
  const slings = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1, 8), cableMat); pend.add(m); return m; });
  const hang = makeBox(BAG_W); scene.add(hang);
  function rod(m, a, b) { _p.copy(b).sub(a); const L = _p.length(); m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.set(1, Math.max(0.001, L), 1); m.quaternion.setFromUnitVectors(Yv, _p.normalize()); }

  // ---------- effects: falling pieces, shockwave rings, sparks ----------
  const pieces = [];                                  // free bodies: sliced overhangs and missed boxes
  function spawnPiece(x, y, w, vx, vy, spin, miss) {
    const g = makeBox(w); g.position.set(x, y, 0); scene.add(g);
    pieces.push({ g, v: new THREE.Vector3(vx, vy, 2 + Math.random() * 0.5),   // drift towards the camera: clear of the scooter and bag
      spin: new THREE.Vector3(miss ? 1.2 : (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5, spin), t: 0, w, miss, bounced: false });
  }
  function floorAt(p) {                               // highest surface under the piece: a wider box below, the bag, the seat, the street
    const x = p.g.position.x, L = x - p.w / 2, R = x + p.w / 2, bottom = p.g.position.y - HB / 2;
    let f = GROUND, eps = 1e-3;
    if (L < BAG_W / 2 - eps && R > -BAG_W / 2 + eps && bottom > -0.05) f = Math.max(f, 0);
    for (let i = 1; i < run.stack.length; i++) {
      const b = run.stack[i], top = i * HB; if (top > bottom + 0.02 || top <= f) continue;
      const bL = wx(b.x - b.w / 2), bR = wx(b.x + b.w / 2);
      if (L < bR - eps && R > bL + eps) f = top;
    }
    return f + HB / 2;
  }
  function updatePieces(dt) {
    for (const p of pieces) {
      p.t += dt; p.v.y -= 16 * dt; p.g.position.addScaledVector(p.v, dt);
      p.g.rotation.x += p.spin.x * dt; p.g.rotation.y += p.spin.y * dt; p.g.rotation.z += p.spin.z * dt;
      const floor = floorAt(p);
      if (p.g.position.y < floor) {
        p.g.position.y = floor;
        if (floor > GROUND + HB) {                       // a ledge: bounce and get pushed off, outward
          const dir = Math.sign(p.g.position.x - wx(S.currentTop(run).x)) || 1;
          p.v.set(dir * Math.max(1.2, Math.abs(p.v.x)), Math.abs(p.v.y) * 0.3, p.v.z); p.spin.z = -dir * 4;
        } else if (!p.bounced) { p.bounced = true; p.v.set(p.v.x * 0.4, Math.abs(p.v.y) * 0.25, p.v.z * 0.4); p.spin.multiplyScalar(0.3); if (p.miss) { SFX.thud(); shake = Math.max(shake, 0.35); } }
        else { p.v.set(p.v.x * 0.9, 0, p.v.z * 0.9); p.spin.multiplyScalar(0.9); }
      }
    }
    for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].t > (pieces[i].miss ? 30 : 4)) { scene.remove(pieces[i].g); pieces.splice(i, 1); }
  }
  const ringGeo = new THREE.RingGeometry(0.92, 1, 64);
  const rings = [];
  function ring(y, w, gold) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: gold ? '#ffd23f' : '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, y, 0); scene.add(m); rings.push({ m, t: 0, w });
    const h = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    rings.push({ m: h, t: 0, w, glow: true }); scene.add(h); return { m, h };
  }
  function updateRings(dt) {
    for (const r of rings) {
      r.t += dt; const k = r.t / (r.glow ? 0.35 : 0.6);
      if (r.glow) { r.m.material.opacity = 0.6 * (1 - k); }
      else { const s = (r.w * 0.55 + 0.15) * (1 + 1.6 * ease(k)); r.m.scale.set(s, s * 0.7, 1); r.m.material.opacity = 1 - k; }
    }
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t > (rings[i].glow ? 0.35 : 0.6)) { scene.remove(rings[i].m); rings[i].m.material.dispose(); rings.splice(i, 1); }
  }
  const sparks = [];
  for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffd23f', depthWrite: false, blending: THREE.AdditiveBlending, transparent: true, fog: false })); s.visible = false; scene.add(s); sparks.push({ s, v: new THREE.Vector3(), t: 9 }); }
  function burst(x, y, n, col) {
    let k = 0;
    for (const p of sparks) { if (k >= n) break; if (p.t < 0.7) continue; k++; p.t = 0; p.s.visible = true; p.s.material.color.set(col); p.s.position.set(x + (Math.random() - 0.5) * 0.6, y, 0.3); const a = Math.random() * Math.PI; p.v.set(Math.cos(a) * 3, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 2); }
  }
  function updateSparks(dt) { for (const p of sparks) { if (!p.s.visible) continue; p.t += dt; p.v.y -= 6 * dt; p.s.position.addScaledVector(p.v, dt); const k = p.t / 0.7; p.s.scale.setScalar(0.3 * (1 - k) + 0.05); p.s.material.opacity = 1 - k; if (k >= 1) p.s.visible = false; } }

  // ---------- audio (generated Web Audio SFX) ----------
  const AU = { ctx: null };
  function auInit() {
    if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = AU.ctx = new AC();
      AU.master = ctx.createGain(); AU.master.gain.value = RG.muted ? 0 : 0.85; AU.master.connect(ctx.destination);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      AU.buf = buf;
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
    s.connect(g); g.connect(AU.master); s.start(t); s.stop(t + a + d + 0.05);
  }
  const SFX = {
    start: () => os({ type: 'triangle', f: 660, f2: 990, d: 0.14, v: 0.08 }),
    release: () => { os({ type: 'triangle', f: 1500, f2: 900, d: 0.05, v: 0.08 }); nz({ f: 1200, f2: 500, q: 0.8, d: 0.14, v: 0.08 }); },
    land: () => { nz({ type: 'lowpass', f: 520, d: 0.09, v: 0.4 }); os({ f: 150, f2: 80, d: 0.1, v: 0.22 }); },
    slice: () => { nz({ type: 'highpass', f: 2600, f2: 1200, d: 0.14, v: 0.16 }); nz({ f: 900, q: 2, d: 0.06, v: 0.1 }); },
    // rising chord: each perfect in a row climbs a step
    perfect: (n) => { const r = 523.25 * Math.pow(2, Math.min(12, (n - 1) * 2) / 12); [1, 1.26, 1.5, 2].forEach((m, i) => os({ type: 'triangle', f: r * m, d: i === 3 ? 0.4 : 0.22, v: 0.12, delay: i * 0.045 })); os({ f: r * 4, d: 0.5, v: 0.03, delay: 0.18 }); },
    grow: () => { [784, 988, 1175, 1568].forEach((f, i) => os({ type: 'square', f, d: 0.16, v: 0.06, delay: 0.2 + i * 0.07 })); nz({ f: 3000, f2: 6000, q: 0.6, d: 0.4, v: 0.06, delay: 0.2 }); },
    miss: () => { os({ type: 'sine', f: 520, f2: 140, d: 0.6, v: 0.16 }); nz({ f: 800, f2: 300, q: 0.6, d: 0.5, v: 0.08 }); },
    thud: () => { nz({ type: 'lowpass', f: 380, d: 0.18, v: 0.5 }); os({ f: 90, f2: 45, d: 0.25, v: 0.3 }); },
    over: () => { [523, 440, 349, 262].forEach((f, i) => os({ type: 'triangle', f, d: 0.25, v: 0.18, delay: 0.25 + i * 0.15 })); },
    pb: () => { [784, 988, 1175, 1568].forEach((f, i) => os({ type: 'triangle', f, d: 0.22, v: 0.16, delay: i * 0.07 })); },
    rank: () => os({ type: 'triangle', f: 1320, d: 0.12, v: 0.08 }),
  };
  ['playBtn', 'againBtn'].forEach((id) => { const b = $(id); if (b) b.addEventListener('click', auInit); });
  document.addEventListener('pointerdown', auInit, { passive: true });

  // ---------- HUD ----------
  const hud = $('hud'), sbScore = $('sbScore'), sbBoxes = $('sbBoxes'), sbCombo = $('sbCombo');
  const rankEl = $('rank'), hintEl = $('hint'), pbEl = $('pb'), pbChip = $('pbChip'), popsEl = $('pops');
  const hudCache = {};
  function setText(el, key, v, bump) {
    if (hudCache[key] === v) return;
    const had = key in hudCache; hudCache[key] = v; el.textContent = v;
    if (bump && had) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
  function flash(op, col) { const f = $('flash'); f.style.setProperty('--fc', col || 'rgba(255,210,63,.55)'); f.animate([{ opacity: op }, { opacity: 0 }], { duration: 600, easing: 'ease-out' }); }
  const _sv = new THREE.Vector3();
  function toScreen(x, y, z) { _sv.set(x, y, z).project(camera); return { x: (_sv.x + 1) / 2 * cssW, y: (1 - _sv.y) / 2 * cssH }; }
  function pop(txt, sub, cls, x, y) {
    const s = toScreen(x, y, 0), el = document.createElement('div');
    el.className = 'pop' + (cls ? ' ' + cls : ''); el.innerHTML = '<b></b><span></span>';
    el.firstChild.textContent = txt; el.lastChild.textContent = sub || '';
    el.style.left = clamp(s.x, 110, cssW - 110) + 'px'; el.style.top = clamp(s.y, 150, cssH - 60) + 'px';
    popsEl.appendChild(el); setTimeout(() => el.remove(), 1200);
  }
  // live rank against everyone else's best on /api/leaderboard (same as the other 3D games)
  let lb = null, pbShown = false, lastRankTxt = '', pbTimer = 0, pbDelay = 0;
  async function loadBoard() {
    try {
      const d = await RG.api('/api/leaderboard?game=stack&riderId=' + encodeURIComponent(sh.rider.id));
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
  async function endBoard(score) {
    const over = $('over'); if (!over) return;
    let box = $('ovBoard');
    if (!box) { box = document.createElement('div'); box.id = 'ovBoard'; box.className = 'pboard'; over.insertBefore(box, over.querySelector('.row')); }
    box.innerHTML = ''; box.style.display = 'none';
    const res = sh.lastResult, runId = sh.runId;
    const l = await loadBoard(); if (!l || sh.state !== 'over' || runId !== sh.runId) return;
    const d = l.d, esc = RG.esc, top = d.top || [];
    const admin = !res || res.admin || !d.me;
    const me = admin ? { rank: 1 + top.filter((x) => x.score >= score).length, nickname: sh.rider.nick || 'You', riderId: sh.rider.id, score, test: true } : d.me;
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
  let hintT = 3;
  function updateHud(dt) {
    const st = sh.state;
    hud.classList.toggle('off', !(st === 'play' || st === 'countdown' || st === 'paused'));
    setText(sbScore, 'score', run.score.toLocaleString('en-US'), true);
    setText(sbBoxes, 'boxes', String(run.landed), true);
    setText(sbCombo, 'combo', 'x' + run.combo, run.combo > 0);
    sbCombo.classList.toggle('z', run.combo === 0);
    let rt = 'Score to rank';
    const lr = run.score > 0 ? liveRank(run.score) : null;
    if (lr) rt = '#' + lr.rank + (lr.plus ? '+' : '') + ' on the board';
    else if (run.score > 0) rt = run.score + ' points';
    if (rt !== lastRankTxt) {
      const improved = lastRankTxt.startsWith('#') && rt.startsWith('#') && parseInt(rt.slice(1), 10) < parseInt(lastRankTxt.slice(1), 10);
      lastRankTxt = rt; rankEl.textContent = rt;
      if (improved) { rankEl.classList.remove('up'); void rankEl.offsetWidth; rankEl.classList.add('up'); SFX.rank(); }
    }
    const pbt = lb && lb.best > 0 ? 'PB ' + lb.best : '';
    if (hudCache.pbt !== pbt) { hudCache.pbt = pbt; pbChip.textContent = pbt; pbChip.classList.toggle('hide', !pbt); }
    if (!pbShown && lb && lb.best > 0 && run.score > lb.best && st === 'play') { pbShown = true; pbDelay = 0.6; }
    hintT = Math.max(0, hintT - dt);
    hintEl.classList.toggle('hide', !(st === 'play' && run.landed === 0 && run.phase === 'swing' && hintT > 0));
  }

  // ---------- reacting to the core run ----------
  let landedSeen = 0, drop = null, shake = 0, punch = 0, dropTheta = 0, growAnim = null, pvVis = null;
  const topVis = () => (run.stack.length - 1) * HB;              // world y of the current stack top
  const hookPt = (th, pv, out) => out.set(ROPE * Math.sin(th), pv - ROPE * Math.cos(th), 0);
  function onDrop() {
    // the moment the core accepts a drop: the hanging box becomes a falling body (never attached to the cable)
    const f = run.fall, pv = pvVis, hp = hookPt(run.theta, pv, _p);
    const y0 = hp.y - SLING - HB / 2;
    dropTheta = run.theta; hang.visible = false; hintT = 0;
    SFX.release();
    if (run.phase === 'miss') {
      const top = S.currentTop(run), dir = Math.sign(f.x - top.x) || 1;
      spawnPiece(wx(f.x), y0, f.w * KX, dir * Math.max(0.9, Math.abs(f.vx * KX)), 0, -dir * 2.6, true);
      SFX.miss(); shake = 0.3;
      return;
    }
    drop = { x: wx(f.x), w: f.w * KX, y: y0, vy: 0, g: makeBox(f.w * KX), L: f.x - f.w / 2, R: f.x + f.w / 2 };
    drop.g.position.set(drop.x, y0, 0); scene.add(drop.g);
  }
  function onLand() {
    // core has already landed the box (instantly); finish the short visual fall, then slice
    const i = run.stack.length - 1, b = run.stack[i], y = (i - 1) * HB + HB / 2;
    const perfect = !!run.fall.perfect, keptW = run.fall.newW, grew = b.w > keptW + 1e-9;   // keptW: width before the growth bonus
    const fin = () => {
      if (drop) scene.remove(drop.g);
      const g = makeBox((grew ? keptW : b.w) * KX); g.position.set(wx(b.x), y, 0); stackGrp.add(g); boxes[i] = g;
      // overhang: whatever part of the dropped box lies outside the kept span falls away
      if (drop) {
        const kL = b.x - keptW / 2, kR = b.x + keptW / 2, cuts = [[drop.L, kL], [kR, drop.R]];
        let sliced = false;
        for (const [a, c] of cuts) if (c - a > 1) { sliced = true; const dir = a < kL ? -1 : 1; spawnPiece(wx((a + c) / 2), y, (c - a) * KX, dir * 0.9, -0.5, dir * -3.2, false); }
        if (sliced && !perfect) SFX.slice();
      }
      drop = null;
      if (perfect) {
        SFX.perfect(run.combo); ring(y - HB / 2 + 0.02, b.w * KX, true).h.position.set(wx(b.x), y, 0);
        rings[rings.length - 1].m.scale.set(b.w * KX + 0.04, HB + 0.04, BOX_D + 0.04);
        rings[rings.length - 2].m.position.x = wx(b.x);
        punch = 1; flash(0.35);
        pop('PERFECT! x' + run.combo, grew ? 'WIDTH UP!' : '+' + (C.PTS + C.PTS_COMBO * run.combo), grew ? 'grow' : '', wx(b.x), y + HB * 2.4);
        if (grew) { SFX.grow(); growAnim = { g, from: keptW * KX, to: b.w * KX, t: 0 }; burst(wx(b.x), y + HB / 2, 22, '#ffd23f'); }
      } else { SFX.land(); pop('+' + C.PTS, '', 'plain', wx(b.x), y + HB * 2); }
    };
    if (drop) drop.fin = fin; else fin();
  }
  function react() {
    if (run.landed > landedSeen) { landedSeen = run.landed; onLand(); }
    if (run.phase === 'over' && !ended) {
      ended = true;
      const n = run.landed;
      SFX.over();
      const p = sh.end(run.score, { title: n >= 20 ? 'Sky high!' : 'Game over', line: `${n} box${n === 1 ? '' : 'es'} stacked`, delay: 1000 });
      if (p && p.then) p.then(() => endBoard(run.score)).catch(() => {});
    }
  }
  function stepDrop(dt) {
    if (!drop) return;
    const i = run.stack.length - 1, rest = drop.fin ? (i - 1) * HB + HB / 2 : -1e9;
    drop.vy -= 30 * dt; drop.y += drop.vy * dt;
    if (drop.fin && drop.y <= rest) { drop.y = rest; const f = drop.fin; drop.fin = null; f(); return; }
    drop.g.position.y = drop.y;
  }
  function reset() {
    run = S.newRun(); ended = false; landedSeen = 0; drop = null; growAnim = null; shake = 0; punch = 0; hintT = 3; pvVis = null;
    for (const b of boxes) if (b) stackGrp.remove(b);
    boxes = [];
    for (const p of pieces) scene.remove(p.g);
    pieces.length = 0; hang.visible = true; popsEl.innerHTML = '';
    pbShown = false; lastRankTxt = ''; pbEl.classList.remove('show'); pbDelay = 0; pbTimer = 0;
    const box = $('ovBoard'); if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    loadBoard();
  }
  loadBoard();

  // ---------- input: tap / click, Space, Enter, gamepad button ----------
  let padHeld = false;
  function dropNow() { if (sh.state !== 'play' || run.over) return false; if (!S.drop(run)) return false; onDrop(); return true; }
  cv.addEventListener('pointerdown', (e) => { dropNow(); e.preventDefault(); });
  window.addEventListener('keydown', (e) => { if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && sh.state === 'play') { e.preventDefault(); dropNow(); } });
  function pollPad() {
    const pads = navigator.getGamepads && navigator.getGamepads();
    const p = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
    const pressed = !!(p && p.buttons[0] && p.buttons[0].pressed);
    if (pressed && !padHeld) dropNow();
    padHeld = pressed;
  }

  // ---------- per-frame drawing ----------
  let skyK = 0;
  const _c1 = new THREE.Color();
  function skyStep(dt) {
    const target = run.landed;                                   // 0 sunset, 15 twilight, 30 night, 50+ deep night
    skyK += (target - skyK) * Math.min(1, dt * 1.2);
    let i = 0; while (i < PAL.length - 2 && skyK > PAL[i + 1].n) i++;
    const a = PAL[i], b = PAL[i + 1], k = ease(clamp((skyK - a.n) / (b.n - a.n), 0, 1));
    skyU.top.value.copy(a.top).lerp(b.top, k); skyU.mid.value.copy(a.mid).lerp(b.mid, k); skyU.hor.value.copy(a.hor).lerp(b.hor, k);
    key.color.copy(a.key).lerp(b.key, k); hemi.color.copy(a.hemi).lerp(b.hemi, k);
    const night = clamp((skyK - 12) / 25, 0, 1);
    key.intensity = lerp(2.1, 1.3, night); hemi.intensity = lerp(1.5, 1.05, night);
    starMat.opacity = night * (qual === 0 ? 0.6 : 0.9); moon.material.opacity = night;
    sun.material.opacity = 1 - clamp(skyK / 14, 0, 1);
    const win = lerp(a.win, b.win, k);
    for (const L of skyline) for (const m of L.mats) m.color.copy(m.userData.tint).multiplyScalar(win);
    _c1.copy(a.cloud).lerp(b.cloud, k);
    for (const c of clouds) { c.material.color.copy(_c1); c.material.opacity = lerp(0.8, 0.35, night); }
    scene.fog.color.copy(skyU.hor.value).lerp(skyU.mid.value, 0.5);
  }
  const _pv = new THREE.Vector3();
  function drawRig(dt) {
    const pvT = topVis() + GAPV + HB + SLING + ROPE;              // hanging box bottom clears the stack top by GAPV at the vertex
    pvVis = pvVis == null ? pvT : pvVis + (pvT - pvVis) * Math.min(1, dt * 10);
    beam.position.set(0, pvVis, 0);
    let th = run.theta;
    if (run.phase === 'fall' || run.phase === 'settle') {         // empty hook eases over to the next start side
      const k = run.phase === 'settle' ? ease(run.settleT / C.SETTLE) : 0;
      th = lerp(dropTheta, -run.side * S.ampOf(run.landed), k);
    }
    const P = _pv.set(0, pvVis, 0), hp = hookPt(th, pvVis, new THREE.Vector3());
    const blk = new THREE.Vector3(Math.sin(th), -Math.cos(th), 0).multiplyScalar(ROPE - 0.36 * 1.35).add(P);
    rod(cable, P, blk);
    hookBlock.position.copy(blk); hookBlock.rotation.z = th;
    const swinging = run.phase === 'swing' && !run.over;
    hang.visible = swinging;
    if (swinging) {
      if (Math.abs(hang.userData.w - run.boxW * KX) > 1e-6) setBoxW(hang, run.boxW * KX);
      const tilt = th * 0.06;
      hang.position.set(hp.x, hp.y - SLING - HB / 2, 0); hang.rotation.z = tilt;   // centre x == core box x
      const hw = run.boxW * KX / 2 * 0.8;
      for (let s = 0; s < 2; s++) {
        const c = new THREE.Vector3(s ? hw : -hw, HB / 2, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), tilt).add(hang.position);
        rod(slings[s], hp, c); slings[s].visible = true;
      }
    } else slings.forEach((m) => { m.visible = false; });
  }
  // camera: slight 3/4 view, tracks up with the stack; punch on perfects, shake on a miss
  const camLook = new THREE.Vector3(0, 1, 0);
  let camY = null;
  function camStep(dt, t) {
    let ty = Math.max(0.9, topVis() + 1.15);
    const miss = pieces.find((p) => p.miss);
    if (miss && run.phase !== 'swing') ty = Math.max(ty - 3.2, miss.g.position.y + 1.5, 0.9);   // glance down as it tumbles past
    camY = camY == null ? ty : camY + (ty - camY) * Math.min(1, dt * (miss ? 2.2 : 3.2));
    const idle = sh.state === 'ready' ? Math.sin(t * 0.4) * 0.6 : 0;
    punch = Math.max(0, punch - dt * 3.2); shake = Math.max(0, shake - dt);
    const pk = Math.sin(Math.min(1, punch) * Math.PI) * 0.35;
    camLook.set(0.15, camY, 0);
    camera.position.set(1.9 + idle, camY + 1.0, camDist * (1 - pk * 0.04));
    if (shake > 0) { const s = shake * 0.22; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; }
    camera.lookAt(camLook);
    // the skyline sinks slower than the stack climbs (parallax), so the city stays behind the tower
    for (let i = 0; i < clouds.length; i++) { const c = clouds[i]; c.position.y = 16 + (i % 3) * 12 + camY * 0.85; c.position.x = -90 + i * 32 + Math.sin(t * 0.03 + i) * 6; }
    sky.position.y = camY;
  }

  // ---------- quality governor: drop resolution/effects if the device can't hold ~60 fps ----------
  let fpsFrames = 0, fpsMs = 0, fpsAvg = 0, lastMs = performance.now(), warm = 0;
  function setQuality(q) {
    qual = q;
    clouds.forEach((c, i) => { c.visible = q > 0 || i % 2 === 0; });
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
  let mutedSeen = null, held = false;
  function frame(dt, t) {
    governor();
    if (held) dt = 0;
    pollPad();
    if (sh.state === 'play' && !ended && !held) { S.step(run, dt); react(); }
    stepDrop(dt); updatePieces(dt); updateRings(dt); updateSparks(dt);
    if (growAnim) { growAnim.t += dt; const k = ease(growAnim.t / 0.3); setBoxW(growAnim.g, lerp(growAnim.from, growAnim.to, k)); if (growAnim.t >= 0.3) growAnim = null; }
    skyStep(dt); drawRig(dt); camStep(dt, t);
    if (AU.master && mutedSeen !== RG.muted) { mutedSeen = RG.muted; AU.master.gain.setTargetAtTime(RG.muted ? 0 : 0.85, AU.ctx.currentTime, 0.03); }
    if (pbDelay > 0) { pbDelay -= dt; if (pbDelay <= 0) { pbEl.classList.add('show'); pbTimer = 2.4; SFX.pb(); } }
    if (pbTimer > 0) { pbTimer -= dt; if (pbTimer <= 0) pbEl.classList.remove('show'); }
    updateHud(dt);
    renderer.render(scene, camera);
  }
  RG.loop((dt, now) => frame(dt, now / 1000));

  // ---------- test hooks (Playwright / Arcade QA) ----------
  window.__stack = {
    state: () => ({ score: run.score, landed: run.landed, combo: run.combo, perfects: run.perfects, phase: run.phase, over: run.over, t: run.t, boxW: run.boxW, theta: run.theta }),
    drop: dropNow, renderer: '3d',
    quality: () => qual, setQuality: (q) => setQuality(q), fps: () => fpsAvg,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixelRatio: renderer.getPixelRatio(), quality: qual, fov: baseFov, pieces: pieces.length, boxes: boxes.filter(Boolean).length, rings: rings.length }),
  };
  // deterministic helpers for the QA scripts only (?qa); absent in normal play
  if (/[?&]qa\b/.test(location.search)) {
    window.__stack.hold = (v) => { held = !!v; };
    // place the swinging box `off` core units from the stack centre (as if tapped at that instant), then drop
    window.__stack.aim = (off) => {
      if (sh.state !== 'play' || run.phase !== 'swing') return false;
      const top = S.currentTop(run), s = clamp((top.x + off - C.PIVOT_X) / C.ARM, -1, 1);
      run.theta = Math.asin(s); drawRig(0); return true;
    };
    window.__stack.aimDrop = (off) => window.__stack.aim(off) && dropNow();
    // geometry read-back for alignment checks: bag top, stack boxes, hanging box vs core x, hook point
    window.__stack.geo = () => {
      const top = S.currentTop(run), hp = hookPt(run.theta, pvVis, new THREE.Vector3()), bp = S.boxPos(run);
      return {
        bagTopY: 0, bagW: BAG_W, stack: run.stack.slice(1).map((b, i) => ({ coreX: b.x, coreW: b.w, x: boxes[i + 1] ? boxes[i + 1].position.x : null, w: boxes[i + 1] ? boxes[i + 1].userData.w : null, y: boxes[i + 1] ? boxes[i + 1].position.y : null })),
        hang: { visible: hang.visible, x: hang.position.x, coreX: wx(bp.x), w: hang.userData.w, coreW: run.boxW * KX, hookX: hp.x, hookY: hp.y, topY: hang.position.y + HB / 2 },
        cable: { pos: cable.position.toArray(), len: cable.scale.y, block: hookBlock.position.toArray() },
        topX: wx(top.x), pieces: pieces.map((p) => ({ miss: p.miss, y: p.g.position.y, w: p.w })),
      };
    };
    window.__stack.screen = (x, y, z) => toScreen(x, y, z || 0);
  }
})();

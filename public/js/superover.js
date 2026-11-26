// Super Over: 3D floodlit-oval renderer (three.js). Rules, deliveries, timing windows and scoring
// all live in superover-core.js and are untouched; this file only draws them and maps the tap.
//
// World: the batter's stumps sit at z = +0.25 and the bowler runs in from -z. A core ball state
// (x lateral, h height, d distance from the bat end) is drawn at (x, h + BR, -d).
import * as THREE from '/vendor/three.min.js?v=5';

(function main() {
  'use strict';
  const SO = window.SuperOver, C = SO.C, RG = window.RG;
  const BR = 0.07;                                         // drawn ball radius (real 0.036, enlarged to read on a phone)
  const STUMP_Z = -C.STUMP_D, FAR_Z = STUMP_Z - 20.12, POP_Z = STUMP_Z - 1.22, FAR_POP_Z = FAR_Z + 1.22;
  const BOUND_R = 64, OVAL_Z = -10;                        // boundary rope radius, oval centre (towards the bowler)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const $ = (id) => document.getElementById(id);
  const qParam = new URLSearchParams(location.search).get('q');   // high | low | (auto)

  // ---------- game shell ----------
  let ended = false;
  const game = SO.createGame({ on: (ev, d) => onEvent(ev, d) });
  const sh = RG.shell({
    game: 'superover', title: '<span class="kick"><img class="tlogo" src="/img/talabat-logo.png" alt="talabat" width="69" height="24">RIDER CUP</span>Super Over',
    how: '• <b>Tap</b> (or press Space) to swing as the ball reaches your bat.<br>• Perfect timing hits a <b>SIX</b>, good timing a <b>FOUR</b>, early or late gets 1 or 2.<br>• Miss badly or don\'t swing and you\'re <b>out</b>. 2 wickets and it\'s game over.<br>• Score each over\'s <b>target</b>, or you lose a wicket. Targets start at 12, 15 and 17 and climb each over; from over 4 a SIX needs tighter timing. Bowling gets faster and trickier every over.',
    onReset: () => reset(), onStart: () => { game.nextBall(800); SFX.start(); },
    // Auto-pause: a ball in flight is re-bowled (not counted), so hiding the tab never costs a wicket.
    onPause: () => game.pause(performance.now()),
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
  const FOG = new THREE.Color('#0a0f1f');
  scene.background = new THREE.Color('#03050b');
  scene.fog = new THREE.Fog(FOG, 110, 300);
  const camera = new THREE.PerspectiveCamera(50, 0.5, 0.1, 700);
  // Broadcast camera: behind and above the batter, a touch to the off side, looking down the pitch.
  const BASE_POS = new THREE.Vector3(0.8, 3.3, 6.3), BASE_LOOK = new THREE.Vector3(-0.1, 0.3, -15);
  let cssW = 360, cssH = 700, baseFov = 50;
  function resize() {
    const r = cv.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    // portrait phones get the full vertical frame; wider screens keep the same horizontal coverage-ish
    baseFov = camera.aspect < 0.75 ? 50 : camera.aspect < 1.2 ? 44 : 38;
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

  // ---------- logo + fonts ----------
  const fontsReady = document.fonts ? Promise.race([Promise.all(['500 40px Poppins', '700 40px Poppins', '900 40px Poppins'].map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}) : Promise.resolve();
  // official logo (cream wordmark on the orange flag): always drawn at its own aspect ratio, never recoloured
  const LOGO = new Image(); LOGO.src = '/img/talabat-logo.png';
  const LOGO_AR = 420 / 146;
  const logoReady = (LOGO.decode ? LOGO.decode() : new Promise((r) => { LOGO.onload = r; })).catch(() => {});
  const assetsReady = Promise.all([fontsReady, logoReady]);
  const logoOk = () => LOGO.complete && LOGO.naturalWidth > 0;
  function drawLogo(g, cx0, cy0, h) { if (!logoOk()) return; const w = h * LOGO.naturalWidth / LOGO.naturalHeight; g.drawImage(LOGO, cx0 - w / 2, cy0 - h / 2, w, h); }

  // ---------- outfield, pitch strip, boundary ----------
  const OF_R = 84;
  function drawOutfield(g, W) {
    const k = W / (OF_R * 2), px = (x) => (x + OF_R) * k, pz = (z) => (z - OVAL_Z + OF_R) * k;
    g.fillStyle = '#123d1d'; g.fillRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(px(0), pz(OVAL_Z), (BOUND_R + 1.5) * k, 0, 7); g.clip();
    for (let x = -OF_R, i = 0; x < OF_R; x += 4.5, i++) { g.fillStyle = i % 2 ? '#22743a' : '#2b8645'; g.fillRect(px(x), 0, 4.5 * k + 1, W); }
    g.fillStyle = 'rgba(0,0,0,.06)';
    for (let z = OVAL_Z - OF_R, i = 0; z < OVAL_Z + OF_R; z += 9, i++) if (i % 2) g.fillRect(0, pz(z), W, 9 * k);
    for (let i = 0; i < 30000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.07)' : 'rgba(190,255,170,.05)'; g.fillRect(Math.random() * W, Math.random() * W, 2, 2 + Math.random() * 3); }
    for (const [x, z, r, a] of [[-30, -60, 46, 0.16], [30, -60, 46, 0.16], [0, -10, 40, 0.12], [-52, -10, 34, 0.1], [52, -10, 34, 0.1]]) {
      const gr = g.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), r * k);
      gr.addColorStop(0, `rgba(255,250,225,${a})`); gr.addColorStop(1, 'rgba(255,250,225,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, W);
    }
    g.restore();
    // 30-yard circle (dashed) around the pitch
    g.strokeStyle = 'rgba(246,250,255,.75)'; g.lineWidth = 0.14 * k; g.setLineDash([1.2 * k, 1.6 * k]);
    g.beginPath(); g.arc(px(0), pz((STUMP_Z + FAR_Z) / 2), 27.4 * k, 0, 7); g.stroke(); g.setLineDash([]);
    // worn square around the strip
    g.fillStyle = 'rgba(160,140,80,.16)'; g.fillRect(px(-6), pz(FAR_Z - 2.5), 12 * k, (STUMP_Z - FAR_Z + 5) * k);
  }
  const ofTex = canvasTex(2048, 2048, drawOutfield);
  const outfield = new THREE.Mesh(new THREE.PlaneGeometry(OF_R * 2, OF_R * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ofTex }));
  outfield.position.set(0, 0, OVAL_Z); scene.add(outfield);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0b1a10' }));
  surround.position.y = -0.03; scene.add(surround);
  const STRIP_L = 26, STRIP_W = 3.05, STRIP_ZC = (STUMP_Z + FAR_Z) / 2;
  function drawStrip(g, W, H) {
    const k = W / STRIP_W, px = (x) => (x + STRIP_W / 2) * k, pz = (z) => (z - (STRIP_ZC - STRIP_L / 2)) * k;
    g.fillStyle = '#c8b27c'; g.fillRect(0, 0, W, H);
    const ed = g.createLinearGradient(0, 0, W, 0); ed.addColorStop(0, '#a99a5e'); ed.addColorStop(0.12, 'rgba(0,0,0,0)'); ed.addColorStop(0.88, 'rgba(0,0,0,0)'); ed.addColorStop(1, '#a99a5e');
    g.fillStyle = ed; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(90,70,30,.12)' : 'rgba(255,245,210,.1)'; g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    // wear: footmarks and the bowlers' landing areas
    for (const [z, s] of [[POP_Z, 1], [FAR_POP_Z, -1]]) {
      for (let i = 0; i < 40; i++) {
        const x = (Math.random() - 0.5) * 1.6, zz = z + s * (Math.random() * 1.6 - 0.3);
        const gr = g.createRadialGradient(px(x), pz(zz), 0, px(x), pz(zz), (0.15 + Math.random() * 0.2) * k);
        gr.addColorStop(0, 'rgba(120,96,50,.45)'); gr.addColorStop(1, 'rgba(120,96,50,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
    }
    for (let i = 0; i < 14; i++) { const zz = STRIP_ZC + (Math.random() - 0.5) * 9, gr = g.createRadialGradient(px(0), pz(zz), 0, px(0), pz(zz), 0.45 * k); gr.addColorStop(0, 'rgba(150,120,60,.25)'); gr.addColorStop(1, 'rgba(150,120,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    g.fillStyle = 'rgba(250,250,245,.95)';
    const ln = (x0, z0, x1, z1) => g.fillRect(px(Math.min(x0, x1)) - 0.025 * k, pz(Math.min(z0, z1)) - 0.025 * k, Math.abs(x1 - x0) * k + 0.05 * k, Math.abs(z1 - z0) * k + 0.05 * k);
    for (const [bz, pz0, s] of [[STUMP_Z, POP_Z, -1], [FAR_Z, FAR_POP_Z, 1]]) {
      ln(-1.52, pz0, 1.52, pz0);                 // popping crease
      ln(-1.32, bz, 1.32, bz);                   // bowling crease
      for (const x of [-1.32, 1.32]) ln(x, pz0, x, bz - s * 1.22);   // return creases
    }
  }
  const stripTex = canvasTex(256, 2048 * STRIP_L / 24.3 | 0, drawStrip);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(STRIP_W, STRIP_L).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: stripTex }));
  strip.position.set(0, 0.006, STRIP_ZC); scene.add(strip);
  const rope = new THREE.Mesh(new THREE.RingGeometry(BOUND_R - 0.1, BOUND_R + 0.1, 180).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f4f4f4' }));
  rope.position.set(0, 0.03, OVAL_Z); scene.add(rope);
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
  const ledTexes = [], LED_BASE = 0.9, boards = [];
  // a board on the oval: centre angle th (0 = straight down the ground behind the bowler), facing the middle
  function ledBoard(w, h, r, th, y) {
    const t1 = ledTex.clone(); t1.repeat.set(w / (h * LED_W / LED_H), 1); t1.needsUpdate = true; ledTexes.push(t1);
    const mat = new THREE.MeshBasicMaterial({ map: t1, color: new THREE.Color(LED_BASE, LED_BASE, LED_BASE) });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), [darkMat, darkMat, darkMat, darkMat, mat, darkMat]);
    m.position.set(Math.sin(th) * r, y, OVAL_Z - Math.cos(th) * r); m.rotation.y = -th; scene.add(m);
    boards.push({ mat, t1 });
  }
  const SIGHT = 0.085, ARC = 2.05;                          // sight-screen half-angle, stand half-arc (rad)
  {
    const r = BOUND_R + 2.6, n = 46, dt = (2 * ARC) / n, w = 2 * r * Math.sin(dt / 2) + 0.05;
    for (let i = 0; i < n; i++) { const th = -ARC + (i + 0.5) * dt; if (Math.abs(th) > SIGHT) ledBoard(w, 0.95, r, th, 0.48); }
  }
  assetsReady.then(() => {
    drawLed(ledTex.image.getContext('2d'), LED_W, LED_H);
    ledTexes.forEach((t) => { t.needsUpdate = true; });
  });

  // ---------- stands: two tiers round the oval, LED ribbon between them, roof with lamp line ----------
  const ST_R = BOUND_R + 6, ROW_D = 0.95, LOW_N = 10, UP_N = 12, UP_R = ST_R + LOW_N * ROW_D + 1.2, crowdSpots = [];
  const lowY = (k) => 0.9 + k * 0.5, upY = (k) => 7.2 + k * 0.62, ROOF_Y = upY(UP_N) + 3.6, ROOF_R = UP_R + UP_N * ROW_D;
  {
    const parts = [], NS = 40, dth = (2 * ARC) / NS;
    const add = (th, r, y, h, d, col, wScale) => {
      const w = 2 * r * Math.sin(dth / 2) * (wScale || 1.03);
      parts.push(part(new THREE.BoxGeometry(w, h, d), col, [Math.sin(th) * r, y, OVAL_Z - Math.cos(th) * r], [0, -th, 0]));
    };
    for (let i = 0; i < NS; i++) {
      const th = -ARC + (i + 0.5) * dth;
      add(th, ST_R - 0.3, 0.6, 1.2, 0.5, '#10141f');
      for (let k = 0; k < LOW_N; k++) add(th, ST_R + k * ROW_D + ROW_D / 2, lowY(k) - 0.25, 0.5, ROW_D, k % 2 ? '#1a2030' : '#222a3c');
      add(th, UP_R - 0.7, 5.4, 3.6, 1.4, '#0d1220');                       // concourse face (LED ribbon sits on it)
      for (let k = 0; k < UP_N; k++) add(th, UP_R + k * ROW_D + ROW_D / 2, upY(k) - 0.31, 0.62, ROW_D, k % 2 ? '#1b2132' : '#242c40');
      add(th, ROOF_R + 0.5, (ROOF_Y + 1) / 2, ROOF_Y + 1, 1, '#0b0e17');    // back wall
      add(th, ROOF_R - 4, ROOF_Y, 0.5, 10, '#0c0f19');                      // roof
      add(th, ROOF_R - 9, ROOF_Y - 0.3, 0.9, 0.35, '#1b2133');              // fascia
      add(th, ROOF_R - 9, ROOF_Y - 0.8, 0.1, 0.37, '#ff5a00');
      // seats -> crowd spots (the sight screen gap stays empty in the lower tier)
      for (const [N, R0, yf, low] of [[LOW_N, ST_R, lowY, true], [UP_N, UP_R, upY, false]]) {
        for (let k = 0; k < N; k++) {
          const rr = R0 + k * ROW_D + 0.3, y = yf(k), step = 0.62 / rr;
          for (let a = th - dth / 2 + step / 2; a < th + dth / 2; a += step) {
            if (low && Math.abs(a) < SIGHT + 0.02) continue;
            if (Math.random() < 0.07) continue;
            crowdSpots.push([Math.sin(a) * rr, y, OVAL_Z - Math.cos(a) * rr, a, 0.92 + Math.random() * 0.16]);
          }
        }
      }
    }
    // sight screen behind the bowler
    parts.push(part(new THREE.BoxGeometry(2 * (BOUND_R + 3) * Math.sin(SIGHT) * 1.05, 5, 0.6), '#121a2c', [0, 2.5, OVAL_Z - (BOUND_R + 3.4)]));
    scene.add(new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true })));
    for (let i = 0; i < 30; i++) { const d = (2 * ARC) / 30, th = -ARC + (i + 0.5) * d; ledBoard(2 * (UP_R - 1.52) * Math.sin(d / 2) + 0.04, 1.3, UP_R - 1.52, th, 5.6); }
  }
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
        vFog = smoothstep(70.0, 260.0, -mv.z);
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
    // shuffle so the quality governor's lower instance count thins the whole bowl evenly
    for (let i = crowdSpots.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = crowdSpots[i]; crowdSpots[i] = crowdSpots[j]; crowdSpots[j] = t; }
    crowdSpots.forEach(([x, y, z, a, s], i) => {
      _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(Yv, -a), _s.set(s, s, s)); crowd.setMatrixAt(i, _m);
      crowd.setColorAt(i, col.set(pal[(Math.random() * pal.length) | 0]).multiplyScalar(0.75 + Math.random() * 0.25));
    });
    crowd.frustumCulled = false; scene.add(crowd);
  }
  const CROWD_N = crowdSpots.length;

  // ---------- floodlight towers ----------
  const beams = [], glows = [];
  {
    const panelTex = canvasTex(128, 96, (g, W, H) => {
      g.fillStyle = '#20263a'; g.fillRect(0, 0, W, H);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) { g.fillStyle = '#fffdf2'; g.fillRect(5 + c * 17.5, 5 + r * 18, 14, 14); }
    });
    const beamTex = canvasTex(8, 128, (g, W, H) => {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,248,225,.0)'); gr.addColorStop(0.6, 'rgba(255,248,225,.3)'); gr.addColorStop(1, 'rgba(255,248,225,1)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    });
    const panelMat = new THREE.MeshBasicMaterial({ map: panelTex, fog: false });
    const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: '#fff1d6', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    const towerParts = [];
    for (const [th, r, h] of [[-0.2, 104, 34], [0.2, 104, 34], [-0.75, 100, 44], [0.75, 100, 44], [-1.35, 96, 44], [1.35, 96, 44]]) {
      const x = Math.sin(th) * r, z = OVAL_Z - Math.cos(th) * r;
      towerParts.push(seg([x, 0, z], [x, h - 2, z], 1.3, 0.55, '#1a1f2e', 8));
      for (let y = 4; y < h - 4; y += 4) towerParts.push(part(new THREE.BoxGeometry(2.2, 0.15, 2.2), '#232a3d', [x, y, z], [0, -th, 0]));
      const pos = new THREE.Vector3(x, h, z), tgt = new THREE.Vector3(x * 0.15, 0, -8 + (z + 8) * 0.15);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(8, 5.2, 0.4), panelMat);
      panel.position.copy(pos); panel.lookAt(tgt); scene.add(panel);
      const sp = new THREE.Sprite(glowMat); sp.position.copy(pos).addScaledVector(tgt.clone().sub(pos).normalize(), 1.5); sp.scale.set(30, 30, 1); scene.add(sp); glows.push(sp);
      const dir = pos.clone().sub(tgt), L = dir.length();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 26, L, 18, 1, true), beamMat);
      beam.position.copy(pos).add(tgt).multiplyScalar(0.5); beam.quaternion.setFromUnitVectors(Yv, dir.normalize());
      scene.add(beam); beams.push(beam);
    }
    scene.add(new THREE.Mesh(merge(towerParts), new THREE.MeshLambertMaterial({ vertexColors: true })));
    // lamp line under the roof fascia
    const lampMat = new THREE.SpriteMaterial({ map: glowTex, color: '#ffe2b8', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    for (let a = -ARC + 0.02; a < ARC; a += 0.035) { const rr = ROOF_R - 9.2, sp = new THREE.Sprite(lampMat); sp.position.set(Math.sin(a) * rr, ROOF_Y - 1.1, OVAL_Z - Math.cos(a) * rr); sp.scale.set(2.2, 2.2, 1); scene.add(sp); }
  }
  // ---------- players ----------
  const KIT = {
    bat: { shirt: '#ff5a00', trim: '#ffffff', shorts: '#17171c', thigh: '#17171c', socks: '#17171c', boots: '#f4f4f4', skin: '#b97a50', hair: '#1a120c', glove: '#f4f4f4', pads: true },
    bowl: { shirt: '#2152d8', trim: '#ffffff', shorts: '#eeeeee', thigh: '#eeeeee', socks: '#eeeeee', boots: '#f4f4f4', skin: '#8d5a3b', hair: '#140c08' },
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
  function rig(k) {
    const mk = (parts) => new THREE.Mesh(merge(parts), charMat);
    const root = new THREE.Group(), hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    hips.add(mk([part(new THREE.BoxGeometry(0.4, 0.2, 0.25), k.shorts, [0, 0, 0])]));
    const torso = new THREE.Group(); torso.position.y = 0.07; hips.add(torso);
    torso.add(mk(torsoParts(k, 0)));
    const legs = [], knees = [], arms = [], elbows = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(0.11 * sx, -0.04, 0); hips.add(leg);
      leg.add(mk([seg([0, 0.03, 0], [0, -0.14, 0], 0.1, 0.1, k.shorts), seg([0, -0.1, 0], [0, -0.44, 0], 0.088, 0.068, k.thigh || k.skin)]));
      const knee = new THREE.Group(); knee.position.y = -0.44; leg.add(knee);
      knee.add(mk([...(k.pads ? [part(new THREE.BoxGeometry(0.17, 0.48, 0.13), '#f4f4f4', [0, -0.19, 0.05]), part(new THREE.BoxGeometry(0.18, 0.13, 0.15), '#f4f4f4', [0, 0.05, 0.06]), part(new THREE.BoxGeometry(0.02, 0.44, 0.02), '#d9d9d9', [0.045, -0.19, 0.12]), part(new THREE.BoxGeometry(0.02, 0.44, 0.02), '#d9d9d9', [-0.045, -0.19, 0.12])] : []), seg([0, 0, 0], [0, -0.4, 0], 0.065, 0.05, k.socks), part(new THREE.BoxGeometry(0.12, 0.09, 0.27), k.boots, [0, -0.43, 0.04])]));
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
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  function blob(sz) { const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz).rotateX(-Math.PI / 2), blobMat); m.position.y = 0.012; scene.add(m); return m; }
  // batter: RIDER 10, helmet, pads, gloves; stands on the leg side just behind the popping crease
  const batter = rig(KIT.bat);
  const BAT_X = -0.5, BAT_Z = POP_Z + 0.42, BAT_ROT = Math.PI / 2 + 0.25;   // side-on: chest to the off side, left shoulder to the bowler
  batter.root.position.set(BAT_X, 0, BAT_Z); batter.root.rotation.y = BAT_ROT;
  const batShadow = blob(1.4); batShadow.position.set(BAT_X, 0.012, BAT_Z);
  {
    const H = 0.74, parts = [
      part(new THREE.SphereGeometry(0.138, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), '#1b2a5a', [0, H + 0.025, -0.01]),
      part(new THREE.BoxGeometry(0.21, 0.018, 0.1), '#1b2a5a', [0, H + 0.06, 0.12], [-0.12, 0, 0]),
      part(new THREE.SphereGeometry(0.05, 8, 6), '#1b2a5a', [-0.12, H - 0.02, 0], 0, [0.5, 1, 1]),
      part(new THREE.SphereGeometry(0.05, 8, 6), '#1b2a5a', [0.12, H - 0.02, 0], 0, [0.5, 1, 1]),
      part(new THREE.BoxGeometry(0.16, 0.022, 0.012), '#ff5a00', [0, H + 0.1, -0.13], [0.5, 0, 0]),
    ];
    for (const y of [-0.075, -0.035, 0.005]) parts.push(part(new THREE.BoxGeometry(0.2, 0.012, 0.012), '#c9ced8', [0, H + y, 0.135]));
    for (const x of [-0.05, 0, 0.05]) parts.push(part(new THREE.BoxGeometry(0.012, 0.1, 0.012), '#c9ced8', [x, H - 0.035, 0.137]));
    batter.torso.add(new THREE.Mesh(merge(parts), charMat));
    // same shirt for everyone: RIDER 10 on the batter's back (faces the broadcast camera)
    const paint = (g) => {
      g.clearRect(0, 0, 128, 128); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 17px Poppins'; g.fillText('RIDER', 64, 20);
      g.font = '900 72px Poppins'; g.fillText('10', 64, 78);
    };
    const t = canvasTex(128, 128, paint);
    fontsReady.then(() => { paint(t.image.getContext('2d')); t.needsUpdate = true; });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false }));
    back.position.set(0, 0.32, -0.135); back.rotation.y = Math.PI; batter.torso.add(back);
  }
  // the bat lives in the batter's root space (x = toward the bowler, z = in front of the chest) and is posed
  // by keyframes that keep the whole blade in front of the body; both arms reach the handle by IK
  const batPivot = new THREE.Group(); batter.root.add(batPivot);
  batPivot.add(new THREE.Mesh(merge([
    seg([0, 0.14, 0], [0, -0.2, 0], 0.017, 0.017, '#151515', 8),
    part(new THREE.BoxGeometry(0.108, 0.64, 0.042), '#e9d5a1', [0, -0.52, 0]),
    part(new THREE.BoxGeometry(0.05, 0.58, 0.03), '#d8bf86', [0, -0.51, -0.03]),
    part(new THREE.BoxGeometry(0.11, 0.07, 0.044), '#ff5a00', [0, -0.3, 0]),
  ]), charMat));
  const ARM_S = 1.12; batter.arms.forEach((a) => a.scale.setScalar(ARM_S));
  const bowler = rig(KIT.bowl);
  const BOWL_X = 0.57, RUN_LEN = 7;           // right-arm bowler: the bowling shoulder passes over x = 0.35 (core release line)
  const bowlShadow = blob(1.3);

  // ---------- stumps (both ends) + lit bails ----------
  const stumpMat = new THREE.MeshLambertMaterial({ color: '#efe6cf' });
  const bailMat = new THREE.MeshBasicMaterial({ color: '#ffb000' });
  function stumps(z) {
    const g = new THREE.Group(); g.position.set(0, 0, z); scene.add(g);
    const pcs = [];
    for (const x of [-0.105, 0, 0.105]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8).translate(0, 0.36, 0), stumpMat); m.position.x = x; g.add(m); pcs.push(m); }
    for (const x of [-0.053, 0.053]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.105, 6).rotateZ(Math.PI / 2), bailMat); m.position.set(x, 0.735, 0); g.add(m); pcs.push(m); }
    pcs.forEach((m) => { m.userData.p0 = m.position.clone(); m.userData.v = new THREE.Vector3(); m.userData.w = new THREE.Vector3(); });
    return { g, pcs, live: false };
  }
  const myStumps = stumps(STUMP_Z), farStumps = stumps(FAR_Z);
  function stumpsReset(s) { s.live = false; s.pcs.forEach((m) => { m.position.copy(m.userData.p0); m.rotation.set(0, 0, 0); }); bailMat.color.set('#ffb000'); }
  function stumpsBlow(s, side) {
    s.live = true;
    s.pcs.forEach((m, i) => {
      const bail = i >= 3, k = bail ? 1.6 : 1;
      m.userData.v.set((m.position.x * 9 + side * 0.4 + (Math.random() - 0.5)) * k, (bail ? 3.2 : 1.6) + Math.random() * 1.4, (1.6 + Math.random() * 2.2) * k);
      m.userData.w.set(3 + Math.random() * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    });
  }
  function stumpsStep(s, dt) {
    if (!s.live) return;
    s.pcs.forEach((m, i) => {
      const u = m.userData; if (m.position.y <= 0 && i < 3 && u.v.y <= 0 && Math.abs(m.rotation.x) > 1.4) return;
      u.v.y -= 9.8 * dt; m.position.addScaledVector(u.v, dt);
      m.rotation.x += u.w.x * dt; m.rotation.y += u.w.y * dt; m.rotation.z += u.w.z * dt;
      if (m.position.y < 0.02) { m.position.y = 0.02; u.v.multiplyScalar(0.35); u.v.y = Math.abs(u.v.y) * 0.3; u.w.multiplyScalar(0.5); if (i < 3) m.rotation.x = clamp(m.rotation.x, -1.57, 1.57); }
    });
  }

  // ---------- ball: red leather with a white seam, shadow, glow, dashed trail ----------
  const ballTex = canvasTex(128, 64, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#8e0c14'); gr.addColorStop(0.5, '#c8141e'); gr.addColorStop(1, '#8e0c14');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f6efe2'; g.fillRect(0, H / 2 - 2, W, 4);
    g.fillStyle = 'rgba(255,255,255,.7)'; for (let x = 0; x < W; x += 6) { g.fillRect(x, H / 2 - 6, 3, 2); g.fillRect(x, H / 2 + 4, 3, 2); }
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BR, 18, 12), new THREE.MeshLambertMaterial({ map: ballTex, emissive: new THREE.Color('#3a0003') }));
  scene.add(ball);
  const ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb4a0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  ballGlow.scale.set(0.42, 0.42, 1); ball.add(ballGlow);
  const ballShadow = blob(0.34);
  const TRAIL = 16, trailPos = new Float32Array(TRAIL * 3).fill(-50), trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
  const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ size: 0.075, map: glowTex, color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  trail.frustumCulled = false; scene.add(trail);
  let trailPts = [], trailClock = 0;
  function trailPush(p, dt) {
    trailClock += dt; if (trailClock < 0.028) return; trailClock = 0;
    trailPts.push(p.x, p.y, p.z); if (trailPts.length > TRAIL * 3) trailPts.splice(0, 3);
  }
  function trailUpdate() { trailPos.fill(-50); trailPos.set(trailPts); trailGeo.attributes.position.needsUpdate = true; }
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
  const SFX = {
    start: () => swell(0.2, 0.8),
    whoosh: () => nz({ f: 700, f2: 2400, q: 0.7, d: 0.16, v: 0.14 }),
    release: () => nz({ f: 900, f2: 1800, q: 0.8, d: 0.12, v: 0.05 }),
    bounce: () => { nz({ type: 'lowpass', f: 700, d: 0.05, v: 0.3 }); os({ f: 120, f2: 70, d: 0.06, v: 0.18 }); },
    // willow crack: brighter and louder the better the timing
    bat: (runs) => {
      const k = runs >= 6 ? 1 : runs >= 4 ? 0.85 : 0.6, f = runs >= 6 ? 1350 : runs >= 4 ? 1100 : 760;
      nz({ type: 'highpass', f: 1800 + runs * 150, d: 0.05 + 0.02 * k, v: 0.55 * k }); os({ type: 'triangle', f, f2: f * 0.45, d: 0.09, v: 0.45 * k }); os({ f: f * 2.7, d: 0.05, v: 0.12 * k });
    },
    edge: () => { os({ type: 'triangle', f: 1900, f2: 1200, d: 0.05, v: 0.22 }); nz({ type: 'highpass', f: 3000, d: 0.03, v: 0.2 }); },
    stumps: () => { nz({ type: 'lowpass', f: 900, d: 0.12, v: 0.55 }); [620, 840, 1130].forEach((f, i) => os({ type: 'triangle', f, f2: f * 0.7, d: 0.25, v: 0.15, delay: i * 0.035 })); os({ f: 140, f2: 60, d: 0.3, v: 0.32 }); },
    groan: () => { nz({ f: 440, f2: 240, q: 1.1, a: 0.2, d: 1.3, v: 0.24 }); swell(0.2, 0.9); },
    four: () => { swell(0.48, 1.6); nz({ f: 1200, q: 0.6, a: 0.1, d: 1.6, v: 0.24 }); },
    six: () => {
      swell(0.66, 2.6); nz({ f: 1100, q: 0.6, a: 0.12, d: 2.4, v: 0.32 }); nz({ f: 2700, q: 1.3, a: 0.2, d: 1.8, v: 0.12 });
      [233, 311, 370].forEach((f) => os({ type: 'sawtooth', f, d: 0.9, v: 0.08, a: 0.03, lp: 1600, delay: 0.25 }));   // stadium horn
    },
    sting: () => { [659.25, 783.99, 1046.5].forEach((f, i) => os({ type: 'triangle', f, d: i === 2 ? 0.45 : 0.14, v: 0.16, delay: i * 0.1 })); },
    fanfare: () => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { const d = i === 3 ? 0.7 : 0.16; os({ type: 'sawtooth', f, d, v: 0.1, a: 0.02, lp: 2400, delay: i * 0.11 }); os({ type: 'sawtooth', f: f / 2, d, v: 0.06, a: 0.02, lp: 1200, delay: i * 0.11 }); });
      swell(0.42, 1.5);
    },
    pb: () => { [784, 988, 1175, 1568].forEach((f, i) => os({ type: 'triangle', f, d: 0.22, v: 0.16, delay: i * 0.07 })); },
    rank: () => os({ type: 'triangle', f: 1320, d: 0.12, v: 0.08 }),
    over: () => { [523, 440, 349, 262].forEach((f, i) => os({ type: 'triangle', f, d: 0.25, v: 0.2, delay: i * 0.15 })); },
  };
  // crowd bed: rises as the over's target comes within a couple of hits
  function setBed(level) { if (!AU.ctx || Math.abs(AU.bed - level) < 0.005) return; AU.bed = level; AU.crowd.gain.setTargetAtTime(level, AU.ctx.currentTime + 0.3, 0.8); }
  ['playBtn', 'againBtn'].forEach((id) => { const b = $(id); if (b) b.addEventListener('click', auInit); });
  document.addEventListener('pointerdown', auInit, { passive: true });

  // ---------- HUD ----------
  const hud = $('hud'), sbOver = $('sbOver'), sbScore = $('sbScore'), sbNeed = $('sbNeed'), sbNeedL = $('sbNeedL'), sbNeedS = $('sbNeedS');
  const rankEl = $('rank'), hintEl = $('hint'), pbEl = $('pb'), pbChip = $('pbChip'), tChip = $('tchip'), bdSpan = $('bd').querySelector('span');
  const dots = Array.from(document.querySelectorAll('#bd i'));
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
      const d = await RG.api('/api/leaderboard?game=superover&riderId=' + encodeURIComponent(sh.rider.id));
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

  // one banner at a time: results first, then over news
  const banQ = []; let banT = 0;
  function say(txt, sub, col, cls, dur, sfx) { banQ.push({ txt, sub, col, cls, dur: dur || 1.0, sfx }); }
  function bannerStep(dt) {
    banT -= dt;
    if (banT <= 0 && banQ.length) { const b = banQ.shift(); banner(b.txt, b.sub, b.col, b.cls); banT = b.dur; if (b.sfx) b.sfx(); }
  }
  // display-only timing read-out: how far the tap was from the ideal contact moment
  let tChipT = 0;
  function timingChip(delta, runs) {
    if (delta == null) { tChip.textContent = 'NO SWING'; tChip.className = 'chip t-bad'; tChipT = 2.4; return; }
    const ms = Math.round(delta);
    tChip.textContent = ms === 0 ? 'SPOT ON · 0 ms' : (ms > 0 ? '+' : '-') + Math.abs(ms) + ' ms ' + (ms > 0 ? 'LATE' : 'EARLY');
    tChip.className = 'chip ' + (runs >= 6 ? 't-six' : runs >= 4 ? 't-good' : runs > 0 ? 't-ok' : 't-bad');
    tChipT = 2.4;
  }
  let lastBedNeed = -1;
  function updateHud(dt) {
    const st = sh.state, g = game;
    hud.classList.toggle('off', !(st === 'play' || st === 'countdown' || st === 'paused'));
    setText(sbOver, 'over', (g.over - 1) + '.' + g.ball, false);
    setText(sbScore, 'score', g.runs + '/' + g.wickets, true);
    const tgt = C.TARGETS[g.over - 1], need = Math.max(0, tgt - g.overRuns), left = 6 - g.ball;
    setText(sbNeedL, 'needL', need ? 'NEED' : 'TARGET', false);
    setText(sbNeed, 'need', need ? String(need) : 'MET', true);
    setText(sbNeedS, 'needS', need ? 'OFF ' + left : 'OVER ' + g.over, false);
    const key = g.overBalls.join(',') + '|' + g.over + '|' + g.ball;
    if (hudCache.dots !== key) {
      hudCache.dots = key;
      dots.forEach((d, i) => {
        const v = g.overBalls[i];
        d.textContent = v == null ? '' : v;
        d.className = v == null ? (i === g.overBalls.length && !g.done ? 'c' : '') : v === 'W' ? 'w' : v === '6' ? 's6' : v === '4' ? 's4' : v === '•' ? 'dt' : 'r';
      });
    }
    setText(bdSpan, 'bd', 'OVER ' + g.over + ' OF ' + C.OVERS, false);
    let rt = 'Score to rank';
    const lr = g.runs > 0 ? liveRank(g.runs) : null;
    if (lr) rt = '#' + lr.rank + (lr.plus ? '+' : '') + ' on the board';
    else if (g.runs > 0) rt = g.runs + ' runs';
    if (rt !== lastRankTxt) {
      const improved = lastRankTxt.startsWith('#') && rt.startsWith('#') && parseInt(rt.slice(1), 10) < parseInt(lastRankTxt.slice(1), 10);
      lastRankTxt = rt; rankEl.textContent = rt;
      if (improved) { rankEl.classList.remove('up'); void rankEl.offsetWidth; rankEl.classList.add('up'); SFX.rank(); }
    }
    const pbt = lb && lb.best > 0 ? 'PB ' + lb.best : '';
    if (hudCache.pbt !== pbt) { hudCache.pbt = pbt; pbChip.textContent = pbt; pbChip.classList.toggle('hide', !pbt); }
    if (!pbShown && lb && lb.best > 0 && g.runs > lb.best && st === 'play') { pbShown = true; pbDelay = 1.1; }
    if (tChipT > 0) { tChipT -= dt; if (tChipT <= 0) tChip.classList.add('hide'); }
    const showHint = st === 'play' && g.over === 1 && g.ball < 2 && g.swing < 0 && (g.phase === 'runup' || g.phase === 'flight');
    hintEl.classList.toggle('hide', !showHint);
    // crowd bed swells when the target is a hit or two away
    if (st === 'play' && need !== lastBedNeed) { lastBedNeed = need; setBed(need > 0 && need <= 6 ? 0.13 : need > 0 && need <= 10 && left <= 3 ? 0.11 : 0.07); }
  }

  // ---------- events from the core ----------
  const handObj = new THREE.Group(); handObj.position.set(0, -0.32, 0.02); bowler.elbows[0].add(handObj);
  let swingAnim = null, post = null, hitRef = null, hitOffT = 0, slowT = 0, camPush = 0, pushTarget = 0, follow = 0, shake = 0, excite = 0, groan = 0, ledT = 0, flashT = 0;
  let bowlZ = -C.REL_D - 0.09 - RUN_LEN, runFrom = bowlZ, outLean = 0, lastResult = null, overNews = null;
  const vdNow = () => (C.REL_D - C.CONTACT_D) / (game.del ? game.del.T : 1);
  function onEvent(ev, d) {
    if (ev === 'ball') {
      stumpsReset(myStumps); stumpsReset(farStumps); trailPts = []; post = null; swingAnim = null; outLean = 0; lastResult = null; runFrom = bowlZ; follow = 0; pushTarget = 0;
    } else if (ev === 'rebowl') { trailPts = []; runFrom = bowlZ; }
    else if (ev === 'release') { relOff.copy(releaseHand(_hp)).sub(ballWorld(SO.ballAt(d, 0), _bp)); if (relOff.length() > 1) relOff.set(0, 0, 0); SFX.release(); tChip.classList.add('hide'); tChipT = 0; }
    else if (ev === 'swing') {
      SFX.whoosh();
      const kind = d && d.kind === 'hit' ? (d.runs === 6 ? 'loft' : d.runs === 4 ? 'pull' : 'edge') : 'miss';
      swingAnim = { t: 0, from: poseCopy({}, curPose), fin: FIN[kind] };
      timingChip(d ? d.delta : game.swing - game.del.hitAt, d && d.kind === 'hit' ? d.runs : 0);
    } else if (ev === 'bounce') {
      SFX.bounce(); burst(ball.position, 10, ['#d9c79a', '#bfae80', '#efe2bd'], 1.1);
    } else if (ev === 'bat') {
      if (d.runs >= 4) SFX.bat(d.runs); else { SFX.edge(); SFX.bat(d.runs); }
      burst(ball.position, d.runs >= 6 ? 26 : 12, ['#ffffff', '#ffd23f', '#ffb000'], d.runs >= 6 ? 3 : 1.8);
      if (d.runs === 6 && d.label === 'PERFECT!') { slowT = 0.5; pushTarget = 1; }
    } else if (ev === 'result') {
      lastResult = d;
      if (d.kind === 'out') {
        SFX.stumps(); SFX.groan(); stumpsBlow(myStumps, game.del.xEnd >= 0 ? 1 : -1); bailMat.color.set('#ff2a2a');
        shake = 0.55; groan = 1; flashT = 1; flash(0.55); $('flash').style.setProperty('--fc', 'rgba(255,40,40,.5)');
        if (game.swing < 0) timingChip(null, 0);
        say('BOWLED!', d.label ? d.label.toUpperCase() : '', '#e0242f');
        post = { p: ball.position.clone(), v: new THREE.Vector3(0, -0.2, vdNow()), out: true, hitStumps: false };
      } else if (d.runs === 6) {
        SFX.six(); excite = 1; ledT = 2.2; follow = 1; confetti(220, 0, -22); $('flash').style.setProperty('--fc', 'rgba(255,210,63,.55)'); flash(0.7);
        say('SIX!', d.label, '#ffb000');
      } else if (d.runs === 4) {
        SFX.four(); excite = 0.6; ledT = 1.2; follow = 0.7; say('FOUR!', d.label, '#ff5a00');
      } else if (d.runs) say(d.runs + (d.runs === 1 ? ' RUN' : ' RUNS'), d.label, '#2a3a7a');
      else {
        say('DOT BALL', (d.label || 'Beaten').toUpperCase(), '#4a5468'); SFX.groan();
        post = { p: ball.position.clone(), v: new THREE.Vector3(0, 1.6, vdNow()), out: false };
      }
    } else if (ev === 'chased') say('TARGET CHASED!', 'EVERY RUN STILL COUNTS', '#1fa84f', 'lvl', 1.5, SFX.fanfare);
    else if (ev === 'chaseFailed') overNews = { txt: 'CHASE FAILED', col: '#e0242f', sfx: SFX.groan };
    else if (ev === 'overDone') overNews = { txt: `OVER ${game.over} DONE`, col: '#1fa84f', sfx: SFX.sting };
    else if (ev === 'newOver') {
      const n = overNews || { txt: `OVER ${game.over - 1} DONE`, col: '#1fa84f', sfx: SFX.sting };
      say(n.txt, `NEXT: OVER ${game.over} · TARGET ${C.TARGETS[game.over - 1]}`, n.col, 'lvl', 1.5, n.sfx); overNews = null;
    } else if (ev === 'finish') {
      if (ended) return;
      ended = true;
      if (overNews) { say(overNews.txt, '', overNews.col, 'lvl', 1.5, overNews.sfx); overNews = null; }
      if (d.won) SFX.fanfare(); else SFX.over();
      const p = sh.end(d.runs, { title: d.won ? 'Super Over champion!' : 'Innings over', line: `${d.runs} runs · reached over ${d.over} of ${C.OVERS}`, delay: 900 });
      if (p && p.then) p.then(() => endBoard(d.runs)).catch(() => {});
    }
  }
  function reset() {
    game.reset(); ended = false; banQ.length = 0; banT = 0; swingAnim = null; post = null; slowT = 0; pushTarget = 0; follow = 0; outLean = 0; lastResult = null; overNews = null;
    pbShown = false; lastRankTxt = ''; lastBedNeed = -1; pbEl.classList.remove('show'); pbDelay = 0; pbTimer = 0; tChip.classList.add('hide'); tChipT = 0;
    stumpsReset(myStumps); stumpsReset(farStumps); trailPts = [];
    const box = $('ovBoard'); if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    loadBoard();
  }
  loadBoard();

  // ---------- input ----------
  function tapIn(ts) { if (sh.state !== 'play') return false; return game.tap(ts); }
  cv.addEventListener('pointerdown', (e) => tapIn(e.timeStamp));
  window.addEventListener('keydown', (e) => { if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && sh.state === 'play') { e.preventDefault(); tapIn(e.timeStamp); } });

  // ---------- animation: bowler, batter, ball ----------
  const _hp = new THREE.Vector3(), _bp = new THREE.Vector3(), relOff = new THREE.Vector3(), hitOff = new THREE.Vector3();
  // Bowling action over the 1.1 s run-up (u = 0..1), release exactly at u = 1 (= the core's release moment):
  // 0-0.55 short run-up, 0.55-0.75 gather/bound (side-on, front arm up), 0.75-1 delivery stride with the
  // front-arm pull and a straight bowling arm going over the top; then a follow-through after release.
  const REL_Z = -C.REL_D - 0.09;
  function releaseHand(out) {                                    // hand position in the exact release pose (u = 1), frame-rate independent
    const b = bowler; b.root.position.set(BOWL_X, 0, REL_Z); b.root.rotation.y = -0.25;
    b.arms[0].rotation.set(Math.PI + 0.12, 0, -0.06 * 0.7); b.elbows[0].rotation.x = 0; b.torso.rotation.x = 0.12; b.hips.position.y = 0.95;
    b.root.updateMatrixWorld(true); return handObj.getWorldPosition(out);
  }
  function animBowler(dt, now) {
    const b = bowler, g = game;
    let z = bowlZ, y = 0, run = 0, armA = 0, front = 0, lean = 0, rot = 0, legL = 0, legR = 0, kneeL = 0, kneeR = 0, side = 0;
    const ph = now / 1000 * 11;
    if (g.phase === 'runup' && g.del) {
      const u = clamp(g.phaseT / C.RUNUP, 0, 1);
      if (u < 0.55) {
        const k = u / 0.55; z = lerp(runFrom, REL_Z - 2.3, k * (0.6 + 0.4 * k)); run = g.phaseT > 0 ? 1 : 0;
        armA = 0.35 * run; front = -Math.sin(ph) * 0.6 * run;
        legL = Math.sin(ph) * 0.75 * run; legR = -legL; kneeL = Math.max(0, -Math.sin(ph)) * run; kneeR = Math.max(0, Math.sin(ph)) * run;
      } else if (u < 0.75) {                                       // gather: bound off the left foot, turn side-on
        const k = (u - 0.55) / 0.2; z = lerp(REL_Z - 2.3, REL_Z - 1.0, k); y = 0.28 * Math.sin(Math.PI * k);
        rot = -1.2 * ease(k); front = -2.4 * ease(k); armA = lerp(0.35, 0.9, k); lean = -0.22 * k;
        legL = -0.9 * Math.sin(Math.PI * k); kneeL = 1.3 * Math.sin(Math.PI * k); legR = 0.35; kneeR = 0.5; side = k;
      } else {                                                     // delivery stride: back foot lands, front leg braces, arms rotate
        const k = (u - 0.75) / 0.25; z = lerp(REL_Z - 1.0, REL_Z, k);
        rot = lerp(-1.2, -0.25, ease(k)); front = lerp(-2.4, -0.2, ease(Math.max(0, (k - 0.3) / 0.7)));
        armA = lerp(0.9, Math.PI + 0.12, k * k);                   // straight arm: down/back -> over the head
        lean = lerp(-0.22, 0.12, k); legL = lerp(-0.6, -0.45, k); kneeL = lerp(0.4, 0.05, k); legR = lerp(0.35, 0.55, k); kneeR = 0.4; side = 1 - k * 0.3;
      }
    } else if (g.phase === 'flight' && g.del && g.del.releaseAt != null) {
      const s = (now - g.del.releaseAt) / 1000, f = clamp(s / 0.6, 0, 1), e = 1 - (1 - f) * (1 - f);
      z = REL_Z + 2.4 * e; run = f > 0.5 ? (1 - f) * 1.4 : 0;
      armA = Math.PI + 0.12 + (Math.PI + 0.5) * ease(Math.min(1, s / 0.35));   // arm carries on down past the left hip
      front = -0.2 - 0.4 * ease(f); rot = lerp(-0.25, 0.25, ease(f)); lean = lerp(0.12, 0.65, ease(Math.min(1, s / 0.3))) - 0.35 * Math.max(0, f - 0.6);
      legL = lerp(-0.45, 0.3, e); kneeL = 0.15; legR = lerp(0.55, -0.5, e); kneeR = lerp(0.4, 0.9, e);
      if (run > 0) { legL += Math.sin(ph) * 0.4 * run; legR -= Math.sin(ph) * 0.4 * run; }
      side = 0.7 * (1 - f);
    } else {
      // walk back to the mark between balls
      const mark = REL_Z - RUN_LEN; z = Math.max(mark, bowlZ - 5.5 * dt); run = z > mark + 0.01 ? 0.4 : 0;
      const wp = now / 1000 * 6; legL = Math.sin(wp) * 0.5 * run; legR = -legL; front = -Math.sin(wp) * 0.4 * run; armA = Math.sin(wp) * 0.4 * run;
    }
    bowlZ = z;
    const walking = !(g.phase === 'runup' || g.phase === 'flight');
    b.root.position.set(BOWL_X + (g.phase === 'flight' ? 0.5 * clamp((z - REL_Z) / 2.4, 0, 1) : 0), y, z);
    b.root.rotation.y = walking ? Math.PI : rot;
    b.legs[1].rotation.x = legL; b.legs[0].rotation.x = legR; b.knees[1].rotation.x = kneeL; b.knees[0].rotation.x = kneeR;
    b.arms[0].rotation.set(armA, 0, -0.06 * side); b.elbows[0].rotation.x = 0;          // bowling arm stays straight
    b.arms[1].rotation.set(front, 0, 0.15 * side); b.elbows[1].rotation.x = front < -1 ? -0.25 : -0.6;
    b.hips.position.y = 0.95 + (run > 0.5 ? Math.abs(Math.sin(ph)) * 0.05 * run : 0);
    b.torso.rotation.x = lean;
    bowlShadow.position.set(b.root.position.x, 0.012, z);
    bowlShadow.scale.setScalar(1 - Math.min(0.4, y));
  }
  // ---------- batter poses (root space) + arm IK ----------
  const D2R = Math.PI / 180;
  const PK = (P, th, dz, tw) => ({ P: new THREE.Vector3(...P), th: th * D2R, dz, tw });
  const READY = PK([-0.03, 0.84, 0.32], -106, -0.02, 0.35);       // bat grounded just behind the back foot
  const BACK = PK([-0.2, 1.12, 0.29], -232, 0, 0.1);              // backlift up behind the back shoulder
  const CONTACT = PK([0.04, 0.86, 0.34], -77, 0.04, 0.55);        // blade vertical in front of the front pad
  const FIN = { loft: PK([0.24, 1.38, 0.29], 59, -0.12, 1.0), pull: PK([0.28, 1.12, 0.33], 21, -0.08, 0.95), edge: PK([0.1, 0.95, 0.35], -63, 0.06, 0.6), miss: PK([0.2, 1.1, 0.32], 44, -0.05, 0.85) };
  const poseCopy = (o, a) => { o.P = (o.P || new THREE.Vector3()).copy(a.P); o.th = a.th; o.dz = a.dz; o.tw = a.tw; return o; };
  const poseLerp = (o, a, b2, t) => { o.P.lerpVectors(a.P, b2.P, t); o.th = lerp(a.th, b2.th, t); o.dz = lerp(a.dz, b2.dz, t); o.tw = lerp(a.tw, b2.tw, t); return o; };
  const curPose = poseCopy({}, READY);
  const _D = new THREE.Vector3(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _iq = new THREE.Quaternion();
  const _d = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3(), _E = new THREE.Vector3(), _f = new THREE.Vector3(), _ht = new THREE.Vector3();
  const POLES = [new THREE.Vector3(-0.6, -1, -0.3), new THREE.Vector3(0.6, -1, -0.3)];
  function armIK(rg, i, target, pole) {                            // target, pole in torso space
    const arm = rg.arms[i], el = rg.elbows[i], L1 = 0.28 * ARM_S, L2 = 0.3 * ARM_S;
    _d.copy(target).sub(arm.position); const dist = clamp(_d.length(), 0.1, L1 + L2 - 0.002); _d.normalize();
    _n.crossVectors(_d, pole).normalize();
    const a1 = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
    _u.copy(_d).applyAxisAngle(_n, a1);
    _E.copy(arm.position).addScaledVector(_u, L1); _f.copy(target).sub(_E).normalize();
    _by.copy(_u).negate(); _bz.crossVectors(_n, _by);
    _m4.makeBasis(_n, _by, _bz); arm.quaternion.setFromRotationMatrix(_m4);
    _iq.copy(arm.quaternion).invert(); _f.applyQuaternion(_iq);
    el.rotation.set(Math.atan2(-_f.z, -_f.y), 0, 0);
  }
  let posePin = null, camPin = null;                         // QA-only overrides (?qa)
  function animBatter(dt) {
    const b = batter, g = game;
    if (posePin) poseCopy(curPose, posePin);
    else if (swingAnim) {
      swingAnim.t += dt;
      const t = swingAnim.t, TC = 0.035, TF = 0.3;
      if (t < TC) poseLerp(curPose, swingAnim.from, CONTACT, t / TC);
      else poseLerp(curPose, CONTACT, swingAnim.fin, 1 - Math.pow(1 - clamp((t - TC) / (TF - TC), 0, 1), 3));
      if (t > 1.3 && g.phase !== 'result' && g.phase !== 'banner') swingAnim = null;
    } else {
      const lift = (g.phase === 'runup' && g.phaseT > C.RUNUP * 0.55) || g.phase === 'flight';   // backlift as the bowler gathers
      poseLerp(curPose, curPose, lift ? BACK : READY, Math.min(1, dt * (lift ? 7 : 4)));
    }
    // body: side-on, feet apart, knees flexed, slight forward lean; shoulders open with the swing
    const thru = clamp((curPose.tw - 0.35) / 0.65, 0, 1);
    for (let i = 0; i < 2; i++) {
      const sx = i ? 1 : -1;
      b.legs[i].rotation.set(-0.18 - (i ? 0.12 * thru : 0), 0, 0.12 * sx);
      b.knees[i].rotation.x = 0.36 + (i ? 0.1 * thru : 0);
    }
    b.hips.position.y = 0.915;
    if (lastResult && lastResult.kind === 'out') outLean = Math.min(1, outLean + dt * 1.5);
    b.torso.rotation.set(0.28 + 0.25 * outLean, curPose.tw, 0);
    // bat: grip at P, blade along D (in the x-y plane in front of the chest), face towards the bowler
    _D.set(Math.cos(curPose.th), Math.sin(curPose.th), curPose.dz).normalize();
    batPivot.position.copy(curPose.P);
    _by.copy(_D).negate();
    _bz.set(1, 0, 0); if (Math.abs(_bz.dot(_by)) > 0.92) _bz.set(0, 0, 1);
    _bz.addScaledVector(_by, -_bz.dot(_by)).normalize(); _bx.crossVectors(_by, _bz);
    _m4.makeBasis(_bx, _by, _bz); batPivot.quaternion.setFromRotationMatrix(_m4);
    // hands on the handle: top (left) hand above the bottom (right) hand
    b.root.updateMatrixWorld(true);
    for (const [i, off] of [[1, -0.06], [0, 0.07]]) {
      _ht.copy(curPose.P).addScaledVector(_D, off); b.root.localToWorld(_ht); b.torso.worldToLocal(_ht);
      armIK(b, i, _ht, POLES[i]);
    }
  }
  function ballWorld(core, out) { return out.set(core.x, core.h + BR, -core.d); }
  function animBall(dt, now) {
    const g = game; let vis = true;
    if (g.hit && (g.phase === 'result' || g.phase === 'banner')) {
      // a late hit starts from where the ball really is (it has passed the contact point), then joins the core flight
      if (g.hit !== hitRef) { hitRef = g.hit; hitOff.copy(ball.position).sub(ballWorld(g.hit, _bp)); hitOffT = 0.2; }
      ballWorld(g.hit, ball.position);
      if (hitOffT > 0) { hitOffT = Math.max(0, hitOffT - dt); ball.position.addScaledVector(hitOff, hitOffT / 0.2); }
      if (g.hit.d > BOUND_R + 30) vis = false;
      trailPush(ball.position, dt);
    } else if (post) {
      post.v.y -= 9.8 * dt * (post.out ? 0.6 : 1); post.p.addScaledVector(post.v, dt);
      if (post.out && !post.hitStumps && post.p.z > STUMP_Z - 0.05) { post.hitStumps = true; post.v.set(post.v.x * 0.3, 1.4, -post.v.z * 0.12); }
      if (post.p.y < BR) { post.p.y = BR; post.v.y = Math.abs(post.v.y) * 0.4; }
      ball.position.copy(post.p); if (post.p.z > 14) vis = false;
      trailPush(ball.position, dt);
    } else if (g.phase === 'flight' && g.del && g.del.releaseAt != null) {
      // 1:1 with the wall clock the judge uses: the ball is at the contact point exactly at hitAt
      const s = Math.max(0, (now - g.del.releaseAt) / 1000), cb = SO.ballAt(g.del, s), v = g.del.verdict;
      ballWorld(cb, ball.position);
      if (s < 0.12) ball.position.addScaledVector(relOff, 1 - s / 0.12);      // leaves the bowler's hand, joins the core path
      if (cb.d < C.CONTACT_D && v && v.kind === 'beaten') ball.position.y += (C.CONTACT_D - cb.d) * 0.9;   // missed: carries over the stumps
      else if (cb.d < C.STUMP_D + BR && !(v && v.kind === 'hit')) ball.position.z = Math.min(ball.position.z, STUMP_Z - BR);   // undecided: it has reached the stumps
      trailPush(ball.position, dt);
    } else if (g.phase === 'runup' || g.phase === 'wait') {
      handObj.getWorldPosition(_hp); ball.position.copy(_hp); trailPts = [];
    } else vis = false;
    ball.visible = vis;
    ball.rotation.x -= dt * 22; ball.rotation.z += dt * 3;
    ballShadow.visible = vis; ballShadow.position.set(ball.position.x, 0.013, ball.position.z);
    const hh = Math.max(0, ball.position.y); ballShadow.scale.setScalar(1 + hh * 0.5); ballShadow.material.opacity = Math.max(0.15, 1 - hh * 0.2);
    trailUpdate();
  }

  // ---------- camera ----------
  const _look = new THREE.Vector3(), _cp = new THREE.Vector3(), _att = new THREE.Vector3(), _tp = new THREE.Vector3(), _tl = new THREE.Vector3();
  let attract = 1, followW = 0;
  function camStep(dt, t) {
    const st = sh.state;
    attract = lerp(attract, st === 'play' || st === 'countdown' || st === 'paused' ? 0 : 1, Math.min(1, dt * 2.4));
    if (attract < 0.001) attract = 0;
    const wantFollow = game.hit && game.phase === 'result' ? follow : 0;
    followW = lerp(followW, wantFollow, Math.min(1, dt * (wantFollow ? 3.5 : 2.2)));
    if (followW < 0.001) followW = 0;
    camPush = lerp(camPush, game.phase === 'result' ? pushTarget : 0, Math.min(1, dt * 3)); if (camPush < 0.001) camPush = 0;
    _cp.copy(BASE_POS); _look.copy(BASE_LOOK);
    if (followW > 0) {
      _tl.copy(ball.position); _tl.y = Math.min(_tl.y, 18);
      _look.lerp(_tl, followW * 0.6);
      _cp.y += 0.9 * followW; _cp.z += 0.8 * followW;
    }
    if (attract > 0) {
      const a = 0.75 * Math.sin(t * 0.11);
      _att.set(Math.sin(a) * 26, 9 + Math.sin(t * 0.23) * 1.5, -9.8 + Math.cos(a) * 26);
      _cp.lerp(_att, ease(attract)); _tp.set(0, 1.2, -12); _look.lerp(_tp, ease(attract));
    }
    if (shake > 0) { const s = shake * shake * 0.18; _cp.x += (Math.random() - 0.5) * s; _cp.y += (Math.random() - 0.5) * s; shake = Math.max(0, shake - dt * 1.4); }
    if (camPin) { _cp.fromArray(camPin[0]); _look.fromArray(camPin[1]); }
    camera.position.copy(_cp); camera.lookAt(_look);
    const fov = baseFov * (1 - 0.16 * camPush) * (1 + 0.12 * attract);
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);
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
  let mutedSeen = null;
  let holdAt = null, frameNow = 0;                         // test hook: freeze game time for a screenshot
  function frame(dt, t) {
    governor();
    if (holdAt !== null) dt = 0;
    const now = holdAt !== null ? holdAt : performance.now(); frameNow = now;
    // slow-mo on a perfect six: the result phase runs at 45% for a moment (only ever lengthens a ball)
    let ts = 1;
    if (slowT > 0 && game.phase === 'result') { ts = 0.45; slowT -= dt; }
    game.update(dt * ts, now, sh.state === 'play');
    const vdt = dt * ts;
    animBowler(vdt, now); animBatter(vdt); animBall(vdt, now);
    stumpsStep(myStumps, vdt);
    if (myStumps.live) { const on = Math.sin(t * 30) > 0; bailMat.color.set(on ? '#ff2a2a' : '#ffd000'); }
    updateSparks(dt); updateConfetti(dt, t);
    bannerStep(dt);
    excite = Math.max(0, excite - dt * 0.35); groan = Math.max(0, groan - dt * 0.7);
    crowdU.uTime.value = t; crowdU.uExcite.value = excite; crowdU.uGroan.value = groan; crowdU.uFlash.value = Math.max(0, excite - 0.5);
    if (ledT > 0) { ledT -= dt; const k = ledT > 0 ? LED_BASE + 0.6 * Math.max(0, Math.sin(t * 16)) : LED_BASE; boards.forEach((b) => b.mat.color.setScalar(k)); }
    const gl = 30 * (1 + 0.15 * excite * Math.max(0, Math.sin(t * 14)));
    glows.forEach((g) => g.scale.set(gl, gl, 1));
    camStep(dt, t);
    if (AU.master && mutedSeen !== RG.muted) { mutedSeen = RG.muted; AU.master.gain.setTargetAtTime(RG.muted ? 0 : 0.85, AU.ctx.currentTime, 0.03); }
    if (pbDelay > 0) { pbDelay -= dt; if (pbDelay <= 0) { pbEl.classList.add('show'); pbTimer = 2.4; SFX.pb(); } }
    if (pbTimer > 0) { pbTimer -= dt; if (pbTimer <= 0) pbEl.classList.remove('show'); }
    updateHud(dt);
    renderer.render(scene, camera);
  }
  RG.loop((dt, now) => frame(dt, now / 1000));

  // ---------- test hooks (Playwright / Arcade QA) ----------
  const _sv = new THREE.Vector3();
  window.__so = {
    state: game.state, tap: tapIn, renderer: '3d',
    ballScreen: () => { _sv.copy(ball.position).project(camera); const r = cv.getBoundingClientRect(); return { x: r.left + (_sv.x + 1) / 2 * r.width, y: r.top + (1 - _sv.y) / 2 * r.height, visible: ball.visible }; },
    camSettled: () => attract === 0 && followW === 0 && camPush === 0 && camera.position.distanceTo(BASE_POS) < 0.01,
    quality: () => qual, setQuality: (q) => setQuality(q), fps: () => fpsAvg,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, crowd: crowd.count, pixelRatio: renderer.getPixelRatio(), quality: qual, fov: baseFov }),
  };
  // screenshot helper for the QA scripts only (?qa): freezes game time; absent in normal play
  if (/[?&]qa\b/.test(location.search)) {
    window.__so.hold = (on) => { holdAt = on ? performance.now() : null; };
    // pose / camera pins for close-ups, and the batter rig for the bat-vs-body clearance check
    const poses = Object.assign({ READY, BACK, CONTACT }, FIN);
    window.__so.pose = (name, toName, t) => { posePin = name ? (toName ? poseLerp(poseCopy({}, poses[name]), poses[name], poses[toName], t) : poses[name]) : null; };
    window.__so.cam = (pos, look) => { camPin = pos ? [pos, look] : null; };
    window.__so.rig = () => ({ batter, batPivot, batterPos: batter.root.position.toArray(), bowlerPos: bowler.root.position.toArray() });
    window.__so.phaseT = () => game.phaseT;
    // drawn ball vs the core path at the (held) wall clock: they must match once the ball has left the hand
    window.__so.ball = () => {
      const d = game.del; if (!d || d.releaseAt == null || game.phase !== 'flight') return null;
      const sec = (frameNow - d.releaseAt) / 1000, c = SO.ballAt(d, Math.max(0, sec));
      return { s: sec, T: d.T, d: c.d, pos: ball.position.toArray(), core: [c.x, c.h + BR, -c.d], hand: (handObj.getWorldPosition(_hp), _hp.toArray()) };
    };
  }
})();

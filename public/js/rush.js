// Talabat Rush Run: endless 3D daytime-Dubai lane runner (Three.js). Rules live in rush-core.js.
import * as THREE from '/vendor/three.min.js?v=3';

(function main() {
  'use strict';
  const RC = window.RushCore, C = RC.C, RG = window.RG;
  const SX = 2.0, SZ = 1.6, SY = 1.5;              // game units -> metres (lane, distance, height)
  const wx = (x) => x * SX, wz = (d) => -d * SZ, wy = (h) => h * SY;
  const VIEW = 120;                                  // game units of track shown ahead
  const hash = (i, s) => { let h = (i * 374761393 + s * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  // ---------- renderer ----------
  const cv = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  let pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color('#d3e9f7');
  scene.fog = new THREE.Fog(HORIZON, 90, 360);
  const camera = new THREE.PerspectiveCamera(70, 0.5, 0.5, 2200);
  let baseFov = 70;
  function resize() {
    const r = cv.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep about 52 degrees across in portrait without fish-eye
    baseFov = Math.min(80, Math.max(55, 2 * Math.atan(Math.tan(26 * Math.PI / 180) / camera.aspect) * 180 / Math.PI));
    camera.fov = baseFov; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  // ---------- helpers ----------
  function canvasTex(w, h, draw, opts) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (opts && opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.userData.canvas = c; return t;
  }
  // Merge simple parts into one vertex-coloured geometry: [geometry, colour, position, rotation, scale]
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  function merge(parts) {
    const pos = [], nor = [], col = [];
    for (const [g0, color, p, r, s] of parts) {
      const g = g0.index ? g0.toNonIndexed() : g0.clone();
      _m.compose(_v.set(...(p || [0, 0, 0])), _q.setFromEuler(_e.set(...(r || [0, 0, 0]))), _s.set(...(s || [1, 1, 1])));
      g.applyMatrix4(_m);
      _c.set(color);
      const P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(_c.r, _c.g, _c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }
  const BOX = new THREE.BoxGeometry(1, 1, 1), CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6), CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8), CYL12 = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const CONE8 = new THREE.CylinderGeometry(0.02, 0.5, 1, 8);
  const VC = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  // ---------- sky, sun, light ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#1f6fd6') }, mid: { value: new THREE.Color('#62a8ec') }, hor: { value: HORIZON } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP; void main(){ float y = max(vP.y, 0.0); vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, y)); c = mix(c, top, smoothstep(0.18, 0.7, y)); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
  }));
  sky.renderOrder = -10; scene.add(sky);
  const sunTex = canvasTex(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,250,1)'); r.addColorStop(0.16, 'rgba(255,252,230,1)'); r.addColorStop(0.24, 'rgba(255,236,170,.55)'); r.addColorStop(0.55, 'rgba(255,225,150,.14)'); r.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true }));
  sun.scale.set(420, 420, 1); sun.renderOrder = -9; scene.add(sun);
  scene.add(new THREE.HemisphereLight('#cfe8ff', '#e6c48f', 1.5));
  const sunL = new THREE.DirectionalLight('#fff1d6', 2.6);
  sunL.castShadow = true; sunL.shadow.mapSize.set(1024, 1024);
  Object.assign(sunL.shadow.camera, { left: -11, right: 11, top: 22, bottom: -14, near: 1, far: 140 });
  sunL.shadow.bias = -0.0006; sunL.shadow.normalBias = 0.03;
  scene.add(sunL, sunL.target);
  const SUN_OFF = new THREE.Vector3(18, 40, -24);

  // ---------- ground, road, barriers ----------
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshLambertMaterial({ color: '#ecd3a0' }));
  // sand is drawn first and sits well below the road (it used to win the depth test near the camera on some frames)
  sand.rotation.x = -Math.PI / 2; sand.position.y = -0.2; sand.renderOrder = -1; sand.receiveShadow = true; scene.add(sand);
  const TILE = 16;
  const roadTex = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#5a5e66'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 80 + Math.random() * 40 | 0; g.fillStyle = `rgba(${v},${v + 2},${v + 8},.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    const X = (m) => (m + 3.8) / 7.6 * w;
    g.fillStyle = '#cfd2d6'; g.fillRect(0, 0, X(-3.25), h); g.fillRect(X(3.25), 0, w - X(3.25), h);  // hard shoulder
    g.fillStyle = '#ffd23f'; g.fillRect(X(-3.15), 0, X(-2.95) - X(-3.15), h); g.fillRect(X(2.95), 0, X(3.15) - X(2.95), h);
    g.fillStyle = '#ffffff'; for (const lx of [-1, 1]) g.fillRect(X(lx - 0.08), 0, X(0.08) - X(-0.08), h * 0.42);
  }, { repeat: true });
  roadTex.repeat.set(1, 600 / TILE);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 600), new THREE.MeshLambertMaterial({ map: roadTex }));
  road.rotation.x = -Math.PI / 2; road.receiveShadow = true; scene.add(road);
  const barrierGeo = merge([[BOX, '#e9e4dc', [0, 0.45, 0], 0, [0.45, 0.9, 600]], [BOX, '#c9c2b7', [0, 0.06, 0], 0, [0.75, 0.12, 600]]]);
  const barriers = [-4.05, 4.05].map((x) => { const m = new THREE.Mesh(barrierGeo, VC); m.position.x = x; m.receiveShadow = true; scene.add(m); return m; });
  // metro viaduct deck (left side) + rails
  const deck = new THREE.Mesh(merge([[BOX, '#a7adb5', [0, 0, 0], 0, [5, 1.1, 900]], [BOX, '#8d939b', [0, 0.75, 0], 0, [0.25, 0.4, 900]], [BOX, '#bcc2c9', [-2.3, 0.85, 0], 0, [0.3, 0.6, 900]], [BOX, '#bcc2c9', [2.3, 0.85, 0], 0, [0.3, 0.6, 900]], [BOX, '#2f6fd0', [-2.46, 0.6, 0], 0, [0.04, 0.12, 900]]]), VC);
  deck.position.set(-15, 9, 0); scene.add(deck);

  // ---------- instanced roadside scenery (recycled by index) ----------
  function inst(geo, n, mat) { const m = new THREE.InstancedMesh(geo, mat || VC, n); m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; }
  const palmGeo = (() => {
    const p = [[CYL6, '#9a7046', [0, 3.2, 0], 0, [0.32, 6.4, 0.32]], [CYL6, '#7d5a37', [0, 6.4, 0], 0, [0.5, 0.6, 0.5]]];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      p.push([BOX, i % 2 ? '#2f9a46' : '#3cb556', [Math.cos(a) * 1.3, 6.15, Math.sin(a) * 1.3], [0, -a, -0.45, 'YXZ'], [2.8, 0.12, 0.7]]);
    }
    return merge(p);
  })();
  const lampGeo = merge([[CYL6, '#9aa3ad', [0, 4, 0], 0, [0.16, 8, 0.16]], [BOX, '#9aa3ad', [0.9, 7.9, 0], 0, [1.8, 0.12, 0.12]], [BOX, '#f4f4f0', [1.7, 7.8, 0], 0, [0.6, 0.15, 0.3]]]);
  const pillarGeo = merge([[BOX, '#b4bac2', [0, 4.2, 0], 0, [1.4, 8.4, 1.4]], [BOX, '#9ea4ac', [0, 8.2, 0], 0, [4.6, 0.6, 1.8]]]);
  const shrubGeo = merge([[new THREE.IcosahedronGeometry(0.7, 0), '#5aa64a', [0, 0.4, 0], 0, [1, 0.7, 1]]]);
  const palms = inst(palmGeo, 80), lamps = inst(lampGeo, 40), pillars = inst(pillarGeo, 30), shrubs = inst(shrubGeo, 80);
  // towers: glass bodies with floor bands, several height variants (instance colour tints the glass)
  function towerGeo(h, kind) {
    const p = [];
    if (kind === 'cyl') { p.push([CYL8, '#ffffff', [0, h / 2, 0], 0, [1, h, 1]]); for (let y = 3; y < h - 2; y += 3.4) p.push([CYL8, '#8a96a6', [0, y, 0], 0, [1.03, 0.35, 1.03]]); p.push([CYL8, '#e8edf2', [0, h + 1.5, 0], 0, [0.7, 3, 0.7]], [CONE8, '#d8dee6', [0, h + 8, 0], 0, [0.12, 10, 0.12]]); }
    else {
      p.push([BOX, '#ffffff', [0, h / 2, 0], 0, [1, h, 1]]);
      for (let y = 3; y < h - 2; y += 3.4) p.push([BOX, '#8a96a6', [0, y, 0], 0, [1.02, 0.35, 1.02]]);
      if (kind === 'step') p.push([BOX, '#ffffff', [0, h + h * 0.12, 0], 0, [0.7, h * 0.24, 0.7]], [BOX, '#ffffff', [0, h + h * 0.3, 0], 0, [0.42, h * 0.12, 0.42]], [CONE8, '#d8dee6', [0, h + h * 0.36 + 6, 0], 0, [0.1, 12, 0.1]]);
      else p.push([BOX, '#e9edf1', [0, h + 1, 0], 0, [0.9, 2, 0.9]]);
    }
    return merge(p);
  }
  const TV = [[32, 'box'], [48, 'box'], [42, 'cyl'], [58, 'step'], [75, 'box'], [68, 'step'], [90, 'cyl']].map(([h, k]) => ({ h, mesh: inst(towerGeo(h, k), 40) }));
  const TOWER_COLS = ['#8fc3e8', '#a9d2ee', '#7fb0d6', '#cfe3f1', '#9ec9e0', '#b7c7d6', '#88b8c9', '#e5d8c2'].map((c) => new THREE.Color(c));

  // distant skyline + Burj Khalifa (camera-relative, never reached)
  const far = new THREE.Group(); scene.add(far);
  const farMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  (function () {
    const p = [];
    for (let i = 0; i < 44; i++) { const x = -520 + i * 24 + hash(i, 3) * 12, h = 30 + hash(i, 4) * 110 * (1 - Math.abs(x) / 700), w = 14 + hash(i, 5) * 18; if (Math.abs(x + 95) < 30) continue; p.push([BOX, ['#b3cde0', '#a9c4da', '#bdd3e3'][i % 3], [x, h / 2, -40 - hash(i, 6) * 60], 0, [w, h, w]]); }
    far.add(new THREE.Mesh(merge(p), farMat));
    // Burj Khalifa: Y-plan wings stepping back as they rise, a core and a long spire
    const b = [], H = 330;
    for (let t = 0; t < 14; t++) {
      const y0 = (t / 14) * H * 0.78, hh = H * 0.78 / 14 + 0.5, wl = 26 * Math.pow(1 - t / 15, 1.25) + 4;
      for (let k = 0; k < 3; k++) { if (t > 3 && (t + k) % 3 === 0 && wl < 10) continue; const a = k * Math.PI * 2 / 3 + Math.PI / 6; b.push([BOX, t % 2 ? '#9fb6cc' : '#a9bfd3', [Math.cos(a) * wl / 2, y0 + hh / 2, Math.sin(a) * wl / 2], [0, -a, 0], [wl, hh, 7.5 - t * 0.3]]); }
    }
    b.push([CYL8, '#a3b9ce', [0, H * 0.82, 0], 0, [6, H * 0.12, 6]], [CONE8, '#9fb6cc', [0, H * 0.96, 0], 0, [4, H * 0.3, 4]], [CYL6, '#a8bdd0', [0, H * 0.4, 0], 0, [9, H * 0.8, 9]]);
    const burj = new THREE.Mesh(merge(b), farMat); burj.position.set(-95, 0, 0); burj.name = 'burj'; far.add(burj);
  })();

  // Dubai Metro train (5 cars, silver-grey with blue bands) running the other way on the viaduct
  const train = new THREE.Mesh(merge([0, 1, 2, 3, 4].flatMap((i) => [
    [BOX, '#c9ced5', [0, 1.7, i * 13], 0, [3, 3.1, 12.4]], [BOX, '#1b2633', [0, 2.2, i * 13], 0, [3.04, 1, 11.6]], [BOX, '#1f5fcc', [0, 1.0, i * 13], 0, [3.04, 0.45, 12.4]],
    [BOX, '#1f5fcc', [0, 3.1, i * 13], 0, [3.04, 0.18, 12.4]], [BOX, '#8e959e', [0, 0.25, i * 13], 0, [2.6, 0.5, 11]],
  ]).concat([[BOX, '#1b2633', [0, 2.1, -6.3], [0.5, 0, 0], [2.8, 1.6, 0.5]], [BOX, '#1f5fcc', [0, 1.0, -6.25], 0, [3, 0.45, 0.3]]])), VC);
  scene.add(train);
  let trainZ = -400;
  // Dubai Metro station on the viaduct every STN m: curved grey shell with blue glazing + concourse below
  const STN = 430;
  const station = new THREE.Mesh((() => {
    const shell = new THREE.CylinderGeometry(5.2, 5.2, 34, 18, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
    const glass = new THREE.CylinderGeometry(5.25, 5.25, 34, 18, 1, true, -Math.PI / 2 + 0.55, 0.42).rotateX(-Math.PI / 2);
    const glass2 = new THREE.CylinderGeometry(5.25, 5.25, 34, 18, 1, true, Math.PI / 2 - 0.97, 0.42).rotateX(-Math.PI / 2);
    const cap = new THREE.CircleGeometry(5.1, 18, 0, Math.PI);
    return merge([[shell, '#c3c8cf', [0, 10, 0]], [glass, '#2d6fd2', [0, 10, 0]], [glass2, '#2d6fd2', [0, 10, 0]],
      [cap, '#5d8fd8', [0, 10, 17], 0], [cap, '#5d8fd8', [0, 10, -17], [0, Math.PI, 0]],
      [BOX, '#9aa1a9', [0, 9.6, 0], 0, [9.6, 0.5, 34]], [BOX, '#e9ecef', [-3.6, 10.1, 0], 0, [2.2, 0.5, 30]], [BOX, '#e9ecef', [3.6, 10.1, 0], 0, [2.2, 0.5, 30]],
      [BOX, '#b9bfc7', [0, 3.2, 0], 0, [8, 6.4, 16]], [BOX, '#2d6fd2', [0, 4.6, 0], 0, [8.06, 1.4, 16.06]], [BOX, '#2d6fd2', [5.2, 4.5, 0], 0, [3, 9, 3]], [BOX, '#c3c8cf', [5.2, 4.5, 0], 0, [3.06, 1, 3.06]]]);
  })(), VC);
  station.castShadow = false; scene.add(station);

  // Talabat campaign hoardings: textures listed in /img/ads/ads.json ({src,w,h}); wide ones (>= 3:1)
  // hang on footbridges over the road, the rest on roadside boards angled towards the rider.
  const ads = { boards: [], wide: [] };
  fetch('/img/ads/ads.json', { cache: 'no-cache' }).then((r) => r.json()).then((list) => {
    for (const a of list) {
      const img = new Image(), t = new THREE.Texture(img); img.onload = () => { t.needsUpdate = true; }; img.src = a.src;
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      const ad = { mat: new THREE.MeshBasicMaterial({ map: t, toneMapped: false }), aspect: a.w / a.h };
      (ad.aspect >= 3 ? ads.wide : ads.boards).push(ad);
    }
  }).catch(() => {});
  const faceGeo = new THREE.PlaneGeometry(1, 1), facePool = [];
  function faceGet(i) { if (!facePool[i]) { const m = new THREE.Mesh(faceGeo, VC); scene.add(m); facePool[i] = m; } return facePool[i]; }
  const BOARD = 70, BRIDGE = 520;
  const bridgeGeo = merge([[BOX, '#b4bac2', [-5.6, 4, 0], 0, [0.8, 8, 0.8]], [BOX, '#b4bac2', [5.6, 4, 0], 0, [0.8, 8, 0.8]], [BOX, '#d5d9de', [0, 7.6, 0], 0, [12.4, 0.8, 2.6]],
    [BOX, '#2d6fd2', [0, 8.25, -0.6], 0, [12.4, 0.5, 1.4]], [BOX, '#9aa1a9', [0, 8.1, 1.25], 0, [12.4, 0.2, 0.1]]]);
  const bridges = new THREE.InstancedMesh(bridgeGeo, VC, 2); bridges.frustumCulled = false; bridges.count = 0; scene.add(bridges);
  const boardBack = new THREE.InstancedMesh(merge([[BOX, '#2a2d33', [0, 0, -0.12], 0, [1, 1, 0.2]]]), VC, 12); boardBack.frustumCulled = false; boardBack.count = 0; scene.add(boardBack);
  const boardPost = new THREE.InstancedMesh(merge([[BOX, '#8d939b', [0, 0.5, 0], 0, [1, 1, 1]]]), VC, 24); boardPost.frustumCulled = false; boardPost.count = 0; scene.add(boardPost);

  // ---------- obstacles (pooled, vertex-coloured, one draw call each) ----------
  const W = (n) => new Array(n);
  const coneGeo = merge([[BOX, '#1f1f24', [0, 0.05, 0], 0, [1.05, 0.1, 1.05]], [CONE8, '#ff6a00', [0, 0.62, 0], 0, [0.9, 1.15, 0.9]], [CYL8, '#ffffff', [0, 0.62, 0], 0, [0.56, 0.2, 0.56]], [CYL8, '#ffffff', [0, 0.95, 0], 0, [0.32, 0.14, 0.32]]]);
  const barrierObsGeo = (() => { const p = [[BOX, '#30333a', [-0.62, 0.42, 0], 0, [0.12, 0.84, 0.12]], [BOX, '#30333a', [0.62, 0.42, 0], 0, [0.12, 0.84, 0.12]], [BOX, '#30333a', [-0.62, 0.03, 0], 0, [0.2, 0.06, 0.6]], [BOX, '#30333a', [0.62, 0.03, 0], 0, [0.2, 0.06, 0.6]]];
    for (let i = 0; i < 6; i++) p.push([BOX, i % 2 ? '#ffffff' : '#e3262f', [-0.65 + 0.26 * i, 0.72, 0.02], 0, [0.26, 0.32, 0.1]]);
    p.push([BOX, '#ffb000', [-0.62, 0.95, 0.02], 0, [0.16, 0.12, 0.16]], [BOX, '#ffb000', [0.62, 0.95, 0.02], 0, [0.16, 0.12, 0.16]]); return merge(p); })();
  const holeGeo = (() => { const ring = new THREE.RingGeometry(0.88, 1.0, 20).rotateX(-Math.PI / 2), disc = new THREE.CircleGeometry(0.9, 20).rotateX(-Math.PI / 2), crack = new THREE.CircleGeometry(0.62, 7).rotateX(-Math.PI / 2);
    return merge([[ring, '#ffd400', [0, 0.03, 0]], [disc, '#26221f', [0, 0.02, 0]], [crack, '#0d0b0a', [0, 0.025, 0]]]); })();
  const SUPER_COLS = ['#8fe000', '#e3141b', '#ffc400', '#f4f5f7'];
  function carGeo(kind) {
    const L = 4.3, p = [];
    const wheel = (x, z) => p.push([CYL8, '#1b1b1f', [x, 0.36, z], [0, 0, Math.PI / 2], [0.72, 0.3, 0.72]], [CYL8, '#b9bec6', [x * 1.02, 0.36, z], [0, 0, Math.PI / 2], [0.36, 0.31, 0.36]]);
    if (kind === 'dd') {
      // RTA-style double-decker: white body, red skirt + red band between decks, two rows of dark windows
      p.push([BOX, '#f4f4f2', [0, 2.05, 0], 0, [1.9, 3.5, L]], [BOX, '#d81e2a', [0, 0.65, 0], 0, [1.92, 0.7, L + 0.03]], [BOX, '#d81e2a', [0, 2.35, 0], 0, [1.92, 0.3, L + 0.03]],
        [BOX, '#1f2a37', [0, 1.65, 0], 0, [1.93, 0.75, L - 0.4]], [BOX, '#1f2a37', [0, 3.05, 0], 0, [1.93, 0.85, L - 0.4]],
        [BOX, '#1f2a37', [0, 1.7, L / 2], 0, [1.6, 0.85, 0.04]], [BOX, '#1f2a37', [0, 3.05, L / 2], 0, [1.6, 0.85, 0.04]], [BOX, '#d81e2a', [0, 3.85, 0], 0, [1.92, 0.1, L + 0.03]],
        [BOX, '#ff2a2a', [-0.72, 0.75, L / 2 + 0.03], 0, [0.3, 0.3, 0.04]], [BOX, '#ff2a2a', [0.72, 0.75, L / 2 + 0.03], 0, [0.3, 0.3, 0.04]], [BOX, '#ffb000', [0, 2.35, L / 2 + 0.03], 0, [1.1, 0.24, 0.04]]);
      wheel(-0.85, -1.3); wheel(0.85, -1.3); wheel(-0.85, 1.3); wheel(0.85, 1.3);
    } else if (kind.startsWith('sc')) {
      // stylised supercar: low, wide wedge, dark canopy, rear wing, no logos
      const c = SUPER_COLS[+kind.slice(2)], dk = '#15171c';
      p.push([BOX, c, [0, 0.5, 0.1], 0, [1.95, 0.5, L - 0.2]], [BOX, c, [0, 0.72, -1.3], [0.12, 0, 0], [1.9, 0.28, 1.5]], [BOX, dk, [0, 0.95, 0.35], [-0.12, 0, 0], [1.4, 0.38, 1.7]],
        [BOX, c, [0, 1.05, 0.6], 0, [1.3, 0.12, 1.0]], [BOX, dk, [-0.99, 0.55, 0.5], 0, [0.04, 0.3, 1.2]], [BOX, dk, [0.99, 0.55, 0.5], 0, [0.04, 0.3, 1.2]],
        [BOX, dk, [0, 1.12, L / 2 - 0.25], 0, [1.8, 0.07, 0.4]], [BOX, dk, [-0.7, 0.9, L / 2 - 0.25], 0, [0.08, 0.35, 0.1]], [BOX, dk, [0.7, 0.9, L / 2 - 0.25], 0, [0.08, 0.35, 0.1]],
        [BOX, '#ff2020', [-0.6, 0.62, L / 2 + 0.01], 0, [0.55, 0.1, 0.04]], [BOX, '#ff2020', [0.6, 0.62, L / 2 + 0.01], 0, [0.55, 0.1, 0.04]], [BOX, dk, [0, 0.32, L / 2], 0, [1.6, 0.16, 0.1]]);
      wheel(-0.9, -1.35); wheel(0.9, -1.35); wheel(-0.9, 1.35); wheel(0.9, 1.35);
    } else {
      const body = kind === 'taxi' ? '#f1e4c4' : '#ffffff', roof = kind === 'taxi' ? '#d62828' : '#ffffff';
      p.push([BOX, body, [0, 0.72, 0], 0, [1.75, 0.66, L]], [BOX, '#2b3542', [0, 1.3, -0.15], 0, [1.55, 0.55, 2.3]], [BOX, roof, [0, 1.6, -0.15], 0, [1.5, 0.1, 2.1]],
        [BOX, '#ff2020', [-0.62, 0.86, L / 2 + 0.01], 0, [0.36, 0.2, 0.04]], [BOX, '#ff2020', [0.62, 0.86, L / 2 + 0.01], 0, [0.36, 0.2, 0.04]], [BOX, '#30333a', [0, 0.46, L / 2], 0, [1.78, 0.18, 0.1]]);
      if (kind === 'taxi') p.push([BOX, '#ffd400', [0, 1.77, -0.15], 0, [0.6, 0.24, 0.3]]);
      else p.push([BOX, '#1e88e5', [0, 0.78, 0], 0, [1.78, 0.12, L - 0.4]]);
      wheel(-0.82, -1.35); wheel(0.82, -1.35); wheel(-0.82, 1.35); wheel(0.82, 1.35);
    }
    return merge(p);
  }
  const GEOS = { cone: coneGeo, barrier: barrierObsGeo, hole: holeGeo, taxi: carGeo('taxi'), suv: carGeo('suv'), dd: carGeo('dd'), sc0: carGeo('sc0'), sc1: carGeo('sc1'), sc2: carGeo('sc2'), sc3: carGeo('sc3') };
  const pools = {};
  function poolGet(kind, i) {
    const p = pools[kind] || (pools[kind] = []);
    if (!p[i]) { const m = new THREE.Mesh(GEOS[kind], VC); m.castShadow = kind !== 'hole'; m.receiveShadow = kind === 'hole'; scene.add(m); p[i] = m; }
    return p[i];
  }
  function variant(o) { const r = hash(Math.round(o.d * 10), o.l0 + 7); if (o.kind === 'car') return r < 0.34 ? 'taxi' : r < 0.6 ? 'sc' + Math.floor(hash(Math.round(o.d * 10), o.l0 + 31) * 4) : r < 0.8 ? 'dd' : 'suv'; if (o.kind === 'cone') return r < 0.6 ? 'cone' : 'barrier'; return 'hole'; }
  // lane warning stripes painted ahead of each obstacle (red = go round, yellow = hop)
  const warnTex = canvasTex(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { const y = h - i * 62 - 20; g.fillStyle = `rgba(255,255,255,${0.95 - i * 0.2})`; g.beginPath(); g.moveTo(6, y); g.lineTo(w / 2, y - 34); g.lineTo(w - 6, y); g.lineTo(w - 6, y - 14); g.lineTo(w / 2, y - 48); g.lineTo(6, y - 14); g.closePath(); g.fill(); }
  });
  const warnMats = { hi: new THREE.MeshBasicMaterial({ map: warnTex, color: '#ff2b2b', transparent: true, depthWrite: false }), lo: new THREE.MeshBasicMaterial({ map: warnTex, color: '#ffc400', transparent: true, depthWrite: false }) };
  const warnGeo = new THREE.PlaneGeometry(1.5, 5.5).rotateX(-Math.PI / 2);
  const warnPool = [];
  function warnGet(i) { if (!warnPool[i]) { const m = new THREE.Mesh(warnGeo, warnMats.hi); m.renderOrder = 1; scene.add(m); warnPool[i] = m; } return warnPool[i]; }

  warnMats.turn = new THREE.MeshBasicMaterial({ map: warnTex, color: '#ff9d00', transparent: true, depthWrite: false });
  // lane-change blinkers: amber lamps + glow on the side the car is moving to
  const blinkLamps = inst(new THREE.BoxGeometry(0.5, 0.5, 0.5), 16, new THREE.MeshBasicMaterial({ color: '#ffb000', toneMapped: false }));
  const blinkGlowTex = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,240,180,1)'); r.addColorStop(0.3, 'rgba(255,170,0,.8)'); r.addColorStop(1, 'rgba(255,150,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
  const blinkGlows = inst(new THREE.PlaneGeometry(7, 7), 16, new THREE.MeshBasicMaterial({ map: blinkGlowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));

  // ---------- coins (instanced, spinning, glowing) ----------
  const coinMat = new THREE.MeshLambertMaterial({ color: '#ffc61a', emissive: '#b07800', flatShading: true });
  const coinGeo = merge([[new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14), '#ffd23f', 0, [Math.PI / 2, 0, 0]], [new THREE.CylinderGeometry(0.26, 0.26, 0.14, 10), '#f0a400', 0, [Math.PI / 2, 0, 0]]]);
  const coins = inst(coinGeo, 90, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#9a6a00', flatShading: true }));
  coins.castShadow = true;
  const glowTex = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,230,120,.9)'); r.addColorStop(0.4, 'rgba(255,200,40,.35)'); r.addColorStop(1, 'rgba(255,190,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
  const glows = inst(new THREE.PlaneGeometry(1.9, 1.9), 90, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  void coinMat;

  // ---------- boost pads ----------
  const padTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#0b8f6a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) { const y = h - 20 - i * 82; g.fillStyle = '#7dffd2'; g.beginPath(); g.moveTo(14, y); g.lineTo(w / 2, y - 50); g.lineTo(w - 14, y); g.lineTo(w - 14, y - 22); g.lineTo(w / 2, y - 72); g.lineTo(14, y - 22); g.closePath(); g.fill(); }
    g.strokeStyle = '#d9fff2'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  }, { repeat: true });
  const padMat = new THREE.MeshBasicMaterial({ map: padTex });
  const padGlowMat = new THREE.MeshBasicMaterial({ color: '#3dffc0', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const padPool = [];
  function padGet(i) {
    if (!padPool[i]) { const g = new THREE.Group(); const top = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4 * SZ).rotateX(-Math.PI / 2), padMat); top.position.y = 0.04; const glow = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.6, 2.4 * SZ + 0.2), padGlowMat); glow.position.y = 0.3; g.add(top, glow); scene.add(g); padPool[i] = g; }
    return padPool[i];
  }

  const logoImg = new Image(); logoImg.src = '/img/talabat-logo.png';

  // ---------- Talabat bike + rider ----------
  const logoTex = canvasTex(512, 512, () => {});
  function drawLogoBox() {
    const g = logoTex.userData.canvas.getContext('2d');
    g.fillStyle = '#FF5A00'; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = '#FFF1E0'; g.lineWidth = 14; g.strokeRect(14, 14, 484, 484);
    if (logoImg.complete && logoImg.naturalWidth) { const w = 500, h = w * logoImg.naturalHeight / logoImg.naturalWidth; g.drawImage(logoImg, (512 - w) / 2, (512 - h) / 2, w, h); }
    logoTex.needsUpdate = true;
  }
  logoImg.onload = drawLogoBox;
  drawLogoBox();
  const bike = new THREE.Group(), bikeBody = new THREE.Group(); bike.add(bikeBody); scene.add(bike);
  (function () {
    const O = '#FF5A00';
    const frame = merge([
      [BOX, O, [0, 0.62, 0.1], 0, [0.5, 0.42, 1.25]], [BOX, '#1d1d22', [0, 0.92, 0.25], 0, [0.4, 0.14, 0.75]], [BOX, O, [0, 0.95, -0.55], [-0.35, 0, 0], [0.45, 0.75, 0.2]],
      [BOX, '#2a2a30', [0, 1.38, -0.62], 0, [0.95, 0.07, 0.07]], [BOX, '#1d1d22', [-0.5, 1.38, -0.62], 0, [0.12, 0.1, 0.12]], [BOX, '#1d1d22', [0.5, 1.38, -0.62], 0, [0.12, 0.1, 0.12]],
      [BOX, '#2a2a30', [0, 0.85, -0.78], [-0.35, 0, 0], [0.12, 0.9, 0.12]], [BOX, '#ff2020', [0, 0.72, 0.74], 0, [0.32, 0.12, 0.05]], [BOX, '#f5f5f5', [0, 0.5, 0.74], 0, [0.28, 0.12, 0.06]],
      // rider: legs, jacket, arms, helmet
      [BOX, '#1d2a4a', [-0.2, 0.9, -0.05], [-0.9, 0, 0], [0.18, 0.62, 0.2]], [BOX, '#1d2a4a', [0.2, 0.9, -0.05], [-0.9, 0, 0], [0.18, 0.62, 0.2]],
      [BOX, '#ff6a14', [0, 1.38, 0.12], [-0.3, 0, 0], [0.58, 0.68, 0.36]], [BOX, '#ff6a14', [-0.36, 1.42, -0.25], [-1.0, 0, 0.15], [0.15, 0.62, 0.15]], [BOX, '#ff6a14', [0.36, 1.42, -0.25], [-1.0, 0, -0.15], [0.15, 0.62, 0.15]],
      [new THREE.IcosahedronGeometry(0.24, 1), O, [0, 1.92, -0.02]], [BOX, '#ffffff', [0, 1.96, 0.05], 0, [0.07, 0.3, 0.42]], [BOX, '#1b1b22', [0, 1.88, -0.22], 0, [0.36, 0.14, 0.1]],
    ]);
    const fm = new THREE.Mesh(frame, VC); fm.castShadow = true; bikeBody.add(fm);
    const wheelGeo = merge([[new THREE.CylinderGeometry(0.34, 0.34, 0.16, 14), '#141418', 0, [0, 0, Math.PI / 2]], [new THREE.CylinderGeometry(0.17, 0.17, 0.18, 8), '#c7ccd3', 0, [0, 0, Math.PI / 2]]]);
    const wf = new THREE.Mesh(wheelGeo, VC), wb = new THREE.Mesh(wheelGeo, VC); wf.position.set(0, 0.34, -0.82); wb.position.set(0, 0.34, 0.68); wf.castShadow = wb.castShadow = true;
    bikeBody.add(wf, wb); bike.userData.wheels = [wf, wb];
    // delivery box: logo on back and both sides (BoxGeometry face UVs read correctly from outside, not mirrored)
    const plain = new THREE.MeshLambertMaterial({ color: '#FF5A00', emissive: '#7a2400' }), logoM = new THREE.MeshLambertMaterial({ map: logoTex, emissive: '#ffffff', emissiveMap: logoTex, emissiveIntensity: 0.45 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.7, 0.66), [logoM, logoM, plain, plain, logoM, plain]);
    box.position.set(0, 1.62, 0.52); box.castShadow = true; box.name = 'deliveryBox'; bikeBody.add(box);
  })();
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
  blob.scale.set(0.6, 1, 1.4); scene.add(blob);

  // ---------- particles + speed lines ----------
  const NP = 260, pPos = new Float32Array(NP * 3).fill(-999), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const dotTex = canvasTex(64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, '#fff'); r.addColorStop(0.5, 'rgba(255,255,255,.8)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.45, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.02 }));
  points.frustumCulled = false; scene.add(points);
  let pNext = 0;
  function burst(x, y, z, n, colors, speed, up) {
    for (let k = 0; k < n; k++) {
      const i = pNext; pNext = (pNext + 1) % NP;
      pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      pVel[i * 3] = Math.cos(a) * s; pVel[i * 3 + 1] = up * (0.5 + Math.random()); pVel[i * 3 + 2] = Math.sin(a) * s;
      _c.set(colors[k % colors.length]); pCol[i * 3] = _c.r; pCol[i * 3 + 1] = _c.g; pCol[i * 3 + 2] = _c.b; pLife[i] = 0.5 + Math.random() * 0.4;
    }
  }
  function stepParticles(dt) {
    for (let i = 0; i < NP; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt; if (pLife[i] <= 0) { pPos[i * 3 + 1] = -999; continue; }
      pVel[i * 3 + 1] -= 14 * dt;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  }
  const lines = inst(new THREE.BoxGeometry(0.04, 0.04, 7), 36, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const lineSeeds = Array.from({ length: 36 }, (_, i) => ({ a: hash(i, 21) * Math.PI * 2, r: 2.6 + hash(i, 22) * 3.5, o: hash(i, 23) }));

  // ---------- HUD (DOM) ----------
  const stage = document.getElementById('stage');
  stage.insertAdjacentHTML('beforeend', `
    <div id="hud"><div class="hrow"><div class="pill sc"><small>SCORE</small><b id="hScore">0</b></div><div class="pill cn"><i class="coin"></i><b id="hCoins">0</b></div></div>
    <div class="hrow2"><div id="hHearts"></div><div class="pill ds"><small>DIST</small><b id="hDist">0 m</b></div></div></div>
    <div id="banner"><b></b><span></span></div><div id="hint">Swipe ← → to change lanes<br>Swipe ↑ to hop</div><div id="flash"></div><div id="pops"></div>`);
  const $ = (id) => document.getElementById(id);
  const hud = { score: $('hScore'), coins: $('hCoins'), hearts: $('hHearts'), dist: $('hDist'), banner: $('banner'), hint: $('hint'), flash: $('flash'), pops: $('pops') };
  const popEls = Array.from({ length: 10 }, () => { const e = document.createElement('div'); e.className = 'pop'; hud.pops.appendChild(e); return { e, t: 9, x: 0, y: 0 }; });
  let popI = 0;

  // ---------- state / shell ----------
  let lastKm = 0, ri = 0, run = null, track = null, shake = 0, banner = null, endT = -1, flashT = 0, idleT = 0, camX = 0, boostVis = 0, lastHUD = '';
  const sh = RG.shell({
    game: 'rush', title: '🛵 Talabat Rush Run',
    how: '• <b>Swipe left / right</b> to change lanes and <b>swipe up</b> to hop (arrow keys and Space work too).<br>• Hop over <b>cones, barriers and potholes</b> (yellow road marks). <b>Taxis, supercars, double-decker buses and SUVs</b> are too tall, so go round them (red road marks). Watch for <b>flashing orange blinkers</b>: that car is about to switch lanes.<br>• Grab <b>coins</b> (+100). Ride over a glowing <b>green boost pad</b> to smash through anything.<br>• <b>Endless ride</b>: traffic gets faster the further you go. 3 hearts, and the run ends when they are gone. Score = metres ridden + 100 per coin.',
    onReset: newRun, onStart: () => {},
  });
  if (!sh) return;
  // ---------- background music (looping, follows the mute button) ----------
  const music = new Audio('audio/rush-music.m4a'); music.loop = true; music.preload = 'auto'; music.volume = 0.55; music.muted = RG.muted;
  const playMusic = () => { music.muted = RG.muted; const p = music.play(); if (p && p.catch) p.catch(() => {}); };
  ['playBtn', 'againBtn'].forEach((id) => { const b = document.getElementById(id); if (b) b.addEventListener('click', playMusic); });
  const mb = document.getElementById('mute'); if (mb) mb.addEventListener('click', () => setTimeout(() => { music.muted = RG.muted; }, 0));
  document.addEventListener('visibilitychange', () => { if (document.hidden) music.pause(); else if (sh.started || sh.state !== 'ready') playMusic(); });
  function newRun() {
    track = RC.clone(RC.generate((Math.random() * 4294967295) >>> 0));
    run = RC.newRun(track); lastKm = 0; ri = 0; shake = 0; banner = null; endT = -1; flashT = 0; camX = 0; boostVis = 0;
    bike.rotation.set(0, 0, 0); bikeBody.rotation.set(0, 0, 0);
    hud.hint.style.opacity = 1;
  }
  newRun();

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
      run._acc = (run._acc || 0) + dt;   // fixed 120 Hz rule steps, same as the fairness bot
      while (run._acc >= 1 / 120 && !run.done) { RC.step(run, 1 / 120); run._acc -= 1 / 120; }
      for (const ev of run.events) handle(ev);
      run.events.length = 0;
    }
    if (run.done && endT >= 0) {
      endT += dt;
      if (endT > 1.3 && sh.state === 'play') sh.end(RC.score(run), { title: 'Crashed!', line: `${run.coins} coins · ${Math.floor(run.d).toLocaleString('en-US')} m ridden`, delay: 0 });
    }
    if (run && !run.done && Math.floor(run.d / 1000) > lastKm) { lastKm = Math.floor(run.d / 1000); setBanner(`${(lastKm * 1000).toLocaleString('en-US')} m`, 'FASTER!', '#FF5A00', 1.2); }
    shake = Math.max(0, shake - dt); flashT = Math.max(0, flashT - dt);
    if (banner) { banner.t += dt; if (banner.t > banner.dur) banner = null; }
    boostVis += ((run.boost > 0 ? 1 : 0) - boostVis) * Math.min(1, dt * 6);
    stepParticles(dt);
  }
  function setBanner(txt, sub, c, dur) { banner = { txt, sub, c, t: 0, dur }; hud.banner.querySelector('b').textContent = txt; hud.banner.querySelector('span').textContent = sub || ''; hud.banner.style.setProperty('--c', c); hud.banner.classList.remove('show'); void hud.banner.offsetWidth; hud.banner.classList.add('show'); }
  // floating text near the bike (coins are collected at the bike, smashes happen right in front of it)
  function pop(txt, x, y) { const p = popEls[popI]; popI = (popI + 1) % popEls.length; p.e.textContent = txt; p.t = 0; p.dx = x - wx(run.x); p.dy = y; }
  function handle(ev) {
    switch (ev.e) {
      case 'coin': { S.coin(); const x = wx(RC.laneX(ev.c.lane)), y = wy(ev.c.h), z = wz(ev.c.d); burst(x, y, z, 10, ['#ffd23f', '#fff3b0', '#ffb000'], 3, 3); pop('+100', x, y + 0.6, z); break; }
      case 'hop': S.hop(); break;
      case 'land': S.land(); burst(wx(run.x), 0.1, wz(run.d) + 0.6, 6, ['#d8cfc2', '#bdb4a6'], 1.5, 1.2); break;
      case 'lane': S.lane(); break;
      case 'hit': ev.o.hitD = run.d; S.hit(); shake = 0.4; flashT = 0.3; setBanner('OUCH!', run.hearts === 1 ? 'LAST HEART!' : '-1 HEART', '#ff2a4a', 0.9); burst(wx(ev.o.x), 0.8, wz(ev.o.d), 14, ['#ff5a00', '#ffffff', '#333'], 4, 4); if (navigator.vibrate) navigator.vibrate(80); break;
      case 'smash': { S.smash(); shake = Math.max(shake, 0.15); const col = ev.o.kind === 'car' ? ['#f1e4c4', '#d62828', '#2b3542', '#ffd400'] : ev.o.kind === 'hole' ? ['#26221f', '#ffd400', '#5a5e66'] : ['#ff6a00', '#ffffff', '#e3262f']; burst(wx(ev.o.x), 0.9, wz(ev.o.d + ev.o.len / 2), 26, col, 7, 6); pop('SMASH!', wx(ev.o.x), 2, wz(ev.o.d)); break; }
      case 'boost': S.boost(); setBanner('BOOST!', 'SMASH THROUGH!', '#16d98c', 1.1); burst(wx(run.x), 0.3, wz(run.d), 18, ['#3dffc0', '#ffffff'], 4, 3); break;
      case 'crash': endT = 0; RG.sfx.over(); setBanner('CRASHED!', '', '#ff2a4a', 9); break;
      case 'blink': RG.tone({ f: 1400, d: 0.04, type: 'square', v: 0.04 }); RG.tone({ f: 1100, d: 0.04, type: 'square', v: 0.04, delay: 0.18 }); break;
    }
  }

  // ---------- per-frame scene placement ----------
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
  function put(mesh, x, y, z, ry, sx, sy, sz) { Q.setFromAxisAngle(Y, ry || 0); P.set(x, y, z); Sc.set(sx || 1, sy || sx || 1, sz || sx || 1); M.compose(P, Q, Sc); mesh.setMatrixAt(mesh.count++, M); }
  function scenery(bz) {
    for (const m of [palms, lamps, pillars, shrubs]) m.count = 0;
    for (const t of TV) t.mesh.count = 0;
    const zNear = bz + 30, zFar = bz - 380;
    // palms + shrubs on the sand, every 14 m
    for (let i = Math.floor(-zNear / 14); i <= Math.floor(-zFar / 14); i++) for (const sd of [-1, 1]) {
      const z = -i * 14, h = hash(i, sd + 2), j = Math.round((-z - 20) / BOARD);
      if (ads.boards.length && j >= 1 && (j % 2 ? 1 : -1) === sd && Math.abs(z + j * BOARD + 20) < 9) continue;  // keep hoardings clear
      if (palms.count < 80) put(palms, sd * (6.2 + h * 1.5), 0, z, h * 6, 0.85 + h * 0.35);
      if (h > 0.45 && shrubs.count < 80) put(shrubs, sd * (7.5 + h * 3), 0, z - 6, h * 5, 0.8 + h);
    }
    for (let i = Math.floor(-zNear / 30); i <= Math.floor(-zFar / 30); i++) for (const sd of [-1, 1]) { if (lamps.count < 40) put(lamps, sd * 4.05, 0, -i * 30 - 15, sd > 0 ? Math.PI : 0); }
    for (let i = Math.floor(-zNear / 28); i <= Math.floor(-zFar / 28); i++) if (pillars.count < 30) put(pillars, -15, 0, -i * 28);
    // towers: two rows per side, every 26 m
    for (let i = Math.floor(-zNear / 26); i <= Math.floor(-zFar / 26); i++) for (const sd of [-1, 1]) for (const row of [0, 1]) {
      const h = hash(i, sd * 3 + row + 10), v = TV[Math.floor(hash(i, sd * 5 + row + 40) * TV.length)];
      if (h < (row ? 0.15 : 0.3)) continue;   // gaps keep the sky and the Burj in view
      if (v.mesh.count >= 40) continue;
      const w = 12 + h * 8, x = sd * (row ? 70 + h * 30 : (sd < 0 ? 34 : 28) + h * 10), z = -i * 26 - row * 13 - (sd > 0 ? 7 : 0);
      v.mesh.setColorAt(v.mesh.count, TOWER_COLS[Math.floor(hash(i, sd + row * 7 + 60) * TOWER_COLS.length)]);
      put(v.mesh, x, 0, z, (h - 0.5) * 0.3, w, row ? 1.5 : 1, w);
    }
    // metro station (on the viaduct) every STN m
    station.visible = false;
    for (let i = Math.floor(-zNear / STN); i <= Math.floor(-zFar / STN); i++) { const z = -i * STN - STN / 2; if (z < zNear && z > zFar - 20) { station.visible = true; station.position.set(-15, 0, z); break; } }
    // hoardings: roadside boards every BOARD m (alternating sides), footbridges with wide banners every BRIDGE m
    let fi = 0; boardBack.count = 0; boardPost.count = 0; bridges.count = 0;
    const nb = ads.boards.length, nw = ads.wide.length;
    for (let i = Math.floor(-zNear / BOARD); i <= Math.floor(-zFar / BOARD); i++) {
      if (!nb || i < 1 || boardBack.count >= 12) continue;
      const ad = ads.boards[i % nb], sd = i % 2 ? 1 : -1, z = -i * BOARD - 20;
      let h = 5.2, w = h * ad.aspect; if (w > 10) { w = 10; h = w / ad.aspect; }
      const x = sd * (8.4 + w * 0.32), ry = -sd * 0.5, y = 2.6 + h / 2;
      const f = faceGet(fi++); f.visible = true; f.material = ad.mat; f.position.set(x, y, z); f.rotation.set(0, ry, 0); f.scale.set(w, h, 1);
      put(boardBack, x, y, z, ry, w + 0.35, h + 0.35, 1);
      const cx = Math.cos(ry), sx = Math.sin(ry);
      for (const k of [-0.3, 0.3]) put(boardPost, x + cx * w * k, 0, z - sx * w * k - 0.3, ry, 0.35, 2.7, 0.35);
    }
    for (let i = Math.floor(-zNear / BRIDGE); i <= Math.floor(-zFar / BRIDGE); i++) {
      if (i < 1 || bridges.count >= 2) continue;
      const z = -i * BRIDGE - 60; put(bridges, 0, 0, z, 0, 1, 1, 1);
      const ad = nw ? ads.wide[i % nw] : nb ? ads.boards[i % nb] : null; if (!ad) continue;
      let w = 11.6, h = w / ad.aspect; if (h > 2.8) { h = 2.8; w = h * ad.aspect; }
      const f = faceGet(fi++); f.visible = true; f.material = ad.mat; f.position.set(0, 8.55 + h / 2, z + 1.32); f.rotation.set(0, 0, 0); f.scale.set(w, h, 1);
      put(boardBack, 0, 8.55 + h / 2, z + 1.32, 0, w + 0.3, h + 0.3, 1);
    }
    for (let i = fi; i < facePool.length; i++) facePool[i].visible = false;
    for (const m of [boardBack, boardPost, bridges]) m.instanceMatrix.needsUpdate = true;
    for (const m of [palms, lamps, pillars, shrubs]) m.instanceMatrix.needsUpdate = true;
    for (const t of TV) { t.mesh.instanceMatrix.needsUpdate = true; if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true; }
  }
  function placeTrack() {
    const cnt = {}; let wi = 0;
    blinkLamps.count = 0; blinkGlows.count = 0;
    const d0 = run.d - 6, d1 = run.d + VIEW, obs = track.obs;
    while (ri < obs.length && obs[ri].d + obs[ri].len < d0) ri++;
    for (let oi = ri; oi < obs.length; oi++) {
      const o = obs[oi];
      if (o.d > d1) break; if (o.d + o.len < d0) continue;
      if (o.smashed || (o.hit && !o.low && o.d + o.len < run.d - 0.5)) continue;
      const v = variant(o), i = cnt[v] = (cnt[v] || 0), m = poolGet(v, i); cnt[v]++;
      m.visible = true;
      m.position.set(wx(o.x), 0, wz(o.d + o.len / 2));
      m.rotation.set(0, 0, 0);
      if (o.hit && o.kind === 'cone') { m.rotation.z = 1.2 * (o.x < 0 ? 1 : -1); m.position.y = 0.3; }
      if (o.hit && o.kind === 'car') { const k = Math.min(1, (run.d - (o.hitD || run.d)) / 3), sd = o.x < 0 ? -1 : 1; m.position.x += sd * 1.6 * k; m.rotation.y = sd * 0.5 * k; }
      if (v === 'hole') m.scale.set(o.hw * SX / 0.95, 1, o.len * SZ / 1.9); else m.scale.set(1, 1, 1);
      // lane-changer: slight yaw while sliding, blinking lamps + amber stripe in the target lane until it has moved
      const ch = o.to != null && o.t0 >= 0 && !o.hit && run.t - o.t0 < C.BLINK + C.MOVE;
      if (ch) {
        const tt = run.t - o.t0, sd = o.to > o.l0 ? 1 : -1, on = (tt * 2.5) % 1 < 0.7;
        if (tt > C.BLINK) m.rotation.y = -sd * 0.18 * Math.sin(Math.PI * (tt - C.BLINK) / C.MOVE);
        if (on && blinkLamps.count < 15) for (const dz of [-2.1, 2.1]) { const bx = m.position.x + sd * 1.0, bz2 = m.position.z + dz; put(blinkLamps, bx, 0.95, bz2, 0, 1); put(blinkGlows, bx, 1.0, bz2 + 0.3, 0, dz > 0 ? 1.5 : 1); }
        if (o.d > run.d + 2) for (const dz of [3.6, -2.4]) { const w = warnGet(wi++); w.visible = true; w.material = warnMats.turn; w.position.set(wx(RC.laneX(o.to)), 0.036, wz(o.d) + dz); w.material.opacity = on ? 1 : 0.55; }
      }
      // warning stripe in front of the obstacle, while it is still ahead
      if (!o.hit && o.d > run.d + 2) {
        const w = warnGet(wi++); w.visible = true; w.material = o.low ? warnMats.lo : warnMats.hi;
        w.position.set(wx(o.x), 0.035, wz(o.d) + 3.6);
        const far = Math.min(1, Math.max(0, (o.d - run.d - 6) / 20));
        w.material.opacity = 0.55 + 0.35 * Math.sin(idleT * 10) * far;
      }
    }
    blinkLamps.instanceMatrix.needsUpdate = true; blinkGlows.instanceMatrix.needsUpdate = true;
    for (const k in pools) for (let i = cnt[k] || 0; i < pools[k].length; i++) pools[k][i].visible = false;
    for (let i = wi; i < warnPool.length; i++) warnPool[i].visible = false;
    // coins
    coins.count = 0; glows.count = 0;
    const spin = idleT * 4;
    for (let i = Math.max(0, run.ci - 2); i < track.coins.length; i++) {
      const c = track.coins[i]; if (c.d > run.d + 90) break; if (c.got || c.d < d0 || coins.count >= 90) continue;
      const x = wx(RC.laneX(c.lane)), y = wy(c.h) + Math.sin(idleT * 3 + c.d) * 0.06, z = wz(c.d);
      put(coins, x, y, z, spin + c.d * 0.3, 1); put(glows, x, y, z + 0.3, 0, 1);
    }
    coins.instanceMatrix.needsUpdate = true; glows.instanceMatrix.needsUpdate = true;
    // pads
    let pi = 0;
    for (let k = Math.max(0, run.pi - 2); k < track.pads.length; k++) { const p = track.pads[k]; if (p.d + p.len < d0 || p.used) continue; if (p.d > d1) break; const g = padGet(pi++); g.visible = true; g.position.set(wx(RC.laneX(p.lane)), 0, wz(p.d + p.len / 2)); }
    for (let i = pi; i < padPool.length; i++) padPool[i].visible = false;
    padTex.offset.y = (idleT * 1.6) % 1; padGlowMat.opacity = 0.25 + 0.15 * Math.sin(idleT * 8);
  }

  // ---------- render ----------
  const camPos = new THREE.Vector3(), look = new THREE.Vector3();
  function render(dt) {
    const bx = wx(run.x), by = wy(run.h), bz = wz(run.d), bikeZ = bz;
    // bike
    const lean = Math.max(-1, Math.min(1, (RC.laneX(run.lane) - run.x) * 3));
    bike.position.set(bx, by, bikeZ);
    bikeBody.rotation.z += (-lean * 0.38 - bikeBody.rotation.z) * Math.min(1, dt * 14);
    bikeBody.rotation.x = run.hopT >= 0 ? -0.25 * Math.sin(Math.PI * run.hopT / C.HOP_T) : 0;
    for (const w of bike.userData.wheels) w.rotation.x -= (run.v || 0) * SZ * dt / 0.34;
    bike.visible = !(run.inv > 0 && !run.done && Math.floor(run.inv * 12) % 2 === 0);
    if (run.done) { bike.rotation.z = Math.min(1.35, bike.rotation.z + dt * 4); bike.position.y = 0.25; }
    blob.position.set(bx, 0.02, bikeZ + 0.05); blob.material.opacity = 0.12 * (1 - Math.min(0.7, by / 2));
    // camera: behind and above, easing sideways
    camX += (bx * 0.55 - camX) * Math.min(1, dt * 6);
    const sk = shake > 0 ? shake * 0.9 : 0;
    camPos.set(camX + (Math.random() - 0.5) * sk, 4.3 + by * 0.35 + (Math.random() - 0.5) * sk, bz + 7.4 + boostVis * 0.9);
    camera.position.copy(camPos);
    look.set(camX * 0.5, 1.1 + by * 0.25, bz - 16); camera.lookAt(look);
    const fov = baseFov + boostVis * 9; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // world that follows the camera
    sky.position.copy(camPos); sun.position.set(camPos.x + 260, camPos.y + 430, camPos.z - 1300);
    sunL.target.position.set(0, 0, bikeZ - 4); sunL.position.copy(sunL.target.position).add(SUN_OFF);
    sand.position.z = bz - 300;
    road.position.z = Math.round(bz / TILE) * TILE - 220;
    for (const b of barriers) b.position.z = bz - 220;
    deck.position.z = bz - 300;
    const k = Math.min(1, run.d / 3000);
    far.position.set(camPos.x * 0.9, 0, bz - 1180 + k * 320);
    trainZ += 34 * dt; if (trainZ > bz + 40) trainZ = bz - 420 - Math.random() * 200; train.position.set(-15, 9.6, trainZ);
    scenery(bz); placeTrack();
    // speed lines on boost
    lines.material.opacity = boostVis * 0.7; lines.count = 0;
    if (boostVis > 0.02) { for (let i = 0; i < lineSeeds.length; i++) { const s = lineSeeds[i], u = (s.o + idleT * 2.2) % 1; put(lines, camPos.x + Math.cos(s.a) * s.r, camPos.y - 1 + Math.sin(s.a) * s.r * 0.7, camPos.z - 40 + u * 44, 0, 1); } }
    lines.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    drawHUD(dt);
  }

  const proj = new THREE.Vector3();
  function drawHUD(dt) {
    const sc = RC.score(run), key = sc + '|' + run.coins + '|' + run.hearts + '|' + Math.round(run.d);
    if (key !== lastHUD) {
      lastHUD = key;
      hud.score.textContent = sc.toLocaleString('en-US'); hud.coins.textContent = run.coins;
      hud.hearts.innerHTML = Array.from({ length: C.HEARTS }, (_, i) => `<i class="${i < run.hearts ? 'on' : ''}">♥</i>`).join('');
      hud.dist.textContent = Math.floor(run.d).toLocaleString('en-US') + ' m';
    }
    hud.flash.style.opacity = flashT > 0 ? Math.min(0.55, flashT * 1.8) : 0;
    if (!banner) hud.banner.classList.remove('show');
    hud.hint.style.opacity = sh.state === 'play' && run.d < 60 ? 1 : (sh.state === 'play' ? 0 : hud.hint.style.opacity);
    const W = cv.clientWidth, H = cv.clientHeight;
    for (const p of popEls) {
      if (p.t > 0.8) { if (p.e.style.opacity !== '0') p.e.style.opacity = 0; continue; }
      p.t += dt; proj.set(bike.position.x + p.dx, p.dy + 1.6, bike.position.z - 1).project(camera);
      p.e.style.opacity = 1 - p.t / 0.8;
      p.e.style.transform = `translate(${((proj.x + 1) / 2 * W).toFixed(0)}px,${((1 - proj.y) / 2 * H - p.t * 50).toFixed(0)}px) translate(-50%,-50%)`;
    }
  }

  // ---------- adaptive resolution + perf stats ----------
  const perf = { frames: 0, t: 0, fps: 0, worst: 0, slow: 0, pr };
  RG.loop((dt, now) => {
    const t0 = performance.now();
    update(dt); render(dt);
    perf.frames++; perf.t += dt; perf.worst = Math.max(perf.worst, dt);
    if (perf.t >= 1) {
      perf.fps = perf.frames / perf.t;
      // a phone that cannot hold ~45 fps for 3 s in a row renders at a lower pixel ratio
      perf.slow = perf.fps < 45 && sh.state === 'play' ? perf.slow + 1 : 0;
      if (perf.slow >= 3 && pr > 1) { pr = Math.max(1, pr - 0.5); renderer.setPixelRatio(pr); resize(); perf.slow = 0; perf.pr = pr; }
      perf.frames = 0; perf.t = 0; perf.worst = 0;
    }
    perf.cpu = performance.now() - t0;
  });
  // QA helper: which Dubai set pieces are on screen right now (ahead of the bike, inside the view)
  const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), _p = new THREE.Vector3();
  function seen() {
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
    const on = (m, y, far) => m.visible && m.position.z < bike.position.z - 4 && m.position.z > bike.position.z - (far || 400) && fr.containsPoint(_p.set(m.position.x, y == null ? m.position.y : y, m.position.z));
    const any = (k) => (pools[k] || []).some((m) => on(m, 1, 45));
    return { supercar: ['sc0', 'sc1', 'sc2', 'sc3'].some(any), doubleDecker: any('dd'), station: on(station, 10, 200), train: on(train, 11, 150),
      hoarding: facePool.some((m) => on(m, null, 130)), blinker: blinkLamps.count > 0, boards: ads.boards.length + ads.wide.length };
  }
  window.__rush = { run: () => run, act: (a) => act(a), track: () => track, seen, perf: () => ({ ...perf, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }), three: { scene, camera, renderer, bike } };
})();

"""Super Over 3D: screenshots + checks (Playwright + Chrome/SwiftShader).
Usage: python3 tools/qa-so3d.py http://localhost:3000
Shots (mobile 390x844 and desktop 1280x800): ready, aiming, six, wicket, end; plus the 2D fallback. Prints PASS/FAIL lines.
SwiftShader renders on the CPU (a few fps), so game time runs slow here; that is expected."""
import sys, time, json, os, math, urllib.request
from concurrent.futures import ThreadPoolExecutor
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'screenshots', 'so3d')
os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
fails = 0

def check(name, ok, info=''):
    global fails
    fails += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + (f' :: {info}' if info else ''), flush=True)

def api(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}')

def seed():
    riders = [('1000001', 'Ahmed', 30), ('1000002', 'Priya', 24), ('1000003', 'Omar', 18), ('1000004', 'Sara', 12), ('7654321', 'Tester', 6), ('7000007', 'PBcheck', 6)]
    toks = [(rid, nick, sc, api('/api/run', {'riderId': rid, 'game': 'superover'})['token']) for rid, nick, sc in riders]
    time.sleep(16.5)  # anti-cheat: 30 runs needs >= 5 balls of play time
    dev = 'ab' * 16
    for rid, nick, sc, tok in toks:
        r = api('/api/score', {'riderId': rid, 'nickname': nick, 'device': dev, 'game': 'superover', 'score': sc, 'token': tok})
        check(f'seed {nick} {sc}', r.get('ok') is True, str(r))

def open_page(p, mobile, rider, q='high'):
    b = p.chromium.launch(channel='chrome', headless=True, args=ARGS)
    if mobile: ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    else: ctx = b.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    ctx.add_init_script("localStorage.setItem('rg_rider', JSON.stringify({id:'%s',nick:'%s'}))" % rider)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('response', lambda r: errs.append(f'{r.status} {r.url}') if r.status >= 400 else None)
    pg.goto(BASE + '/superover?qa=1' + (f'&q={q}' if q else ''))
    pg.wait_for_load_state('networkidle')
    return b, pg, errs

def shot(pg, name):
    path = os.path.join(OUT, name); pg.screenshot(path=path); print('SHOT', path, flush=True); return path

def st(pg): return pg.evaluate('__so.state()')

def wait_phase(pg, phases, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = st(pg)
        if s['phase'] in phases: return s
        time.sleep(0.1)
    return st(pg)

def wait_settled(pg, timeout=40):
    # the camera eases from the menu orbit to the shooting view; wait until the ball sits on its spot
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate('__so.camSettled()'): return True
        time.sleep(0.3)
    return False

BRAND_JS = r"""() => {
  // only text that is actually painted (icon buttons keep their emoji text at font-size 0 behind an SVG)
  const bad = [], st = document.getElementById('stage'); let txt = '';
  for (const el of st.querySelectorAll('*')) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    if (!/\S/.test(own)) continue;
    const cs = getComputedStyle(el), fam = cs.fontFamily.replace(/["']/g, '').trim(), w = +cs.fontWeight;
    if (parseFloat(cs.fontSize) === 0 || cs.visibility === 'hidden') continue;
    txt += own + ' ';
    if (fam !== 'Poppins' || ![500, 700, 900].includes(w) || cs.fontStyle !== 'normal') bad.push(el.tagName + '#' + el.id + '.' + el.className + ' ' + fam + ' ' + w + ' ' + cs.fontStyle);
  }
  const logos = [...document.querySelectorAll('img.tlogo')].filter((i) => i.offsetParent !== null);
  return {
    bad: bad.slice(0, 6), nBad: bad.length,
    typedBrand: /talabat/i.test(txt),
    oddGlyphs: (txt.match(/[\p{Extended_Pictographic}\u2190-\u21ff\u2600-\u27bf\u22ef]/gu) || []).join(''),
    fonts: ['500', '700', '900'].every((w) => document.fonts.check(w + ' 12px Poppins')),
    logos: logos.map((i) => ({ ok: i.complete && i.naturalWidth === 420, ar: +(i.getBoundingClientRect().width / i.getBoundingClientRect().height).toFixed(3) })),
  };
}"""

def brand_check(pg, tag, need_logo=True):
    r = pg.evaluate(BRAND_JS)
    logos_ok = all(l['ok'] and abs(l['ar'] - 420 / 146) < 0.06 for l in r['logos']) and (len(r['logos']) > 0 or not need_logo)
    check(f'{tag}: Poppins 500/700/900 only, official logo (no typed brand, no emoji)', r['nBad'] == 0 and not r['typedBrand'] and not r['oddGlyphs'] and r['fonts'] and logos_ok, json.dumps(r))


def freeze_banner(pg, text=None):
    # SwiftShader is slow: catch the banner as soon as it is shown and park its animation on the fully visible frame
    cond = "b.classList.contains('show')" + (f" && b.firstElementChild.textContent === '{text}'" if text else '')
    try: pg.wait_for_function("(() => { const b = document.getElementById('banner'); return b && " + cond + "; })()", timeout=45000, polling=20)
    except Exception: pass
    pg.evaluate("(() => { const b = document.getElementById('banner'); if (b) b.getAnimations().forEach((a) => { a.pause(); a.currentTime = 400; }); })()")

def thaw_banner(pg):
    pg.evaluate("(() => { const b = document.getElementById('banner'); if (b) b.getAnimations().forEach((a) => a.play()); })()")

def perfect(pg):
    # tap at the exact ideal contact moment (test hook; same path as a pointer tap)
    s = wait_phase(pg, ('flight',), 40)
    return pg.evaluate('__so.state().phase === "flight" && __so.tap(__so.state().hitAt)')

CLEAR_JS = r"""async (seq) => {
  const r = __so.rig(), bp = r.batPivot, b = r.batter, V = bp.position.constructor;
  const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const body = () => {
    const sph = [];
    const add = (obj, pts, rad, name) => pts.forEach((p) => sph.push([obj.localToWorld(new V(...p)), rad, name]));
    add(b.torso, [[0, 0.05, 0], [0, 0.2, 0], [0, 0.35, 0], [0, 0.5, 0]], 0.17, 'torso');
    add(b.torso, [[0, 0.75, 0]], 0.15, 'head');
    b.legs.forEach((l, i) => add(l, [[0, -0.1, 0], [0, -0.3, 0]], 0.095, 'thigh' + i));
    b.knees.forEach((k, i) => add(k, [[0, 0.05, 0.05], [0, -0.15, 0.05], [0, -0.35, 0.05]], 0.1, 'pad' + i));
    return sph;
  };
  const out = [];
  for (const [a, z, n] of seq) {
    let worst = 9, who = '';
    for (let k = 0; k <= n; k++) {
      __so.pose(a, z, k / n); await frame();
      const sph = body();
      for (let y = -0.2; y >= -0.84; y -= 0.04) for (const x of [-0.054, 0, 0.054]) {
        const p = bp.localToWorld(new V(x, y, 0));
        for (const [c, rad, name] of sph) { const d = p.distanceTo(c) - rad - 0.021; if (d < worst) { worst = d; who = name + '@' + (k / n).toFixed(2); } }
      }
    }
    out.push([a + '->' + z, +worst.toFixed(3), who]);
  }
  __so.pose(null); return out;
}"""
SEQ = [['READY', 'BACK', 8], ['BACK', 'CONTACT', 8]] + [['CONTACT', k, 8] for k in ('loft', 'pull', 'edge', 'miss')] + [['loft', 'READY', 8]]

def wait_until(pg, js, timeout=60, step=0.03):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate(js): return True
        time.sleep(step)
    return False

def detail_views(p):
    """Bowler action, ball-vs-judge timing, and batter close-ups (bat never inside the body)."""
    b, pg, errs = open_page(p, True, ('7654321', 'Tester'))
    time.sleep(2.0)
    # --- batter: bat-vs-body clearance over every pose transition, then close-ups ---
    pg.evaluate("document.querySelectorAll('.ov').forEach(e => e.style.display='none')")
    res = pg.evaluate(CLEAR_JS, SEQ)
    worst = min(r[1] for r in res)
    check('batter: bat never intersects body/pads/head through ready, backlift, swing, follow-through (min clearance m)', worst > 0, json.dumps(res))
    bx, by, bz = pg.evaluate('__so.rig().batterPos')
    views = {'side': [[bx + 1.9, 1.25, bz - 1.2], [bx, 0.95, bz]], 'behind': [[bx + 0.9, 1.7, bz + 2.6], [bx, 0.9, bz - 0.3]]}
    for name, pose in [('ready', ('READY', None, 0)), ('midswing', ('BACK', 'CONTACT', 0.6)), ('follow', ('loft', None, 0))]:
        pg.evaluate(f"__so.pose({json.dumps(pose[0])}, {json.dumps(pose[1])}, {pose[2]})")
        for v, cam in views.items():
            pg.evaluate(f"__so.cam({json.dumps(cam[0])}, {json.dumps(cam[1])})"); time.sleep(0.9)
            shot(pg, f'closeup-batter-{name}-{v}.png')
    pg.evaluate('__so.pose(null); __so.cam(null)')
    pg.evaluate("document.querySelectorAll('.ov').forEach(e => e.style.display='')")
    pg.click('#playBtn'); pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=30000); wait_settled(pg)
    # --- bowler mid-delivery (gather/stride, before release) ---
    ok = wait_until(pg, "__so.state().phase === 'runup' && __so.phaseT() > 0.92 && __so.phaseT() < 1.08", 60, 0.01)
    pg.evaluate('__so.hold(true)'); time.sleep(0.6)
    check('bowler: caught mid-delivery stride', ok, str(pg.evaluate('__so.phaseT()')))
    shot(pg, 'mobile-bowler-delivery.png')
    rx, ry, rz = pg.evaluate('__so.rig().bowlerPos')
    pg.evaluate(f"__so.cam([{rx + 3.2}, 1.7, {rz + 3.6}], [{rx}, 1.3, {rz}])"); time.sleep(0.9)
    shot(pg, 'closeup-bowler-delivery.png')
    pg.evaluate('__so.cam(null); __so.hold(false)')
    # --- ball leaves the hand at the release moment, then tracks the judge's wall-clock path 1:1 ---
    # the next delivery, unheld: sample every rendered frame of the flight (pos and core both use that frame's clock)
    devs, rel, seen = [], None, set()
    wait_until(pg, "!!__so.ball()", 40, 0.002)
    t0 = time.time()
    while time.time() - t0 < 6:
        bl = pg.evaluate('__so.ball()')
        if not bl: break
        if rel is None: rel = bl
        if bl['s'] >= 0.12 and bl['d'] > -0.2 and bl['s'] not in seen:
            seen.add(bl['s']); devs.append(round(max(abs(a - c) for a, c in zip(bl['pos'], bl['core'])), 5))
        time.sleep(0.01)
    check('ball: drawn position = core path at the wall clock (1:1, no post-contact ease)', devs and max(devs) < 0.003, f'max dev {max(devs) if devs else None} m over {len(devs)} frames')
    if rel: check('ball: at release it is in the bowler hand (blends onto the path within 0.12 s)', math.dist(rel['pos'], rel['hand']) < 0.2 + 17 * rel['s'], json.dumps(rel))
    check('detail views: no console/network errors', not errs, str(errs[:4]))
    b.close()

def run_view(p, mobile, rider):
    tag = 'mobile' if mobile else 'desktop'
    b, pg, errs = open_page(p, mobile, rider)
    time.sleep(2.0)
    check(f'{tag}: ready card + WebGL renderer', pg.is_visible('#ready') and pg.evaluate("document.body.classList.contains('pen') && __so.renderer === '3d'"))
    shot(pg, f'{tag}-ready.png')
    brand_check(pg, f'{tag} ready')
    pg.click('#playBtn')
    pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=30000)
    check(f'{tag}: camera settles on the broadcast view', wait_settled(pg))
    info = pg.evaluate('__so.info()'); print('INFO', tag, json.dumps(info), flush=True)
    # --- aiming: ball in the air, before the swing (game time held for the slow SwiftShader capture) ---
    s = wait_phase(pg, ('flight',), 40)
    pg.evaluate('__so.hold(true)')
    s0 = st(pg)
    pg.evaluate('__so.tap(__so.state().hitAt)')          # perfect timing: resolves as soon as time runs again
    bs = pg.evaluate('__so.ballScreen()')
    vw = pg.viewport_size
    check(f'{tag}: delivery in flight is on screen', s['phase'] == 'flight' and bs['visible'] and 0 < bs['x'] < vw['width'] and 0 < bs['y'] < vw['height'], json.dumps(bs))
    shot(pg, f'{tag}-aiming.png')
    brand_check(pg, f'{tag} play HUD')
    pg.evaluate('__so.hold(false)')
    # --- six ---
    freeze_banner(pg, 'SIX!'); pg.evaluate('__so.hold(true)')
    s = st(pg)
    check(f'{tag}: perfect tap scores a SIX', s['runs'] - s0['runs'] == 6, json.dumps([s0, s]))
    chip = pg.inner_text('#tchip')
    check(f'{tag}: timing chip shows the ms offset', 'ms' in chip, chip)
    shot(pg, f'{tag}-six.png')
    pg.evaluate('__so.hold(false)'); thaw_banner(pg)
    # --- wicket: no swing on the next ball ---
    w0 = s['wickets']
    wait_phase(pg, ('runup',), 30)
    freeze_banner(pg, 'BOWLED!'); time.sleep(0.3); pg.evaluate('__so.hold(true)')
    s = st(pg)
    check(f'{tag}: no swing is BOWLED', s['wickets'] == w0 + 1, json.dumps(s))
    shot(pg, f'{tag}-wicket.png')
    pg.evaluate('__so.hold(false)'); thaw_banner(pg)
    # --- second wicket ends the innings ---
    wait_phase(pg, ('runup',), 30)
    pg.wait_for_selector('#over:not(.hide)', timeout=90000)
    try: pg.wait_for_function("document.getElementById('ovBoard') && document.getElementById('ovBoard').style.display !== 'none' && document.getElementById('ovBoard').innerText.length > 10", timeout=20000)
    except Exception: pass
    time.sleep(0.8)
    board = pg.evaluate("(document.getElementById('ovBoard')||{}).innerText || ''")
    check(f'{tag}: end screen shows the leaderboard position', ('YOUR POSITION' in board) or ('WOULD BE' in board), board.replace('\n', ' | '))
    shot(pg, f'{tag}-end.png')
    brand_check(pg, f'{tag} end', need_logo=False)
    check(f'{tag}: no console/network errors', not errs, str(errs[:4]))
    b.close()

with sync_playwright() as p:
    seed()
    run_view(p, True, ('7654321', 'Tester'))
    detail_views(p)
    run_view(p, False, ('4826', 'Admin'))
    # rank chip + PB pill (rider has a seeded best of 6): two sixes pass it
    b, pg, errs = open_page(p, True, ('7000007', 'PBcheck'))
    pg.click('#playBtn'); pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=30000); wait_settled(pg)
    pbchip = pg.inner_text('#pbChip')
    for _ in range(6):
        if st(pg)['runs'] >= 12 or st(pg)['phase'] == 'done': break
        perfect(pg); wait_phase(pg, ('result', 'done'), 30); wait_phase(pg, ('runup', 'done'), 30)
    time.sleep(0.4)
    chip = pg.inner_text('#rank')
    try: pg.wait_for_function("document.getElementById('pb').classList.contains('show')", timeout=20000); pb = True
    except Exception: pb = False
    check('PB chip shows the saved best', pbchip == 'PB 6', pbchip)
    check('live rank chip shows a board position', chip.startswith('#') and 'on the board' in chip, chip)
    check('new personal best pill appears when the run passes the saved best', pb)
    check('pb run: no console/network errors', not errs, str(errs[:4]))
    b.close()
    # 2D fallback + quality switches
    b, pg, errs = open_page(p, True, ('7654321', 'Tester'), q='2d')
    time.sleep(1.0)
    check('2d: fallback renderer (no WebGL module, no 3D HUD)', pg.evaluate("__so.renderer === '2d' && !document.body.classList.contains('pen') && !document.getElementById('hud')"))
    brand_check(pg, '2d ready')
    pg.click('#playBtn'); pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=30000)
    for _ in range(3):
        r0 = st(pg)['runs']
        if perfect(pg): break
    s = wait_phase(pg, ('result',), 30)
    check('2d: perfect tap scores a SIX', s['runs'] - r0 == 6, json.dumps(s))
    time.sleep(0.3); shot(pg, 'mobile-2d-six.png')
    check('2d: no console/network errors', not errs, str(errs[:4]))
    b.close()
    b, pg, errs = open_page(p, True, ('7654321', 'Tester'), q='low')
    time.sleep(1.5)
    check('q=low: locked to quality 0 with a thinner crowd', pg.evaluate('__so.quality()') == 0 and pg.evaluate('__so.info().crowd') < 9000, json.dumps(pg.evaluate('__so.info()')))
    check('q=low: no console/network errors', not errs, str(errs[:4]))
    b.close()
print('RESULT', 'ALL PASS' if fails == 0 else f'{fails} FAIL', flush=True)

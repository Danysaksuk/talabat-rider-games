"""Penalty Shootout 3D: screenshots + checks (Playwright + Chrome/SwiftShader).
Usage: python3 tools/qa-pen3d.py http://localhost:3000
Shots (mobile 390x844 and desktop 1280x800): ready, aiming, goal, save, end. Prints PASS/FAIL lines.
SwiftShader renders on the CPU (a few fps), so game time runs slow here; that is expected."""
import sys, time, json, os, math, urllib.request
from concurrent.futures import ThreadPoolExecutor
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'screenshots', 'pen3d')
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
    riders = [('1000001', 'Ahmed', 1200), ('1000002', 'Priya', 900), ('1000003', 'Omar', 600), ('1000004', 'Sara', 300), ('7654321', 'Tester', 50), ('7000007', 'PBcheck', 50)]
    toks = [(rid, nick, sc, api('/api/run', {'riderId': rid, 'game': 'penalty'})['token']) for rid, nick, sc in riders]
    time.sleep(7.3)
    dev = 'ab' * 16
    for rid, nick, sc, tok in toks:
        r = api('/api/score', {'riderId': rid, 'nickname': nick, 'device': dev, 'game': 'penalty', 'score': sc, 'token': tok})
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
    pg.goto(BASE + '/penalty' + (f'?q={q}' if q else ''))
    pg.wait_for_load_state('networkidle')
    return b, pg, errs

def shot(pg, name):
    path = os.path.join(OUT, name); pg.screenshot(path=path); print('SHOT', path, flush=True); return path

def st(pg): return pg.evaluate('__penalty.state()')

def wait_phase(pg, phases, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = st(pg)
        if s['phase'] in phases or s['over']: return s
        time.sleep(0.1)
    return st(pg)

def wait_settled(pg, timeout=40):
    # the camera eases from the menu orbit to the shooting view; wait until the ball sits on its spot
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate('__penalty.camSettled()'): return True
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

def run_view(p, mobile, rider):
    tag = 'mobile' if mobile else 'desktop'
    b, pg, errs = open_page(p, mobile, rider)
    time.sleep(2.0)
    check(f'{tag}: ready card + WebGL renderer', pg.is_visible('#ready') and pg.evaluate("document.body.classList.contains('pen')"))
    shot(pg, f'{tag}-ready.png')
    brand_check(pg, f'{tag} ready')
    pg.click('#playBtn')
    pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=30000)
    check(f'{tag}: camera settles on the shooting view', wait_settled(pg))
    info = pg.evaluate('__penalty.info()'); print('INFO', tag, json.dumps(info), flush=True)
    # --- aiming: a real pointer drag along a curve to the top-left corner (stop before release) ---
    core_pts = []
    for i in range(0, 31):
        u = i / 30
        x = (1 - u) ** 2 * 180 + 2 * u * (1 - u) * 40 + u * u * 98
        y = (1 - u) ** 2 * 575 + 2 * u * (1 - u) * 340 + u * u * 134
        core_pts.append((x, y))
    scr = [pg.evaluate(f'__penalty.coreToScreen({x},{y})') for x, y in core_pts]
    pg.mouse.move(scr[0]['x'], scr[0]['y']); pg.mouse.down()
    for s in scr[1:27]: pg.mouse.move(s['x'], s['y'], steps=1)
    time.sleep(0.6)
    shot(pg, f'{tag}-aiming.png')
    for s in scr[27:]: pg.mouse.move(s['x'], s['y'], steps=1)
    t_up = time.time(); pg.mouse.up()
    s1 = wait_phase(pg, ('flight', 'result', 'done'), 10)
    check(f'{tag}: drawn curve fires a shot', s1['phase'] in ('flight', 'result', 'done'), str(s1['phase']))
    # the ball must follow the drawn line on screen
    devs = []
    for _ in range(40):
        s = st(pg)
        if s['phase'] != 'flight': break
        bpos = pg.evaluate('__penalty.ballScreen()')
        d = min(math.hypot(bpos['x'] - q['x'], bpos['y'] - q['y']) for q in scr)
        seg_d = min(dist_seg(bpos, scr[i], scr[i + 1]) for i in range(len(scr) - 1))
        devs.append(min(d, seg_d))
        time.sleep(0.05)
    check(f'{tag}: ball follows the drawn curve on screen', devs and max(devs) < 4, f'max dev {max(devs) if devs else None:.2f}px over {len(devs)} samples' if devs else 'no samples')
    r1 = wait_phase(pg, ('result',), 20)['result']
    print('KICK1', r1, flush=True)
    check(f'{tag}: paused mid-drag still gets full power (not TOO WEAK)', bool(r1) and r1['kind'] != 'short', str(r1))
    wait_phase(pg, ('aim',), 30)
    brand_check(pg, f'{tag} play HUD')
    # --- goal moment ---
    f = pg.evaluate("__penalty.find('goal')")
    check(f'{tag}: found a scoring shot', bool(f), str(f))
    s = wait_phase(pg, ('result',), 30)
    try: pg.wait_for_function("(() => { const b = document.getElementById('banner'); return b.classList.contains('show') && +getComputedStyle(b).opacity > 0.95; })()", timeout=5000, polling=30)
    except Exception: pass
    # SwiftShader screenshots take ~1 s; freeze the banner animation at its visible frame for the capture
    pg.evaluate("document.getElementById('banner').getAnimations().forEach((a) => a.pause())")
    check(f'{tag}: goal registered', bool(s['result']) and s['result']['goal'], str(s['result']))
    shot(pg, f'{tag}-goal.png')
    pg.evaluate("document.getElementById('banner').getAnimations().forEach((a) => a.play())")
    wait_phase(pg, ('aim',), 40)
    # --- save ---
    f = pg.evaluate("__penalty.find('save')")
    check(f'{tag}: found a shot the keeper saves', bool(f), str(f))
    s = wait_phase(pg, ('result',), 30)
    try: pg.wait_for_function("(() => { const b = document.getElementById('banner'); return b.classList.contains('show') && +getComputedStyle(b).opacity > 0.95; })()", timeout=5000, polling=30)
    except Exception: pass
    # SwiftShader screenshots take ~1 s; freeze the banner animation at its visible frame for the capture
    pg.evaluate("document.getElementById('banner').getAnimations().forEach((a) => a.pause())")
    check(f'{tag}: save registered', bool(s['result']) and s['result']['kind'] == 'save', str(s['result']))
    shot(pg, f'{tag}-save.png')
    pg.evaluate("document.getElementById('banner').getAnimations().forEach((a) => a.play())")
    # --- miss out to end the run ---
    for _ in range(6):
        s = wait_phase(pg, ('aim',), 40)
        if s['over']: break
        pg.evaluate("__penalty.find('wide') || __penalty.find('over') || __penalty.find('short')")
        time.sleep(0.3)
    pg.wait_for_selector('#over:not(.hide)', timeout=60000)
    try: pg.wait_for_function("document.getElementById('ovBoard') && document.getElementById('ovBoard').style.display !== 'none' && document.getElementById('ovBoard').innerText.length > 10", timeout=20000)
    except Exception: pass
    time.sleep(0.8)
    board = pg.evaluate("(document.getElementById('ovBoard')||{}).innerText || ''")
    check(f'{tag}: end screen shows the leaderboard position', ('YOUR POSITION' in board) or ('WOULD BE' in board), board.replace('\n', ' | '))
    shot(pg, f'{tag}-end.png')
    brand_check(pg, f'{tag} end', need_logo=False)
    check(f'{tag}: no console/network errors', not errs, str(errs[:4]))
    b.close()

def dist_seg(p, a, b):
    ax, ay, bx, by, px, py = a['x'], a['y'], b['x'], b['y'], p['x'], p['y']
    dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy or 1
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - (ax + dx * t), py - (ay + dy * t))

with sync_playwright() as p:
    seed()
    run_view(p, True, ('7654321', 'Tester'))
    run_view(p, False, ('4826', 'Admin'))
    # rank chip + PB banner (mobile rider has a seeded best of 50): one goal is enough
    b, pg, errs = open_page(p, True, ('7000007', 'PBcheck'))
    pg.click('#playBtn'); pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=30000); wait_settled(pg)
    pg.evaluate("__penalty.find('goal')"); wait_phase(pg, ('result',), 30); time.sleep(0.4)
    chip = pg.inner_text('#rank')
    # the PB pill waits for the result banner to clear (one focus at a time); game time runs slow under SwiftShader
    try: pg.wait_for_function("document.getElementById('pb').classList.contains('show')", timeout=20000); pb = True
    except Exception: pb = False
    check('live rank chip shows a board position', chip.startswith('#') and 'on the board' in chip, chip)
    check('new personal best banner appears when the run passes the saved best', pb)
    shot(pg, 'mobile-rank-pb.png')
    b.close()
    # automatic low-quality fallback: SwiftShader at 2x DPR is far below 48 fps, so the governor must step down
    b, pg, errs = open_page(p, True, ('4826', 'Admin'), q=None)
    t0 = time.time(); q = 2
    while time.time() - t0 < 25:
        q = pg.evaluate('__penalty.quality()')
        if q == 0: break
        time.sleep(1)
    info = pg.evaluate('__penalty.info()')
    check('auto quality falls back to low when FPS is poor', q == 0, json.dumps(info))
    shot(pg, 'mobile-lowq-ready.png')
    b.close()
    # no-WebGL fallback path still loads the 2D renderer
    b, pg, errs = open_page(p, True, ('4826', 'Admin'), q='2d')
    time.sleep(1.5)
    pg.click('#playBtn'); pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=30000); time.sleep(0.5)
    check('2D fallback (?q=2d) loads and plays', pg.evaluate("!!window.__penalty && !document.body.classList.contains('pen')") and not errs, str(errs[:3]))
    shot(pg, 'mobile-2d-fallback.png')
    brand_check(pg, '2D fallback', need_logo=False)
    b.close()

print('DONE', 'fails =', fails)
sys.exit(1 if fails else 0)

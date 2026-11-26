"""Stack the Order 3D: checks + screenshots (Playwright + Chrome/SwiftShader).
Usage: python3 tools/qa-stack3d.py http://localhost:3000   (server started with DATA_FILE=... ADMIN_PIN=4826)
Mobile 390x844 (rider 7654321, score saves) and desktop 1280x800 (admin 4826, never saved); ?q=2d and ?q=low.
Drops are aimed with the ?qa hook (__stack.aim / aimDrop: sets the swing angle, then drops exactly like a tap),
because SwiftShader renders a few fps. Boards are reset before and after. Prints PASS/FAIL lines."""
import sys, time, json, os, re, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
PIN = os.environ.get('ADMIN_PIN', '4826')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'screenshots', 'stack3d')
os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
KX = 0.01
fails = 0

def check(name, ok, info=''):
    global fails
    fails += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + (f' :: {info}' if info else ''), flush=True)

def api(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}')

def seed():
    riders = [('1000001', 'Ahmed', 400), ('1000002', 'Priya', 250), ('1000003', 'Omar', 120)]
    toks = [(rid, nick, sc, api('/api/run', {'riderId': rid, 'game': 'stack'})['token']) for rid, nick, sc in riders]
    time.sleep(3.5)
    for rid, nick, sc, tok in toks:
        r = api('/api/score', {'riderId': rid, 'nickname': nick, 'device': 'cd' * 16, 'game': 'stack', 'score': sc, 'token': tok})
        check(f'seed {nick} {sc}', r.get('ok') is True, str(r))

def open_page(p, mobile, rider, q='high', pad=False):
    b = p.chromium.launch(channel='chrome', headless=True, args=ARGS)
    if mobile: ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    else: ctx = b.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    ctx.add_init_script("localStorage.setItem('rg_rider', JSON.stringify({id:'%s',nick:'%s'}))" % rider)
    if pad:  # a fake gamepad whose button 0 follows window.__padDown
        ctx.add_init_script("navigator.getGamepads = () => [{ buttons: [{ pressed: !!window.__padDown }] }];")
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('response', lambda r: errs.append(f'{r.status} {r.url}') if r.status >= 400 else None)
    pg.goto(BASE + '/stack?qa=1' + (f'&q={q}' if q else ''))
    pg.wait_for_load_state('networkidle')
    return b, pg, errs

def shot(pg, name):
    path = os.path.join(OUT, name); pg.screenshot(path=path); print('SHOT', path, flush=True); return path

def st(pg): return pg.evaluate('__stack.state()')

def wait_js(pg, js, timeout=40):
    try: pg.wait_for_function(js, timeout=timeout * 1000, polling=50); return True
    except Exception: return False

def swing(pg): return wait_js(pg, "__stack.state().phase === 'swing'")

def start(pg):
    pg.click('#playBtn'); pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=30000)

def aim_drop(pg, off):
    swing(pg); s0 = st(pg)
    ok = pg.evaluate(f'__stack.aimDrop({off})')
    wait_js(pg, f"__stack.state().landed > {s0['landed']} || __stack.state().over || __stack.state().phase === 'miss'", 20)
    return s0, st(pg), ok

BRAND_JS = r"""() => {
  const bad = [], txt = [];
  for (const el of document.getElementById('stage').querySelectorAll('*')) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    const cs = getComputedStyle(el);
    if (!/\S/.test(own) || parseFloat(cs.fontSize) === 0 || cs.visibility === 'hidden') continue;
    txt.push(own);
    if (cs.fontFamily.replace(/["']/g, '').trim() !== 'Poppins' || ![500, 700, 900].includes(+cs.fontWeight)) bad.push(own.trim().slice(0, 20) + ' ' + cs.fontFamily + ' ' + cs.fontWeight);
  }
  const all = txt.join(' ');
  const logos = [...document.querySelectorAll('#stage img.tlogo')].filter((i) => i.offsetParent !== null).map((i) => i.complete && i.naturalWidth === 420);
  return { bad, emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all), fonts: document.fonts.check('900 20px Poppins'), logos };
}"""
def brand(pg, label):
    r = pg.evaluate(BRAND_JS)
    check(f'{label}: Poppins 500/700/900 only, official logo, no emoji', not r['bad'] and not r['emoji'] and r['fonts'] and r['logos'] and all(r['logos']), json.dumps(r))

def align(pg, label):
    # bag top at y=0 and BAG_W wide; hanging box centre == core x; landed boxes == core x/width (1:1 horizontally)
    pg.wait_for_timeout(700)
    g = pg.evaluate('__stack.geo()')
    errs = [abs(b['x'] - (b['coreX'] - 180) * KX) for b in g['stack']] + [abs(b['w'] - b['coreW'] * KX) for b in g['stack']]
    h = g['hang']
    hang_ok = (not h['visible']) or (abs(h['x'] - h['coreX']) < 1e-6 and abs(h['hookX'] - h['x']) < 1e-6 and abs(h['w'] - h['coreW']) < 1e-6)
    check(f'{label}: bag top y=0 / width BAG_W; boxes and hanging box match the core horizontally; box hangs under the hook',
          g['bagTopY'] == 0 and abs(g['bagW'] - 1.32) < 1e-9 and max(errs or [0]) < 1e-6 and hang_ok, f'max box err {max(errs or [0]):.2e}, hang {json.dumps(h)}')

def mobile_run(p):
    b, pg, errs = open_page(p, True, ('7654321', 'Tester'))
    time.sleep(1.5)
    check('mobile: 3D renderer loaded (WebGL module, compact HUD)', pg.evaluate("__stack.renderer === '3d' && document.body.classList.contains('g3d') && !!document.getElementById('sb')"))
    shot(pg, 'mobile-ready.png'); brand(pg, 'mobile ready')
    start(pg); time.sleep(0.5)
    brand(pg, 'mobile play HUD')
    # 1) overhang slice: 18 core units off-centre trims the box and drops a free chunk
    s0, s1, _ = aim_drop(pg, 18)
    wait_js(pg, '__stack.geo().pieces.some((x) => !x.miss)', 10)   # the chunk shears off when the visual fall lands
    g = pg.evaluate('__stack.geo()')
    check('drop lands a box (+10)', s1['landed'] == 1 and s1['score'] == 10, json.dumps(s1))
    check('overhang sliced: box trimmed to 114 and a falling chunk spawned (not on the cable)', s1['boxW'] == 114 and any(not x['miss'] for x in g['pieces']), json.dumps(g['pieces']))
    # 2) perfects + combo; the 3rd perfect in a row grows the box (WIDTH UP!)
    s0, s1, _ = aim_drop(pg, 0)
    check('perfect: combo x1, +15', s1['combo'] == 1 and s1['perfects'] == 1 and s1['score'] - s0['score'] == 15, json.dumps(s1))
    s0, s1, _ = aim_drop(pg, 2)
    check('perfect within tolerance: combo x2, +20', s1['combo'] == 2 and s1['score'] - s0['score'] == 20, json.dumps(s1))
    s0, s1, _ = aim_drop(pg, 0)
    grow = wait_js(pg, "!!document.querySelector('.pop.grow')", 5)
    check('3rd perfect in a row: width grows by 16 with a WIDTH UP! burst', s1['perfects'] == 3 and abs(s1['boxW'] - (s0['boxW'] + 16)) < 1e-9 and grow, f"{s0['boxW']} -> {s1['boxW']}, pop {grow}")
    align(pg, 'mobile after grow')
    # 3) the perfect shot: slice first, then a perfect; freeze while the gold ring and the chunk are both on screen
    aim_drop(pg, -26)
    swing(pg); pg.evaluate('__stack.aimDrop(0)')
    ring = wait_js(pg, '__stack.info().rings > 0', 10)
    pg.evaluate('__stack.hold(true)'); time.sleep(0.6)
    info = pg.evaluate('__stack.info()')
    check('perfect: gold shockwave ring + PERFECT pop, with the previous slice chunk still falling', ring and info['pieces'] >= 1 and pg.evaluate("!!document.querySelector('.pop:not(.plain)')"), json.dumps(info))
    shot(pg, 'mobile-perfect.png')
    pg.evaluate('__stack.hold(false)')
    for off in (6, -9, 0):
        aim_drop(pg, off)
    swing(pg); time.sleep(1.2)
    s = st(pg)
    check('mid-climb: 4+ boxes stacked', s['landed'] >= 4, json.dumps(s))
    shot(pg, 'mobile-stack.png'); align(pg, 'mobile mid-climb')
    # 4) miss: way off the stack -> tumbles to the street -> game over -> score saved
    score = s['score']
    swing(pg); pg.evaluate('__stack.aimDrop(170)')
    wait_js(pg, "__stack.state().phase === 'miss' || __stack.state().over", 10)
    check('miss: box tumbles away (free body, no box added)', st(pg)['landed'] == s['landed'] and pg.evaluate('__stack.geo().pieces.some((x) => x.miss)'))
    ok = wait_js(pg, "!document.getElementById('over').classList.contains('hide')", 60)
    wait_js(pg, "!!document.getElementById('ovBoard') && document.getElementById('ovBoard').style.display !== 'none'", 30)
    time.sleep(0.5)
    note, board = pg.inner_text('#ovNote'), pg.inner_text('#ovBoard') if pg.query_selector('#ovBoard') else ''
    check('miss ends the run with the summary screen', ok and st(pg)['over'], pg.inner_text('#ovScore'))
    lb = api('/api/leaderboard?game=stack&riderId=7654321')
    check('score saved for rider 7654321 (leaderboard + end panel)', lb.get('me') and lb['me']['score'] == score and 'YOUR POSITION' in board, f"me={lb.get('me')} note={note!r} board={board!r}")
    shot(pg, 'mobile-end.png'); brand(pg, 'mobile end')
    check('mobile: no console/network errors', not errs, str(errs[:4]))
    b.close()

def desktop_run(p):
    b, pg, errs = open_page(p, False, ('4826', 'Admin'), pad=True)
    time.sleep(1.5)
    check('desktop: 3D renderer loaded', pg.evaluate("__stack.renderer === '3d'"))
    start(pg)
    # input paths: Space, Enter, click/tap, gamepad button each drop the (aimed, frozen) box
    for name, act in [('Space', lambda: pg.keyboard.press('Space')), ('Enter', lambda: pg.keyboard.press('Enter')),
                      ('click', lambda: pg.mouse.click(640, 500)), ('gamepad', lambda: (pg.evaluate('window.__padDown = true'), time.sleep(0.7), pg.evaluate('window.__padDown = false')))]:
        swing(pg); n = st(pg)['landed']
        pg.evaluate('__stack.hold(true)'); pg.evaluate('__stack.aim(0)'); act(); dropped = st(pg)['phase'] != 'swing'
        pg.evaluate('__stack.hold(false)')
        wait_js(pg, f'__stack.state().landed > {n}', 10)
        check(f'input: {name} drops the box', dropped and st(pg)['landed'] == n + 1, json.dumps(st(pg)))
    for off in (12, 0):
        aim_drop(pg, off)
    swing(pg); time.sleep(1.2)
    shot(pg, 'desktop-stack.png'); align(pg, 'desktop')
    swing(pg); pg.evaluate('__stack.aimDrop(-170)')
    wait_js(pg, "!document.getElementById('over').classList.contains('hide')", 60)
    wait_js(pg, "document.getElementById('ovNote').textContent.includes('Admin')", 20)
    lb = api('/api/leaderboard?game=stack')
    check('admin 4826: run ends, score NOT saved', 'not saved' in pg.inner_text('#ovNote') and not any(r['riderId'] == '4826' for r in lb.get('top', [])), pg.inner_text('#ovNote'))
    check('desktop: no console/network errors', not errs, str(errs[:4]))
    b.close()

def fallback_runs(p):
    b, pg, errs = open_page(p, True, ('7654321', 'Tester'), q='2d')
    time.sleep(1.0)
    check('2d: fallback renderer (no WebGL module, no 3D HUD)', pg.evaluate("!!window.__stack && !__stack.renderer && !document.body.classList.contains('g3d') && !document.getElementById('hud')"))
    start(pg)
    # drop near the bottom of the swing a few times (2D runs at full speed here)
    for _ in range(3):
        n = st(pg)['landed']
        pg.evaluate("""() => new Promise((res) => { const t0 = performance.now(); (function f() { const s = __stack.state();
          if (s.phase === 'swing' && Math.abs(s.theta) < 0.03) { __stack.drop(); return res(true); } if (performance.now() - t0 > 8000) return res(false); requestAnimationFrame(f); })(); })""")
        wait_js(pg, f'__stack.state().landed > {n} || __stack.state().over', 5)
    time.sleep(0.6)
    s = st(pg)
    check('2d: drops land boxes', s['landed'] >= 2, json.dumps(s))
    shot(pg, 'mobile-2d.png')
    check('2d: no console/network errors', not errs, str(errs[:4]))
    b.close()
    b, pg, errs = open_page(p, True, ('7654321', 'Tester'), q='low')
    time.sleep(1.5)
    info = pg.evaluate('__stack.info()')
    check('q=low: locked to quality 0 at reduced resolution', pg.evaluate('__stack.quality()') == 0 and info['pixelRatio'] <= 0.85, json.dumps(info))
    start(pg); aim_drop(pg, 0)
    check('q=low: plays (perfect drop)', st(pg)['perfects'] == 1, json.dumps(st(pg)))
    check('q=low: no console/network errors', not errs, str(errs[:4]))
    b.close()

with sync_playwright() as p:
    check('boards reset (start)', api(f'/api/reset?pin={PIN}', {}).get('ok') is True)
    seed()
    mobile_run(p)
    desktop_run(p)
    fallback_runs(p)
    check('boards reset (after)', api(f'/api/reset?pin={PIN}', {}).get('ok') is True)
print('RESULT', 'ALL PASS' if fails == 0 else f'{fails} FAIL', flush=True)

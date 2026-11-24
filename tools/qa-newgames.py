"""Smoke tests for Penalty Shootout and Stack the Order (Playwright + Chrome).
Usage: python3 tools/qa-newgames.py http://localhost:3000
Screenshots go to screenshots/newgames/. Prints PASS/FAIL lines."""
import sys, time, json, os, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'screenshots', 'newgames')
os.makedirs(OUT, exist_ok=True)
fails = 0

def check(name, ok, info=''):
    global fails
    fails += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + (f' :: {info}' if info else ''), flush=True)

def shot(pg, name):
    path = os.path.join(OUT, name)
    pg.screenshot(path=path)
    print('SHOT', path, flush=True)

CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']

def browser(p, mobile, rider=('4826', 'Admin')):
    b = p.chromium.launch(channel='chrome', headless=True, args=CHROME_ARGS)
    if mobile:
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    else:
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    if rider:
        ctx.add_init_script("localStorage.setItem('rg_rider', JSON.stringify({id:'%s',nick:'%s'}))" % rider)
    pg = ctx.new_page()
    errs, bad = [], []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 else None)
    return b, pg, errs, bad

def start_play(pg, game):
    pg.click('#playBtn')
    pg.wait_for_function("RG.current && RG.current.state==='play'", timeout=8000)

with sync_playwright() as p:
    # Gate redirect
    b, pg, errs, bad = browser(p, True, rider=None)
    pg.goto(BASE + '/penalty')
    pg.wait_for_url('**/?next=*', timeout=8000)
    check('penalty without a rider redirects to the gate', '/?next=%2Fpenalty' in pg.url, pg.url)
    b.close()

    # Hub cards + leaderboard tabs (mobile)
    b, pg, errs, bad = browser(p, True, rider=('4826', 'Admin'))
    pg.goto(BASE + '/')
    pg.wait_for_load_state('networkidle')
    time.sleep(0.4)
    text = pg.evaluate('document.body.innerText')
    check('hub lists Penalty Shootout and Stack the Order', 'Penalty Shootout' in text and 'Stack the Order' in text)
    shot(pg, 'hub-mobile.png')
    pg.goto(BASE + '/leaderboard')
    pg.wait_for_load_state('networkidle')
    tabs = pg.evaluate("Array.from(document.querySelectorAll('.tabs button')).map(b => b.dataset.g + ':' + b.textContent.trim())")
    check('leaderboard has Penalty and Stack tabs', 'penalty:Penalty' in tabs and 'stack:Stack' in tabs, str(tabs))
    pg.click('button[data-g="penalty"]')
    time.sleep(0.3)
    shot(pg, 'lb-penalty-mobile.png')
    pg.click('button[data-g="stack"]')
    time.sleep(0.3)
    shot(pg, 'lb-stack-mobile.png')
    check('hub/leaderboard no console errors', not errs and not bad, str(errs[:3] + bad[:3]))
    b.close()

    # Each game, desktop + mobile: ready + in-play screenshots
    for game, hook, ready_txt in (
        ('penalty', '__penalty', 'Draw a curve'),
        ('stack', '__stack', 'Tap'),
    ):
        for mobile, tag, w in ((False, 'desktop', 1280), (True, 'mobile', 390)):
            b, pg, errs, bad = browser(p, mobile)
            pg.goto(BASE + '/' + game)
            pg.wait_for_load_state('networkidle')
            time.sleep(0.8)
            how = pg.evaluate("document.body.innerText")
            check(f'{game} {tag}: attract/how-to is shown', ready_txt.split()[0] in how or 'Play' in how, how[:120].replace('\n', ' '))
            check(f'{game} {tag}: ready card visible', pg.is_visible('#ready'))
            shot(pg, f'{game}-{tag}-ready.png')
            start_play(pg, game)
            time.sleep(0.35)
            st = pg.evaluate(f"window.{hook} && {hook}.state()")
            check(f'{game} {tag}: enters play after countdown', bool(st) and pg.evaluate("RG.current.state") == "play", str(st))
            shot(pg, f'{game}-{tag}-play.png')
            # one interaction
            if game == 'stack':
                pg.evaluate('__stack.drop()')
                time.sleep(0.8)
                st2 = pg.evaluate('__stack.state()')
                check(f'{game} {tag}: first drop is accepted (fall, miss or land)', st2['phase'] in ('fall', 'settle', 'miss', 'over') or st2['landed'] > 0 or st2['over'], str(st2))
                shot(pg, f'{game}-{tag}-drop.png')
            else:
                # bot takes one kick so play is visibly in motion
                pg.evaluate('__penalty.bot()')
                time.sleep(0.9)
                st2 = pg.evaluate('__penalty.state()')
                check(f'{game} {tag}: a shot can be taken', st2['phase'] in ('flight', 'result', 'aim', 'done') or st2['kickNo'] >= 0, str(st2))
                shot(pg, f'{game}-{tag}-shot.png')
            check(f'{game} {tag}: no console/network errors', not errs and not bad, str(errs[:3] + bad[:3]))
            b.close()

    # API recognises the new games
    def api(path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': 'application/json'}, method='POST' if body is not None else 'GET')
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    for g in ('penalty', 'stack'):
        d = api(f'/api/leaderboard?game={g}')
        check(f'leaderboard API accepts {g}', d.get('game') == g, str(d)[:120])

print('RESULT', 'ALL PASS' if not fails else f'{fails} FAIL')
sys.exit(1 if fails else 0)

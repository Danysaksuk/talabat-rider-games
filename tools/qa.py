"""End-to-end QA for Talabat Rider Games (Playwright + Chrome).
Usage: python3 tools/qa.py <base_url> <part>   part = gate|hoops|superover|rush|api|board|desktop
Writes screenshots to screenshots/ and prints PASS/FAIL lines."""
import sys, time, json, os, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

BASE, PART = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'screenshots')
os.makedirs(SHOTS, exist_ok=True)
results = []

def check(name, ok, info=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + f'[{PART}] {name}' + (f' :: {info}' if info else ''), flush=True)

def shot(pg, name): pg.screenshot(path=os.path.join(SHOTS, name))

def api(path, body=None, expect_json=True):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': 'application/json'}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode(); return r.status, (json.loads(raw) if expect_json else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw

def browser(p, w=390, h=844, mobile=True, rider=('7700001', 'QA Bot')):
    b = p.chromium.launch(channel='chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, has_touch=mobile, is_mobile=mobile)
    if rider: ctx.add_init_script("localStorage.setItem('rg_rider', JSON.stringify({id:'%s',nick:'%s'}))" % rider)
    pg = ctx.new_page(); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return b, pg, errs

SWIPE_JS = """async ([x0,y0,x1,y1,ms]) => {
  const c = document.getElementById('c'), n = Math.max(3, Math.round(ms/16));
  const ev = (t,x,y) => c.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,pointerId:7,pointerType:'touch',isPrimary:true,bubbles:true}));
  ev('pointerdown',x0,y0);
  for (let i=1;i<=n;i++){ await new Promise(r=>setTimeout(r,ms/n)); ev('pointermove',x0+(x1-x0)*i/n,y0+(y1-y0)*i/n); }
  ev('pointerup',x1,y1);
}"""

HIDE_JS = """(h) => { Object.defineProperty(document, 'hidden', { get: () => h, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => (h ? 'hidden' : 'visible'), configurable: true });
  document.dispatchEvent(new Event('visibilitychange')); }"""

def buttons_tappable(pg, where):
    # Back and Mute must be the top element at their centre (not covered by the Ready/Game-Over card)
    hit = pg.evaluate("""() => ['back','mute'].map(id => { const b = document.getElementById(id).getBoundingClientRect();
      const el = document.elementFromPoint(b.x + b.width/2, b.y + b.height/2); return el && (el.id === id || el.closest('#' + id)) ? id : (el ? el.id || el.tagName : null); })""")
    m0 = pg.text_content('#mute'); pg.click('#mute'); m1 = pg.text_content('#mute'); pg.click('#mute')
    check(f'Back and Mute tappable on the {where} card (blocker 3)', hit == ['back', 'mute'] and m0 != m1, f'{hit} mute {m0}->{m1}')

def over_info(pg):
    return pg.evaluate("({score:document.getElementById('ovScore').textContent,best:document.getElementById('ovBest').textContent,rank:document.getElementById('ovRank').textContent,note:document.getElementById('ovNote').textContent,title:document.getElementById('ovTitle').textContent})")

def wait_over(pg, timeout):
    pg.wait_for_selector('#over:not(.hide)', timeout=timeout * 1000)
    pg.wait_for_function("!document.getElementById('ovNote').textContent.startsWith('Saving')", timeout=10000)
    return over_info(pg)

with sync_playwright() as p:
    if PART == 'gate':
        b, pg, errs = browser(p, rider=None)
        pg.goto(BASE + '/hoops'); pg.wait_for_url('**/?next=*')
        check('game page without rider redirects to gate', '/?next=%2Fhoops' in pg.url, pg.url)
        check('gate visible', pg.is_visible('#gate'))
        shot(pg, 'gate-mobile.png')
        for bad in ['ab', 'TR-12', 'tr 123', 'TR_99']:
            pg.fill('#rid', bad); pg.click('#gateForm button')
            check(f'rejects rider ID "{bad}"', 'Rider ID must be' in pg.text_content('#err') and pg.is_visible('#gate'))
        check('rider ID input capped at 12 chars', pg.get_attribute('#rid', 'maxlength') == '12')
        pg.fill('#rid', 'tr12345'); pg.fill('#nick', 'Speedy Sam'); pg.click('#gateForm button')
        pg.wait_for_url('**/hoops')
        check('valid ID continues to the requested game', pg.url.endswith('/hoops'))
        stored = pg.evaluate("JSON.parse(localStorage.getItem('rg_rider'))")
        check('rider stored uppercase in localStorage', stored == {'id': 'TR12345', 'nick': 'Speedy Sam'}, str(stored))
        pg.goto(BASE + '/'); pg.wait_for_selector('#hub:not([hidden])')
        check('hub greets rider', 'Speedy Sam' in pg.text_content('#hiName') and pg.text_content('#hiId') == 'TR12345')
        m0 = pg.text_content('#mute'); pg.click('#mute'); m1 = pg.text_content('#mute')
        check('mute toggle switches and persists', m0 != m1 and pg.evaluate("localStorage.getItem('rg_muted')") in ('0', '1'))
        pg.click('#mute')
        check('no console errors', not errs, str(errs)); b.close()

    elif PART == 'hoops':
        b, pg, errs = browser(p)
        pg.goto(BASE + '/hoops'); time.sleep(0.6); shot(pg, 'hoops-ready.png')
        buttons_tappable(pg, 'Ready')
        pg.click('#playBtn'); time.sleep(3.4)
        pg.keyboard.press('Space'); time.sleep(0.3)
        check('Space no longer throws a free perfect shot (blocker 2)', pg.evaluate('__hoops.state().shots') == 0)
        check('countdown finished, game running', pg.evaluate('__hoops.state().t') > 0.1)
        # real swipe gestures (pointer events with real timing)
        for _ in range(3):
            s0 = pg.evaluate('__hoops.state().shots'); pg.evaluate(SWIPE_JS, [195, 720, 197, 480, 140]); time.sleep(1.4)
            check('swipe gesture throws a ball', pg.evaluate('__hoops.state().shots') == s0 + 1)
        pg.evaluate(SWIPE_JS, [195, 720, 260, 715, 140]); time.sleep(0.3)
        st = pg.evaluate('__hoops.state()')
        check('sideways drag does not throw', st['shots'] == 3)
        shot(pg, 'hoops-play.png')
        makes0 = st['makes']
        shot_taken = False
        # Aim at the hoop as you SEE it (no manual lead), one shot every 1.3 s; count makes per phase.
        phase = {}
        while pg.evaluate('__hoops.state().t') < 58.2:
            st = pg.evaluate('__hoops.state()')
            k = 'static 0-20s' if st['t'] < 20 else 'moving 20-40s' if st['t'] < 40 else 'fast 40-60s'
            pg.evaluate('__hoops.throwBall(1, __hoops.slopeFor(__hoops.state().hx))'); time.sleep(1.3)
            a = phase.setdefault(k, [0, 0]); a[0] += 1; a[1] += pg.evaluate('__hoops.state().makes') - st['makes']
            if not shot_taken and st['t'] > 27: shot(pg, 'hoops-moving-hoop.png'); shot_taken = True
        for k in ['moving 20-40s', 'fast 40-60s']:
            m = phase.get(k, [0, 0])
            check(f'moving hoop makeable by aiming at the visible hoop, {k} (blocker 1)', m[0] >= 5 and m[1] >= 0.7 * m[0], f'{m[1]}/{m[0]} made')
        st = pg.evaluate('__hoops.state()')
        check('scored baskets during the run', st['makes'] > makes0 and st['score'] > 0, f"makes={st['makes']} shots={st['shots']} score={st['score']}")
        info = wait_over(pg, 20)
        shot(pg, 'hoops-over.png')
        buttons_tappable(pg, 'Game-Over')
        check('game over screen with score/best/rank', info['rank'].startswith('#') and info['best'] != '–', str(info))
        check('submitted score equals game score', int(info['score'].replace(',', '')) == st['score'], f"{info['score']} vs {st['score']}")
        check('no console errors', not errs, str(errs)); b.close()

    elif PART == 'superover':
        b, pg, errs = browser(p)
        pg.goto(BASE + '/superover'); pg.wait_for_selector('#back', timeout=20000); time.sleep(0.6); shot(pg, 'superover-ready.png')  # renderer loads async (3D module or 2D fallback)
        buttons_tappable(pg, 'Ready')
        pg.click('#playBtn'); time.sleep(3.2)
        # blocker 4: hide the tab mid-delivery for 3 s -> paused, ball re-bowled, no wicket, 3-2-1 on return
        pg.wait_for_function("__so.state().phase==='flight'", timeout=10000)
        b0 = pg.evaluate('__so.state()'); pg.evaluate(HIDE_JS, True); time.sleep(3)
        paused = pg.evaluate('RG.current.state'); shot(pg, 'superover-paused.png')
        pg.evaluate(HIDE_JS, False); time.sleep(0.3); cd = pg.evaluate('RG.current.state')
        pg.wait_for_function("RG.current.state==='play'", timeout=6000)
        b1 = pg.evaluate('__so.state()')
        check('hidden tab mid-delivery: pauses, resumes with 3-2-1, no wicket or ball lost (blocker 4)',
              paused == 'paused' and cd == 'countdown' and b1['wickets'] == 0 and b1['ball'] == b0['ball'] and b1['phase'] == 'runup', f'{paused} -> {cd}; before {b0} after {b1}')
        offsets = [0, 0, 70, -120, 20, 0, 0, -60, 10, 0]
        TAP = "(off)=>new Promise(r=>{const h=__so.state().hitAt;const f=()=>{if(performance.now()>=h+off){__so.tap(performance.now());r();}else requestAnimationFrame(f)};f()})"
        got = []
        for i, off in enumerate(offsets):
            pg.wait_for_function("__so.state().phase==='flight'", timeout=10000)
            r0 = pg.evaluate('__so.state().runs'); pg.evaluate(TAP, off)
            if i == 1: time.sleep(0.35); shot(pg, 'superover-six.png')
            pg.wait_for_function("__so.state().phase!=='flight'", timeout=10000)
            got.append(pg.evaluate('__so.state().runs') - r0)
        check('timing windows: perfect=6, good=4, early/late=1-2', got[0] == 6 and got[1] == 6 and got[2] == 4 and got[3] in (1, 2), str(got))
        st = pg.evaluate('__so.state()')
        check('over 1 target chased, moved to over 2', st['over'] == 2 and st['wickets'] == 0, str(st))
        # one real tap via the mouse (timing is whatever it is)
        pg.wait_for_function("__so.state().phase==='flight'", timeout=10000); pg.mouse.click(200, 500)
        pg.wait_for_function("__so.state().phase!=='flight'", timeout=10000)
        check('real tap resolves the ball', True, str(pg.evaluate('__so.state()')))
        # stop batting: ignored balls are bowled; 2 wickets ends the innings
        pg.wait_for_function("__so.state().wickets>=1", timeout=30000); shot(pg, 'superover-wicket.png')
        runs = pg.evaluate('__so.state().runs')
        info = wait_over(pg, 40)
        shot(pg, 'superover-over.png')
        buttons_tappable(pg, 'Game-Over')
        check('2 wickets ends the game; result saved', info['rank'].startswith('#') and int(info['score']) == runs, str(info))
        check('no console errors', not errs, str(errs)); b.close()

    elif PART == 'rush':
        b, pg, errs = browser(p)
        pg.goto(BASE + '/rush'); time.sleep(0.8); shot(pg, 'rush-ready.png')
        buttons_tappable(pg, 'Ready')
        pg.click('#playBtn'); time.sleep(3.3)
        d0 = pg.evaluate('__rush.run().d'); pg.evaluate(HIDE_JS, True); time.sleep(1.5); d1 = pg.evaluate('__rush.run().d')
        pg.evaluate(HIDE_JS, False); pg.wait_for_function("RG.current.state==='play'", timeout=6000); time.sleep(0.5); d2 = pg.evaluate('__rush.run().d')
        check('Rush auto-pauses when hidden and resumes after 3-2-1 (blocker 4)', abs(d1 - d0) < 1.0 and d2 > d1 + 3, f'd {d0:.1f} -> {d1:.1f} (hidden) -> {d2:.1f}')
        lane0 = pg.evaluate('__rush.run().lane'); pg.evaluate(SWIPE_JS, [200, 600, 120, 605, 100]); time.sleep(0.2)
        check('swipe left changes lane', pg.evaluate('__rush.run().lane') == lane0 - 1)
        pg.evaluate(SWIPE_JS, [200, 600, 280, 600, 100]); time.sleep(0.1)
        pg.evaluate(SWIPE_JS, [200, 600, 202, 480, 100]); time.sleep(0.15)
        check('swipe up hops', pg.evaluate('__rush.run().h') > 0.2)
        pg.keyboard.press('ArrowRight'); time.sleep(0.05)
        check('arrow key changes lane', pg.evaluate('__rush.run().lane') == lane0 + 1)
        pg.add_script_tag(path=os.path.join(ROOT, 'tools', 'autopilot.js')); pg.evaluate('__autopilot()')
        time.sleep(4); shot(pg, 'rush-play.png')
        boost_shot = False; t0 = time.time(); coin_shot = False
        while time.time() - t0 < 110:
            r = pg.evaluate("(()=>{const r=__rush.run();return {d:r.d,boost:r.boost,done:r.done,hearts:r.hearts,coins:r.coins}})()")
            if r['done']: break
            if not boost_shot and r['boost'] > 1.0: shot(pg, 'rush-boost.png'); boost_shot = True
            if not coin_shot and r['d'] > 900: shot(pg, 'rush-midrun.png'); coin_shot = True
            time.sleep(0.25)
        time.sleep(0.5); shot(pg, 'rush-delivered.png')
        r = pg.evaluate("(()=>{const r=__rush.run();return {d:r.d,delivered:r.delivered,hearts:r.hearts,coins:r.coins,hits:r.hits,score:RushCore.score(r)}})()")
        check('autopilot reaches the DELIVERED arch', r['delivered'], str(r))
        check('boost pad triggered at least once', boost_shot)
        info = wait_over(pg, 10); shot(pg, 'rush-over.png')
        buttons_tappable(pg, 'Game-Over')
        check('delivery bonus in final score and saved', int(info['score'].replace(',', '')) == r['score'] and info['rank'].startswith('#'), str(info))
        check('no console errors', not errs, str(errs)); b.close()

    elif PART == 'api':
        s, d = api('/api/run', {'riderId': 'a!', 'game': 'hoops'}); check('invalid rider id rejected', s == 400, str(d))
        s, d = api('/api/run', {'riderId': 'APIB1', 'game': 'chess'}); check('unknown game rejected', s == 400, str(d))
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'superover', 'score': 10, 'token': 'f' * 32}); check('forged token rejected', s == 403, str(d))
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'superover', 'score': 10}); check('missing token rejected', s == 403, str(d))
        _, t1 = api('/api/run', {'riderId': 'APIB1', 'game': 'superover'})
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'superover', 'score': 10, 'token': t1['token']}); check('run shorter than minimum rejected', s == 422, str(d))
        toks = [api('/api/run', {'riderId': 'APIB1', 'game': 'superover'})[1]['token'] for _ in range(5)]
        tw = api('/api/run', {'riderId': 'APIB2', 'game': 'superover'})[1]['token']
        tr = api('/api/run', {'riderId': 'APIB1', 'game': 'rush'})[1]['token']
        # seed 25 riders for the leaderboard (superover + rush), all scoring above QA001
        seeds = [(f'SEED{i:02d}', api('/api/run', {'riderId': f'SEED{i:02d}', 'game': 'superover', 'nickname': f'Rider {i}'})[1]['token'],
                  api('/api/run', {'riderId': f'SEED{i:02d}', 'game': 'rush', 'nickname': f'Rider {i}'})[1]['token']) for i in range(1, 26)]
        # blocker 7 setup: device-bound nicknames
        DEV_A, DEV_B = 'a' * 32, 'b' * 32
        nk = [api('/api/run', {'riderId': 'NICK1', 'game': 'superover'})[1]['token'] for _ in range(3)]
        tg = api('/api/run', {'riderId': 'TAGS1', 'game': 'superover'})[1]['token']
        t_rush_tamper = api('/api/run', {'riderId': 'TAMP1', 'game': 'rush'})[1]['token']
        t_so_tamper = api('/api/run', {'riderId': 'TAMP1', 'game': 'superover'})[1]['token']
        time.sleep(4.3)
        s, d = api('/api/score', {'riderId': 'TAMP1', 'game': 'rush', 'score': 7700, 'token': t_rush_tamper})
        check('tampered Rush score 7,700 with a valid token at 4 s rejected (blocker 6)', s == 422, str(d))
        time.sleep(1.8)
        s, d = api('/api/score', {'riderId': 'TAMP1', 'game': 'superover', 'score': 30, 'token': t_so_tamper})
        check('Super Over 30 runs at 6 s rejected: more than 6 x balls possible (blocker 6)', s == 422, str(d))
        th = api('/api/run', {'riderId': 'APIB1', 'game': 'hoops'})[1]['token']  # ~39 s before submit, under the 58 s minimum
        time.sleep(39)
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'superover', 'score': 401, 'token': toks[0]}); check('score above game max rejected', s == 422, str(d))
        s, d = api('/api/score', {'riderId': 'APIB9', 'game': 'superover', 'score': 20, 'token': toks[1]}); check('token for a different rider rejected', s == 403, str(d))
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'rush', 'score': 20, 'token': toks[2]}); check('token for a different game rejected', s == 403, str(d))
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'superover', 'score': 20, 'token': toks[3]}); check('valid score accepted', s == 200 and d['best'] == 20 and d['improved'], str(d))
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'superover', 'score': 20, 'token': toks[3]}); check('replayed token rejected', s == 403, str(d))
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'superover', 'score': 12, 'token': toks[4]}); check('lower score keeps best', s == 200 and d['best'] == 20 and not d['improved'], str(d))
        s, d = api('/api/score', {'riderId': 'APIB2', 'game': 'superover', 'score': 300, 'token': tw}); check('implausible score for elapsed time rejected', s == 422, str(d))
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'hoops', 'score': 30, 'token': th}); check('hoops run under 58 s rejected', s == 422, str(d))
        s, d = api('/api/score', {'riderId': 'APIB1', 'game': 'rush', 'score': 3000, 'token': tr}); check('rush score accepted', s == 200, str(d))
        for i, (rid, ts, trk) in enumerate(seeds):
            api('/api/score', {'riderId': rid, 'game': 'superover', 'score': 60 + i, 'token': ts})
            api('/api/score', {'riderId': rid, 'game': 'rush', 'score': 5000 + i * 300, 'token': trk})
        s, d = api('/api/leaderboard?game=superover&riderId=APIB1')
        check('leaderboard top 20 + own rank outside top 20', s == 200 and len(d['top']) == 20 and d['me'] and d['me']['rank'] > 20, json.dumps(d['me']))
        check('leaderboard sorted by score desc', all(d['top'][i]['score'] >= d['top'][i + 1]['score'] for i in range(19)))
        s, o = api('/api/leaderboard?game=overall&riderId=APIB1')
        check('overall leaderboard removed (400)', s == 400, json.dumps(o))
        s, o = api('/api/leaderboard?riderId=APIB1')
        check('leaderboard defaults to hoops', s == 200 and o['game'] == 'hoops', o.get('game'))
        s, d = api('/api/me?riderId=APIB1'); check('/api/me returns per-game best and rank only', d['games']['superover']['best'] == 20 and d['games']['rush']['best'] == 3000 and d['games']['hoops'] is None and 'overall' not in d['games'], json.dumps(d['games']))
        s, d = api('/api/export?pin=0000', expect_json=False); check('export with wrong PIN refused', s == 403)
        s, d = api('/api/export?pin=4826&game=superover', expect_json=False)
        rows = d.splitlines()
        check('per-game export CSV with correct PIN', s == 200 and rows[0] == 'game,rank,rider_id,nickname,best,plays,best_at_utc' and rows[1].startswith('superover,1,SEED25,') and all(r.startswith('superover,') for r in rows[1:]), rows[1] if len(rows) > 1 else d)
        s, d = api('/api/export?pin=4826', expect_json=False)
        games = {r.split(',')[0] for r in d.splitlines()[1:]}
        check('export without game lists each scored game separately', s == 200 and {'superover', 'rush'} <= games <= {'hoops', 'superover', 'rush'} and 'overall' not in d, str(games))
        s, d = api('/api/export?pin=4826&game=overall', expect_json=False); check('export rejects overall', s == 400)
        s, d = api('/api/reset?pin=0000', {}); check('reset with wrong PIN refused', s == 403)
        # blocker 7: nicknames
        name = lambda rid: (api('/api/leaderboard?game=superover&riderId=' + rid)[1]['me'] or {}).get('nickname')
        s, d = api('/api/score', {'riderId': 'NICK1', 'game': 'superover', 'score': 10, 'token': nk[0], 'nickname': 'Alice', 'device': DEV_A})
        check('first accepted score creates the rider with its nickname', s == 200 and name('NICK1') == 'Alice', str(d))
        api('/api/run', {'riderId': 'NICK1', 'game': 'rush', 'nickname': 'Hijacked', 'device': DEV_B})
        check('/api/run cannot rename an existing rider (blocker 7)', name('NICK1') == 'Alice', name('NICK1'))
        s, d = api('/api/score', {'riderId': 'NICK1', 'game': 'superover', 'score': 12, 'token': nk[1], 'nickname': 'Bob', 'device': DEV_B})
        check('score from another device counts but cannot rename (blocker 7)', s == 200 and d['best'] == 12 and name('NICK1') == 'Alice', name('NICK1'))
        s, d = api('/api/score', {'riderId': 'NICK1', 'game': 'superover', 'score': 5, 'token': nk[2], 'nickname': 'Alice Two', 'device': DEV_A})
        check('the bound device can rename on a successful score (blocker 7)', s == 200 and name('NICK1') == 'Alice Two', name('NICK1'))
        n0 = api('/api/leaderboard?game=rush')[1]['total']; api('/api/run', {'riderId': 'NOSCORE1', 'game': 'rush', 'nickname': 'Ghost'})
        s, me = api('/api/me?riderId=NOSCORE1')
        check('/api/run creates no rider record without a score', api('/api/leaderboard?game=rush')[1]['total'] == n0 and all(v is None for v in me['games'].values()))
        s, d = api('/api/score', {'riderId': 'TAGS1', 'game': 'superover', 'score': 3, 'token': tg, 'nickname': '<script>alert(1)</script>Zed', 'device': 'c' * 32})
        check('nickname tags / angle brackets stripped server-side', s == 200 and '<' not in name('TAGS1') and 'script' not in name('TAGS1'), repr(name('TAGS1')))
        req = urllib.request.Request(BASE + '/api/score', data=b'{bad json', headers={'Content-Type': 'application/json'}, method='POST')
        try: urllib.request.urlopen(req); code, body = 200, ''
        except urllib.error.HTTPError as e: code, body = e.code, e.read().decode()
        check('malformed JSON gets a JSON 400 without a stack trace', code == 400 and body.startswith('{') and 'node_modules' not in body and ' at ' not in body, body[:80])
        import subprocess
        r = subprocess.run(['node', os.path.join(ROOT, 'tools', 'check-limits.js')], capture_output=True, text=True)
        for line in r.stdout.strip().splitlines(): check('limits: ' + line[5:] + ' (blockers 5+6)', line.startswith('PASS'))

    elif PART == 'ratelimit':
        codes = [api('/api/run', {'riderId': 'RATE1', 'game': 'rush'})[0] for _ in range(260)]
        check('rate limit returns 429 after 240 writes/min per IP', codes.count(429) > 0 and codes[:240].count(200) == 240, f'200s={codes.count(200)} 429s={codes.count(429)}')

    elif PART == 'board':
        b, pg, errs = browser(p)
        pg.goto(BASE + '/'); pg.wait_for_selector('#hub:not([hidden])'); time.sleep(0.8)
        bests = pg.eval_on_selector_all('.best', 'els=>els.map(e=>e.textContent)')
        check('hub shows best + rank per game', all('Your best' in x for x in bests), str(bests))
        check('hub shows no overall total', pg.locator('#overall').count() == 0 and 'Overall' not in pg.text_content('#hub'))
        shot(pg, 'hub-mobile.png')
        pg.goto(BASE + '/leaderboard'); pg.wait_for_selector('.lr'); time.sleep(0.4)
        check('no Overall tab; Hoops tab is default with own row highlighted', pg.locator('.tabs button').count() == 3 and pg.locator('.tabs button[data-g=overall]').count() == 0 and pg.is_visible('.tabs button.on[data-g=hoops]') and pg.locator('.lr.me').count() == 1)
        for gid in ['hoops', 'superover', 'rush']:
            pg.click(f'.tabs button[data-g={gid}]'); pg.wait_for_function(f"document.querySelector('.tabs .on').dataset.g==='{gid}' && !document.querySelector('.empty')"); time.sleep(0.4)
            mine = pg.locator('.lr.me').count(); gap = pg.locator('.lr.gap').count()
            rk = pg.locator('.lr.me .rk').first.text_content() if mine else ''
            check(f'{gid} tab lists riders with own row', mine == 1, f'rank={rk} gap_row={gap}')
            shot(pg, f'leaderboard-{gid}.png')
        pg.click('.tabs button[data-g=superover]'); time.sleep(0.6)
        check('own row shown below top 20 with gap marker when outside', pg.locator('.lr.gap').count() == 1 and pg.locator('.lr').count() == 22)
        upd0 = pg.text_content('#upd'); time.sleep(11); upd1 = pg.text_content('#upd')
        check('auto-refresh every 10 s', upd0 != upd1, f'{upd0} -> {upd1}')
        check('no console errors', not errs, str(errs)); b.close()

    elif PART == 'desktop':
        b, pg, errs = browser(p, 1280, 800, mobile=False)
        pg.goto(BASE + '/'); time.sleep(0.6); shot(pg, 'desktop-hub.png')
        pg.goto(BASE + '/leaderboard'); pg.wait_for_selector('.lr'); time.sleep(0.4); shot(pg, 'desktop-leaderboard.png')
        for gid in ['hoops', 'superover', 'rush']:
            pg.goto(BASE + '/' + gid); time.sleep(0.5); pg.click('#playBtn'); time.sleep(3.4)
            if gid == 'hoops':
                box = pg.locator('#c').bounding_box(); x = box['x'] + box['width'] / 2
                pg.mouse.move(x, box['y'] + box['height'] * 0.85); pg.mouse.down()
                for i in range(1, 9): pg.mouse.move(x, box['y'] + box['height'] * (0.85 - 0.04 * i)); time.sleep(0.016)
                pg.mouse.up(); time.sleep(0.5)
                check('desktop: mouse drag throws', pg.evaluate('__hoops.state().shots') == 1)
                pg.keyboard.press('Space'); time.sleep(0.6)
                check('desktop: Space does not throw (mouse drag only)', pg.evaluate('__hoops.state().shots') == 1)
            if gid == 'superover':
                pg.wait_for_function("__so.state().phase==='flight'", timeout=8000); pg.keyboard.press('Space')
                pg.wait_for_function("__so.state().phase!=='flight'", timeout=8000)
                check('desktop: Space swings', pg.evaluate('__so.state().ball') == 1)
            if gid == 'rush':
                l0 = pg.evaluate('__rush.run().lane'); pg.keyboard.press('ArrowLeft'); time.sleep(0.1)
                check('desktop: arrow keys steer', pg.evaluate('__rush.run().lane') == l0 - 1)
                pg.keyboard.press('ArrowUp'); time.sleep(0.15)
            shot(pg, f'desktop-{gid}.png')
            box = pg.locator('#stage').bounding_box()
            check(f'desktop: {gid} keeps a portrait frame', box['height'] > box['width'], str(box))
        check('no console errors', not errs, str(errs)); b.close()

print(f'SUMMARY [{PART}] {sum(results)}/{len(results)} passed', flush=True)
sys.exit(0 if all(results) else 1)

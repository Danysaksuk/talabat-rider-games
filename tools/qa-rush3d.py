"""Playtest for the 3D Rush Run (Playwright + Chrome, software WebGL).
Usage: python3 tools/qa-rush3d.py http://localhost:3400
Screenshots go to screenshots/rush3d/. Prints PASS/FAIL lines and perf numbers."""
import sys, time, json, os, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'screenshots', 'rush3d'); os.makedirs(OUT, exist_ok=True)
fails = 0
def check(name, ok, info=''):
    global fails; fails += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + (f' :: {info}' if info else ''), flush=True)
def shot(pg, name): pg.screenshot(path=os.path.join(OUT, name))
SWIPE = """async ([x0,y0,x1,y1]) => { const c=document.getElementById('c'); const ev=(t,x,y)=>c.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,pointerId:7,pointerType:'touch',isPrimary:true,bubbles:true}));
  ev('pointerdown',x0,y0); for(let i=1;i<=6;i++){ await new Promise(r=>setTimeout(r,16)); ev('pointermove',x0+(x1-x0)*i/6,y0+(y1-y0)*i/6);} ev('pointerup',x1,y1); }"""
RUN = "(()=>{const r=__rush.run();return {d:r.d,lane:r.lane,h:r.h,boost:r.boost,done:r.done,delivered:r.delivered,hearts:r.hearts,coins:r.coins,hits:r.hits,score:RushCore.score(r)}})()"
# watches hops that clear a cone/pothole in the bike's lane, and smashes
MON = """window.__mon={hopOver:0,smash:0,boostSeen:0,minFps:999}; setInterval(()=>{const r=__rush.run(); if(!r||r.done)return; if(r.boost>0)__mon.boostSeen=1;
  for(const o of r.track.obs){ if(o.d>r.d+1)break; if(o.low&&!o.hit&&!o._over&&o.lane===r.lane&&r.h>RushCore.C.LOW_CLEAR&&o.d<r.d+0.45&&o.d+o.len>r.d-0.45){o._over=1;__mon.hopOver++;} if(o.smashed&&!o._sm){o._sm=1;__mon.smash++;} } },8);"""

def browser(p, rider):
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.add_init_script("localStorage.setItem('rg_rider', JSON.stringify({id:'%s',nick:'%s'}))" % rider)
    pg = ctx.new_page(); errs, bad = [], []
    pg.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 else None)
    pg.on('requestfailed', lambda r: bad.append(f'failed {r.url}'))
    return b, pg, errs, bad

with sync_playwright() as p:
    # ---- part 1: controls, hit, hop, boost-smash (admin rider: nothing saved) ----
    b, pg, errs, bad = browser(p, ('4826', 'Admin'))
    pg.goto(BASE + '/rush'); pg.wait_for_load_state('networkidle'); time.sleep(1.2)
    shot(pg, 'rush3d-start.png')
    assets = pg.evaluate("performance.getEntriesByType('resource').map(e=>e.name.replace(location.origin,''))")
    check('page + assets load (no 4xx/5xx, three.js vendored locally)', not bad and any('/vendor/three.min.js' in a for a in assets) and not any(a.startswith('http') for a in assets), f'{len(assets)} assets {bad}')
    pg.click('#playBtn'); pg.wait_for_function("RG.current.state==='play'", timeout=8000); time.sleep(0.3)
    pg.evaluate(MON)
    l0 = pg.evaluate('__rush.run().lane'); pg.evaluate(SWIPE, [200, 600, 110, 604]); time.sleep(0.25)
    check('swipe left changes lane', pg.evaluate('__rush.run().lane') == l0 - 1)
    pg.evaluate(SWIPE, [200, 600, 290, 600]); time.sleep(0.25)
    pg.keyboard.press('ArrowRight'); time.sleep(0.1)
    check('arrow key changes lane', pg.evaluate('__rush.run().lane') == l0 + 1)
    pg.keyboard.press('ArrowLeft'); time.sleep(0.2)
    pg.evaluate(SWIPE, [200, 600, 203, 470]); time.sleep(0.2)
    check('swipe up hops', pg.evaluate('__rush.run().h') > 0.3)
    # hit: ride into the first tall obstacle
    first = pg.evaluate("(()=>{const r=__rush.run(),i=r.track.obs.findIndex(o=>!o.low&&o.d>r.d+8);return {i,lane:r.track.obs[i].lane,d:r.track.obs[i].d}})()")
    pg.wait_for_function("__rush.run().h===0", timeout=3000)
    pg.evaluate("(l)=>{const r=__rush.run(); while(r.lane>l)__rush.act('left'); while(r.lane<l)__rush.act('right');}", first['lane'])
    pg.wait_for_function(f"__rush.run().d>{first['d'] - 3}", timeout=20000); h0 = pg.evaluate('__rush.run().hearts')
    pg.wait_for_function(f"__rush.run().d>{first['d'] + 1}", timeout=20000); time.sleep(0.12)
    shot(pg, 'rush3d-hit.png')
    r = pg.evaluate(RUN); hit = pg.evaluate(f"__rush.track().obs[{first['i']}].hit===true")
    check('riding into a taxi/bus costs a heart', hit and r['hearts'] == h0 - 1, f'hearts {h0}->{r["hearts"]} {r}')
    # boost smash: give the boost (as a pad does) and steer into the next tall obstacle
    nxt = pg.evaluate("(()=>{const r=__rush.run(),i=r.track.obs.findIndex(o=>!o.low&&o.d>r.d+12);return {i,lane:r.track.obs[i].lane,d:r.track.obs[i].d}})()")
    pg.wait_for_function(f"__rush.run().d>{nxt['d'] - 12} && __rush.run().inv===0", timeout=20000)
    h0 = pg.evaluate("(l)=>{const r=__rush.run(); r.boost=RushCore.C.BOOST_T; while(r.lane>l)__rush.act('left'); while(r.lane<l)__rush.act('right'); return r.hearts;}", nxt['lane'])
    pg.wait_for_function(f"__rush.run().d>{nxt['d'] + 1}", timeout=20000)
    r = pg.evaluate(RUN); sm = pg.evaluate(f"__rush.track().obs[{nxt['i']}].smashed===true")
    check('boost smashes a taxi/bus without losing a heart', sm and r['hearts'] == h0, f'hearts {h0}->{r["hearts"]} smashed={sm}')
    # hop: autopilot hops cones/potholes in its lane
    pg.add_script_tag(path=os.path.join(ROOT, 'tools', 'autopilot.js')); pg.evaluate('__autopilot()')
    t0 = time.time()
    while time.time() - t0 < 40 and pg.evaluate('__mon.hopOver') < 2: time.sleep(0.3)
    m = pg.evaluate('__mon'); check('hop clears cones / potholes in the lane', m['hopOver'] >= 2, str(m))
    check('no console errors (controls run)', not errs, str(errs[:3])); b.close()

    # ---- part 2: full autopilot run to the drop-off, score saved for a real rider ID ----
    b, pg, errs, bad = browser(p, ('7654321', 'QA Rider'))
    pg.goto(BASE + '/rush'); pg.wait_for_load_state('networkidle'); time.sleep(1)
    pg.click('#playBtn'); pg.wait_for_function("RG.current.state==='play'", timeout=8000)
    pg.evaluate(MON); pg.add_script_tag(path=os.path.join(ROOT, 'tools', 'autopilot.js')); pg.evaluate('__autopilot()')
    mid = boost = False; perf = []; t0 = time.time()
    while time.time() - t0 < 150:
        r = pg.evaluate(RUN)
        if r['done']: break
        if not boost and r['boost'] > 1.4: time.sleep(0.25); shot(pg, 'rush3d-boost.png'); boost = True
        if not mid and r['d'] > 520:
            near = pg.evaluate("(()=>{const r=__rush.run();return r.track.obs.filter(o=>o.d>r.d+6&&o.d<r.d+40&&!o.smashed).length})()")
            if near >= 2: shot(pg, 'rush3d-midrun.png'); mid = True
        if int(time.time() - t0) % 5 == 0: perf.append(pg.evaluate('__rush.perf()'))
        time.sleep(0.2)
    r = pg.evaluate(RUN); m = pg.evaluate('__mon')
    check('autopilot reaches the DROP-OFF arch', r['delivered'], str(r))
    check('a boost pad fired during the run', m['boostSeen'] == 1, str(m))
    time.sleep(0.4); shot(pg, 'rush3d-delivered.png')
    pg.wait_for_selector('#over:not(.hide)', timeout=10000)
    pg.wait_for_function("!document.getElementById('ovNote').textContent.startsWith('Saving')", timeout=10000)
    ov = pg.evaluate("({score:ovScore.textContent,rank:ovRank.textContent,note:ovNote.textContent})")
    shot(pg, 'rush3d-gameover.png')
    check('server accepted the full-run score', int(ov['score'].replace(',', '')) == r['score'] and ov['rank'].startswith('#'), str(ov))
    lb = json.loads(urllib.request.urlopen(BASE + '/api/leaderboard?game=rush').read())
    check('score is on the Rush leaderboard', any(t['riderId'] == '7654321' and t['score'] == r['score'] for t in lb['top']), json.dumps(lb['top'][:3]))
    check('no console errors (full run)', not errs and not bad, str(errs[:3] + bad[:3]))
    fps = [x['fps'] for x in perf if x['fps']]
    print('PERF', json.dumps({'fps_avg': round(sum(fps) / max(1, len(fps)), 1), 'fps_min': round(min(fps or [0]), 1), 'cpu_ms_last': perf[-1]['cpu'] if perf else None, 'draw_calls': max(x['calls'] for x in perf), 'triangles': max(x['tris'] for x in perf), 'pixel_ratio_end': perf[-1]['pr'] if perf else None}))
    b.close()
print('RESULT', 'ALL PASS' if not fails else f'{fails} FAIL')
sys.exit(1 if fails else 0)

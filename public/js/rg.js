// Talabat Rider Games: shared helpers (rider identity, API, audio, game shell).
(function () {
  'use strict';
  const RG = (window.RG = {});
  const LS = window.localStorage;

  // ---------- rider identity ----------
  RG.RIDER_RE = /^[0-9]{1,7}$/;
  RG.rider = function () {
    try { const r = JSON.parse(LS.getItem('rg_rider') || 'null'); return r && RG.RIDER_RE.test(r.id) ? r : null; } catch (e) { return null; }
  };
  // Per-device secret: binds a rider ID to the phone that first scored with it (only that phone can rename).
  RG.device = function () {
    let d = LS.getItem('rg_device');
    if (!/^[a-f0-9]{32}$/.test(d || '')) {
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      d = Array.from(a, (x) => x.toString(16).padStart(2, '0')).join(''); LS.setItem('rg_device', d);
    }
    return d;
  };
  RG.setRider = function (id, nick) { RG.device(); LS.setItem('rg_rider', JSON.stringify({ id: id.toUpperCase(), nick: (nick || '').trim().slice(0, 16) })); };
  RG.clearRider = function () { LS.removeItem('rg_rider'); };
  RG.GAMES = {
    hoops: { name: 'Basketball Shootout', short: 'Hoops' },
    superover: { name: 'Super Over', short: 'Super Over' },
    rush: { name: 'Talabat Rush Run', short: 'Rush Run' },
  };

  RG.api = async function (path, body) {
    const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const res = await fetch(path, opt);
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) { const err = new Error(data.error || 'HTTP ' + res.status); err.status = res.status; throw err; }
    return data;
  };

  // ---------- audio (tiny WebAudio synth) ----------
  let ac = null, master = null, noiseBuf = null;
  RG.muted = LS.getItem('rg_muted') === '1';
  RG.audioUnlock = function () {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = RG.muted ? 0 : 0.6; master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  };
  RG.setMuted = function (m) {
    RG.muted = m; LS.setItem('rg_muted', m ? '1' : '0');
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, ac.currentTime, 0.02);
    document.querySelectorAll('.mute-btn').forEach((b) => { b.textContent = m ? '🔇' : '🔊'; b.setAttribute('aria-label', m ? 'Unmute' : 'Mute'); });
  };
  // tone({f, f2, d, type, v, delay})
  RG.tone = function (o) {
    if (!ac || RG.muted) return;
    const t = ac.currentTime + (o.delay || 0), d = o.d || 0.12;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.v || 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + d + 0.02);
  };
  // noise({d, v, f, f2, q, filter, delay})
  RG.noise = function (o) {
    if (!ac || RG.muted) return;
    const t = ac.currentTime + (o.delay || 0), d = o.d || 0.2;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const flt = ac.createBiquadFilter(); flt.type = o.filter || 'bandpass'; flt.Q.value = o.q || 1;
    flt.frequency.setValueAtTime(o.f || 1200, t);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, t + d);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.v || 0.3, t + (o.a || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + d + 0.02);
  };
  RG.sfx = {
    beep: () => RG.tone({ f: 660, d: 0.15, type: 'square', v: 0.15 }),
    go: () => { RG.tone({ f: 880, d: 0.3, type: 'square', v: 0.18 }); RG.tone({ f: 1320, d: 0.3, type: 'square', v: 0.1, delay: 0.05 }); },
    over: () => [523, 440, 349, 262].forEach((f, i) => RG.tone({ f, d: 0.22, type: 'triangle', v: 0.25, delay: i * 0.14 })),
    win: () => [523, 659, 784, 1047].forEach((f, i) => RG.tone({ f, d: 0.25, type: 'square', v: 0.14, delay: i * 0.1 })),
  };

  // ---------- canvas sizing ----------
  // Fits canvas to its CSS box at device resolution. Logical width = lw units; height follows aspect.
  RG.fit = function (canvas, lw, onResize) {
    function apply() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      const scale = canvas.width / lw;
      const info = { W: lw, H: canvas.height / scale, scale, dpr, cssW: r.width, cssH: r.height };
      onResize && onResize(info);
    }
    window.addEventListener('resize', apply);
    apply();
  };

  // ---------- main loop ----------
  RG.loop = function (step) {
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      step(dt, now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  // ---------- game shell: ready -> countdown -> play -> over ----------
  RG.shell = function (cfg) {
    if (document.fonts) ['500 12px Poppins', '700 12px Poppins', '900 12px Poppins', '8px "Press Start 2P"'].forEach((f) => document.fonts.load(f).catch(() => {}));
    const rider = RG.rider();
    if (!rider) { location.replace('/?next=' + encodeURIComponent(location.pathname)); return null; }
    document.body.classList.add('game');
    const stage = document.getElementById('stage');
    stage.insertAdjacentHTML('beforeend', `
      <a id="back" class="hbtn" href="/" aria-label="Back to games">←</a>
      <button id="mute" class="hbtn mute-btn" aria-label="Mute"></button>
      <div id="cd" class="hide"></div>
      <div id="rot">📱<b>Rotate your phone to portrait</b>The game is paused.</div>
      <div id="ready" class="ov">
        <h2>${cfg.title}</h2>
        <p>Rider <b>${rider.nick ? esc(rider.nick) + ' · ' : ''}${rider.id}</b></p>
        <div class="how">${cfg.how}</div>
        <button class="btn" id="playBtn">Play</button>
      </div>
      <div id="over" class="ov hide">
        <div id="ovTag"></div>
        <h2 id="ovTitle">Game over</h2>
        <div class="big" id="ovScore">0</div>
        <p id="ovLine"></p>
        <div class="stats">
          <div class="stat"><b id="ovBest">–</b><span>Best</span></div>
          <div class="stat"><b id="ovRank">–</b><span>Rank</span></div>
        </div>
        <div class="row">
          <button class="btn" id="againBtn">Play again</button>
          <a class="btn ghost" id="lbBtn" href="/leaderboard?game=${cfg.game}" style="text-decoration:none">Leaderboard</a>
        </div>
        <div class="note" id="ovNote"></div>
      </div>`);
    const $ = (id) => document.getElementById(id);
    RG.setMuted(RG.muted);
    $('mute').addEventListener('click', (e) => { e.stopPropagation(); RG.audioUnlock(); RG.setMuted(!RG.muted); });
    ['pointerdown', 'touchstart'].forEach((ev) => { $('mute').addEventListener(ev, (e) => e.stopPropagation()); $('back').addEventListener(ev, (e) => e.stopPropagation()); });

    const sh = { state: 'ready', rider, token: null, runId: 0, started: false };
    let tokenP = null, cdId = 0;
    const rotMQ = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
    const blocked = () => document.hidden || rotMQ.matches;

    // 3-2-1-GO, then done(). Cancelled if the game is paused or restarted meanwhile.
    function countdown(done) {
      const cd = $('cd'), seq = ['3', '2', '1', 'GO!'], id = ++cdId;
      let i = 0;
      cd.classList.remove('paused');
      (function next() {
        if (id !== cdId) return;
        if (i >= seq.length) { cd.classList.add('hide'); done(); return; }
        cd.textContent = seq[i]; cd.classList.remove('hide', 'pop'); void cd.offsetWidth; cd.classList.add('pop');
        (i < 3 ? RG.sfx.beep : RG.sfx.go)();
        i++; setTimeout(next, i < 4 ? 750 : 450);
      })();
    }
    function go() {
      sh.state = 'play';
      if (!sh.started) { sh.started = true; cfg.onStart && cfg.onStart(); } else if (cfg.onResume) cfg.onResume();
    }
    function start() {
      RG.audioUnlock();
      $('ready').classList.add('hide'); $('over').classList.add('hide');
      sh.state = 'countdown'; sh.started = false;
      sh.runId++;
      sh.token = null;
      tokenP = RG.api('/api/run', { riderId: rider.id, game: cfg.game })
        .then((d) => (sh.token = d.token)).catch(() => null);
      cfg.onReset && cfg.onReset();
      if (blocked()) { pause(); return; }
      countdown(go);
    }
    // Auto-pause when the tab is hidden, the window loses focus or the phone is in landscape;
    // resume with a fresh 3-2-1. Games freeze their own clocks while sh.state !== 'play'.
    function pause() {
      if (sh.state !== 'play' && sh.state !== 'countdown') return;
      cdId++;
      if (sh.state === 'play' && cfg.onPause) cfg.onPause();
      sh.state = 'paused';
      const cd = $('cd'); cd.textContent = 'PAUSED'; cd.classList.remove('hide', 'pop'); cd.classList.add('paused');
    }
    function resume() {
      if (sh.state !== 'paused' || blocked() || !document.hasFocus()) return;
      sh.state = 'countdown';
      countdown(go);
    }
    sh.pause = pause; sh.resume = resume; RG.current = sh;
    document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
    window.addEventListener('blur', pause);
    window.addEventListener('focus', resume);
    rotMQ.addEventListener && rotMQ.addEventListener('change', () => (rotMQ.matches ? pause() : resume()));
    $('playBtn').addEventListener('click', start);
    $('againBtn').addEventListener('click', start);

    sh.end = async function (score, opts) {
      if (sh.state !== 'play') return;
      opts = opts || {};
      sh.state = 'over';
      score = Math.max(0, Math.floor(score));
      $('ovTitle').textContent = opts.title || 'Game over';
      $('ovScore').textContent = score.toLocaleString('en-US');
      $('ovLine').innerHTML = opts.line || '';
      $('ovTag').innerHTML = ''; $('ovBest').textContent = '…'; $('ovRank').textContent = '…';
      $('ovNote').textContent = 'Saving your score…';
      const run = sh.runId;
      setTimeout(() => { if (run === sh.runId && sh.state === 'over') $('over').classList.remove('hide'); }, opts.delay != null ? opts.delay : 900);
      let note = '';
      try {
        await tokenP;
        if (!sh.token) throw new Error('offline');
        const d = await RG.api('/api/score', { riderId: rider.id, nickname: rider.nick, device: RG.device(), game: cfg.game, score, token: sh.token });
        sh.lastResult = d;
        if (d.admin) { $('ovBest').textContent = '–'; $('ovRank').textContent = '–'; $('ovNote').textContent = 'Admin test run, so this score was not saved.'; return; }
        $('ovBest').textContent = d.best.toLocaleString('en-US');
        $('ovRank').textContent = '#' + d.rank;
        if (d.improved && d.score > 0) $('ovTag').innerHTML = '<span class="newbest">NEW BEST!</span>';
        note = `Rank #${d.rank} of ${d.total} riders`;
      } catch (e) {
        $('ovBest').textContent = '–'; $('ovRank').textContent = '–';
        note = e.message === 'offline' ? 'Could not reach the server, so this score was not saved.' : 'Score not saved: ' + e.message;
      }
      $('ovNote').textContent = note;
    };
    return sh;
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  RG.esc = esc;
})();

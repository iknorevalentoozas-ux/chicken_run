// Chicken Run — browser client: menus, networking, client-side prediction, rendering, input.
(() => {
  'use strict';
  const { C, COLORS } = CR;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const now = () => performance.now();
  const clamp = CR.clamp;

  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) document.body.classList.add('desktop');

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ------------------------------------------------------------ state
  let ws = null, wsQueue = [];
  let myId = null, room = null, screen = 'menu', rtt = 0.1, lanBase = null;

  const G = {
    active: false, map: null, players: new Map(), token: 0,
    snapMt: 0, snapAt: 0, kl: C.CAM_START, klv: 0, ft: null, gotSnap: false,
    body: null, myState: 'spectator', seq: 0, lastSeq: 0, pending: [], acc: 0,
    off: { x: 0, y: 0 }, danger: 0, dashQ: 0, prevCd: 0, phase: 0,
    renderT: 0, camY: -2, spec: null, specWait: 0, deathPos: null,
    corpses: [], parts: [], shake: 0, lastCount: null, total: 0,
  };

  const attract = { map: CR.buildMap(20240601), camY: -1, t: 0 };

  // ------------------------------------------------------------ screens / UI helpers
  function show(name) {
    screen = name;
    $('menu').classList.toggle('hidden', name !== 'menu');
    $('lobby').classList.toggle('hidden', name !== 'lobby');
    $('results').classList.toggle('hidden', name !== 'results');
    $('hud').classList.toggle('hidden', name !== 'game');
    if (name !== 'game') {
      big('', '', '', 0);
      $('flash').style.opacity = 0;
      joy = null;
    }
  }

  let toastT = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  let bigUntil = 0, bigKind = '';
  function big(text, sub = '', cls = 'pop', dur = 1.2) {
    const b = $('bigText');
    b.className = '';
    void b.offsetWidth; // restart CSS animation
    if (text && cls) b.className = cls;
    b.textContent = text;
    $('subText').textContent = sub;
    bigUntil = dur ? now() + dur * 1000 : Infinity;
    bigKind = text ? cls : '';
  }

  function feed(text, evil) {
    const f = $('feed'), d = document.createElement('div');
    d.textContent = text;
    if (evil) d.className = 'evil';
    f.appendChild(d);
    while (f.children.length > 4) f.firstChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 500); }, 3500);
  }

  const textCache = new Map();
  function setText(id, v) {
    if (textCache.get(id) === v) return;
    textCache.set(id, v);
    $(id).textContent = v;
  }

  // ------------------------------------------------------------ networking
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => {
      for (const m of wsQueue) ws.send(m);
      wsQueue = [];
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      handle(m);
    };
    ws.onclose = () => {
      ws = null;
      if (screen !== 'menu' || G.active) {
        toast('หลุดการเชื่อมต่อ 😢');
        resetToMenu();
      }
    };
  }

  function send(m) {
    const s = JSON.stringify(m);
    if (ws && ws.readyState === 1) ws.send(s);
    else if (m.t !== 'i') { wsQueue.push(s); connect(); }
  }

  setInterval(() => { if (ws && ws.readyState === 1) send({ t: 'ping', c: now() }); }, 2000);

  function handle(m) {
    switch (m.t) {
      case 'joined': myId = m.id; $('menuErr').textContent = ''; break;
      case 'lobby': onLobby(m); break;
      case 'start': onStart(m); break;
      case 's': if (G.active) onSnap(m); break;
      case 'ev': if (G.active) onEvent(m); break;
      case 'results': onResults(m); break;
      case 'error':
        if (screen === 'menu') $('menuErr').textContent = m.msg;
        else toast(m.msg);
        break;
      case 'pong': rtt = rtt * 0.7 + ((now() - m.c) / 1000) * 0.3; break;
    }
  }

  // ------------------------------------------------------------ menu
  const nameIn = $('nameIn');
  nameIn.value = store.get('cr_name') || '';

  function myName() {
    const n = nameIn.value.trim().slice(0, 12);
    store.set('cr_name', n);
    return n;
  }

  function doPlay() {
    Sfx.init();
    Sfx.pop();
    $('menuErr').textContent = '';
    send({ t: 'join', name: myName() });
  }

  $('playBtn').onclick = doPlay;
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doPlay(); });

  function resetToMenu() {
    G.active = false;
    G.map = null;
    G.players = new Map();
    G.token++;
    room = null;
    show('menu');
  }

  function doLeave() {
    send({ t: 'leave' });
    resetToMenu();
  }
  $('leaveBtn').onclick = doLeave;
  $('leave2Btn').onclick = doLeave;

  // invite link for phones on the same Wi-Fi (only useful when opened as localhost)
  fetch('/info').then((r) => r.json()).then((d) => {
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    if (local && d.lan && d.lan.length) lanBase = d.lan[0];
    const el = $('shareUrl');
    el.textContent = '📱 ชวนเพื่อน: ' + shareLink();
    el.classList.remove('hidden');
  }).catch(() => {});

  function shareLink() {
    return `${lanBase || location.origin}/`;
  }

  $('shareUrl').onclick = () => {
    const url = shareLink();
    const done = () => toast('คัดลอกลิงก์แล้ว 📋');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => toast(url));
    else toast(url);
  };

  // logo chicken
  (() => {
    const lc = $('logoCv').getContext('2d');
    Art.chicken(lc, 108, 160, 160, { col: COLORS[4], flip: 1, t: 0 });
  })();

  // ------------------------------------------------------------ lobby
  function onLobby(m) {
    room = m;
    renderLobby();
    // joined while the results screen is up -> wait for the next round
    if (screen === 'menu' && m.state === 'results') show('lobby');
  }

  function renderLobby() {
    if (!room) return;
    const ul = $('plist');
    ul.innerHTML = '';
    for (let i = 0; i < C.MAX_PLAYERS; i++) {
      const p = room.players[i];
      const li = document.createElement('li');
      if (!p) {
        li.className = 'empty';
        li.textContent = 'ว่าง';
        ul.appendChild(li);
        continue;
      }
      const c = document.createElement('canvas');
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = p.name;
      li.append(c, nm);
      if (p.id === myId) li.appendChild(tag('คุณ'));
      ul.appendChild(li);
      Art.icon(c, p.color);
    }
  }

  function tag(text) {
    const s = document.createElement('span');
    s.className = 'tagx';
    s.textContent = text;
    return s;
  }

  // ------------------------------------------------------------ match lifecycle
  function onStart(m) {
    G.token++;
    G.map = CR.buildMap(m.seed);
    G.players = new Map();
    for (const p of m.players) {
      G.players.set(p.id, {
        id: p.id, name: p.name, color: p.color, state: p.state,
        rx: p.x, ry: p.y, tx: p.x, ty: p.y, fx: 1, flip: 1, flags: 0, phase: Math.random() * 6, moving: false,
      });
    }
    G.total = m.players.length;
    const mine = G.players.get(myId);
    G.myState = mine ? mine.state : 'spectator';
    G.body = mine && mine.state === 'alive' ? CR.newBody(mine.rx, mine.ry) : null;
    Object.assign(G, {
      active: true, seq: 0, lastSeq: 0, pending: [], acc: 0, off: { x: 0, y: 0 }, danger: 0, dashQ: 0, prevCd: 0,
      snapMt: m.mt, snapAt: now(), kl: C.CAM_START, klv: 0, ft: null, gotSnap: false, renderT: m.mt,
      spec: null, specWait: 0, deathPos: null, corpses: [], parts: [], shake: 0,
      lastCount: m.mt < 0 ? Math.ceil(-m.mt) + 1 : null,
    });
    G.camY = camTarget(tile());
    $('feed').innerHTML = '';
    show('game');
    if (!G.body) big('⏳ รอรอบถัดไป', 'มีคนเล่นอยู่ ดูไปก่อนนะ 👀', 'pop', 3);
  }

  const meControls = () => G.active && G.body && (G.myState === 'alive' || G.myState === 'finished');
  const minY = () => (G.myState === 'finished' ? G.map.finishY + 0.05 : C.R);
  const canMoveFor = (s) => G.snapMt + (s - G.lastSeq) * C.DT >= -1e-6;
  const estMt = () => G.snapMt + Math.min(0.25, (now() - G.snapAt) / 1000);
  const klEst = () => G.kl + (G.snapMt >= 0 ? G.klv * Math.min(0.25, (now() - G.snapAt) / 1000) : 0);

  function onSnap(m) {
    G.snapMt = m.mt;
    G.snapAt = now();
    G.kl = m.kl;
    G.klv = m.klv;
    G.ft = m.ft;
    if (!G.gotSnap) { G.gotSnap = true; G.camY = camTarget(tile()); }
    for (const r of m.p) {
      const [id, x, y, fx, fy, fl, ls, vx, vy, kvx, kvy, dashT, dashCd, stun, ddx, ddy, danger] = r;
      const P = G.players.get(id);
      if (!P) continue;
      if ((fl & 4) && P.state === 'alive') P.state = 'finished';
      if (id === myId && G.body) {
        if (fl & 4) G.myState = 'finished';
        const ox = G.body.x + G.off.x, oy = G.body.y + G.off.y;
        Object.assign(G.body, { x, y, fx, fy, vx, vy, kvx, kvy, dashT, dashCd, stun, ddx, ddy });
        G.lastSeq = ls;
        G.danger = danger;
        G.pending = G.pending.filter((i) => i.s > ls);
        for (const inp of G.pending) CR.stepPlayer(G.body, inp, C.DT, canMoveFor(inp.s), minY(), G.map.maxY);
        G.off.x = ox - G.body.x;
        G.off.y = oy - G.body.y;
        if (Math.hypot(G.off.x, G.off.y) > 2) G.off.x = G.off.y = 0;
      } else {
        if ((fl & 1) && !(P.flags & 1)) puff(x, y, 5);
        P.tx = x; P.ty = y; P.fx = fx;
      }
      P.flags = fl;
    }
  }

  function onEvent(e) {
    const P = G.players.get(e.id);
    switch (e.k) {
      case 'die': {
        if (!P) return;
        P.state = 'dead';
        const col = COLORS[P.color];
        const isMe = e.id === myId;
        const px = isMe && G.body ? G.body.x + G.off.x : e.x, py = isMe && G.body ? G.body.y + G.off.y : e.y;
        G.corpses.push({ x: px, y: py, col, t: 0, dir: e.dir || 0, car: e.cause !== 'camera', lift: 0, rot: 0 });
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 3;
          G.parts.push({
            kind: 'feather', x: px, y: py, z: 0.4, vx: Math.cos(a) * v + (e.dir || 0) * 2, vy: Math.sin(a) * v, vz: 2 + Math.random() * 3,
            rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, life: 1.6 + Math.random(), col: i % 3 ? col.body : '#fff',
          });
        }
        const by = e.by != null && G.players.get(e.by);
        feed(`💥 ${P.name} — ${e.text}`, !!by);
        if (e.cause !== 'camera') Sfx.bonk(); else Sfx.splat();
        Sfx.bukaak(0.9 + Math.random() * 0.3);
        if (isMe) {
          G.myState = 'dead';
          G.deathPos = { x: px, y: py };
          G.body = null;
          G.specWait = now() + 1600;
          G.shake = 14;
          $('flash').style.opacity = 1;
          big(e.text, by ? '😈' : '💀', 'danger', 2.2);
          setTimeout(() => Sfx.sad(), 500);
        } else if (G.spec === e.id) {
          G.specWait = now() + 1200;
        }
        break;
      }
      case 'fin':
        if (!P) return;
        P.state = 'finished';
        feed(`🏁 ${P.name} เข้าเส้นชัย อันดับ ${e.rank}!`);
        confetti(P, e.id === myId);
        if (e.id === myId) {
          G.myState = 'finished';
          big('FINISH!', `อันดับ ${e.rank} 🏆`, 'pop', 2.5);
          Sfx.fanfare();
        } else Sfx.cluck(1.3);
        break;
      case 'last':
        if (!P) return;
        P.state = 'last';
        feed(`👑 ${P.name} รอดตัวสุดท้าย!`);
        big('LAST CHICKEN!', P.name, 'pop', 2);
        if (e.id === myId) Sfx.fanfare();
        break;
      case 'push': {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          G.parts.push({ kind: 'star', x: e.x, y: e.y, z: 0.5, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, vz: 1, rot: a, vr: 6, life: 0.5, col: '#ffd95e' });
        }
        G.parts.push({ kind: 'pow', x: e.x, y: e.y, z: 0.9, vx: 0, vy: 0, vz: 0, rot: (Math.random() - 0.5) * 0.4, vr: 0, life: 0.55, col: '#fff' });
        Sfx.pow();
        if (e.b === myId) { G.shake = 9; Sfx.bukaak(1.15); }
        else if (e.a === myId) G.shake = 5;
        break;
      }
      case 'left':
        if (!P) return;
        feed(`👋 ${P.name} ออกจากห้อง`);
        P.state = 'left';
        break;
    }
  }

  function onResults(m) {
    G.active = false;
    G.nextAt = now() + (m.next || 8) * 1000;
    const token = ++G.token;
    setTimeout(() => { if (token === G.token && G.map) showResults(m); }, 1400);
  }

  function showResults(m) {
    const medals = ['🥇', '🥈', '🥉'];
    const ol = $('rlist');
    ol.innerHTML = '';
    show('results');
    for (const r of m.results) {
      const li = document.createElement('li');
      const dead = r.kind === 'dead';
      if (r.place === 1 && !dead) li.className = 'win';
      else if (dead) li.className = 'dead';
      const medal = document.createElement('span');
      medal.className = 'medal';
      medal.textContent = dead ? '💀' : medals[r.place - 1] || String(r.place);
      const c = document.createElement('canvas');
      const who = document.createElement('div');
      who.className = 'who';
      const b = document.createElement('b');
      b.textContent = r.name + (r.id === myId ? ' (คุณ)' : '');
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = r.text + (r.accidents ? ` · 😈×${r.accidents}` : '');
      who.append(b, why);
      li.append(medal, c, who);
      ol.appendChild(li);
      Art.icon(c, r.color, { dead, happy: r.place === 1 && !dead });
    }
    const first = m.results[0];
    const won = first && first.kind !== 'dead';
    $('resTitle').textContent = !won ? '💀 ไม่มีใครรอด' : first.id === myId ? '🏆 คุณชนะ!' : `🏆 ${first.name} ชนะ!`;
    const db = $('dangerBox');
    db.innerHTML = '';
    if (m.dangerous) {
      const nb = document.createElement('b');
      nb.textContent = m.dangerous.name;
      db.append('😈 ไก่อันตรายที่สุด', document.createElement('br'), nb, ` ก่ออุบัติเหตุ ${m.dangerous.count} ครั้ง`);
    }
    if (won && first.id === myId) Sfx.fanfare();
    else Sfx.cluck();
  }

  // ------------------------------------------------------------ input
  const keys = new Set();
  let joy = null;
  const JOY_R = 55;

  function pressDash() {
    Sfx.init();
    if (meControls()) G.dashQ = now();
  }

  addEventListener('keydown', (e) => {
    Sfx.init();
    if (e.target && e.target.tagName === 'INPUT') return;
    if (screen !== 'game') return;
    const k = e.code;
    if (/^Arrow|^Space$/.test(k)) e.preventDefault();
    if (!meControls()) {
      if (!e.repeat && (k === 'Space' || k === 'Enter' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Tab')) {
        e.preventDefault();
        cycleSpectate();
      }
      return;
    }
    if (k === 'Space' || k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyJ' || k === 'KeyK') {
      if (!e.repeat) pressDash();
      return;
    }
    keys.add(k);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); joy = null; });

  cv.addEventListener('pointerdown', (e) => {
    Sfx.init();
    if (screen !== 'game') return;
    if (!meControls()) { cycleSpectate(); return; }
    if (e.pointerType === 'mouse') return;
    if (!joy) {
      joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!joy || e.pointerId !== joy.id) return;
    joy.x = e.clientX;
    joy.y = e.clientY;
    const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy);
    if (d > JOY_R) { joy.ox = joy.x - (dx / d) * JOY_R; joy.oy = joy.y - (dy / d) * JOY_R; }
  });
  const endJoy = (e) => { if (joy && e.pointerId === joy.id) joy = null; };
  cv.addEventListener('pointerup', endJoy);
  cv.addEventListener('pointercancel', endJoy);

  const dashBtn = $('dashBtn');
  dashBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dashBtn.classList.add('pressed');
    pressDash();
  });
  const unpress = () => dashBtn.classList.remove('pressed');
  dashBtn.addEventListener('pointerup', unpress);
  dashBtn.addEventListener('pointercancel', unpress);
  dashBtn.addEventListener('pointerleave', unpress);

  function readInput() {
    let mx = 0, my = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my -= 1;
    if (joy) {
      const jx = (joy.x - joy.ox) / JOY_R, jy = -(joy.y - joy.oy) / JOY_R;
      if (Math.hypot(jx, jy) > 0.18) { mx = jx; my = jy; }
    }
    mx = Math.round(clamp(mx, -1, 1) * 100) / 100;
    my = Math.round(clamp(my, -1, 1) * 100) / 100;
    if (G.dashQ && now() - G.dashQ > 250) G.dashQ = 0;
    return { s: 0, mx, my, dash: !!G.dashQ };
  }

  function stepLocal() {
    const inp = readInput();
    inp.s = ++G.seq;
    send({ t: 'i', s: inp.s, x: inp.mx, y: inp.my, d: inp.dash ? 1 : 0 });
    if (CR.stepPlayer(G.body, inp, C.DT, canMoveFor(inp.s), minY(), G.map.maxY)) {
      G.dashQ = 0;
      Sfx.whoosh();
      puff(G.body.x, G.body.y, 6);
    }
    G.pending.push(inp);
    if (G.pending.length > 120) G.pending.shift();
  }

  // ------------------------------------------------------------ spectating
  function spectateCandidates() {
    const list = [...G.players.values()].filter((p) => p.id !== myId && (p.state === 'alive' || p.state === 'finished'));
    return list.sort((a, b) => (a.state === 'alive' ? 0 : 1) - (b.state === 'alive' ? 0 : 1) || b.ty - a.ty);
  }

  function cycleSpectate() {
    const c = spectateCandidates();
    if (!c.length) return;
    const i = c.findIndex((p) => p.id === G.spec);
    G.spec = c[(i + 1) % c.length].id;
    G.specWait = 0;
    Sfx.pop();
  }

  function focusPos() {
    if (meControls()) return { x: G.body.x + G.off.x, y: G.body.y + G.off.y };
    const sp = G.players.get(G.spec);
    if (sp && now() >= G.specWait) return { x: sp.rx, y: sp.ry };
    if (G.deathPos) return G.deathPos;
    if (sp) return { x: sp.rx, y: sp.ry };
    return { x: C.W / 2, y: klEst() + 3 };
  }

  // ------------------------------------------------------------ particles
  function puff(x, y, n) {
    for (let i = 0; i < n; i++) {
      G.parts.push({
        kind: 'dust', x: x + (Math.random() - 0.5) * 0.3, y: y + (Math.random() - 0.5) * 0.2, z: 0.05,
        vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, vz: 0.6, rot: 0, vr: 0, life: 0.45, col: '#fffdf7',
      });
    }
  }

  function confetti(P, big) {
    const cols = ['#ff8fb1', '#ffd95e', '#7cc6ff', '#8ee0b8', '#c9a6ff'];
    for (let i = 0; i < (big ? 36 : 14); i++) {
      const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 3;
      G.parts.push({
        kind: 'confetti', x: P.id === myId && G.body ? G.body.x : P.tx, y: P.id === myId && G.body ? G.body.y : P.ty, z: 0.6,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 3 + Math.random() * 3, rot: a, vr: (Math.random() - 0.5) * 14,
        life: 1.4 + Math.random(), col: cols[i % cols.length],
      });
    }
  }

  // ------------------------------------------------------------ per-frame match update
  let VW = 0, VH = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    VW = window.innerWidth;
    VH = window.innerHeight;
    cv.width = Math.round(VW * DPR);
    cv.height = Math.round(VH * DPR);
  }
  addEventListener('resize', resize);
  resize();

  const tile = () => Math.min(VW / C.W, VH / 9.5);

  function camTarget(T) {
    const rowsVis = VH / T, kl = klEst();
    let t = Math.max(kl - 1.3, focusPos().y - rowsVis * 0.3);
    t = Math.min(t, G.map.rows.length + 0.5 - rowsVis);
    return Math.max(t, kl - 1.3);
  }

  function updateMatch(dt) {
    const t = now();

    // fixed-step local simulation + input send
    if (meControls()) {
      G.acc += dt;
      let n = 0;
      while (G.acc >= C.DT && n < 4) { G.acc -= C.DT; stepLocal(); n++; }
      if (G.acc > C.DT) G.acc = 0;
    }

    const mt = estMt();

    // countdown
    if (G.lastCount != null) {
      const c = mt < 0 ? Math.ceil(-mt) : 0;
      if (c !== G.lastCount) {
        G.lastCount = c;
        if (c > 0) { big(String(c), c === 3 ? 'เตรียมตัว!' : '', 'pop', 1); Sfx.beep(660); }
        else { big('GO!', '', 'pop', 0.9); Sfx.go(); G.lastCount = null; }
      }
    }

    // car clock: when alive, show cars at the time the server will process our newest input
    const target = meControls() ? G.snapMt + (G.seq - G.lastSeq) * C.DT + G.acc : mt;
    const diff = target - G.renderT - dt;
    G.renderT += dt;
    if (Math.abs(diff) > 0.5) G.renderT = target;
    else G.renderT += diff * Math.min(1, dt * 8);

    // remote chickens
    const k = 1 - Math.exp(-18 * dt);
    for (const P of G.players.values()) {
      if (P.id === myId && G.body) continue;
      const ox = P.rx, oy = P.ry;
      P.rx += (P.tx - P.rx) * k;
      P.ry += (P.ty - P.ry) * k;
      const sp = Math.hypot(P.rx - ox, P.ry - oy) / Math.max(dt, 1e-3);
      P.moving = sp > 0.6;
      if (P.moving) P.phase += dt * 14;
      if (Math.abs(P.fx) > 0.2) P.flip = P.fx < 0 ? -1 : 1;
    }

    // me
    if (G.body) {
      const d = Math.exp(-10 * dt);
      G.off.x *= d;
      G.off.y *= d;
      const sp = Math.hypot(G.body.vx, G.body.vy);
      if (sp > 0.6) G.phase += dt * 14;
      const me = G.players.get(myId);
      if (me) {
        me.rx = G.body.x + G.off.x;
        me.ry = G.body.y + G.off.y;
        me.moving = sp > 0.6;
        me.phase = G.phase;
        if (Math.abs(G.body.fx) > 0.2) me.flip = G.body.fx < 0 ? -1 : 1;
        me.flags = (G.body.dashT > 0 ? 1 : 0) | (G.body.stun > 0 ? 2 : 0) | (G.myState === 'finished' ? 4 : 0);
      }
    }

    // spectate target upkeep
    if (!meControls()) {
      const sp = G.players.get(G.spec);
      if ((!sp || (sp.state !== 'alive' && sp.state !== 'finished')) && t >= G.specWait) {
        const c = spectateCandidates();
        G.spec = c.length ? c[0].id : null;
      }
    }

    // camera
    const T = tile();
    G.camY += (camTarget(T) - G.camY) * (1 - Math.exp(-5 * dt));
    G.shake *= Math.exp(-8 * dt);

    // corpses
    for (const c of G.corpses) {
      c.t += dt;
      if (c.car && c.t < 0.7) {
        c.x += c.dir * 6 * dt;
        c.lift = Math.sin((Math.PI * c.t) / 0.7) * 1.4;
        c.rot += c.dir * 14 * dt;
      } else {
        c.lift = 0;
        c.rot = c.car ? (c.dir || 1) * Math.PI / 2 : 0;
      }
      c.x = clamp(c.x, -0.5, C.W + 0.5);
    }

    updateHud(mt);
  }

  function updateHud(mt) {
    let alive = 0;
    for (const p of G.players.values()) if (p.state === 'alive' || p.state === 'finished' || p.state === 'last') alive++;
    setText('aliveTxt', `${alive}/${G.total}`);

    const f = focusPos();
    const pct = clamp(f.y / G.map.finishY, 0, 1) * 100;
    $('progFill').style.width = pct + '%';
    $('progChick').style.left = pct + '%';
    setText('progTxt', Math.round(pct) + '%');

    const gb = $('graceBox');
    if (G.ft != null) {
      gb.classList.remove('hidden');
      setText('graceTxt', String(Math.max(0, Math.ceil(C.FINISH_GRACE - (mt - G.ft)))));
    } else gb.classList.add('hidden');

    const spectating = !meControls() && G.spec != null && now() >= G.specWait;
    $('specBar').classList.toggle('hidden', !spectating);
    if (spectating) setText('specName', (G.players.get(G.spec) || {}).name || '');
    dashBtn.classList.toggle('hidden', !meControls());

    // danger warning
    const fl = $('flash');
    if (meControls() && G.myState === 'alive' && G.danger > 0) {
      fl.style.opacity = Math.min(1, G.danger / C.DANGER_TIME) * 0.9;
      if (bigKind !== 'warn' && (bigKind === '' || now() > bigUntil)) big('HURRY!', 'หนีกล้องเร็ว!', 'warn', 0);
      if (!G.warnT || now() - G.warnT > 300) { G.warnT = now(); Sfx.warn(); }
    } else {
      const o = +fl.style.opacity || 0;
      if (o > 0) fl.style.opacity = Math.max(0, o - 0.04);
      if (bigKind === 'warn') big('', '', '', 0);
    }
    if (bigKind && bigKind !== 'warn' && now() > bigUntil) big('', '', '', 0);

    // dash cooldown ring
    if (G.body) {
      const cd = G.body.dashCd / C.DASH_CD;
      dashBtn.style.setProperty('--cd', cd.toFixed(3));
      if (G.prevCd > 0 && cd <= 0) {
        dashBtn.classList.remove('ready');
        void dashBtn.offsetWidth;
        dashBtn.classList.add('ready');
      }
      G.prevCd = cd;
    }
  }

  function updateParts(dt) {
    for (const p of G.parts) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'feather' || p.kind === 'confetti') {
        p.vz -= 9 * dt;
        p.z = Math.max(0, p.z + p.vz * dt);
        if (p.z <= 0) { p.vx *= 0.8; p.vy *= 0.8; p.vr *= 0.8; }
        p.vx *= Math.exp(-1.5 * dt);
        p.vy *= Math.exp(-1.5 * dt);
      } else {
        p.vx *= Math.exp(-6 * dt);
        p.vy *= Math.exp(-6 * dt);
      }
    }
    G.parts = G.parts.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------ rendering
  const FLOWERS = ['#ff9fc2', '#fffdf7', '#ffd95e', '#c9a6ff'];

  function render(dt, t) {
    const inMatch = !!G.map;
    const map = inMatch ? G.map : attract.map;
    const T = tile(), offX = (VW - C.W * T) / 2;
    const camY = inMatch ? G.camY : attract.camY;
    const carT = inMatch ? G.renderT : attract.t;
    const time = t / 1000;
    let shx = 0, shy = 0;
    if (inMatch && G.shake > 0.3) { shx = (Math.random() - 0.5) * G.shake; shy = (Math.random() - 0.5) * G.shake; }
    ctx.setTransform(DPR, 0, 0, DPR, shx * DPR, shy * DPR);

    const sx = (x) => offX + x * T;
    const sy = (y) => VH - (y - camY) * T;
    const r0 = Math.floor(camY) - 1, r1 = Math.ceil(camY + VH / T) + 1;

    // --- ground
    ctx.fillStyle = '#9cdb85';
    ctx.fillRect(-20, -20, VW + 40, VH + 40);
    for (let r = r0; r <= r1; r++) drawRow(map, r, sx, sy, T, offX);

    // outside-the-field shade
    if (offX > 1) {
      ctx.fillStyle = 'rgba(40,80,40,0.12)';
      ctx.fillRect(-20, -20, offX + 20, VH + 40);
      ctx.fillRect(offX + C.W * T, -20, offX + 20, VH + 40);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(offX - 1.5, -20, 3, VH + 40);
      ctx.fillRect(offX + C.W * T - 1.5, -20, 3, VH + 40);
    }

    // --- entities, sorted back (top of screen) to front
    const ents = [];
    for (let r = r0; r <= r1; r++) rowEntities(map, r, ents, sx, sy, T, carT);

    const tags = [];
    if (inMatch) {
      for (const c of G.corpses) {
        const X = sx(c.x), Y = sy(c.y);
        ents.push({ k: Y, d: () => Art.chicken(ctx, X, Y, T, { col: c.col, flip: 1, dead: true, rot: c.rot, lift: c.lift * T, t: time, scale: 1 }) });
      }
      for (const P of G.players.values()) {
        if (!(P.state === 'alive' || P.state === 'finished' || P.state === 'last')) continue;
        const X = sx(P.rx), Y = sy(P.ry), col = COLORS[P.color];
        const opts = {
          col, flip: P.flip || 1, phase: P.phase, moving: P.moving, dash: !!(P.flags & 1), stun: !!(P.flags & 2),
          happy: P.state === 'finished' || P.state === 'last', t: time + P.id,
        };
        ents.push({ k: Y, d: () => Art.chicken(ctx, X, Y, T, opts) });
        tags.push({ P, X, Y, col });
      }
    }
    ents.sort((a, b) => a.k - b.k);
    for (const e of ents) e.d();

    // --- particles
    if (inMatch) {
      updateParts(dt);
      for (const p of G.parts) drawPart(p, sx(p.x), sy(p.y) - p.z * T, T);
    }

    // --- name tags
    const fs = Math.max(10, T * 0.26);
    for (const { P, X, Y, col } of tags) {
      const me = P.id === myId;
      const ty = Y - T * 1.0;
      Art.nameTag(ctx, P.name, X, ty, fs, col, me);
      if (me) {
        const by = ty - fs * 1.2 + Math.sin(time * 6) * 2;
        ctx.beginPath();
        ctx.moveTo(X - fs * 0.4, by - fs * 0.45);
        ctx.lineTo(X + fs * 0.4, by - fs * 0.45);
        ctx.lineTo(X, by + fs * 0.1);
        ctx.closePath();
        ctx.fillStyle = '#ffd95e';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = Art.INK;
        ctx.stroke();
      }
    }

    // --- camera kill zone
    if (inMatch && G.active) {
      const ky = sy(klEst());
      if (ky < VH + 10) {
        const top = Math.max(-20, ky);
        const g = ctx.createLinearGradient(0, top, 0, VH);
        g.addColorStop(0, 'rgba(255,70,100,0.14)');
        g.addColorStop(1, 'rgba(255,40,70,0.5)');
        ctx.fillStyle = g;
        ctx.fillRect(-20, top, VW + 40, VH - top + 20);
        ctx.save();
        ctx.strokeStyle = `rgba(255,60,90,${0.7 + Math.sin(time * 8) * 0.25})`;
        ctx.lineWidth = 4;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -time * 40;
        ctx.beginPath();
        ctx.moveTo(-20, ky);
        ctx.lineTo(VW + 20, ky);
        ctx.stroke();
        ctx.restore();
      }
    }

    // --- off-screen arrow for me (e.g. far ahead / behind)
    if (inMatch && meControls()) {
      const Y = sy(G.body.y);
      if (Y < 0 || Y > VH) {
        const X = sx(G.body.x), up = Y < 0, ay = up ? 70 : VH - 20;
        ctx.beginPath();
        ctx.moveTo(X, ay + (up ? -14 : 14));
        ctx.lineTo(X - 12, ay);
        ctx.lineTo(X + 12, ay);
        ctx.closePath();
        ctx.fillStyle = COLORS[(G.players.get(myId) || { color: 0 }).color].body;
        ctx.fill();
        ctx.strokeStyle = Art.INK;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // --- virtual joystick
    if (joy && screen === 'game') {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.beginPath();
      ctx.arc(joy.ox, joy.oy, JOY_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,253,247,0.25)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,253,247,0.7)';
      ctx.stroke();
      Art.circle(ctx, joy.x, joy.y, 24, 'rgba(255,143,177,0.85)');
    }
  }

  function rowSeed(map, r) {
    const row = map.rows[r];
    return row ? row.deco : (r * 7919 + 13) | 0;
  }

  function drawRow(map, r, sx, sy, T, offX) {
    const row = map.rows[r], type = row ? row.type : 'grass';
    const top = sy(r + 1), bot = sy(r);
    const yA = Math.floor(top), hA = Math.ceil(bot) - yA + 1;
    if (type === 'road') {
      ctx.fillStyle = '#7e7893';
      ctx.fillRect(-20, yA, VW + 40, hA);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(-20, top + T * 0.3, VW + 40, T * 0.4);
      const up = map.rows[r + 1], dn = map.rows[r - 1];
      if (up && up.type === 'road') {
        ctx.fillStyle = 'rgba(255,250,235,0.6)';
        const start = offX - Math.ceil(offX / T + 1) * T + T * 0.225;
        for (let x = start; x < VW; x += T) ctx.fillRect(x, top - T * 0.03, T * 0.55, T * 0.06);
      } else {
        ctx.fillStyle = '#e6dff0';
        ctx.fillRect(-20, top, VW + 40, T * 0.09);
      }
      if (!(dn && dn.type === 'road')) {
        ctx.fillStyle = '#b3aac6';
        ctx.fillRect(-20, bot - T * 0.09, VW + 40, T * 0.09);
      }
      return;
    }
    ctx.fillStyle = ((r % 2) + 2) % 2 ? '#a3e28c' : '#98d981';
    ctx.fillRect(-20, yA, VW + 40, hA);
    const R = CR.rng((rowSeed(map, r) ^ 0x51ed) >>> 0);
    for (let i = 0; i < 3; i++) {
      const fx = R() * C.W, fy = r + 0.1 + R() * 0.8, col = FLOWERS[(R() * FLOWERS.length) | 0], on = R() < 0.6;
      if (on) Art.flower(ctx, sx(fx), sy(fy), T, col);
    }
    if (type === 'finish') {
      const s = T * 0.25;
      const startX = offX - Math.ceil(offX / s + 1) * s;
      for (let j = 0; j < 2; j++) {
        const y = sy(r + 0.05 + (j + 1) * 0.25);
        let i = 0;
        for (let x = startX; x < VW; x += s, i++) {
          ctx.fillStyle = (i + j) % 2 ? '#5a3b2e' : '#fffdf7';
          ctx.fillRect(x, y, s + 0.5, s + 0.5);
        }
      }
      Art.comic(ctx, 'FINISH', sx(C.W / 2), sy(r + 0.8), T * 0.42, '#ffd95e');
    }
  }

  function rowEntities(map, r, ents, sx, sy, T, carT) {
    const row = map.rows[r], type = row ? row.type : 'grass';
    if (type === 'road') {
      for (const v of CR.carsAt(row, carT)) {
        const x0 = sx(v.xl), x1 = sx(v.xl + v.len);
        if (x1 < -T || x0 > VW + T) continue;
        const hh = CR.VEHICLES[v.kind].h;
        const yT = sy(r + 0.5 + hh / 2), yB = sy(r + 0.5 - hh / 2);
        ents.push({ k: yB, d: () => Art.car(ctx, x0, x1, yT, yB, T, v) });
      }
      return;
    }
    const R = CR.rng((rowSeed(map, r) ^ 0x2f6b) >>> 0);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const a = R(), b = R(), c = R(), d = R();
        if (a > 0.6) continue;
        const x = side < 0 ? -0.75 - k * 1.25 - b * 0.4 : C.W + 0.75 + k * 1.25 + b * 0.4;
        const X = sx(x), Y = sy(r + 0.25 + c * 0.5);
        if (X < -T || X > VW + T) continue;
        const kind = d < 0.55 ? 0 : d < 0.8 ? 1 : 2, tk = ((d * 100) | 0) % 3;
        ents.push({ k: Y, d: () => (kind === 0 ? Art.tree(ctx, X, Y, T, tk) : kind === 1 ? Art.bush(ctx, X, Y, T) : Art.rock(ctx, X, Y, T)) });
      }
    }
    if (type === 'finish') {
      for (const x of [-0.25, C.W + 0.25]) {
        const X = sx(x), Y = sy(r + 0.3);
        ents.push({ k: Y, d: () => flagPole(X, Y, T, x < 0 ? 1 : -1) });
      }
    }
  }

  function flagPole(X, Y, T, dir) {
    const time = now() / 1000;
    ctx.fillStyle = '#fffdf7';
    Art.rr(ctx, X - T * 0.05, Y - T * 1.5, T * 0.1, T * 1.5, T * 0.04);
    ctx.fill();
    ctx.strokeStyle = Art.INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    const wave = Math.sin(time * 5) * T * 0.06;
    ctx.beginPath();
    ctx.moveTo(X, Y - T * 1.45);
    ctx.quadraticCurveTo(X + dir * T * 0.3, Y - T * 1.45 + wave, X + dir * T * 0.6, Y - T * 1.3 + wave);
    ctx.lineTo(X, Y - T * 1.1);
    ctx.closePath();
    ctx.fillStyle = '#ff8fb1';
    ctx.fill();
    ctx.stroke();
  }

  function drawPart(p, X, Y, T) {
    const a = Math.min(1, p.life * 2.5);
    ctx.globalAlpha = a;
    if (p.kind === 'feather') Art.feather(ctx, X, Y, T * 0.12, p.rot, p.col);
    else if (p.kind === 'star') Art.star(ctx, X, Y, T * 0.12, p.rot, p.col);
    else if (p.kind === 'confetti') {
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-T * 0.06, -T * 0.03, T * 0.12, T * 0.06);
      ctx.restore();
    } else if (p.kind === 'pow') {
      const s = 1 + (0.55 - p.life) * 1.5;
      Art.star(ctx, X, Y, T * 0.5 * s, p.rot, '#fff6b0');
      Art.comic(ctx, 'POW!', X, Y, T * 0.34 * s, '#ff8fb1', p.rot);
    } else Art.circle(ctx, X, Y, T * (0.08 + (0.45 - p.life) * 0.25), 'rgba(255,253,247,0.8)');
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ main loop
  let lastFrame = now();
  function frame() {
    const t = now();
    const dt = Math.min(0.1, (t - lastFrame) / 1000);
    lastFrame = t;
    if (G.active) updateMatch(dt);
    else if (G.map) {
      G.renderT += dt;
      for (const P of G.players.values()) P.moving = false;
      if (screen === 'results') {
        const left = Math.max(0, Math.ceil((G.nextAt - t) / 1000));
        setText('nextRound', left > 0 ? `รอบใหม่เริ่มใน ${left} วิ... 🥚` : 'กำลังเริ่ม! 🐣');
      }
    } else {
      attract.t += dt;
      attract.camY += dt * 0.6;
      if (attract.camY > attract.map.rows.length - 8) attract.camY = -1;
    }
    render(dt, t);
    requestAnimationFrame(frame);
  }

  if (/[?&]debug/.test(location.search)) window.CRG = G;
  show('menu');
  connect();
  requestAnimationFrame(frame);
})();

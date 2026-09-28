'use strict';
// Chicken Run — authoritative game server (HTTP static files + WebSocket rooms)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const CR = require('./public/shared.js');
const { C } = CR;

const PORT = +process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ lan: lanUrls() }));
  }
  const file = path.join(PUBLIC, url === '/' ? 'index.html' : url);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- helpers
let nextId = 1;
const RESULTS_TIME = 8;   // seconds the results screen stays up before the next round auto-starts
const MAX_IN_ROOM = 16;   // up to 8 play per round, the rest watch and wait
const r3 = (v) => Math.round(v * 1000) / 1000;
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp1 = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
const NEUTRAL = { mx: 0, my: 0, dash: false };

function causeText(cause, byName) {
  if (byName) return pick([`BETRAYED BY ${byName}`, `BETRAYED BY ${byName}`, `${byName} CAUSED THE ACCIDENT`]);
  if (cause === 'truck') return pick(['HIT BY TRUCK', 'TRUCKED', 'FLATTENED']);
  if (cause === 'car') return pick(['ROADKILL', 'BONKED', 'SPEED BUMP', 'HIT BY CAR']);
  return pick(['TOO SLOW', 'EATEN BY THE SCREEN', 'LEFT BEHIND']);
}

// ---------------------------------------------------------------- the one shared room
class Room {
  constructor() {
    this.players = new Map();
    this.state = 'lobby'; // lobby | playing | results
    this.m = null;
    this.timer = null;
    this.nextTimer = null;
  }

  send(p, msg) {
    if (p.ws.readyState === 1) p.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) this.send(p, s);
  }

  lobbyInfo() {
    return {
      t: 'lobby', state: this.state,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };
  }

  add(p) {
    const used = new Set([...this.players.values()].map((q) => q.color));
    p.color = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => !used.has(i)) ?? this.players.size % 8;
    p.state = 'spectator';
    this.players.set(p.id, p);
    p.room = this;
    this.send(p, { t: 'joined', id: p.id });
    this.broadcast(this.lobbyInfo());
    if (this.state === 'lobby') return this.start();
    if (this.state !== 'playing') return; // results screen: next round starts automatically
    if (this.m.mt < 0 && this.m.part.length < C.MAX_PLAYERS) {
      // still counting down -> hop into this round
      this.m.part.push(p);
      this.m.startCount = this.m.part.length;
      this.m.part.forEach((q, i) => this.resetPlayer(q, i, this.m.part.length));
      this.broadcast(this.startMsg());
    } else this.send(p, this.startMsg()); // round in progress -> watch and wait
  }

  remove(p) {
    this.players.delete(p.id);
    p.room = null;
    if (this.m && this.m.part.includes(p)) {
      this.m.part = this.m.part.filter((q) => q !== p);
      if (this.state === 'playing') this.broadcast({ t: 'ev', k: 'left', id: p.id });
    }
    if (this.players.size === 0) {
      clearInterval(this.timer);
      clearTimeout(this.nextTimer);
      this.timer = this.nextTimer = null;
      this.state = 'lobby';
      this.m = null;
      return;
    }
    this.broadcast(this.lobbyInfo());
  }

  resetPlayer(p, i, n) {
    const s = CR.spawn(i, n);
    Object.assign(p, {
      b: CR.newBody(s.x, s.y), state: 'alive', inputs: [], lastSeq: 0, lastQueued: 0, starve: 0,
      danger: 0, pushBy: null, pushT: -99, accidents: 0, deathT: 0, cause: null, text: '', byId: null,
      rank: 0, hitSet: new Set(),
    });
  }

  start() {
    if (this.state === 'playing' || this.players.size === 0) return;
    clearTimeout(this.nextTimer);
    this.nextTimer = null;
    const seed = (Math.random() * 2 ** 31) | 0;
    const map = CR.buildMap(seed);
    const part = [...this.players.values()].slice(0, C.MAX_PLAYERS);
    for (const p of this.players.values()) p.state = 'spectator';
    part.forEach((p, i) => this.resetPlayer(p, i, part.length));
    this.m = {
      seed, map, part, startCount: part.length, mt: -C.COUNTDOWN,
      kl: C.CAM_START, klv: 0, finishers: 0, firstFinishT: null,
    };
    this.state = 'playing';
    this.broadcast(this.startMsg());
    this.broadcast(this.lobbyInfo());
    this.acc = 0;
    this.last = performance.now();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.loop(), 5);
  }

  startMsg() {
    const m = this.m;
    return {
      t: 'start', seed: m.seed, mt: m.mt,
      players: m.part.map((p) => ({ id: p.id, name: p.name, color: p.color, x: p.b.x, y: p.b.y, state: p.state })),
    };
  }

  loop() {
    const now = performance.now();
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    while (this.acc >= C.DT && this.state === 'playing') {
      this.acc -= C.DT;
      this.tick();
    }
  }

  tick() {
    const m = this.m, dt = C.DT;
    m.mt += dt;
    const canMove = m.mt >= 0;

    // 1) movement from queued inputs
    for (const p of m.part) {
      if (p.state !== 'alive' && p.state !== 'finished') continue;
      const minY = p.state === 'finished' ? m.map.finishY + 0.05 : C.R;
      let steps = p.inputs.length > 3 ? 2 : p.inputs.length ? 1 : 0;
      if (!steps) {
        // client is lagging / backgrounded: keep physics (knockback, cooldowns) going
        if (++p.starve > 4) CR.stepPlayer(p.b, NEUTRAL, dt, false, minY, m.map.maxY);
        continue;
      }
      p.starve = 0;
      while (steps--) {
        const inp = p.inputs.shift();
        if (CR.stepPlayer(p.b, inp, dt, canMove, minY, m.map.maxY)) p.hitSet = new Set();
        p.lastSeq = inp.s;
      }
    }

    // 2) chicken vs chicken
    const alive = m.part.filter((p) => p.state === 'alive');
    const minD = C.R * 2;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        let dx = b.b.x - a.b.x, dy = b.b.y - a.b.y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-4) { dx = Math.random() - 0.5; dy = 0.01; d = Math.hypot(dx, dy); }
        const nx = dx / d, ny = dy / d;
        const aDash = a.b.dashT > 0 && !a.hitSet.has(b.id);
        const bDash = b.b.dashT > 0 && !b.hitSet.has(a.id);
        if (aDash || bDash) {
          if (aDash) this.push(a, b, nx, ny);
          if (bDash) this.push(b, a, -nx, -ny);
        } else {
          const s = (minD - d) * 0.5 * C.SOFT;
          a.b.x = Math.max(C.R, Math.min(C.W - C.R, a.b.x - nx * s));
          a.b.y -= ny * s;
          b.b.x = Math.max(C.R, Math.min(C.W - C.R, b.b.x + nx * s));
          b.b.y += ny * s;
        }
      }
    }

    // 3) camera pressure
    if (canMove) {
      let lead = -Infinity;
      for (const p of alive) lead = Math.max(lead, p.b.y);
      m.klv = CR.cameraSpeed(m.mt, lead - m.kl);
      m.kl = Math.min(m.kl + m.klv * dt, m.map.finishY - 0.6);
    }

    // 4) hazards / finish
    for (const p of alive) {
      if (p.b.y >= m.map.finishY) { this.finish(p); continue; }
      const hit = CR.carHit(m.map, p.b.x, p.b.y, m.mt);
      if (hit) { this.kill(p, hit.car.kind, hit.row.dir); continue; }
      if (canMove && p.b.y < m.kl) {
        p.danger += dt;
        if (p.danger >= C.DANGER_TIME || p.b.y < m.kl - C.DANGER_DEPTH) this.kill(p, 'camera', 0);
      } else p.danger = 0;
    }

    // 5) snapshot
    const ps = [];
    for (const p of m.part) {
      if (p.state !== 'alive' && p.state !== 'finished') continue;
      const b = p.b;
      ps.push([
        p.id, r3(b.x), r3(b.y), r3(b.fx), r3(b.fy),
        (b.dashT > 0 ? 1 : 0) | (b.stun > 0 ? 2 : 0) | (p.state === 'finished' ? 4 : 0),
        p.lastSeq, r3(b.vx), r3(b.vy), r3(b.kvx), r3(b.kvy), r3(b.dashT), r3(b.dashCd), r3(b.stun),
        r3(b.ddx), r3(b.ddy), r3(p.danger),
      ]);
    }
    this.broadcast({ t: 's', mt: r3(m.mt), kl: r3(m.kl), klv: r3(m.klv), ft: m.firstFinishT, p: ps });

    // 6) win conditions
    const still = m.part.filter((p) => p.state === 'alive');
    if (m.firstFinishT == null) {
      if (still.length === 0) return this.end();
      if (m.startCount >= 2 && still.length === 1) {
        still[0].state = 'last';
        this.broadcast({ t: 'ev', k: 'last', id: still[0].id });
        return this.end();
      }
    } else if (still.length === 0 || m.mt - m.firstFinishT >= C.FINISH_GRACE) {
      return this.end();
    }
  }

  push(a, b, nx, ny) {
    a.hitSet.add(b.id);
    let px = a.b.ddx * 0.7 + nx * 0.3, py = a.b.ddy * 0.7 + ny * 0.3;
    const l = Math.hypot(px, py) || 1;
    px /= l; py /= l;
    Object.assign(b.b, { kvx: px * C.KNOCK, kvy: py * C.KNOCK, stun: C.STUN, dashT: 0 });
    b.pushBy = a.id;
    b.pushT = this.m.mt;
    Object.assign(a.b, { dashT: 0, kvx: -px * 1.5, kvy: -py * 1.5 });
    this.broadcast({ t: 'ev', k: 'push', a: a.id, b: b.id, x: r3((a.b.x + b.b.x) / 2), y: r3((a.b.y + b.b.y) / 2) });
  }

  kill(p, cause, dir) {
    const m = this.m;
    p.state = 'dead';
    p.deathT = m.mt;
    p.cause = cause;
    let by = null;
    if (cause !== 'camera' && p.pushBy != null && m.mt - p.pushT <= C.PUSH_CREDIT) {
      by = m.part.find((q) => q.id === p.pushBy && q !== p) || null;
    }
    if (by) by.accidents++;
    p.byId = by ? by.id : null;
    p.text = causeText(cause, by && by.name);
    this.broadcast({ t: 'ev', k: 'die', id: p.id, cause, by: p.byId, text: p.text, x: r3(p.b.x), y: r3(p.b.y), dir });
  }

  finish(p) {
    const m = this.m;
    p.state = 'finished';
    p.rank = ++m.finishers;
    if (m.firstFinishT == null) m.firstFinishT = m.mt;
    this.broadcast({ t: 'ev', k: 'fin', id: p.id, rank: p.rank });
  }

  end() {
    const m = this.m;
    clearInterval(this.timer);
    this.timer = null;
    this.state = 'results';
    const last = m.part.filter((p) => p.state === 'last');
    const fin = m.part.filter((p) => p.state === 'finished').sort((a, b) => a.rank - b.rank);
    const alive = m.part.filter((p) => p.state === 'alive').sort((a, b) => b.b.y - a.b.y);
    const dead = m.part.filter((p) => p.state === 'dead').sort((a, b) => b.deathT - a.deathT);
    const list = [
      ...last.map((p) => [p, 'last']), ...fin.map((p) => [p, 'fin']),
      ...alive.map((p) => [p, 'time']), ...dead.map((p) => [p, 'dead']),
    ];
    const results = list.map(([p, kind], i) => ({
      id: p.id, name: p.name, color: p.color, place: i + 1, kind, accidents: p.accidents,
      text: kind === 'dead' ? p.text : kind === 'time' ? "TIME'S UP" : kind === 'last' ? 'LAST CHICKEN STANDING' : 'FINISHED',
    }));
    let md = null;
    for (const p of m.part) if (p.accidents > 0 && (!md || p.accidents > md.accidents)) md = p;
    this.broadcast({
      t: 'results', results, next: RESULTS_TIME,
      dangerous: md && { id: md.id, name: md.name, color: md.color, count: md.accidents },
    });
    this.broadcast(this.lobbyInfo());
    clearTimeout(this.nextTimer);
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.state = 'lobby';
      this.start();
    }, RESULTS_TIME * 1000);
  }
}

// ---------------------------------------------------------------- sockets
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const room = new Room();

function cleanName(n, id) {
  n = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return n || `Chick${id}`;
}

wss.on('connection', (ws) => {
  const p = { id: nextId++, ws, name: 'Chick', room: null, state: 'spectator' };
  const reply = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const r = p.room;
    switch (msg.t) {
      case 'join': {
        if (r) return;
        if (room.players.size >= MAX_IN_ROOM) return reply({ t: 'error', msg: 'คนเต็มแล้ว ลองใหม่อีกครั้งนะ' });
        p.name = cleanName(msg.name, p.id);
        room.add(p);
        break;
      }
      case 'i': {
        if (!r || r.state !== 'playing' || (p.state !== 'alive' && p.state !== 'finished')) return;
        const s = msg.s | 0;
        if (s <= p.lastQueued) return;
        p.lastQueued = s;
        p.inputs.push({ s, mx: clamp1(+msg.x), my: clamp1(+msg.y), dash: !!msg.d });
        if (p.inputs.length > 12) p.inputs.splice(0, p.inputs.length - 12);
        break;
      }
      case 'ping':
        reply({ t: 'pong', c: msg.c });
        break;
      case 'leave':
        if (r) r.remove(p);
        break;
    }
  });

  ws.on('close', () => { if (p.room) p.room.remove(p); });
});

server.listen(PORT, () => {
  console.log(`\n  🐔💥 CHICKEN RUN server running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  Network: ${u}   <- open this on phones (same Wi-Fi)`);
  console.log('');
});

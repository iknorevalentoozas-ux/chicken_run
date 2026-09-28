// Shared simulation code — used by both the server (Node) and the browser client.
// Everything here must be deterministic so the client can predict what the server does.
(function (root, factory) {
  const CR = factory();
  if (typeof module === 'object' && module.exports) module.exports = CR;
  else root.CR = CR;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    W: 12,              // playfield width in tiles
    DT: 1 / 30,         // fixed simulation step
    R: 0.3,             // chicken body radius (player-vs-player)
    HIT_W: 0.24,        // chicken half-size used for car hits
    HIT_H: 0.2,

    SPEED: 4.4,         // tiles / s
    ACCEL: 26,          // higher = snappier start/stop

    DASH_SPEED: 11.5,
    DASH_TIME: 0.17,    // ~2 tiles
    DASH_CD: 2.0,

    KNOCK: 7.2,         // dash-push knockback speed (~0.8 tile total)
    KNOCK_DECAY: 9,
    STUN: 0.35,
    SOFT: 0.35,         // soft collision strength per tick

    PUSH_CREDIT: 2.0,   // seconds a push counts toward "caused the accident"

    DANGER_TIME: 1.5,   // seconds allowed below the camera line
    DANGER_DEPTH: 2.2,  // this far below the line = instant elimination
    FINISH_GRACE: 10,   // seconds after first finisher before match ends
    COUNTDOWN: 3,

    CAM_START: -1.2,
    CAM_V0: 0.2,        // rows / s at start
    CAM_ACC: 0.0062,    // extra rows / s per second
    CAM_TMAX: 100,
    CAM_CATCHUP: 9,     // leader this many rows ahead -> camera speeds up

    CAR_MARGIN: 8,      // cars wrap this far outside the playfield
    MAX_PLAYERS: 8,
  };

  const COLORS = [
    { name: 'Red', body: '#ff5a4e', dark: '#c4362d' },
    { name: 'Blue', body: '#4fb3ff', dark: '#2a7cc0' },
    { name: 'Green', body: '#6ad66b', dark: '#3a9a3d' },
    { name: 'Pink', body: '#ff8fd0', dark: '#cc5a9c' },
    { name: 'Yellow', body: '#ffd84a', dark: '#c49f1c' },
    { name: 'Purple', body: '#ae82ff', dark: '#744bcc' },
    { name: 'Orange', body: '#ffa044', dark: '#c46d16' },
    { name: 'White', body: '#f6f3ec', dark: '#b5ae9f' },
  ];

  const VEHICLES = {
    car: { len: 1.4, h: 0.5 },
    truck: { len: 2.9, h: 0.9 },
  };

  // ---------- deterministic RNG (mulberry32)
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- Lane chunks
  const CHUNKS = {
    start: ['grass', 'grass', 'grass', 'grass'],
    easy: ['road', 'grass'],
    double: ['road', 'road', 'grass'],
    traffic: ['road', 'road', 'road', 'grass'],
    quad: ['road', 'road', 'road', 'road', 'grass'],
    chaos: ['road', 'road', 'road', 'road', 'road', 'road', 'road'],
    finish: ['finish', 'grass', 'grass', 'grass', 'grass'],
  };

  // MVP: fixed chunk order (car placement/speeds still vary per match via the seed)
  const MVP_SEQUENCE = [
    'start', 'easy', 'easy', 'double', 'easy', 'double', 'traffic', 'double',
    'traffic', 'quad', 'traffic', 'quad', 'double', 'quad', 'chaos', 'finish',
  ];

  function buildMap(seed, sequence) {
    const R = rng(seed);
    const types = [];
    for (const name of sequence || MVP_SEQUENCE) for (const t of CHUNKS[name]) types.push({ t, chunk: name });
    const finishRow = types.findIndex((r) => r.t === 'finish');
    const rows = types.map((r, y) => {
      const row = { y, type: r.t, chunk: r.chunk, deco: (R() * 1e9) | 0 };
      if (r.t === 'road') makeRoad(row, r.chunk === 'chaos' ? 1 : y / finishRow, R);
      return row;
    });
    return { seed, rows, finishRow, finishY: finishRow + 0.3, maxY: rows.length - C.R };
  }

  function makeRoad(row, d, R) {
    const truckLane = R() < 0.22 + d * 0.2;
    row.dir = R() < 0.5 ? 1 : -1;
    row.speed = truckLane
      ? lerp(1.4, 2.7, d) * (0.9 + R() * 0.2)
      : lerp(2.0, 4.8, d) * (0.85 + R() * 0.3);
    row.period = C.W + 2 * C.CAR_MARGIN + Math.floor(R() * 8);
    const gapMin = lerp(2.4, 1.05, d); // seconds between one car's tail and the next car's head
    const gapMax = lerp(4.5, 2.2, d);
    const cars = [];
    let pos = R() * 3;
    for (;;) {
      const kind = truckLane && R() < 0.75 ? 'truck' : 'car';
      const len = VEHICLES[kind].len;
      if (cars.length && pos + len + gapMin * row.speed > row.period + cars[0].o) break;
      cars.push({ o: pos, kind, len, c: Math.floor(R() * 6) });
      pos += len + (gapMin + R() * (gapMax - gapMin)) * row.speed;
    }
    row.cars = cars;
  }

  // Car positions are a pure function of time — no AI, no braking.
  function carsAt(row, t) {
    const out = [];
    const P = row.period;
    for (const car of row.cars) {
      let s = (car.o + row.speed * t) % P;
      if (s < 0) s += P;
      const xl = row.dir > 0 ? s - C.CAR_MARGIN : C.W + C.CAR_MARGIN - s - car.len;
      out.push({ xl, len: car.len, kind: car.kind, c: car.c, dir: row.dir });
    }
    return out;
  }

  function carHit(map, x, y, t) {
    const r0 = Math.floor(y - C.HIT_H), r1 = Math.floor(y + C.HIT_H);
    for (let r = r0; r <= r1; r++) {
      const row = map.rows[r];
      if (!row || row.type !== 'road') continue;
      if (y + C.HIT_H < r + 0.18 || y - C.HIT_H > r + 0.82) continue;
      for (const car of carsAt(row, t)) {
        if (x + C.HIT_W > car.xl + 0.08 && x - C.HIT_W < car.xl + car.len - 0.08) return { row, car };
      }
    }
    return null;
  }

  function cameraSpeed(t, leaderGap) {
    let v = C.CAM_V0 + C.CAM_ACC * Math.min(Math.max(t, 0), C.CAM_TMAX);
    if (leaderGap > C.CAM_CATCHUP) v += (leaderGap - C.CAM_CATCHUP) * 0.3;
    return v;
  }

  function spawn(i, n) {
    return { x: C.W / 2 + (i - (n - 1) / 2) * 1.15, y: 1.5 };
  }

  function newBody(x, y) {
    return { x, y, vx: 0, vy: 0, kvx: 0, kvy: 0, fx: 0, fy: 1, dashT: 0, dashCd: 0, ddx: 0, ddy: 1, stun: 0 };
  }

  // One fixed step of chicken movement. Returns true if a dash started this step.
  function stepPlayer(b, inp, dt, canMove, minY, maxY) {
    let mx = canMove ? clamp(+inp.mx || 0, -1, 1) : 0;
    let my = canMove ? clamp(+inp.my || 0, -1, 1) : 0;
    let mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; mag = 1; }

    if (b.dashCd > 0) b.dashCd = Math.max(0, b.dashCd - dt);
    if (b.stun > 0) b.stun = Math.max(0, b.stun - dt);
    const control = canMove && b.stun <= 0;

    if (control && mag > 0.15) { b.fx = mx / mag; b.fy = my / mag; }

    let dashed = false;
    if (control && inp.dash && b.dashCd <= 0) {
      const dx = mag > 0.15 ? mx / mag : b.fx, dy = mag > 0.15 ? my / mag : b.fy;
      const l = Math.hypot(dx, dy) || 1;
      b.ddx = dx / l; b.ddy = dy / l;
      b.dashT = C.DASH_TIME;
      b.dashCd = C.DASH_CD;
      dashed = true;
    }

    let vx, vy;
    if (b.dashT > 0) {
      vx = b.ddx * C.DASH_SPEED;
      vy = b.ddy * C.DASH_SPEED;
      b.dashT = Math.max(0, b.dashT - dt);
      b.vx = b.ddx * C.SPEED * 0.6;
      b.vy = b.ddy * C.SPEED * 0.6;
    } else {
      const tx = control ? mx * C.SPEED : 0, ty = control ? my * C.SPEED : 0;
      const k = 1 - Math.exp(-C.ACCEL * dt);
      b.vx += (tx - b.vx) * k;
      b.vy += (ty - b.vy) * k;
      vx = b.vx; vy = b.vy;
    }

    vx += b.kvx; vy += b.kvy;
    const kd = Math.exp(-C.KNOCK_DECAY * dt);
    b.kvx *= kd; b.kvy *= kd;
    if (Math.abs(b.kvx) < 0.01) b.kvx = 0;
    if (Math.abs(b.kvy) < 0.01) b.kvy = 0;

    b.x = clamp(b.x + vx * dt, C.R, C.W - C.R);
    b.y = clamp(b.y + vy * dt, minY, maxY);
    return dashed;
  }

  return { C, COLORS, VEHICLES, rng, buildMap, carsAt, carHit, cameraSpeed, spawn, newBody, stepPlayer, clamp, lerp };
});

// Cute procedural art — everything is drawn with canvas paths, no image files.
const Art = (() => {
  'use strict';
  const INK = '#5a3b2e';
  const TAU = Math.PI * 2;

  const CAR_COLORS = [
    ['#ff8a8a', '#d9606a', '#ffc2c2'],
    ['#7cc6ff', '#4f97d6', '#c2e6ff'],
    ['#ffd166', '#d9a53a', '#ffe9a8'],
    ['#9be58f', '#68b35e', '#cff5c8'],
    ['#c9a6ff', '#9a74d9', '#e6d6ff'],
    ['#ffa9d6', '#d97aae', '#ffd6ec'],
  ];
  const TRUCK_STRIPES = ['#ff8fb1', '#7cc6ff', '#ffd166', '#8ee0b8', '#c9a6ff', '#ffa06e'];

  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circle(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function ellipse(ctx, x, y, rx, ry, fill, rot = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // A soft 2.5D block: visible top face + south-facing front face.
  function block(ctx, x0, x1, yT, yB, h, top, front, r) {
    const w = x1 - x0;
    rr(ctx, x0, yB - h - r, w, h + r, r);
    ctx.fillStyle = front;
    ctx.fill();
    rr(ctx, x0, yT - h, w, yB - yT, r);
    ctx.fillStyle = top;
    ctx.fill();
  }

  // ------------------------------------------------------------ chicken
  // (x, y) = ground point under the chicken, s = tile size in px.
  // o: { col, flip, phase, moving, dash, stun, dead, happy, rot, lift, t, scale, noShadow }
  function chicken(ctx, x, y, s, o) {
    const col = o.col;
    const lift = o.lift || 0;
    s *= o.scale || 1;
    if (!o.noShadow) {
      const k = 1 / (1 + lift / (s * 1.5));
      ellipse(ctx, x, y + s * 0.02, s * 0.3 * k, s * 0.11 * k, 'rgba(60,40,80,0.22)');
    }
    const bob = o.moving ? Math.abs(Math.sin(o.phase)) * s * 0.07 : Math.sin((o.t || 0) * 3) * s * 0.012;
    ctx.save();
    ctx.translate(x, y - lift);
    if (o.rot) {
      ctx.translate(0, -s * 0.38);
      ctx.rotate(o.rot);
      ctx.translate(0, s * 0.38);
    }
    ctx.scale(o.flip || 1, 1);
    if (o.dash) ctx.scale(1.18, 0.88);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // legs
    if (!o.dead && lift < s * 0.2) {
      const a = o.moving ? Math.sin(o.phase) * s * 0.09 : 0;
      ctx.strokeStyle = '#f39a3d';
      ctx.lineWidth = s * 0.05;
      for (const [lx, sw] of [[-0.08, a], [0.08, -a]]) {
        ctx.beginPath();
        ctx.moveTo(lx * s, -s * 0.12 - bob);
        ctx.lineTo(lx * s + sw, -s * 0.01);
        ctx.lineTo(lx * s + sw + s * 0.06, -s * 0.01);
        ctx.stroke();
      }
    } else if (o.dead) {
      ctx.strokeStyle = '#f39a3d';
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.moveTo(-s * 0.08, -s * 0.12); ctx.lineTo(-s * 0.13, s * 0.02);
      ctx.moveTo(s * 0.08, -s * 0.12); ctx.lineTo(s * 0.15, s * 0.0);
      ctx.stroke();
    }

    const cy = -s * 0.38 - bob;

    // tail tufts
    ctx.fillStyle = col.dark;
    for (let i = 0; i < 3; i++) {
      ellipse(ctx, -s * 0.3, cy - s * 0.12 + i * s * 0.06, s * 0.1, s * 0.045, col.dark, -0.6 + i * 0.35);
    }

    // body blob
    ctx.beginPath();
    ctx.ellipse(0, cy, s * 0.33, s * 0.31, 0, 0, TAU);
    ctx.fillStyle = col.body;
    ctx.fill();
    ctx.lineWidth = s * 0.035;
    ctx.strokeStyle = col.dark;
    ctx.stroke();
    // belly highlight
    ellipse(ctx, s * 0.04, cy + s * 0.1, s * 0.2, s * 0.14, 'rgba(255,255,255,0.35)');
    // shine
    ellipse(ctx, -s * 0.12, cy - s * 0.16, s * 0.07, s * 0.04, 'rgba(255,255,255,0.7)', -0.5);

    // comb
    ctx.fillStyle = '#ff5d73';
    for (const [cx, cr] of [[-0.03, 0.065], [0.05, 0.08], [0.13, 0.06]]) {
      circle(ctx, cx * s, cy - s * 0.3, cr * s, '#ff5d73');
    }

    // wing
    const flap = o.dash || o.happy ? Math.sin((o.t || 0) * 30) * 0.5 - 0.9 : o.moving ? Math.sin(o.phase * 2) * 0.25 : 0;
    ctx.save();
    ctx.translate(-s * 0.06, cy + s * 0.02);
    ctx.rotate(flap);
    ellipse(ctx, -s * 0.02, 0, s * 0.14, s * 0.1, col.dark);
    ellipse(ctx, -s * 0.03, -s * 0.02, s * 0.1, s * 0.06, 'rgba(255,255,255,0.22)');
    ctx.restore();

    // beak + wattle
    ctx.beginPath();
    ctx.moveTo(s * 0.29, cy - s * 0.1);
    ctx.lineTo(s * 0.43, cy - s * 0.05);
    ctx.lineTo(s * 0.29, cy + s * 0.0);
    ctx.closePath();
    ctx.fillStyle = '#ffae3d';
    ctx.fill();
    ellipse(ctx, s * 0.29, cy + s * 0.04, s * 0.035, s * 0.05, '#ff5d73');

    // blush
    ellipse(ctx, s * 0.16, cy - s * 0.0, s * 0.065, s * 0.04, 'rgba(255,120,150,0.55)');

    // eyes
    const ex = s * 0.15, ey = cy - s * 0.12;
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.03;
    if (o.dead) {
      const e = s * 0.045;
      ctx.beginPath();
      ctx.moveTo(ex - e, ey - e); ctx.lineTo(ex + e, ey + e);
      ctx.moveTo(ex + e, ey - e); ctx.lineTo(ex - e, ey + e);
      ctx.stroke();
    } else if (o.stun) {
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = i * 0.9 + (o.t || 0) * 10, r = (i / 14) * s * 0.06;
        ctx.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r);
      }
      ctx.stroke();
    } else if (o.happy) {
      ctx.beginPath();
      ctx.arc(ex, ey + s * 0.02, s * 0.045, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else if (o.dash) {
      ctx.beginPath();
      ctx.moveTo(ex - s * 0.04, ey - s * 0.04); ctx.lineTo(ex + s * 0.03, ey); ctx.lineTo(ex - s * 0.04, ey + s * 0.04);
      ctx.stroke();
    } else {
      ellipse(ctx, ex, ey, s * 0.045, s * 0.058, INK);
      circle(ctx, ex + s * 0.015, ey - s * 0.022, s * 0.018, '#fff');
    }
    ctx.restore();

    // dizzy stars
    if (o.stun && !o.dead) {
      for (let i = 0; i < 3; i++) {
        const a = (o.t || 0) * 7 + (i * TAU) / 3;
        star(ctx, x + Math.cos(a) * s * 0.3, y - lift - s * 0.85 + Math.sin(a) * s * 0.08, s * 0.07, a, '#ffd95e');
      }
    }
  }

  // ------------------------------------------------------------ vehicles
  function car(ctx, x0, x1, yT, yB, T, v) {
    const L = x1 - x0, D = yB - yT;
    const [col, dark, light] = CAR_COLORS[v.c % CAR_COLORS.length];
    const lead = v.dir > 0 ? 1 : -1;
    // shadow
    rr(ctx, x0 + T * 0.06, yT + T * 0.1, L, D, T * 0.2);
    ctx.fillStyle = 'rgba(40,30,70,0.2)';
    ctx.fill();

    if (v.kind === 'truck') return truck(ctx, x0, x1, yT, yB, T, v, lead);

    const h1 = T * 0.24, h2 = T * 0.2, r = T * 0.16;
    // wheels
    for (const wx of [x0 + L * 0.22, x1 - L * 0.22]) {
      circle(ctx, wx, yB - T * 0.02, T * 0.11, '#4a4458');
      circle(ctx, wx, yB - T * 0.02, T * 0.045, '#cfc8dc');
    }
    block(ctx, x0, x1, yT, yB, h1, col, dark, r);
    // cabin (rear-biased)
    const cx0 = lead > 0 ? x0 + L * 0.12 : x0 + L * 0.34;
    const cx1 = lead > 0 ? x0 + L * 0.66 : x0 + L * 0.88;
    block(ctx, cx0, cx1, yT + D * 0.14 - h1, yB - D * 0.14 - h1, h2, light, '#bfe8ff', T * 0.13);
    // window shine + pillar
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    rr(ctx, cx0 + (cx1 - cx0) * 0.12, yB - D * 0.14 - h1 - h2 * 0.85, (cx1 - cx0) * 0.18, h2 * 0.5, 3);
    ctx.fill();
    ctx.fillStyle = light;
    ctx.fillRect((cx0 + cx1) / 2 - T * 0.025, yB - D * 0.14 - h1 - h2, T * 0.05, h2);
    // hood shine
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const hx = lead > 0 ? x1 - L * 0.3 : x0 + L * 0.1;
    rr(ctx, hx, yT - h1 + D * 0.2, L * 0.2, D * 0.18, 4);
    ctx.fill();
    // lights
    const fx = lead > 0 ? x1 - T * 0.1 : x0 + T * 0.1;
    const bx = lead > 0 ? x0 + T * 0.09 : x1 - T * 0.09;
    circle(ctx, fx, yB - h1 * 0.55, T * 0.06, '#fff6b0');
    circle(ctx, bx, yB - h1 * 0.55, T * 0.045, '#ff6f8e');
  }

  function truck(ctx, x0, x1, yT, yB, T, v, lead) {
    const L = x1 - x0, D = yB - yT;
    const cab = T * 0.85, gap = T * 0.06;
    const [col, dark, light] = CAR_COLORS[v.c % CAR_COLORS.length];
    const stripe = TRUCK_STRIPES[v.c % TRUCK_STRIPES.length];
    const wheels = [x0 + L * 0.12, x0 + L * 0.3, x1 - L * 0.12, x1 - L * 0.3];
    for (const wx of wheels) {
      circle(ctx, wx, yB - T * 0.01, T * 0.12, '#4a4458');
      circle(ctx, wx, yB - T * 0.01, T * 0.05, '#cfc8dc');
    }
    const kx0 = lead > 0 ? x1 - cab : x0, kx1 = lead > 0 ? x1 : x0 + cab;
    const bx0 = lead > 0 ? x0 : x0 + cab + gap, bx1 = lead > 0 ? x1 - cab - gap : x1;
    // container
    const hc = T * 0.62;
    block(ctx, bx0, bx1, yT - D * 0.02, yB, hc, '#fff8ee', '#f0dcc4', T * 0.14);
    ctx.fillStyle = stripe;
    ctx.fillRect(bx0 + T * 0.05, yB - hc * 0.62, bx1 - bx0 - T * 0.1, hc * 0.2);
    // little heart logo
    heart(ctx, (bx0 + bx1) / 2, yB - hc * 0.3, T * 0.1, stripe);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    rr(ctx, bx0 + T * 0.12, yT - D * 0.02 - hc + D * 0.15, (bx1 - bx0) * 0.5, D * 0.14, 4);
    ctx.fill();
    // cab
    const hk = T * 0.46;
    block(ctx, kx0, kx1, yT + D * 0.06, yB, hk, col, dark, T * 0.16);
    const wx0 = lead > 0 ? kx0 + cab * 0.35 : kx0 + cab * 0.1;
    ctx.fillStyle = '#bfe8ff';
    rr(ctx, wx0, yB - hk * 0.95, cab * 0.55, hk * 0.42, T * 0.06);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    rr(ctx, wx0 + cab * 0.06, yB - hk * 0.9, cab * 0.14, hk * 0.25, 3);
    ctx.fill();
    const fx = lead > 0 ? x1 - T * 0.1 : x0 + T * 0.1;
    circle(ctx, fx, yB - hk * 0.28, T * 0.065, '#fff6b0');
    ellipse(ctx, (kx0 + kx1) / 2, yT + D * 0.06 - hk + D * 0.3, cab * 0.25, D * 0.12, light);
  }

  // ------------------------------------------------------------ scenery
  function tree(ctx, x, y, s, kind) {
    ellipse(ctx, x + s * 0.05, y, s * 0.36, s * 0.13, 'rgba(40,70,40,0.22)');
    rr(ctx, x - s * 0.07, y - s * 0.38, s * 0.14, s * 0.4, s * 0.05);
    ctx.fillStyle = '#b98159';
    ctx.fill();
    const pal = kind === 1 ? ['#ff9fc2', '#ffc4da', '#f07ba6'] : kind === 2 ? ['#ffc66b', '#ffe0a3', '#e59f3b'] : ['#72cf74', '#a4e695', '#4fa956'];
    const cy = y - s * 0.72;
    circle(ctx, x - s * 0.2, cy + s * 0.08, s * 0.25, pal[2]);
    circle(ctx, x + s * 0.2, cy + s * 0.08, s * 0.25, pal[2]);
    circle(ctx, x - s * 0.16, cy + s * 0.02, s * 0.25, pal[0]);
    circle(ctx, x + s * 0.17, cy + s * 0.02, s * 0.24, pal[0]);
    circle(ctx, x, cy - s * 0.14, s * 0.28, pal[0]);
    circle(ctx, x - s * 0.08, cy - s * 0.22, s * 0.1, pal[1]);
    if (kind === 0) {
      circle(ctx, x + s * 0.12, cy - s * 0.02, s * 0.04, '#ff6f8e');
      circle(ctx, x - s * 0.2, cy + s * 0.08, s * 0.04, '#ff6f8e');
    }
  }

  function bush(ctx, x, y, s) {
    ellipse(ctx, x, y, s * 0.3, s * 0.1, 'rgba(40,70,40,0.2)');
    circle(ctx, x - s * 0.14, y - s * 0.12, s * 0.15, '#5fbf62');
    circle(ctx, x + s * 0.14, y - s * 0.12, s * 0.15, '#5fbf62');
    circle(ctx, x, y - s * 0.2, s * 0.18, '#7fd67d');
    circle(ctx, x - s * 0.05, y - s * 0.28, s * 0.06, '#b2ec9f');
  }

  function rock(ctx, x, y, s) {
    ellipse(ctx, x, y, s * 0.2, s * 0.07, 'rgba(40,40,60,0.2)');
    ellipse(ctx, x, y - s * 0.08, s * 0.18, s * 0.12, '#c9c3d6');
    ellipse(ctx, x - s * 0.05, y - s * 0.12, s * 0.07, s * 0.04, '#e9e5f0');
  }

  function flower(ctx, x, y, s, col) {
    for (let i = 0; i < 5; i++) {
      const a = (i * TAU) / 5;
      circle(ctx, x + Math.cos(a) * s * 0.045, y + Math.sin(a) * s * 0.035, s * 0.035, col);
    }
    circle(ctx, x, y, s * 0.028, '#ffd95e');
  }

  function star(ctx, x, y, r, rot, fill) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5 - Math.PI / 2, rr2 = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function heart(ctx, x, y, s, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.7);
    ctx.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.5, y - s * 0.9, x, y - s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 1.2, y - s * 0.1, x, y + s * 0.7);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function feather(ctx, x, y, s, rot, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.55, 0, 0, s);
    ctx.quadraticCurveTo(-s * 0.55, 0, 0, -s);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,59,46,0.35)';
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.8);
    ctx.lineTo(0, s * 1.2);
    ctx.stroke();
    ctx.restore();
  }

  function comic(ctx, text, x, y, size, fill, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `600 ${size}px Mitr, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = INK;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function nameTag(ctx, text, x, y, size, col, me) {
    ctx.font = `600 ${size}px Mitr, 'Segoe UI', sans-serif`;
    const w = ctx.measureText(text).width + size * 0.9;
    rr(ctx, x - w / 2, y - size * 0.75, w, size * 1.4, size * 0.7);
    ctx.fillStyle = me ? '#fffdf7' : 'rgba(255,253,247,0.85)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, size * 0.14);
    ctx.strokeStyle = col.body;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  // small chicken portrait for lobby / results lists
  function icon(canvas, colorIdx, opts = {}) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 34, h = canvas.clientHeight || 34;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    chicken(c, w * 0.45, h * 0.95, w * 1.15, { col: CR.COLORS[colorIdx], flip: 1, noShadow: true, dead: opts.dead, happy: opts.happy });
  }

  return { rr, circle, ellipse, block, chicken, car, tree, bush, rock, flower, star, heart, feather, comic, nameTag, icon, INK };
})();

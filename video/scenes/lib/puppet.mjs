// Puppet rig: stylised characters built from simple shapes and posed by joint angles. Pure: the same
// design, pose and placement always give the same pixels.
//
//   const kid = design({ height: 320, fill: '#FF3D7F', outline: '#14001F', outlineW: 5, head: 'round' });
//   const pose = cycles.walk(phase);                        // or poses.stand, blend(a, b, u), ...
//   drawPuppet(ctx, kid, pose, { x: 960, ground: 900, facing: 1, view: 'side' });
//   const j = solve(kid, pose, { x: 960, ground: 900 });     // joint positions, e.g. j.wristR
//
// A pose holds angles in radians, in the picture plane:
//   sL/sR  upper arm from the torso axis (0 = hanging; + = forward in 'side' view, outward in 'front')
//   eL/eR  elbow bend (+ = forearm swings further forward or up)
//   hL/hR  thigh from straight down (+ = forward in 'side', outward in 'front')
//   kL/kR  knee bend (+ = shin folds back)
//   lean   torso tilt (+ = forward)          head  head tilt (+ = nods forward)
//   rot    whole-body rotation about the pelvis (+ = clockwise on screen, before facing)
//   bob    lift of the pelvis, in body heights      squash  0..1 flattens (landing), < 0 stretches
// Lengths in a design are fractions of the body height; widths and outlines of the drawing are px at
// scale 1. In 'side' view the R limbs are the near ones (drawn last); the far limbs are shaded.

const TAU = Math.PI * 2;
const KEYS = ['sL', 'eL', 'sR', 'eR', 'hL', 'kL', 'hR', 'kR', 'lean', 'head', 'rot', 'bob', 'squash'];

const BASE = {
  height: 300,
  headR: 0.11, neck: 0.025, torso: 0.3, shoulderDrop: 0.035, shoulderX: 0.085, hipX: 0.045,
  upperArm: 0.16, foreArm: 0.15, hand: 0.026, thigh: 0.22, shin: 0.21, foot: 0.06,
  torsoW: 0.15, torsoSide: 0.11, armW: 0.05, legW: 0.062,
  torsoShape: 'capsule',          // 'capsule' | 'tri' (wider at the hem: a dress or coat) | 'inv' (broad shoulders)
  head: 'round',                  // 'round' | 'tv' | 'moon' | 'flower' | 'star' | 'none' | (ctx, r, info) => void
  face: 'dots',                   // 'dots' | 'closed' | 'none' | (ctx, r, info) => void
  fill: '#F2EDE4', limbFill: null, headFill: null, faceColor: '#14101C',
  outline: null, outlineW: 0, glow: null, glowBlur: 0, farShade: 0.72,
  screen: '#89F7FE',              // tv: screen colour (or a function drawing the screen)
  petals: 7, petalFill: null,     // flower head
};

/** A character design: proportions (fractions of height) and drawing style. */
export function design(spec = {}) {
  const d = { ...BASE, ...spec };
  d.limbFill ||= d.fill;
  d.headFill ||= d.fill;
  d.petalFill ||= d.headFill;
  d.id = spec.id || JSON.stringify(Object.entries(d).filter(([, v]) => typeof v !== 'function'));
  return d;
}

/** The kid proportions: big head, short limbs. */
export const KID = { headR: 0.15, neck: 0.02, torso: 0.27, upperArm: 0.14, foreArm: 0.13, thigh: 0.18, shin: 0.17, foot: 0.055, torsoW: 0.17, legW: 0.07, armW: 0.055 };

const z = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

/** Linear blend of two poses (missing keys count as 0). */
export function blend(a, b, u) {
  const o = {};
  for (const k of KEYS) o[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * u;
  return o;
}

/** Mirror a pose left to right (swap L and R limbs). */
export function mirror(p) {
  return { ...p, sL: p.sR, eL: p.eR, sR: p.sL, eR: p.eL, hL: p.hR, kL: p.kR, hR: p.hL, kR: p.kL };
}

const smooth = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

export const poses = {
  stand: { ...z(), sL: 0.08, sR: 0.08, eL: 0.12, eR: 0.12 },
  slump: { ...z(), lean: 0.32, head: 0.55, sL: -0.05, sR: -0.05, eL: 0.05, eR: 0.05, kL: 0.12, kR: 0.12, hL: 0.06, hR: 0.06 },
  armsUp: { ...z(), sL: 2.75, sR: 2.75, eL: 0.15, eR: 0.15, head: -0.25 },
  reachUp: { ...z(), sR: 2.9, eR: 0.05, sL: 0.15, eL: 0.2, head: -0.35, lean: -0.08 },
  sit: { ...z(), hL: 1.45, hR: 1.45, kL: 1.5, kR: 1.5, sL: 0.35, sR: 0.35, eL: 0.6, eR: 0.6, lean: 0.1 },
  hug: { ...z(), sL: 1.35, sR: 1.45, eL: 1.3, eR: 1.2, lean: 0.12, head: 0.15 },
  fall: { ...z(), sL: 2.4, sR: 2.2, eL: 0.6, eR: 0.4, hL: 0.6, hR: 0.15, kL: 1.2, kR: 0.5, head: -0.3 },
  float: { ...z(), sL: 0.9, sR: 1.1, eL: 0.4, eR: 0.3, hL: 0.25, hR: -0.1, kL: 0.6, kR: 0.35, head: -0.15 },
  crouch: { ...z(), hL: 1.0, hR: 1.0, kL: 2.0, kR: 2.0, lean: 0.45, sL: 0.5, sR: 0.5, eL: 0.6, eR: 0.6 },
  star: { ...z(), sL: 2.1, sR: 2.1, hL: 0.45, hR: 0.45, head: -0.2 },
};

export const cycles = {
  /** Walk, phase 0..1 per two steps. Side view. */
  walk(p, amt = 1) {
    const a = TAU * p;
    return {
      ...z(),
      hL: 0.42 * amt * Math.sin(a), hR: -0.42 * amt * Math.sin(a),
      kL: amt * (0.15 + 0.55 * Math.max(0, Math.sin(a + 1.9))), kR: amt * (0.15 + 0.55 * Math.max(0, Math.sin(a + 1.9 + Math.PI))),
      sL: -0.38 * amt * Math.sin(a), sR: 0.38 * amt * Math.sin(a), eL: 0.25 + 0.2 * amt, eR: 0.25 + 0.2 * amt,
      lean: 0.06 * amt, bob: 0.018 * amt * Math.abs(Math.cos(a)), head: 0.05,
    };
  },
  /** Run, phase 0..1 per two strides. Side view. */
  run(p, amt = 1) {
    const a = TAU * p;
    return {
      ...z(),
      hL: 0.75 * amt * Math.sin(a), hR: -0.75 * amt * Math.sin(a),
      kL: amt * (0.3 + 1.3 * Math.max(0, Math.sin(a + 2.2))), kR: amt * (0.3 + 1.3 * Math.max(0, Math.sin(a + 2.2 + Math.PI))),
      sL: -0.8 * amt * Math.sin(a), sR: 0.8 * amt * Math.sin(a), eL: 1.3, eR: 1.3,
      lean: 0.22 * amt, bob: 0.045 * amt * Math.abs(Math.sin(a)), head: -0.05,
    };
  },
  /**
   * Dance on the beat: p = beat phase (0 on the beat). move picks a style: 'pump' (fists up on the
   * beat), 'bounce', 'sway', 'clap', 'jack' (jumping jack). amt scales it (energy).
   */
  dance(p, move = 'bounce', amt = 1) {
    const dip = Math.exp(-p * 7) * amt;                 // sharp on the beat, decays across it
    const s = Math.sin(TAU * p);
    const base = { ...z(), kL: 0.15 + 0.55 * dip, kR: 0.15 + 0.55 * dip, hL: 0.08 + 0.3 * dip, hR: 0.08 + 0.3 * dip, bob: -0.035 * dip, lean: 0.08 * dip };
    switch (move) {
      case 'pump': return { ...base, sL: 0.3, eL: 1.4, sR: 2.4 + 0.5 * dip, eR: 0.2 * (1 - dip), head: -0.2 * dip };
      case 'sway': return { ...base, rot: 0.12 * amt * s, sL: 0.5 + 0.4 * s, sR: 0.5 - 0.4 * s, eL: 0.6, eR: 0.6, head: 0.15 * s };
      case 'clap': return { ...base, sL: 1.25, sR: 1.25, eL: 1.2 - 0.9 * dip, eR: 1.2 - 0.9 * dip };
      case 'jack': return { ...base, sL: 0.25 + 2.3 * dip, sR: 0.25 + 2.3 * dip, hL: 0.05 + 0.4 * dip, hR: 0.05 + 0.4 * dip, kL: 0.1, kR: 0.1, bob: 0.06 * dip };
      default: return { ...base, sL: 0.35 + 0.3 * dip, sR: 0.35 + 0.3 * dip, eL: 0.9, eR: 0.9 };
    }
  },
  /** One jump, u 0..1: crouch, push, air (tucked, arms up), land (squash). */
  jump(u, height = 0.35) {
    if (u < 0.18) { const k = smooth(u / 0.18); return blend(poses.stand, { ...poses.crouch, squash: 0.25 }, k); }
    if (u < 0.3) { const k = smooth((u - 0.18) / 0.12); return blend({ ...poses.crouch, squash: 0.25 }, { ...poses.armsUp, squash: -0.15, bob: height * 0.3 }, k); }
    if (u < 0.82) {
      const k = (u - 0.3) / 0.52;
      const air = 4 * k * (1 - k);
      return { ...poses.armsUp, hL: 0.7, hR: 0.5, kL: 1.4, kR: 1.1, bob: height * (0.3 + 0.7 * air), squash: -0.1 * (1 - k) };
    }
    const k = smooth((u - 0.82) / 0.18);
    return blend({ ...poses.crouch, squash: 0.35 }, poses.stand, k);
  },
  /** Slow drift in zero gravity: t seconds, seed for individuality. */
  float(t, seed = 0) {
    const w = (f, ph) => Math.sin(t * f + seed * 1.7 + ph);
    return { ...poses.float, sL: 0.9 + 0.35 * w(0.9, 0), sR: 1.1 + 0.35 * w(0.7, 1), eL: 0.4 + 0.3 * w(1.1, 2), eR: 0.3 + 0.3 * w(1.3, 3),
      hL: 0.25 + 0.2 * w(0.6, 4), hR: -0.1 + 0.2 * w(0.8, 5), kL: 0.6 + 0.25 * w(0.5, 6), kR: 0.35 + 0.25 * w(0.9, 7), rot: 0.25 * w(0.3, 8), head: -0.15 + 0.1 * w(0.4, 9) };
  },
};

/** Two-bone IK for an arm in the body frame: target (dx, dy) from the shoulder in body heights. */
export function armTo(d, dx, dy, lean = 0, bend = 1) {
  const a = d.upperArm, b = d.foreArm;
  const dist = Math.max(1e-6, Math.min(a + b - 1e-6, Math.hypot(dx, dy)));
  const base = Math.atan2(dx, dy);                       // angle from straight down, + = forward
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const cosE = (a * a + b * b - dist * dist) / (2 * a * b);
  const E = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosE)));
  return { s: base - bend * A - lean, e: bend * E };
}

/**
 * Joint positions in px. opts: x, y (pelvis) or ground (lowest point of the feet), facing (+-1),
 * scale, view ('side' | 'front'). Returns {pelvis, neck, headC, headAng, shoulderL/R, elbowL/R,
 * wristL/R, hipL/R, kneeL/R, ankleL/R, toeL/R, U (px per body height), facing, view}.
 */
export function solve(d, pose, opts = {}) {
  const p = { ...z(), ...pose };
  const facing = opts.facing === -1 ? -1 : 1;
  const view = opts.view || 'side';
  const U = d.height * (opts.scale ?? 1);
  const front = view === 'front';
  // local body frame: origin at the pelvis, x forward, y down, units of body height
  const dir = (ang, side) => [side * Math.sin(ang), Math.cos(ang)];
  const add = (q, v, l) => [q[0] + v[0] * l, q[1] + v[1] * l];
  const sideOf = (lr) => (front ? (lr === 'L' ? -1 : 1) : 1);
  const J = { pelvis: [0, 0] };
  const up = [Math.sin(p.lean), -Math.cos(p.lean)];
  const perp = [Math.cos(p.lean), Math.sin(p.lean)];
  J.neck = add(J.pelvis, up, d.torso);
  const sBase = add(J.neck, up, -d.shoulderDrop);
  for (const lr of ['L', 'R']) {
    const sd = sideOf(lr);
    const sx = front ? sd * d.shoulderX : 0;
    const sh = add(sBase, perp, sx);
    const s = p[`s${lr}`], e = p[`e${lr}`];
    const elbow = add(sh, dir(p.lean + s, sd), d.upperArm);
    const wrist = add(elbow, dir(p.lean + s + e, sd), d.foreArm);
    J[`shoulder${lr}`] = sh; J[`elbow${lr}`] = elbow; J[`wrist${lr}`] = wrist;
    const hip = [front ? sd * d.hipX : 0, 0];
    const h = p[`h${lr}`], k = p[`k${lr}`];
    const knee = add(hip, dir(h, sd), d.thigh);
    const ankle = add(knee, dir(h - k, sd), d.shin);
    const toe = front ? [ankle[0] + sd * d.foot * 0.45, ankle[1]] : [ankle[0] + d.foot, ankle[1]];
    J[`hip${lr}`] = hip; J[`knee${lr}`] = knee; J[`ankle${lr}`] = ankle; J[`toe${lr}`] = toe;
  }
  const hAng = p.lean + p.head * 0.35;
  J.headC = add(J.neck, [Math.sin(hAng), -Math.cos(hAng)], d.neck + d.headR);
  // whole-body rotation about the pelvis
  if (p.rot) {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (const k of Object.keys(J)) { const [x, y] = J[k]; J[k] = [x * c - y * s, x * s + y * c]; }
  }
  // squash about the lowest point of the feet
  const footH = d.legW * 0.5;
  let low = -Infinity;
  for (const k of ['ankleL', 'ankleR', 'toeL', 'toeR']) low = Math.max(low, J[k][1]);
  low += footH;
  const sq = Math.max(-0.5, Math.min(0.9, p.squash || 0));
  if (sq) {
    const sx = 1 + 0.28 * sq, sy = 1 - 0.32 * sq;
    for (const k of Object.keys(J)) { const [x, y] = J[k]; J[k] = [x * sx, low + (y - low) * sy]; }
  }
  // place in the world
  let ox = opts.x ?? 0, oy;
  if (opts.ground !== undefined) oy = opts.ground - low * U - p.bob * U;
  else oy = (opts.y ?? 0) - p.bob * U;
  const out = { U, facing, view, headAng: (p.lean + p.head + p.rot) * facing, rot: p.rot, squash: sq };
  for (const k of Object.keys(J)) out[k] = [ox + facing * J[k][0] * U, oy + J[k][1] * U];
  out.feetY = oy + low * U;
  return out;
}

function shade(hex, k) {
  if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length < 7) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

function polyline(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function torsoPath(ctx, d, j, w) {
  const [px, py] = j.pelvis, [nx, ny] = j.neck;
  if (d.torsoShape === 'capsule') return null;
  const ax = nx - px, ay = ny - py, L = Math.hypot(ax, ay) || 1;
  const qx = -ay / L, qy = ax / L;                        // perpendicular
  const top = d.torsoShape === 'inv' ? w * 0.62 : w * 0.34, bot = d.torsoShape === 'inv' ? w * 0.36 : w * 0.72;
  const hem = d.torsoShape === 'tri' ? 0.12 : 0;
  ctx.beginPath();
  ctx.moveTo(nx + qx * top, ny + qy * top);
  ctx.lineTo(px + qx * bot - (ax / L) * hem * j.U, py + qy * bot - (ay / L) * hem * j.U);
  ctx.lineTo(px - qx * bot - (ax / L) * hem * j.U, py - qy * bot - (ay / L) * hem * j.U);
  ctx.lineTo(nx - qx * top, ny - qy * top);
  ctx.closePath();
  return true;
}

function drawHead(ctx, d, j, r, pass, info) {
  const [hx, hy] = j.headC;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(j.headAng);
  if (j.facing < 0) ctx.scale(-1, 1);
  const kind = d.head;
  if (typeof kind === 'function') {
    kind(ctx, r, { ...info, pass, design: d, joints: j });
  } else if (kind === 'tv') {
    const w = r * 2.5, h = r * 2.0;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, r * 0.35);
    ctx.fill();
    if (pass === 'fill') {
      const sw = w * 0.78, shh = h * 0.68;
      if (typeof d.screen === 'function') {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(-sw / 2, -shh / 2, sw, shh, r * 0.2);
        ctx.clip();
        d.screen(ctx, sw, shh, { ...info, design: d, joints: j });
        ctx.restore();
      } else {
        ctx.fillStyle = d.screen;
        ctx.beginPath();
        ctx.roundRect(-sw / 2, -shh / 2, sw, shh, r * 0.2);
        ctx.fill();
      }
      ctx.strokeStyle = ctx.fillStyle = d.headFill;
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -h / 2); ctx.lineTo(-r * 0.75, -h / 2 - r * 0.7);
      ctx.moveTo(r * 0.3, -h / 2); ctx.lineTo(r * 0.75, -h / 2 - r * 0.7);
      ctx.stroke();
    }
  } else if (kind === 'moon') {
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI * 0.38, Math.PI * 1.62, false);
    ctx.arc(r * 0.55, 0, r * 0.82, Math.PI * 1.3, Math.PI * 0.7, true);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'flower') {
    const n = d.petals;
    const save = ctx.fillStyle;
    if (pass === 'fill') ctx.fillStyle = d.petalFill;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.55, r * 0.32, a, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = save;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, TAU);
    ctx.fill();
  } else if (kind === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * TAU, rr = i % 2 ? r * 0.5 : r * 1.15;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind !== 'none') {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
  }
  if (pass === 'fill' && kind !== 'tv' && kind !== 'none' && typeof kind !== 'function') {
    const face = d.face;
    if (typeof face === 'function') face(ctx, r, { ...info, design: d, joints: j });
    else if (face === 'dots' || face === 'closed') {
      ctx.fillStyle = ctx.strokeStyle = d.faceColor;
      const side = j.view === 'side';
      const ex = side ? [r * 0.45] : [-r * 0.32, r * 0.32];
      for (const x of ex) {
        if (face === 'dots') { ctx.beginPath(); ctx.arc(x, -r * 0.05, r * 0.11, 0, TAU); ctx.fill(); }
        else { ctx.lineWidth = r * 0.09; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - r * 0.13, 0); ctx.lineTo(x + r * 0.13, 0); ctx.stroke(); }
      }
    }
  }
  ctx.restore();
}

/**
 * Draw a puppet. opts as in solve(), plus alpha, fill/outline overrides, info (passed to custom
 * heads, faces and screens, e.g. {t, F}). Returns the solved joints.
 */
export function drawPuppet(ctx, d, pose, opts = {}) {
  const j = solve(d, pose, opts);
  const U = j.U;
  const fill = opts.fill || d.fill, limb = opts.limbFill || opts.fill || d.limbFill, headFill = opts.headFill || opts.fill || d.headFill;
  const outline = opts.outline === undefined ? d.outline : opts.outline;
  const ow = (opts.outlineW ?? d.outlineW) * (opts.scale ?? 1);
  const side = j.view === 'side';
  const tw = (side ? d.torsoSide : d.torsoW) * U, aw = d.armW * U, lw = d.legW * U;
  const r = d.headR * U;
  const info = opts.info || {};
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= Math.max(0, Math.min(1, opts.alpha));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const legs = (lr, pass, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw + (pass === 'outline' ? 2 * ow : 0);
    polyline(ctx, [j[`hip${lr}`], j[`knee${lr}`], j[`ankle${lr}`], j[`toe${lr}`]]);
  };
  const arms = (lr, pass, col) => {
    ctx.strokeStyle = ctx.fillStyle = col;
    ctx.lineWidth = aw + (pass === 'outline' ? 2 * ow : 0);
    polyline(ctx, [j[`shoulder${lr}`], j[`elbow${lr}`], j[`wrist${lr}`]]);
    ctx.beginPath();
    ctx.arc(j[`wrist${lr}`][0], j[`wrist${lr}`][1], d.hand * U + (pass === 'outline' ? ow : 0), 0, TAU);
    ctx.fill();
  };
  const torso = (pass, col) => {
    ctx.strokeStyle = ctx.fillStyle = col;
    if (torsoPath(ctx, d, j, tw)) {
      ctx.lineWidth = Math.max(1, tw * 0.25) + (pass === 'outline' ? 2 * ow : 0);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.lineWidth = tw + (pass === 'outline' ? 2 * ow : 0);
      polyline(ctx, [j.pelvis, j.neck]);
    }
    if (d.neck > 0.005) {
      ctx.lineWidth = aw * 0.8 + (pass === 'outline' ? 2 * ow : 0);
      polyline(ctx, [j.neck, [(j.neck[0] * 2 + j.headC[0]) / 3, (j.neck[1] * 2 + j.headC[1]) / 3]]);
    }
  };
  const head = (pass, col) => {
    ctx.fillStyle = ctx.strokeStyle = col;
    // the outline of a head is the same shape grown by the outline width, filled in the outline colour
    drawHead(ctx, d, j, pass === 'outline' ? r + ow : r, pass, info);
  };
  const order = side
    ? [['arm', 'L', true], ['leg', 'L', true], ['torso'], ['leg', 'R'], ['head'], ['arm', 'R']]
    : [['leg', 'L'], ['leg', 'R'], ['torso'], ['head'], ['arm', 'L'], ['arm', 'R']];
  const passes = outline && ow > 0 ? ['outline', 'fill'] : ['fill'];
  passes.forEach((pass, n) => {
    if (n === 0 && d.glow && d.glowBlur > 0) {          // glow: a blurred shadow under the first pass
      ctx.shadowColor = d.glow;
      ctx.shadowBlur = d.glowBlur * (opts.scale ?? 1) * (opts.devScale ?? 1);
    }
    for (const [part, lr, far] of order) {
      const k = far ? d.farShade : 1;
      const col = (base) => (pass === 'outline' ? outline : k === 1 ? base : shade(base, k));
      if (part === 'leg') legs(lr, pass, col(limb));
      else if (part === 'arm') arms(lr, pass, col(limb));
      else if (part === 'torso') torso(pass, col(fill));
      else head(pass, col(headFill));
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
  return j;
}

const spriteCache = new Map();

/**
 * A puppet rendered once into an offscreen canvas, for stamping crowds with drawImage. `key` must
 * identify the pose (e.g. a quantised phase) because the cache is keyed by it, not by the angles.
 * Returns {canvas, w, h, ax, ay}: draw with ctx.drawImage(s.canvas, x - s.ax, groundY - s.ay, s.w, s.h)
 * so the feet land on groundY at x (logical px).
 */
export function puppetSprite(g, d, pose, { key, scale = 1, view = 'side', facing = 1, fill, outline, outlineW } = {}) {
  const ck = `${d.id}|${key}|${scale}|${view}|${facing}|${fill}|${outline}|${outlineW}|${g.scale}`;
  let s = spriteCache.get(ck);
  if (s) return s;
  const ds = g.scale;
  // tight bounds from the solved joints (feet at y = 0), grown by limb widths, head, outline and glow
  const j = solve(d, pose, { x: 0, ground: 0, scale, view, facing });
  const U = j.U, ow = (outlineW ?? d.outlineW ?? 0) * scale;
  const grow = Math.max(d.legW, d.armW, d.torsoW) * U * 0.6 + ow + (d.glowBlur || 0) * scale + 2;
  const headPad = d.headR * U * (d.head === 'tv' ? 1.9 : d.head === 'flower' ? 1.6 : 1.25) + ow + (d.glowBlur || 0) * scale + 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [k, v] of Object.entries(j)) {
    if (!Array.isArray(v)) continue;
    const r = k === 'headC' ? headPad : grow;
    x0 = Math.min(x0, v[0] - r); x1 = Math.max(x1, v[0] + r);
    y0 = Math.min(y0, v[1] - r); y1 = Math.max(y1, v[1] + r);
  }
  const wL = Math.ceil(x1 - x0), hL = Math.ceil(y1 - y0);
  const c = g.createCanvas(Math.max(1, Math.ceil(wL * ds)), Math.max(1, Math.ceil(hL * ds)));
  const x = c.getContext('2d');
  x.scale(ds, ds);
  const ax = -x0, ay = -y0;
  drawPuppet(x, d, pose, { x: ax, ground: ay, scale, view, facing, fill, outline, outlineW, devScale: ds });
  x.getImageData(0, 0, 1, 1);   // rasterise now: an unflushed canvas costs ~2x per drawImage
  s = { canvas: c, w: wL, h: hL, ax, ay };
  if (spriteCache.size > 600) spriteCache.delete(spriteCache.keys().next().value);
  spriteCache.set(ck, s);
  return s;
}

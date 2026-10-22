// A4 + C3 THE SECOND KAISER IMPACT AND THE CORONATION: the climax of the film (and of the short cut).
//
// High in the night sky above a stadium (drawn here, seen from far above: a glowing oval ring of
// floodlights round stands full of tiny lights and a floodlit pitch, in a city of lights under the
// stars), Kaiser rises with the ball floating before him and his red cape billowing. On P.emperorT the
// cape snaps open and gold rays burst behind him; from P.powerT blue energy rings converge on the ball
// (one per strong kick), which glows brighter and brighter; on P.nameT we cut to his profile: he draws
// his leg back and time slows (the world dims, focus lines, slow streaks). P.strikeT: four ink impact
// frames (the engine inverts three of them), then a gigantic shockwave ring tears across the sky and the
// ball dives onto the stadium as a blue comet. P.boomT (the engine flashes): a dome of blue light erupts
// over the stadium, shockwave rings roll across the stands and the city, and the sky fills with blue rose
// petals and gold confetti. The coronation: Kaiser hovers above the light; on P.chosenT a giant crown
// descends from the sky, shrinking as it falls, and settles on his head on the next downbeat while gold
// light pours down; on P.numberT fireworks burst in gold and blue around the stadium (and then on every
// strong kick) and he raises an arm to the sky; on P.loudT a white-gold bloom and the crown flares.
// Kicks fire shockwave pulses and fireworks, snares scatter the petals, hats twinkle the crowd.
//
// Pure: every phase comes from t, F (columns and events) and P; caches are pure functions of their key.

import { KAISER, KZ, drawBall, drawCape, drawCrown, drawRose, speedLines, streakLines } from './lib/kaiser.mjs';
import { blend, drawPuppet, solve } from './lib/puppet.mjs';
import { halftone } from './lib/fx.mjs';
import { fbm, hashU, lattice, rays } from './lib/worldkit.mjs';

const TAU = Math.PI * 2;

export const meta = { type: 'kzCrown', budgetMs: 200 };

/** Fallback colours (the treatment's palette overrides them). */
export const DEFAULT = {
  sky: '#060B2A', skyHi: '#1F4FD8', comet: '#3DE0FF', cometCore: '#FFFFFF', gold: '#FFD45A', goldDeep: '#B8860B',
  rose: '#2E6BFF', stadiumLight: '#EAF4FF', cape: '#B3122B',
};

export const defaults = {
  // moments (seconds); null = derived from the entry, the beat and the events
  emperorT: null,      // the cape snaps open, rays burst
  powerT: null,        // energy rings start converging on the ball
  nameT: null,         // the leg draws back, time slows
  strikeT: null,       // the volley (impact frames)
  boomT: null,         // the comet hits the stadium (null = the section that starts inside the entry)
  chosenT: null,       // the giant crown appears
  numberT: null,       // fireworks
  loudT: null,         // white-gold bloom (null = F.ev.loudest)
  impactFrames: 4,     // ink frames from the strike
  crownMin: 0.55,      // the crown lands on the first downbeat this many seconds after chosenT...
  crownMax: 1.7,       // ...and no later than this (else chosenT + 2 beats)
  ringMin: 0.6,        // kick strength that fires an energy ring (power) or a shockwave pulse (coronation)
  fireMin: 0.72,       // kick strength that fires a firework after numberT
  volley: 8,           // fireworks in the numberT volley
  petals: 230,         // petals in the boom burst
  petalRate: 30,       // petals per second after it
  confetti: 200,
  confettiRate: 28,
  roses: 9,            // whole roses among the petals
  crowd: 9000,         // tiny lights in the stands
};

// ---------------------------------------------------------------- helpers

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const outCubic = (u) => 1 - (1 - clamp(u)) ** 3;
const inQuad = (u) => clamp(u) ** 2;
const outExpo = (u) => { u = clamp(u); return u >= 1 ? 1 : 1 - 2 ** (-10 * u); };
const inOut = (u) => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2; };
const outBack = (u, s = 1.7) => { u = clamp(u); const c3 = s + 1; return 1 + c3 * (u - 1) ** 3 + s * (u - 1) ** 2; };
const dec = (t, t0, tau) => (t < t0 ? 0 : Math.exp(-(t - t0) / tau));
const frac = (x) => x - Math.floor(x);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const landT = (x, fps) => Math.floor(x * fps + 0.5) / fps;

function palette(S) {
  const p = (S && S.palette) || {};
  const o = {};
  for (const k of Object.keys(DEFAULT)) o[k] = typeof p[k] === 'string' && /^#[0-9a-fA-F]{6}/.test(p[k]) ? p[k].slice(0, 7) : DEFAULT[k];
  return o;
}

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    cache.set(key, v);
  }
  return v;
}

/** Derived colours, mixed once per palette. */
function tones(g, pal) {
  return cached(`tones|${Object.values(pal).join(',')}`, () => {
    const m = g.color.mix;
    return {
      zenith: m(pal.sky, '#000000', 0.6),
      skyMid: pal.sky,
      skyLow: m(pal.sky, pal.skyHi, 0.4),
      horizon: m(pal.skyHi, pal.sky, 0.25),
      haze: m(pal.skyHi, pal.sky, 0.5),
      ground: m(pal.sky, '#000000', 0.3),
      groundDeep: m(pal.sky, '#000000', 0.72),
      cloud: m(pal.sky, '#7F95CC', 0.3),
      cloudHi: m('#B9C8F0', pal.skyHi, 0.25),
      roseHi: m(pal.rose, '#FFFFFF', 0.45),
      roseDeep: m(pal.rose, '#000000', 0.45),
      goldHi: m(pal.gold, '#FFFFFF', 0.55),
      ice: m(pal.comet, '#FFFFFF', 0.5),
      warm: m(pal.gold, '#FFFFFF', 0.3),
      crownAura: m(pal.gold, pal.comet, 0.35),
    };
  });
}

// ---------------------------------------------------------------- the moments

function moments(F, P, S) {
  const fps = F.fps || 30, beat = F.beatS || 0.4;
  const L = (x) => landT(x, fps);
  const span = Math.max(1, S.t1 - S.t0);
  const secs = (F.ev && F.ev.sections) || [];
  const sec = secs.find((s) => s.t0 > S.t0 + 1 && s.t0 < S.t1 - 1);
  const boom = L(num(P.boomT) ?? (sec ? sec.t0 : S.t0 + 0.43 * span));
  const strike = L(num(P.strikeT) ?? boom - 1.5 * beat);
  const name = L(num(P.nameT) ?? strike - 0.85 * beat);
  const power = L(num(P.powerT) ?? strike - 4.85 * beat);
  const emperor = L(num(P.emperorT) ?? S.t0 + 2 * beat);
  const chosen = L(num(P.chosenT) ?? boom + 5.6 * beat);
  const number = L(num(P.numberT) ?? chosen + 4.2 * beat);
  const ld = num(F.ev && F.ev.loudest);
  const loud = L(num(P.loudT) ?? (ld !== null && ld > S.t0 && ld < S.t1 ? ld : S.t1 - 0.8));
  let crownLand = chosen + 2 * beat;
  for (const d of (F.ev && F.ev.downbeats) || []) {
    const dl = L(d);
    if (dl >= chosen + (num(P.crownMin) ?? 0.55) && dl <= chosen + (num(P.crownMax) ?? 1.7)) { crownLand = dl; break; }
  }
  const imp = Math.max(1, Math.round(num(P.impactFrames) ?? 4));
  return { t0: S.t0, t1: S.t1, fps, beat, emperor, power, name, strike, boom, chosen, number, loud, crownLand, impEnd: strike + imp / fps - 1e-6 };
}

/** Events of a list in [a, b) with strength >= min, as [landed time, strength] (stable across frames). */
function hits(F, list, a, b, min, fps) {
  const out = [];
  if (!(b > a)) return out;
  for (const e of F.between(list, a, b)) {
    const s = Array.isArray(e) ? (typeof e[1] === 'number' ? e[1] : 1) : 1;
    if (s >= min) out.push([landT(Array.isArray(e) ? e[0] : e, fps), s]);
  }
  return out;
}

// ---------------------------------------------------------------- camera

/**
 * A 2D camera: zoom z about (fx, fy) and a crane move (ox, oy), of which a layer with parallax p takes a
 * fraction, plus a tilt ty that moves every layer alike.
 */
function applyCam(ctx, c, p) {
  const z = 1 + (c.z - 1) * p;
  ctx.translate(c.fx + c.ox * p, c.fy + c.oy * p + (c.ty || 0));
  ctx.scale(z, z);
  ctx.translate(-c.fx, -c.fy);
}
function camPt(c, p, x, y) {
  const z = 1 + (c.z - 1) * p;
  return [c.fx + c.ox * p + (x - c.fx) * z, c.fy + c.oy * p + (c.ty || 0) + (y - c.fy) * z];
}
const camZ = (c, p) => 1 + (c.z - 1) * p;

const PAR = { sky: 0.06, city: 0.2, stadium: 0.28, cloudFar: 0.4, cloudNear: 0.65, kaiser: 1, front: 1.25 };

// ---------------------------------------------------------------- the stadium (seen from far above)

// A small 3D model in metres, projected once into a cached sprite. Logical px at sprite scale 1.
const ST = { alpha: 0.6, D: 1300, kf: 5700 };
const ST_SA = Math.sin(ST.alpha), ST_CA = Math.cos(ST.alpha);
function stProj(X, Y, Z) {
  const dy = Y - ST.D * ST_SA, dz = Z + ST.D * ST_CA;
  const zc = Math.max(1, -dy * ST_SA + dz * ST_CA), yc = dy * ST_CA + dz * ST_SA;
  return [(ST.kf * X) / zc, (-ST.kf * yc) / zc];
}
function se(phi, a, b, n) {
  const c = Math.cos(phi), s = Math.sin(phi), e = 2 / n;
  return [a * Math.sign(c) * Math.abs(c) ** e, b * Math.sign(s) * Math.abs(s) ** e];
}
const SHAPE = { outer: [132, 106, 2.4], roofIn: [101, 77, 2.6], apron: [63, 44, 4.5] };
const H_ROOF = 36, H_ROOF_IN = 33, H_BOWL = 30;
function bowlPt(s, phi) {
  const [x0, z0] = se(phi, ...SHAPE.apron), [x1, z1] = se(phi, ...SHAPE.roofIn);
  return stProj(lerp(x0, x1, s), lerp(1, H_BOWL, s), lerp(z0, z1, s));
}
function ringPts(shape, h, N = 180) {
  const out = [];
  for (let i = 0; i < N; i++) { const [x, z] = se((i / N) * TAU, ...shape); out.push(stProj(x, h, z)); }
  return out;
}
function poly(ctx, pts, close = true) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

function stadiumSprite(g, pal, crowdN) {
  return cached(`stadium|${g.scale}|${Object.values(pal).join(',')}|${crowdN}`, () => {
    const ds = g.scale, m = g.color.mix, css = g.color.css;
    const outerG = ringPts(SHAPE.outer, 0), outerR = ringPts(SHAPE.outer, H_ROOF), innerR = ringPts(SHAPE.roofIn, H_ROOF_IN);
    const PLAZA = [0, 20, 800, 420];                          // a dark plaza round it, so the city does not crowd it
    let x0 = -PLAZA[2], y0 = PLAZA[1] - PLAZA[3], x1 = PLAZA[2], y1 = PLAZA[1] + PLAZA[3];
    for (const [x, y] of [...outerG, ...outerR]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const M = 10, w = Math.ceil(x1 - x0 + 2 * M), h = Math.ceil(y1 - y0 + 2 * M), ax = -x0 + M, ay = -y0 + M;
    const k = 0.65 * ds;                                      // it is only ever drawn at about half size
    const c = g.createCanvas(Math.max(1, Math.ceil(w * k)), Math.max(1, Math.ceil(h * k)));
    const x = c.getContext('2d');
    x.scale(k, k);
    x.translate(ax, ay);
    x.lineJoin = 'round';
    const pg = x.createRadialGradient(0, 0, 0, 0, 0, PLAZA[2]);
    pg.addColorStop(0, css(pal.sky, 0.75)); pg.addColorStop(0.75, css(pal.sky, 0.6)); pg.addColorStop(1, css(pal.sky, 0));
    x.save(); x.translate(0, PLAZA[1]); x.scale(1, PLAZA[3] / PLAZA[2]);
    x.fillStyle = pg; x.fillRect(-PLAZA[2], -PLAZA[2], 2 * PLAZA[2], 2 * PLAZA[2]);
    x.restore();
    const H = (i, k) => hashU(4242, i, k);
    const ledHi = m(pal.skyHi, '#FFFFFF', 0.4);

    // facade: the outer wall, lit by bands of blue LEDs under the roof edge
    x.beginPath(); poly(x, outerG);
    const fg = x.createLinearGradient(0, stProj(0, H_ROOF, -106)[1], 0, stProj(0, 0, -106)[1]);
    fg.addColorStop(0, m(pal.skyHi, '#FFFFFF', 0.1));
    fg.addColorStop(0.18, m(pal.skyHi, pal.sky, 0.62));
    fg.addColorStop(1, m(pal.sky, '#000000', 0.55));
    x.fillStyle = fg; x.fill();
    for (const hh of [8, 15, 22, 29]) {
      x.beginPath();
      for (let i = 0; i <= 90; i++) {
        const [X, Z] = se(Math.PI + (i / 90) * Math.PI, ...SHAPE.outer);
        const [px, py] = stProj(X, hh, Z);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.lineWidth = 1.6; x.strokeStyle = css(ledHi, 0.08 + 0.012 * hh); x.stroke();
    }
    x.strokeStyle = css(pal.sky, 0.6); x.lineWidth = 1.6;
    x.beginPath();
    for (let i = 0; i < 64; i++) {
      const [X, Z] = se(Math.PI + ((i + 0.5) / 64) * Math.PI, ...SHAPE.outer);
      const a = stProj(X, 1, Z), b = stProj(X, H_ROOF - 1, Z);
      x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]);
    }
    x.stroke();

    // the bowl: tiers from the roof down to the apron, alternating seat colours
    const TIERS = 14, N = 180;
    const tier = (s) => Array.from({ length: N }, (_, i) => bowlPt(s, (i / N) * TAU));
    let prev = tier(1);
    for (let k = TIERS - 1; k >= 0; k--) {
      const cur = tier(k / TIERS);
      x.beginPath(); poly(x, prev); poly(x, [...cur].reverse());
      x.fillStyle = k % 2 ? m(pal.sky, pal.cape, 0.3) : m(pal.sky, '#000000', 0.1);
      x.fill('evenodd');
      prev = cur;
    }
    // the crowd: thousands of tiny lights (shirts, scarves, phone screens)
    const crowdCols = ['#FFFFFF', KZ.red, pal.rose, pal.gold, m(pal.stadiumLight, pal.sky, 0.3), pal.cape, '#FFFFFF', pal.comet];
    const live = [];
    for (let i = 0; i < crowdN; i++) {
      const s = 0.03 + 0.94 * H(i, 1), phi = H(i, 2) * TAU;
      const [px, py] = bowlPt(s, phi);
      const col = crowdCols[Math.floor(H(i, 3) * crowdCols.length)];
      const sz = 1.0 + 1.3 * H(i, 4);
      x.fillStyle = css(col, 0.4 + 0.55 * H(i, 5));
      x.fillRect(px - sz / 2, py - sz / 2, sz, sz);
      if (i % 12 === 0 && Math.sin(phi) > -0.25) live.push([px, py, H(i, 6)]);
    }
    // apron and pitch
    const apron = Array.from({ length: N }, (_, i) => { const [X, Z] = se((i / N) * TAU, ...SHAPE.apron); return stProj(X * 0.98, 0.5, Z * 0.98); });
    x.beginPath(); poly(x, apron); x.fillStyle = '#0F4A3A'; x.fill();
    const gA = '#1E8A5E', gB = '#27A06C';
    for (let i = 0; i < 14; i++) {
      const xa = -55 + (i * 110) / 14, xb = -55 + ((i + 1) * 110) / 14;
      const q = [stProj(xa, 0, -36), stProj(xb, 0, -36), stProj(xb, 0, 36), stProj(xa, 0, 36)];
      x.beginPath(); poly(x, q); x.fillStyle = i % 2 ? gA : gB; x.fill();
    }
    x.strokeStyle = 'rgba(245,250,255,0.9)'; x.lineWidth = 1.6;
    const line = (pts) => { x.beginPath(); poly(x, pts.map(([X, Z]) => stProj(X, 0.05, Z)), false); x.stroke(); };
    line([[-52.5, -34], [52.5, -34], [52.5, 34], [-52.5, 34], [-52.5, -34]]);
    line([[0, -34], [0, 34]]);
    line(Array.from({ length: 41 }, (_, i) => [9.15 * Math.cos((i / 40) * TAU), 9.15 * Math.sin((i / 40) * TAU)]));
    for (const sgn of [-1, 1]) {
      line([[sgn * 52.5, -20.16], [sgn * 36, -20.16], [sgn * 36, 20.16], [sgn * 52.5, 20.16]]);
      line([[sgn * 52.5, -9.16], [sgn * 47, -9.16], [sgn * 47, 9.16], [sgn * 52.5, 9.16]]);
    }
    // floodlight wash on the grass
    const [pcx, pcy] = stProj(0, 0, 0);
    const wash = x.createRadialGradient(pcx, pcy, 0, pcx, pcy, 520);
    wash.addColorStop(0, css(pal.stadiumLight, 0.35)); wash.addColorStop(0.6, css(pal.stadiumLight, 0.12)); wash.addColorStop(1, css(pal.stadiumLight, 0));
    x.globalCompositeOperation = 'lighter';
    x.beginPath(); poly(x, apron); x.fillStyle = wash; x.fill();
    x.globalCompositeOperation = 'source-over';

    // the roof ring: dark, with trusses; a strip of floodlights on its inner edge and a glowing outer rim
    x.beginPath(); poly(x, outerR); poly(x, [...innerR].reverse());
    const rg = x.createLinearGradient(0, stProj(0, H_ROOF, 106)[1], 0, stProj(0, H_ROOF, -106)[1]);
    rg.addColorStop(0, m(pal.sky, '#3A4670', 0.5)); rg.addColorStop(1, m(pal.sky, '#28335E', 0.6));
    x.fillStyle = rg; x.fill('evenodd');
    x.strokeStyle = css(pal.sky, 0.65); x.lineWidth = 1.3;
    x.beginPath();
    for (let i = 0; i < 96; i++) {
      const phi = (i / 96) * TAU;
      const [Xa, Za] = se(phi, ...SHAPE.roofIn), [Xb, Zb] = se(phi, ...SHAPE.outer);
      const a = stProj(Xa, H_ROOF_IN, Za), b = stProj(Xb, H_ROOF, Zb);
      x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]);
    }
    x.stroke();
    x.beginPath(); poly(x, outerR);
    x.lineWidth = 9; x.strokeStyle = css(pal.skyHi, 0.4); x.stroke();
    x.lineWidth = 3; x.strokeStyle = css(ledHi, 1); x.stroke();
    x.beginPath(); poly(x, innerR);
    x.lineWidth = 2.6; x.strokeStyle = css(pal.stadiumLight, 0.95); x.stroke();
    const lamps = [];
    for (let i = 0; i < 64; i++) {
      const phi = ((i + 0.5) / 64) * TAU;
      const [X, Z] = se(phi, ...SHAPE.roofIn);
      const [px, py] = stProj(X, H_ROOF_IN + 0.5, Z);
      lamps.push([px, py]);
      x.fillStyle = '#FFFFFF';
      x.beginPath(); x.arc(px, py, 3, 0, TAU); x.fill();
    }
    // it lies far below, under a veil of night haze
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = css(pal.sky, 0.18);
    x.fillRect(-ax, -ay, w, h);
    x.globalCompositeOperation = 'source-over';
    x.getImageData(0, 0, 1, 1);
    return { canvas: c, w, h, ax, ay, lamps, live };
  });
}

/** Stadium-space point (metres) to the reference frame for a view's stadium placement. */
function stPt(V, X, Y, Z) {
  const [px, py] = stProj(X, Y, Z);
  return [V.st.x + px * V.st.s, V.st.y + py * V.st.s];
}

// ---------------------------------------------------------------- the city, the stars and the clouds

/** City lights in perspective toward a horizon at y = 0, across W0 px, thinned by a density field. */
function paintCity(x, pal, css, W0, H0) {
  const f = 1150, Hc = 520, cx = W0 / 2;
  const Lt = lattice(77);
  const H = (i, k) => hashU(7177, i, k);
  const cols = ['#FFC46B', '#FFE3A6', '#CFE3FF', '#FFFFFF', '#8FB6FF', '#FFC46B', '#FFB25A'];
  const dens = (X, Z) => { const v = fbm(Lt, X / 1500 + 7.3, Z / 1500 + 1.1, 4); return clamp((v - 0.36) / 0.24); };
  const dot = (X, Z, i, bright) => {
    const y = (f * Hc) / Z;
    if (y < 1.5 || y > H0) return;
    const px = cx + (f * X) / Z;
    if (px < -4 || px > W0 + 4) return;
    const near = clamp(y / H0);
    const sz = (0.7 + 1.9 * near) * (bright ? 1.35 : 1);
    x.fillStyle = css(cols[Math.floor(H(i, 7) * cols.length)], clamp((0.35 + 0.65 * H(i, 8)) * (0.55 + 0.45 * near) * (bright ? 1.3 : 1)));
    x.fillRect(px - sz / 2, y - sz / 2, sz, sz);
  };
  let id = 0;
  for (let m0 = -70; m0 <= 70; m0++) {                      // streets toward the horizon
    const X = m0 * 160;
    for (let Z = 680; Z < 24000; Z *= 1.03) {
      id++;
      if (H(id, 1) > 0.12 + 0.88 * dens(X, Z)) continue;
      dot(X + (H(id, 2) - 0.5) * 8, Z, id, m0 % 5 === 0);
    }
  }
  for (let Z = 700; Z < 24000; Z *= 1.09) {                 // cross streets
    const step = Math.max(12, (12 * Z) / f);
    for (let X = (-cx * Z) / f; X < (cx * Z) / f; X += step) {
      id++;
      if (H(id, 1) > 0.1 + 0.9 * dens(X, Z)) continue;
      dot(X + (H(id, 2) - 0.5) * step * 0.5, Z, id, false);
    }
  }
  for (let i = 0; i < 9000; i++) {                          // scattered windows
    id++;
    const Z = 680 * Math.exp(H(id, 3) * Math.log(32)), X = (H(id, 4) * 2 - 1) * (cx * Z) / f;
    if (H(id, 5) > dens(X, Z)) continue;
    dot(X, Z, id, false);
  }
  const hz = x.createLinearGradient(0, 0, 0, 220);           // the haze band at the horizon
  hz.addColorStop(0, css(pal.skyHi, 0.3)); hz.addColorStop(0.3, css(pal.skyHi, 0.1)); hz.addColorStop(1, css(pal.skyHi, 0));
  x.globalCompositeOperation = 'lighter';
  x.fillStyle = hz; x.fillRect(0, 0, W0, 220);
  x.globalCompositeOperation = 'source-over';
}

/** Stars over W0 x H0 (denser and brighter high up), a few with glints. */
function paintStars(x, W0, H0) {
  const H = (i, k) => hashU(3131, i, k);
  for (let i = 0; i < 1300; i++) {
    const px = H(i, 1) * W0, py = H(i, 2) ** 1.15 * H0;
    const r = H(i, 3), sz = r < 0.86 ? 0.7 + 0.9 * H(i, 4) : r < 0.98 ? 1.4 + 1.0 * H(i, 4) : 2.4;
    const col = H(i, 5) < 0.75 ? '255,255,255' : H(i, 5) < 0.9 ? '190,215,255' : '255,232,190';
    x.fillStyle = `rgba(${col},${((0.35 + 0.65 * H(i, 6)) * (1 - 0.5 * (py / H0))).toFixed(3)})`;
    x.beginPath(); x.arc(px, py, sz / 2, 0, TAU); x.fill();
    if (r >= 0.985) {
      x.fillStyle = `rgba(${col},0.5)`;
      x.fillRect(px - 8, py - 0.5, 16, 1); x.fillRect(px - 0.5, py - 8, 1, 16);
    }
  }
}

// The whole far world (sky, stars, a gently curved horizon, the city far below) painted once and blitted
// at whole device pixels: the horizon is at BD.y within it, the frame's left edge at BD.mx.
const BD = { mx: 300, y: 640, h: 1720, R: 8000 };
function backdropSprite(g, pal) {
  return cached(`backdrop|${g.scale}|${Object.values(pal).join(',')}`, () => {
    const T = tones(g, pal), css = g.color.css, ds = g.scale;
    const Wb = g.W + 2 * BD.mx, hy = BD.y;
    const c = g.createCanvas(Math.ceil(Wb * ds), Math.ceil(BD.h * ds));
    const x = c.getContext('2d');
    x.scale(ds, ds);
    const sg = x.createLinearGradient(0, hy - 700, 0, hy);
    sg.addColorStop(0, T.zenith); sg.addColorStop(0.45, T.skyMid); sg.addColorStop(0.8, T.skyLow); sg.addColorStop(1, T.horizon);
    x.fillStyle = sg;
    x.fillRect(0, 0, Wb, hy + 160);
    x.save();
    x.globalCompositeOperation = 'lighter';
    x.translate(0, hy - 900 - 30);
    paintStars(x, Wb, 900);
    x.restore();
    const earth = () => { x.beginPath(); x.arc(Wb / 2, hy + BD.R, BD.R, 0, TAU); };
    const gg = x.createLinearGradient(0, hy, 0, hy + 1060);
    gg.addColorStop(0, T.horizon); gg.addColorStop(0.05, T.haze); gg.addColorStop(0.24, T.ground); gg.addColorStop(1, T.groundDeep);
    x.fillStyle = gg;
    earth(); x.fill();
    x.save();
    earth(); x.clip();
    const city = g.createCanvas(Math.ceil(3000 * ds), Math.ceil(900 * ds));
    const cx = city.getContext('2d');
    cx.scale(ds, ds);
    paintCity(cx, pal, css, 3000, 900);
    x.globalCompositeOperation = 'lighter';
    x.drawImage(city, Wb / 2 - 1500, hy, 3000, 900);
    x.restore();
    x.globalCompositeOperation = 'lighter';
    earth();
    x.lineWidth = 140; x.strokeStyle = css(T.horizon, 0.07); x.stroke();
    x.lineWidth = 46; x.strokeStyle = css(T.horizon, 0.11); x.stroke();
    x.lineWidth = 3; x.strokeStyle = css(T.horizon, 0.35); x.stroke();
    x.globalCompositeOperation = 'source-over';
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/** A soft cloud bank: fbm noise through an elliptical mask, lit from above. Small, drawn upscaled. */
function cloudSprite(g, pal, i) {
  const T = tones(g, pal);
  return cached(`cloud|${i}|${T.cloud}|${T.cloudHi}`, () => {
    const w = 320, h = 90;
    const c = g.createCanvas(w, h);
    const x = c.getContext('2d');
    const img = x.createImageData(w, h);
    const d = img.data;
    const Lt = lattice(500 + i);
    const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
    const A = rgb(T.cloud), B = rgb(T.cloudHi);
    for (let yy = 0, o = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++, o += 4) {
        const u = xx / w - 0.5, v = yy / h - 0.55;
        const mask = clamp(1 - (u * u) / 0.25 - (v * v) / 0.2);
        const n = fbm(Lt, xx / 40 + i * 9.1, yy / 26, 5);
        const a = clamp((n * (0.35 + 0.9 * mask) - 0.36) / 0.2) * mask;
        const lit = clamp(0.85 - yy / h + 1.6 * (n - 0.5));
        d[o] = A[0] + (B[0] - A[0]) * lit; d[o + 1] = A[1] + (B[1] - A[1]) * lit; d[o + 2] = A[2] + (B[2] - A[2]) * lit;
        d[o + 3] = Math.round(255 * a);
      }
    }
    x.putImageData(img, 0, 0);
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

function petalSprite(g, pal, v) {
  return cached(`petal|${v}|${g.scale}|${pal.rose}`, () => {
    const T = tones(g, pal);
    const s = Math.max(8, Math.round(64 * g.scale));
    const c = g.createCanvas(s, s);
    const x = c.getContext('2d');
    x.scale(s / 64, s / 64);
    x.translate(32, 32);
    const col = [pal.rose, g.color.mix(pal.rose, T.roseHi, 0.45), g.color.mix(pal.rose, T.roseDeep, 0.5)][v % 3];
    const gr = x.createLinearGradient(-20, -26, 18, 26);
    gr.addColorStop(0, g.color.mix(col, '#FFFFFF', 0.22)); gr.addColorStop(0.45, col); gr.addColorStop(1, g.color.mix(col, '#000000', 0.45));
    x.beginPath();
    x.moveTo(-4, -28);
    x.bezierCurveTo(10, -30, 26, -12, 18, 8);
    x.bezierCurveTo(12, 22, 2, 28, -2, 28);
    x.bezierCurveTo(-18, 18, -24, -16, -4, -28);
    x.fillStyle = gr; x.fill();
    x.strokeStyle = 'rgba(8,12,40,0.6)'; x.lineWidth = 1.8; x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.4)'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(0, -18); x.quadraticCurveTo(5, 0, 0, 18); x.stroke();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

function roseSprite(g, pal) {
  return cached(`rose|${g.scale}|${pal.rose}`, () => {
    const T = tones(g, pal);
    const s = Math.max(12, Math.round(128 * g.scale));
    const c = g.createCanvas(s, s);
    const x = c.getContext('2d');
    x.scale(s / 128, s / 128);
    drawRose(x, 64, 64, 58, { color: pal.rose, deep: T.roseDeep, hi: T.roseHi });
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

// ---------------------------------------------------------------- poses, shots, framing

const POSE = {
  hover: { sL: 0.34, sR: 0.4, eL: 0.3, eR: 0.22, hL: 0.05, hR: 0.03, kL: 0.24, kR: 0.08, head: -0.18 },
  rise: { sL: 0.2, sR: 0.24, eL: 0.2, eR: 0.15, hL: 0.03, hR: 0.02, kL: 0.1, kR: 0.04, head: -0.34 },
  emperor: { sL: 1.1, sR: 1.1, eL: 0.2, eR: 0.2, hL: 0.07, hR: 0.07, kL: 0.14, kR: 0.05, head: -0.3 },
  power: { sL: 0.85, sR: 1.3, eL: 0.25, eR: 0.7, hL: 0.06, hR: 0.04, kL: 0.2, kR: 0.08, head: 0.08 },
  sideHover: { sL: 0.45, eL: 0.55, sR: -0.3, eR: 0.45, hL: 0.25, kL: 0.45, hR: -0.15, kR: 0.6, head: 0.2, lean: 0.02 },
  windup: { sL: 1.0, eL: 0.4, sR: -2.2, eR: 0.3, hL: 0.3, kL: 0.5, hR: -1.0, kR: 2.4, lean: 0.15, head: 0.45, rot: -0.1 },
  contact: { sL: -1.2, eL: 0.35, sR: 1.9, eR: 0.2, hL: -0.6, kL: 1.2, hR: 1.35, kR: 0.08, lean: -0.3, head: 0.35, rot: 0.12 },
  follow: { sL: -1.3, eL: 0.3, sR: 2.3, eR: 0.15, hL: -0.7, kL: 1.1, hR: 2.0, kR: 0.1, lean: -0.42, head: 0.25, rot: -0.15 },
  crowned: { sL: 0.72, sR: 0.72, eL: 0.2, eR: 0.2, hL: 0.05, hR: 0.05, kL: 0.12, kR: 0.04, head: -0.24 },
  number: { sL: 0.62, sR: 2.95, eL: 0.25, eR: 0.04, hL: 0.05, hR: 0.05, kL: 0.12, kR: 0.04, head: -0.32 },
};

function shotOf(t, T) {
  if (t < T.name) return 'A';
  if (t < T.strike) return 'B';
  if (t < T.impEnd) return 'I';
  if (t < T.boom) return 'C';
  return 'D';
}

/** The camera's look up at the sky as the crown appears, following it back down onto his head. */
function crownTilt(t, T) {
  const up = outCubic((t - T.chosen + 0.04) / 0.3);
  const down = inOut((t - T.chosen - 0.22) / Math.max(0.2, T.crownLand - T.chosen - 0.12));
  return 330 * up * (1 - down);
}

function makeView(t, T) {
  const shot = shotOf(t, T);
  const bob = Math.sin(t * 2.2) * 6 + Math.sin(t * 0.9 + 1) * 4;
  if (shot === 'A') {
    const rise = outCubic((t - T.t0) / Math.max(0.6, T.emperor - T.t0 + 0.8));
    const drift = smooth((t - T.emperor) / Math.max(0.3, T.power - T.emperor));
    const push = inOut((t - T.power) / Math.max(0.3, T.name - T.power));
    return {
      shot, hy: lerp(208, 226, rise), st: { x: 960, y: lerp(880, 912, rise), s: lerp(0.54, 0.5, rise) }, gx: 0,
      cam: { z: 1 + 0.04 * drift + 0.26 * push, fx: 1010, fy: 560, ox: 0, oy: 0, ty: 0 }, cloudY: lerp(-420, 0, rise),
      K: { x: 930, y: lerp(730, 432, rise) + bob * rise, U: 500, view: 'front', facing: 1 },
    };
  }
  if (shot === 'B' || shot === 'I') {
    const u = clamp((t - T.name) / Math.max(1e-3, T.strike - T.name));
    return {
      shot, hy: 150, st: { x: 1560, y: 985, s: 0.42 }, gx: -420, cloudY: 0,
      cam: { z: 1 + 0.07 * u, fx: 1000, fy: 620, ox: 0, oy: 0, ty: 0 },
      K: { x: 640, y: 520, U: 640, view: 'side', facing: 1 },
    };
  }
  if (shot === 'C') {
    const u = clamp((t - T.strike) / Math.max(1e-3, T.boom - T.strike));
    return {
      shot, hy: 175, st: { x: 1330, y: 880, s: 0.5 }, gx: 300, cloudY: 0,
      cam: { z: 1 + 0.22 * inQuad(u), fx: 1330, fy: 870, ox: 0, oy: 0, ty: 0 },
      K: { x: 600, y: 330, U: 360, view: 'side', facing: 1 },
    };
  }
  const p1 = smooth((t - T.boom) / Math.max(0.5, T.chosen - T.boom));
  const p2 = inOut((t - T.chosen) / Math.max(0.5, T.t1 - T.chosen));
  const drift = Math.sin(Math.PI * p1) * (1 - p2);                // a slow sideways glide while he hovers
  return {
    shot, hy: 226, st: { x: 960, y: 915, s: 0.52 }, gx: 0, cloudY: 0,
    cam: { z: 1 + 0.1 * p1 + 0.38 * p2, fx: 960, fy: 300, ox: 70 * drift, oy: -24 * drift, ty: crownTilt(t, T) },
    K: { x: 960, y: 440 + bob, U: 500, view: 'front', facing: 1 },
  };
}

// ---------------------------------------------------------------- backdrop: sky, stars, city, stadium, clouds

/** The far world: one integer blit of the cached backdrop (the horizon follows the camera), then twinkles. */
function drawBackdrop(g, V, pal, t, F) {
  const { ctx } = g, ds = g.scale;
  const bd = backdropSprite(g, pal);
  const hyS = camPt(V.cam, PAR.city, 0, V.hy)[1];
  const dx = Math.round((-BD.mx + V.gx * 0.4) * ds), dy = Math.round((hyS - BD.y) * ds);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bd, dx, dy);
  ctx.restore();
  const tw = clamp(F.c.hat || 0);
  if (tw > 0.05) {                                              // stars twinkle on the hats
    const glow = g.sprites.glow('#CFE0FF', 1);
    const fr = Math.floor((F.frame || 0) / 2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12; i++) {
      const px = hashU(88, fr, i) * g.W, py = hyS - 40 - hashU(88, fr, i + 50) * (hyS + 60);
      ctx.globalAlpha = tw * 0.55;
      ctx.drawImage(glow, px - 8, py - 8, 16, 16);
    }
    ctx.restore();
  }
}

function drawClouds(g, V, pal, t, which, alpha = 1) {
  const { ctx } = g;
  const near = which === 'near';
  ctx.save();
  applyCam(ctx, V.cam, near ? PAR.cloudNear : PAR.cloudFar);
  const list = near
    ? [[0, 1700, 0.93, 300, 0.42], [1, 1900, 1.02, 260, 0.36], [2, 1500, 0.8, 200, 0.24]]
    : [[3, 1500, 0.3, 120, 0.5], [1, 1300, 0.45, 150, 0.45], [0, 1700, 0.6, 190, 0.4], [2, 1400, 0.7, 170, 0.32]];
  for (const [i, w, yf, hgt, a] of list) {
    const c = cloudSprite(g, pal, i);
    const span = g.W + w + 400;
    const drift = ((((t * (near ? 26 : 10) + i * 731 + yf * 400) % span) + span) % span) - w / 2 - 200;
    const y = V.hy + (g.H - V.hy) * yf + (near ? V.cloudY : V.cloudY * 0.4);
    ctx.globalAlpha = a * alpha;
    for (const xx of [drift - w / 2 + V.gx * (near ? 0.4 : 0.2), drift - w / 2 - span + V.gx * (near ? 0.4 : 0.2)]) {
      if (xx > g.W + 250 || xx + w < -250) continue;
      ctx.drawImage(c, xx, y - hgt / 2, w, hgt);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** The opening: a bank of cloud under Kaiser, lit from below, sinking away as he rises out of it. */
function drawRiseBank(g, V, pal, t, T) {
  const k = 1 - smooth((t - T.t0) / Math.max(0.6, T.emperor - T.t0 + 1.0));
  if (k <= 0.01) return;
  const { ctx } = g;
  const sink = 620 * (1 - k) * (1 - k * 0.3);
  ctx.save();
  applyCam(ctx, V.cam, PAR.cloudNear);
  for (let i = 0; i < 6; i++) {
    const c = cloudSprite(g, pal, i % 4);
    const w = 1250 + 260 * hashU(909, i, 1), h = 330 + 90 * hashU(909, i, 2);
    const x = -260 + i * 470 + Math.sin(t * 0.5 + i) * 30 + (t - T.t0) * (i % 2 ? 14 : -10);
    const y = 800 + (i % 2) * 120 + sink * (0.85 + 0.3 * hashU(909, i, 3));
    ctx.globalAlpha = 0.92 * clamp(k * 1.6);
    ctx.drawImage(c, x - w / 2, y - h / 2, w, h);
  }
  ctx.globalCompositeOperation = 'lighter';                    // the stadium's glow from beneath
  ctx.globalAlpha = 0.35 * k;
  const gl = g.sprites.glow(g.color.mix(pal.stadiumLight, pal.skyHi, 0.4));
  ctx.drawImage(gl, 960 - 900, 760 + sink - 300, 1800, 700);
  ctx.restore();
}

function drawStadium(g, V, pal, t, F, P, boost = 0) {
  const { ctx } = g, css = g.color.css;
  const sp = stadiumSprite(g, pal, Math.round(num(P.crowd) ?? 9000));
  const s = V.st.s, X0 = V.st.x, Y0 = V.st.y;
  const kick = clamp(F.c.kick || 0), hat = clamp(F.c.hat || 0), sn = clamp(F.c.snare || 0);
  ctx.save();
  applyCam(ctx, V.cam, PAR.stadium);
  ctx.drawImage(sp.canvas, X0 - sp.ax * s, Y0 - sp.ay * s, sp.w * s, sp.h * s);
  // live lights: lamps flare on kicks, phones twinkle on hats and snares
  const lg = g.sprites.glow(pal.stadiumLight, 1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(0.5 + 0.35 * kick + 0.3 * boost);
  const r = 22 * s * (1 + 0.5 * kick + 0.6 * boost);
  for (const [px, py] of sp.lamps) ctx.drawImage(lg, X0 + px * s - r, Y0 + py * s - r, 2 * r, 2 * r);
  const fr = Math.floor((F.frame || 0) / 2);
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < sp.live.length; i++) {
    const [px, py, h] = sp.live[i];
    if (hashU(97, fr, i) > 0.1 + 0.35 * hat + 0.3 * sn) continue;
    ctx.globalAlpha = 0.6 + 0.4 * h;
    const sz = 3 * s;
    ctx.fillRect(X0 + px * s - sz / 2, Y0 + py * s - sz / 2, sz, sz);
  }
  ctx.globalAlpha = clamp(0.36 + 0.14 * kick + 0.35 * boost);     // the glow of the floodlights in the night air
  const hz = g.sprites.glow(g.color.mix(pal.stadiumLight, pal.skyHi, 0.35));
  ctx.drawImage(hz, X0 - 900 * s, Y0 - 560 * s, 1800 * s, 960 * s);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// ---------------------------------------------------------------- Kaiser

/** The cape, shaped for the moment: billowing, snapped open (front) or streaming back (side), with folds. */
function capeFor(c, j, K, pal, ink) {
  const cp = K.cape, U = j.U;
  const cx = (j.shoulderL[0] + j.shoulderR[0]) / 2, cy = (j.shoulderL[1] + j.shoulderR[1]) / 2;
  const side = K.view === 'side';
  c.save();
  const sx = side ? 1 : 1 + 0.24 * cp.open, sy = side ? 1 : 1 + 0.06 * cp.open;

  c.translate(cx, cy);
  if (side) {
    c.rotate(cp.stream * j.facing);
    c.scale(0.58, 1 + 0.08 * Math.sin(cp.t * 3));
  } else {
    c.transform(1, 0, cp.skew, 1, 0, 0);
    c.scale(sx, sy);
  }
  c.translate(-cx, -cy);
  if (ink) {
    drawCape(c, j, { t: cp.t, wind: cp.wind, length: cp.length, color: '#202020', deep: '#000000', gold: '#FFFFFF', fur: '#FFFFFF', spot: '#000000' });
  } else {
    // (a widened cape's own collar is drawn in the cape's colours: it tucks under the real collar)
    drawCape(c, j, sx > 1.01 ? { t: cp.t, wind: cp.wind, length: cp.length, color: pal.cape, fur: KZ.capeDeep, spot: KZ.capeDeep } : { t: cp.t, wind: cp.wind, length: cp.length, color: pal.cape });
    // folds: dark and light wedges from the collar to the hem, painted only onto the cape (first in the layer)
    c.globalCompositeOperation = 'source-atop';
    const half = Math.max(Math.abs(j.shoulderR[0] - j.shoulderL[0]) / 2, U * 0.09) + U * 0.05;
    const spread = U * (0.24 + 0.06 * Math.abs(cp.wind)), sway = cp.wind * U * 0.16, bottom = cy + U * cp.length;
    for (let i = 0; i < 8; i++) {
      const u = (i + 0.5) / 8;
      const xb = cx - half - spread + sway + 2 * (half + spread) * u + Math.sin(cp.t * 2.2 + i * 1.3) * U * 0.015;
      const xt = cx + (u - 0.5) * half * 1.4;
      const w = U * (0.02 + 0.014 * ((i * 5) % 3));
      const gr = c.createLinearGradient(0, cy, 0, bottom);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, i % 2 ? 'rgba(255,140,150,0.2)' : 'rgba(30,0,6,0.42)');
      c.fillStyle = gr;
      c.beginPath();
      c.moveTo(xt, cy + U * 0.05);
      c.lineTo(xb - w, bottom + U * 0.04);
      c.lineTo(xb + w, bottom + U * 0.04);
      c.closePath();
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }
  c.restore();
}

function collarFor(c, j, K, ink) {
  c.save();
  if (K.view === 'side') {
    const cx = (j.shoulderL[0] + j.shoulderR[0]) / 2, cy = (j.shoulderL[1] + j.shoulderR[1]) / 2;
    c.translate(cx, cy); c.scale(0.55, 1); c.translate(-cx, -cy);
  }
  drawCape(c, j, ink ? { collarOnly: true, fur: '#FFFFFF', spot: '#000000' } : { collarOnly: true });
  c.restore();
}

/** Kaiser into his own layer (camera applied); returns the layer, the solved joints and his device-px box. */
function kaiserLayer(g, V, K, pal, extra, ink = false) {
  const L = g.layer('kzCrown-kaiser');
  const c = L.ctx;
  c.save();
  applyCam(c, V.cam, PAR.kaiser);
  const sc = K.U / KAISER.height;
  const o = { x: K.x, y: K.y, scale: sc, view: K.view, facing: K.facing, devScale: g.scale };
  const j = solve(KAISER, K.pose, o);
  capeFor(c, j, K, pal, ink);
  if (ink) drawPuppet(c, KAISER, K.pose, { ...o, fill: '#0A0A0A', limbFill: '#0A0A0A', armFill: '#0A0A0A', legFill: '#0A0A0A', outline: '#FFFFFF', outlineW: 2.2 });
  else drawPuppet(c, KAISER, K.pose, o);
  collarFor(c, j, K, ink);
  if (extra) extra(c, j);
  c.restore();
  // a generous box round him and his cape (and a crown), so the compositing touches only that
  const U = j.U;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of Object.values(j)) {
    if (!Array.isArray(v)) continue;
    x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]);
  }
  const cx = (j.shoulderL[0] + j.shoulderR[0]) / 2, cy = (j.shoulderL[1] + j.shoulderR[1]) / 2;
  if (K.view === 'side') { x0 = Math.min(x0, cx - 1.0 * U); x1 = Math.max(x1, cx + 1.0 * U); y0 = Math.min(y0, cy - 1.0 * U); y1 = Math.max(y1, cy + 1.0 * U); }
  else { x0 = Math.min(x0, cx - 0.8 * U); x1 = Math.max(x1, cx + 0.8 * U); y1 = Math.max(y1, cy + 0.95 * U); }
  y0 = Math.min(y0, j.headC[1] - 0.3 * U);
  const pad = 0.1 * U + 40;
  const [ax, ay] = camPt(V.cam, 1, x0 - pad, y0 - pad), [bx, by] = camPt(V.cam, 1, x1 + pad, y1 + pad);
  const ds = g.scale;
  const X0 = clamp(Math.floor(ax * ds), 0, g.devW), Y0 = clamp(Math.floor(ay * ds), 0, g.devH);
  const X1 = clamp(Math.ceil(bx * ds), 0, g.devW), Y1 = clamp(Math.ceil(by * ds), 0, g.devH);
  return { L, j, box: [X0, Y0, Math.max(1, X1 - X0), Math.max(1, Y1 - Y0)] };
}

/** Composite Kaiser's layer within his box: a soft aura behind (blurred silhouette), the figure, then a rim light. */
function compositeKaiser(g, L, box, { aura = 0, auraColor = '#3DE0FF', auraR = 16, rim = 0, rimColor = '#FFFFFF', rimDx = 0, rimDy = -6 } = {}) {
  const { ctx } = g;
  const ds = g.scale;
  const [X, Y, Wd, Hd] = box;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (aura > 0.01) {
    const q = cached(`q|${g.devW}x${g.devH}`, () => g.createCanvas(Math.max(1, Math.ceil(g.devW / 4) + 2), Math.max(1, Math.ceil(g.devH / 4) + 2)));
    const qc = q.getContext('2d');
    const qw = Math.ceil(Wd / 4), qh = Math.ceil(Hd / 4);
    qc.setTransform(1, 0, 0, 1, 0, 0);
    qc.globalAlpha = 1;
    qc.globalCompositeOperation = 'source-over';
    qc.clearRect(0, 0, qw + 2, qh + 2);
    qc.filter = `blur(${Math.max(0.5, (auraR * ds) / 4).toFixed(2)}px)`;
    qc.drawImage(L.canvas, X, Y, Wd, Hd, 0, 0, Wd / 4, Hd / 4);
    qc.filter = 'none';
    qc.globalCompositeOperation = 'source-in';
    qc.fillStyle = auraColor;
    qc.fillRect(0, 0, qw + 2, qh + 2);
    qc.globalCompositeOperation = 'source-over';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(aura);
    ctx.drawImage(q, 0, 0, Wd / 4, Hd / 4, X, Y, Wd, Hd);
    if (aura > 1) { ctx.globalAlpha = clamp(aura - 1); ctx.drawImage(q, 0, 0, Wd / 4, Hd / 4, X, Y, Wd, Hd); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(L.canvas, X, Y, Wd, Hd, X, Y, Wd, Hd);
  if (rim > 0.01) {
    const R = g.layer('kzCrown-rim');
    const rc = R.ctx;
    rc.setTransform(1, 0, 0, 1, 0, 0);
    rc.drawImage(L.canvas, X, Y, Wd, Hd, X, Y, Wd, Hd);
    rc.globalCompositeOperation = 'source-in';
    rc.fillStyle = rimColor;
    rc.fillRect(X, Y, Wd, Hd);
    rc.globalCompositeOperation = 'destination-out';
    const ox = Math.round(rimDx * ds), oy = Math.round(rimDy * ds);
    rc.drawImage(L.canvas, X, Y, Wd, Hd, X + ox, Y + oy, Wd, Hd);
    rc.globalCompositeOperation = 'source-over';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(rim);
    ctx.drawImage(R.canvas, X, Y, Wd, Hd, X, Y, Wd, Hd);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/** Where the crown sits on a head (reference coords) and its width. */
function crownSeat(j) {
  const r = KAISER.headR * j.U, a = j.headAng;
  const dx = Math.sin(a) * 0.74 * r, dy = -Math.cos(a) * 0.74 * r;
  return { x: j.headC[0] + dx, y: j.headC[1] + dy, w: 2.15 * r, ang: a, r };
}

// ---------------------------------------------------------------- light, energy, ball

function drawRaysBehind(g, cx, cy, col, amt, t, len, kick, rot0) {
  if (amt <= 0.01 || len <= 1) return;
  const { ctx } = g, css = g.color.css;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  rays(ctx, { cx, cy, n: 12, rot: 0.04 * t + rot0, spread: 0.075, length: len, color: css(col, 0.2 * amt * (0.8 + 0.4 * kick)), fade: css(col, 0) });
  rays(ctx, { cx, cy, n: 12, rot: -0.06 * t + 0.13 - rot0 * 0.5, spread: 0.022, length: len * 0.85, color: css('#FFFFFF', 0.12 * amt), fade: css('#FFFFFF', 0) });
  const gl = g.sprites.glow(col);
  ctx.globalAlpha = clamp(0.4 * amt * (0.85 + 0.3 * kick));
  ctx.drawImage(gl, cx - 380, cy - 380, 760, 760);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Electric arcs crackling off the ball (re-rolled every 2 frames). */
function arcs(ctx, x, y, r, n, len, frame, color, width, seed = 5, hold = 2) {
  const k = Math.floor(frame / hold);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = hashU(seed, k, i) * TAU;
    let px = x + Math.cos(a0) * r, py = y + Math.sin(a0) * r;
    ctx.moveTo(px, py);
    const L = len * (0.5 + 0.7 * hashU(seed, k, i + 40));
    for (let s = 1; s <= 6; s++) {
      const a = a0 + (hashU(seed, k, i * 31 + s) - 0.5) * 1.3;
      px += (Math.cos(a) * L) / 6; py += (Math.sin(a) * L) / 6;
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
}

function drawBallEnergy(g, x, y, r, charge, flash, F, pal, { rot = 0, arcsN = 0, hold = 2 } = {}) {
  const { ctx } = g, css = g.color.css;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gl = g.sprites.glow(pal.comet), gw = g.sprites.glow(pal.rose);
  const R1 = r * (2.6 + 6.5 * charge + 6 * flash);
  ctx.globalAlpha = clamp(0.18 + 0.42 * charge + 0.4 * flash);
  ctx.drawImage(gw, x - R1 * 1.3, y - R1 * 1.3, R1 * 2.6, R1 * 2.6);
  ctx.globalAlpha = clamp(0.25 + 0.75 * charge + 0.35 * flash);
  ctx.drawImage(gl, x - R1, y - R1, 2 * R1, 2 * R1);
  ctx.globalAlpha = 1;
  if (arcsN > 0) arcs(ctx, x, y, r * 1.05, arcsN, r * (1.6 + 2.6 * charge), F.frame || 0, css(pal.cometCore, 0.85), Math.max(1.2, r * 0.06), 5, hold);
  ctx.restore();
  drawBall(ctx, x, y, r, { rot });
  if (charge > 0.05 || flash > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, TAU);
    ctx.lineWidth = Math.max(1.5, r * 0.1); ctx.strokeStyle = css(pal.comet, clamp(0.4 + 0.6 * charge)); ctx.stroke();
    const core = g.sprites.glow(pal.cometCore, 1);
    ctx.globalAlpha = clamp(0.35 * charge + 0.7 * flash);
    ctx.drawImage(core, x - r * 1.7, y - r * 1.7, r * 3.4, r * 3.4);
    ctx.restore();
  }
}

/** Energy rings converging on the ball: one per strong kick in [power, name). Returns the arrival flash. */
function drawConverge(g, x, y, t, T, F, P, pal, scale = 1) {
  const { ctx } = g, css = g.color.css;
  const life = 0.36;
  const list = [[T.power, 1.3], ...hits(F, 'kick', T.power + 0.05, Math.min(T.name, t + 1e-6), num(P.ringMin) ?? 0.6, T.fps)];
  let flash = 0;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [t0, s] of list) {
    if (t < t0) continue;
    const age = t - t0 + 0.5 / T.fps;
    if (age > life) { flash = Math.max(flash, dec(t, t0 + life, 0.09) * Math.min(1, s)); continue; }
    const u = age / life;
    const id = Math.round(t0 * 1000);
    const R = (380 + 240 * hashU(61, id, 1)) * (1 - inQuad(u)) * scale * (s > 1 ? 1.6 : 1);
    const ratio = 0.28 + 0.6 * hashU(61, id, 2), rot = hashU(61, id, 3) * Math.PI;
    const a = clamp(0.45 + u * 4) * (0.55 + 0.45 * u);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, ratio);
    ctx.beginPath(); ctx.arc(0, 0, Math.max(1, R), 0, TAU);
    ctx.lineWidth = (8 + 14 * u) * scale; ctx.strokeStyle = css(pal.rose, 0.3 * a); ctx.stroke();
    ctx.lineWidth = (2 + 3.5 * u) * scale; ctx.strokeStyle = css(pal.comet, 0.95 * a); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  return flash;
}

/** Sparks streaming into the ball (closed form, looping). */
function drawInflow(g, x, y, amt, t, pal, R = 480) {
  if (amt <= 0.02) return;
  const { ctx } = g, css = g.color.css;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(pal.comet, 0.7 * amt);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const n = Math.round(56 * amt);
  for (let i = 0; i < n; i++) {
    const a = hashU(17, i, 1) * TAU, per = 0.45 + 0.4 * hashU(17, i, 2);
    const ph = frac(t / per + hashU(17, i, 3));
    const d = R * (0.35 + 0.65 * hashU(17, i, 4)) * (1 - ph) ** 2;
    const l = 8 + 46 * (1 - ph);
    ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    ctx.lineTo(x + Math.cos(a) * (d + l), y + Math.sin(a) * (d + l));
  }
  ctx.stroke();
  ctx.restore();
}

function strokeRing(ctx, css, cx, cy, R, ratio, rot, w, a, inner, outer) {
  if (R <= 1 || a <= 0.005) return;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(1, ratio);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
  ctx.lineWidth = w * 4; ctx.strokeStyle = css(outer, 0.16 * a); ctx.stroke();
  ctx.lineWidth = w * 1.8; ctx.strokeStyle = css(outer, 0.42 * a); ctx.stroke();
  ctx.lineWidth = w * 0.6; ctx.strokeStyle = css(inner, 0.95 * a); ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- strike: comet

function drawComet(g, x0, y0, x1, y1, u, t, pal) {
  const { ctx } = g, css = g.color.css;
  const dx = x1 - x0, dy = y1 - y0, D = Math.hypot(dx, dy) || 1, ux = dx / D, uy = dy / D, px = -uy, py = ux;
  const hx = x0 + dx * u, hy = y0 + dy * u;
  const r = lerp(56, 22, u);
  const tl = Math.min(D * u + 80, 1300);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [w, cA, cB, aA] of [[r * 2.8, pal.rose, pal.rose, 0.55], [r * 1.5, pal.comet, pal.rose, 0.85], [r * 0.6, pal.cometCore, pal.comet, 1]]) {
    const gr = ctx.createLinearGradient(hx, hy, hx - ux * tl, hy - uy * tl);
    gr.addColorStop(0, css(cA, aA)); gr.addColorStop(0.35, css(cB, aA * 0.5)); gr.addColorStop(1, css(cB, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(hx + px * w, hy + py * w);
    ctx.lineTo(hx - ux * tl, hy - uy * tl);
    ctx.lineTo(hx - px * w, hy - py * w);
    ctx.arc(hx, hy, w, Math.atan2(-py, -px), Math.atan2(py, px), ux * py - uy * px > 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineCap = 'round';
  for (let k = 0; k < 2; k++) {                             // helical streaks wrapping the tail
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const d = (i / 40) * tl * 0.8;
      const wv = r * 1.6 * (1 - d / tl) * Math.sin(d / 36 - t * 40 + k * Math.PI);
      const xx = hx - ux * d + px * wv, yy = hy - uy * d + py * wv;
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.strokeStyle = css(k ? pal.cometCore : pal.comet, 0.7);
    ctx.stroke();
  }
  for (let k = 0; k < 7; k++) {                             // Mach rings left along the path
    const d = 140 + k * 150;
    if (d > D * u) break;
    const a = (1 - d / 1200) * 0.8;
    const rr = r * (1.3 + d / 120);
    strokeRing(ctx, css, hx - ux * d, hy - uy * d, rr, 0.38, Math.atan2(uy, ux) + Math.PI / 2, 3, a, pal.cometCore, pal.comet);
  }
  const gc = g.sprites.glow(pal.comet), gw = g.sprites.glow(pal.cometCore, 1);
  ctx.drawImage(gc, hx - r * 6, hy - r * 6, r * 12, r * 12);
  ctx.drawImage(gw, hx - r * 2.4, hy - r * 2.4, r * 4.8, r * 4.8);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(hx, hy, r * 0.75, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- impact frames

function drawImpactFrame(g, k, V, pal, t) {
  const { ctx } = g;
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(-100, -100, g.W + 200, g.H + 200);
  ctx.restore();
  const cam = { ...V.cam, z: [1.1, 1.16, 1.12, 1.2][k % 4], fx: 900, fy: 620 };
  const V2 = { ...V, cam };
  const K = { ...V.K, pose: POSE.contact, cape: { t: t * 0.3, wind: -0.8, length: 0.72, open: 0, skew: 0, stream: 1.15 } };
  const { L, j, box } = kaiserLayer(g, V2, K, pal, null, true);
  const [X, Y, Wd, Hd] = box;
  const [bx, by] = camPt(cam, 1, j.toeR[0] + 0.02 * j.U, j.toeR[1] - 0.01 * j.U);
  // radial impact lines and a jagged burst at the contact
  halftone(g, { cell: 20, angle: 0.4 + 0.3 * k, color: '#FFFFFF', amount: (x, y) => clamp((Math.hypot(x - bx, y - by) - 640) / 700) * 0.9 });
  speedLines(ctx, { cx: bx, cy: by, n: 170, inner: 140 + 50 * k, outer: 2600, color: '#FFFFFF', alpha: 1, seed: 11 + k, frame: k, hold: 1, width: 0.013 });
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  const spikes = 16, R0 = 110 + 120 * k;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU + k * 0.2;
    const rr = i % 2 ? R0 * 0.4 : R0 * (0.75 + 0.55 * hashU(23, k, i));
    ctx.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pal.gold;                               // the accent ring: gold, or blue on an inverted frame
  ctx.lineWidth = 18 - 3 * k;
  ctx.beginPath(); ctx.arc(bx, by, 190 + 260 * k, 0, TAU); ctx.stroke();
  ctx.restore();
  // Kaiser in ink: white contour round a black figure drawn with white lines (within his box)
  const R = g.layer('kzCrown-rim');
  const rc = R.ctx;
  rc.setTransform(1, 0, 0, 1, 0, 0);
  rc.drawImage(L.canvas, X, Y, Wd, Hd, X, Y, Wd, Hd);
  rc.globalCompositeOperation = 'source-in';
  rc.fillStyle = '#FFFFFF';
  rc.fillRect(X, Y, Wd, Hd);
  rc.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const o = 8 * g.scale;
  for (let i = 0; i < 8; i++) {
    const ox = Math.round(Math.cos((i / 8) * TAU) * o), oy = Math.round(Math.sin((i / 8) * TAU) * o);
    ctx.drawImage(R.canvas, X, Y, Wd, Hd, X + ox, Y + oy, Wd, Hd);
  }
  ctx.filter = 'grayscale(1) contrast(1.8)';
  ctx.drawImage(L.canvas, X, Y, Wd, Hd, X, Y, Wd, Hd);
  ctx.restore();
  // the head in negative, so that on the engine's inverted frames he has a light face with dark features
  const [hx, hy] = camPt(cam, 1, j.headC[0], j.headC[1]);
  ctx.save();
  ctx.beginPath(); ctx.arc(hx, hy, KAISER.headR * j.U * cam.z * 1.42, 0, TAU); ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'grayscale(1) contrast(1.8) invert(1)';
  ctx.drawImage(L.canvas, X, Y, Wd, Hd, X, Y, Wd, Hd);
  ctx.filter = 'none';
  ctx.restore();
  // the ball, squashed on the boot
  ctx.save();
  ctx.translate(bx, by);
  ctx.scale(1.3, 0.78);
  ctx.beginPath(); ctx.arc(0, 0, 0.065 * j.U * cam.z, 0, TAU);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.lineWidth = 7; ctx.strokeStyle = '#000000'; ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- the boom: dome, pillar, ground rings

function groundRing(g, V, R, a, w, colIn, colOut) {
  if (a <= 0.005 || R <= 1) return;
  const { ctx } = g, css = g.color.css;
  const pts = [];
  for (let i = 0; i <= 96; i++) {
    const ph = (i / 96) * TAU;
    pts.push(stPt(V, R * Math.cos(ph), 0, R * Math.sin(ph)));
  }
  ctx.beginPath(); poly(ctx, pts);
  ctx.lineWidth = w * 2.6; ctx.strokeStyle = css(colOut, 0.22 * a); ctx.stroke();
  ctx.lineWidth = w * 1.2; ctx.strokeStyle = css(colOut, 0.45 * a); ctx.stroke();
  ctx.lineWidth = w * 0.5; ctx.strokeStyle = css(colIn, 0.95 * a); ctx.stroke();
}

/** The dome's size (metres): it erupts past its size, then settles and breathes with the kicks. */
function domeR(t, T, kick) {
  const age = t - T.boom + 1 / T.fps;
  if (age < 0) return 0;
  const grow = outExpo(age / 0.42), settle = smooth((age - 0.4) / 1.4);
  return (255 * grow * (1 - settle) + 212 * settle) * (1 + 0.04 * kick);
}

function drawDome(g, V, pal, t, T, F, P) {
  const age = t - T.boom;
  if (age < 0) return;
  const { ctx } = g, css = g.color.css;
  const kick = clamp(F.c.kick || 0);
  const Rm = domeR(t, T, kick);
  const hot = dec(t, T.boom, 0.4);
  const a = clamp(0.6 + 0.4 * hot + 0.25 * kick);
  ctx.save();
  applyCam(ctx, V.cam, PAR.stadium);
  ctx.globalCompositeOperation = 'lighter';
  const [cx, cy] = stPt(V, 0, 0, 0);
  const apex = stPt(V, 0, Rm, 0);
  const ax = stPt(V, Rm, 0, 0)[0] - cx;
  // the light it throws on the city
  const gl = g.sprites.glow(pal.comet);
  ctx.globalAlpha = clamp(0.4 * a + 0.4 * hot);
  ctx.drawImage(gl, cx - ax * 1.9, cy - ax * 1.05, ax * 3.8, ax * 1.9);
  ctx.globalAlpha = 1;
  if (ax > 2) {
    // silhouette: the limb (great circle facing the camera) over the top, the near half of the base below
    const sil = [];
    for (let i = 0; i <= 28; i++) { const th = (i / 28) * Math.PI; sil.push(stPt(V, Rm * Math.cos(th), Rm * Math.sin(th) * ST_CA, Rm * Math.sin(th) * ST_SA)); }
    for (let i = 1; i < 28; i++) { const ph = Math.PI - (i / 28) * Math.PI; sil.push(stPt(V, Rm * Math.cos(ph), 0, -Rm * Math.sin(ph))); }
    const near = stPt(V, 0, 0, -Rm)[1];
    const top = Math.min(...sil.map((p) => p[1]));
    ctx.beginPath(); poly(ctx, sil);
    const gr = ctx.createLinearGradient(0, near, 0, top);
    gr.addColorStop(0, css(pal.cometCore, 0.85 * a));
    gr.addColorStop(0.3, css(pal.comet, 0.6 * a));
    gr.addColorStop(0.75, css(pal.rose, 0.35 * a));
    gr.addColorStop(1, css(pal.comet, 0.3 * a));
    ctx.fillStyle = gr;
    ctx.fill();
    const rim = ctx.createRadialGradient(apex[0], (apex[1] + cy) / 2, 0, apex[0], (apex[1] + cy) / 2, Math.max(ax, cy - apex[1]) * 1.05);
    rim.addColorStop(0, css(pal.comet, 0)); rim.addColorStop(0.7, css(pal.comet, 0.05 * a)); rim.addColorStop(1, css(pal.ice || pal.comet, 0.55 * a));
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.lineWidth = 3.5; ctx.strokeStyle = css(pal.cometCore, 0.75 * a); ctx.stroke();
    ctx.lineWidth = 14; ctx.strokeStyle = css(pal.comet, 0.18 * a); ctx.stroke();
    // meridians and latitudes, turning slowly, brighter on the near side
    ctx.lineWidth = 2;
    for (let k = 0; k < 10; k++) {
      const ph = (k / 10) * TAU + t * 0.35;
      const nearA = 0.5 - 0.5 * Math.sin(ph);
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        const e = (i / 10) * (Math.PI / 2);
        const [px, py] = stPt(V, Rm * Math.cos(e) * Math.cos(ph), Rm * Math.sin(e), Rm * Math.cos(e) * Math.sin(ph));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = css(pal.stadiumLight, (0.06 + 0.22 * nearA) * a);
      ctx.stroke();
    }
    for (const e of [0.42, 0.85]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) { const ph = (i / 40) * TAU; pts.push(stPt(V, Rm * Math.cos(e) * Math.cos(ph), Rm * Math.sin(e), Rm * Math.cos(e) * Math.sin(ph))); }
      ctx.beginPath(); poly(ctx, pts);
      ctx.strokeStyle = css(pal.stadiumLight, 0.16 * a); ctx.stroke();
    }
    // the base: a ring of fire where the light meets the ground
    groundRing(g, V, Rm, a, 10, pal.cometCore, pal.comet);
    const sg = g.sprites.glow(pal.cometCore, 1);
    ctx.globalAlpha = clamp(0.5 + 0.5 * hot + 0.3 * kick);
    ctx.drawImage(sg, apex[0] - 90, apex[1] - 90, 180, 180);
    ctx.globalAlpha = 1;
  }
  // the pillar of light from the impact
  const pa = dec(t, T.boom, 0.6);
  if (pa > 0.01) {
    const pw = lerp(240, 50, clamp(age / 1.2));
    const pg = ctx.createLinearGradient(cx - pw, 0, cx + pw, 0);
    pg.addColorStop(0, css(pal.comet, 0)); pg.addColorStop(0.5, css(pal.cometCore, 0.8 * pa)); pg.addColorStop(1, css(pal.comet, 0));
    ctx.fillStyle = pg;
    ctx.fillRect(cx - pw, -1200, 2 * pw, apex[1] + 1200);
  }
  // shockwave rings rolling across the stands and the city
  for (let k = 0; k < 3; k++) {
    const ra = t - (T.boom + k * 0.13);
    if (ra < 0 || ra > 1.6) continue;
    groundRing(g, V, 40 + 520 * outCubic(ra / 1.5), (1 - ra / 1.6) ** 1.4, 10 - 2 * k, pal.cometCore, pal.comet);
  }
  // shockwave pulses on strong kicks
  const pulses = hits(F, 'kick', Math.max(T.boom + 0.3, t - 0.8), t + 1e-6, num(P.ringMin) ?? 0.6, T.fps).slice(-2);
  for (const [t0, s] of pulses) {
    const ra = t - t0;
    groundRing(g, V, Rm + 200 * outCubic(ra / 0.8), Math.min(1, s) * (1 - ra / 0.8) ** 1.3, 8, pal.stadiumLight, pal.comet);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- petals, confetti, roses

/** Snare scatter: a quick push that relaxes, and a cumulative spin. */
function scatterAt(F, t, a, fps) {
  let v = 0, spin = 0;
  for (const [ts, s] of hits(F, 'snare', a, t + 1e-6, 0.3, fps)) {
    const x = t - ts;
    spin += s * (1 - Math.exp(-x / 0.08));
    if (x < 1.5) v += s * (1 - Math.exp(-x / 0.05)) * Math.exp(-x / 0.4);
  }
  return [v, spin];
}

function drawPetals(g, V, pal, t, T, F, P, layer) {
  const age0 = t - T.boom;
  if (age0 < 0) return;
  const { ctx } = g;
  const [sc, spin] = scatterAt(F, t, T.boom, T.fps);
  const sprites = [petalSprite(g, pal, 0), petalSprite(g, pal, 1), petalSprite(g, pal, 2)];
  const rose = roseSprite(g, pal);
  const nBurst = Math.round(num(P.petals) ?? 230), rate = num(P.petalRate) ?? 30, nRose = Math.max(0, Math.round(num(P.roses) ?? 9));
  const nCont = Math.floor(age0 * rate);
  const [ox, oy] = stPt(V, 0, 140, 0);
  const roseEvery = nRose > 0 ? Math.max(3, Math.floor(nBurst / nRose)) : Infinity;
  const par = layer === 'front' ? PAR.front : 0.8, zl = camZ(V.cam, par), ds = g.scale;
  ctx.save();
  for (let i = 0; i < nBurst + nCont; i++) {
    const burst = i < nBurst;
    const born = burst ? T.boom + 0.25 * hashU(41, i, 0) : T.boom + (i - nBurst + hashU(41, i, 0)) / rate;
    const age = t - born;
    if (age < 0) continue;
    const life = 4.2 + 1.5 * hashU(41, i, 1);
    if (age > life) continue;
    const depth = 0.45 + 1.35 * hashU(41, i, 2);
    const front = depth > 1.38;
    if ((layer === 'front') !== front) continue;
    const ang = -Math.PI / 2 + (hashU(41, i, 3) - 0.5) * (burst ? 2.7 : 3.3);
    const sp = (burst ? 1300 : 720) * (0.45 + 0.75 * hashU(41, i, 4)) * depth;
    const dv = (1 - Math.exp(-1.6 * age)) / 1.6;
    let x = ox + (hashU(41, i, 5) - 0.5) * 300 + Math.cos(ang) * sp * dv + Math.sin(age * 2.1 + i) * 26 * depth;
    let y = oy - 40 + Math.sin(ang) * sp * dv + 35 * depth * age * age;
    const vx = x - 960, vy = y - 430, vl = Math.hypot(vx, vy) || 1;   // snare scatter, away from Kaiser
    x += (vx / vl) * sc * 95 * depth; y += (vy / vl) * sc * 95 * depth;
    const [X, Y] = camPt(V.cam, par, x, y);
    if (X < -80 || X > g.W + 80 || Y < -80 || Y > g.H + 80) continue;
    const fade = clamp(age / 0.15) * clamp((life - age) / 0.6);
    const isRose = burst && i % roseEvery === 0;
    const sz = (isRose ? 24 : 15) * depth;
    const rot = hashU(41, i, 6) * TAU + age * (1.5 + 2 * hashU(41, i, 7)) + spin * 1.3;
    const flip = isRose ? 1 : Math.max(0.12, Math.abs(Math.cos(age * (2 + 3 * hashU(41, i, 8)) + spin * 2.2 + i)));
    const k = zl * ds, cr = Math.cos(rot) * k, sr = Math.sin(rot) * k;
    ctx.setTransform(cr * flip, sr * flip, -sr, cr, X * ds, Y * ds);
    ctx.globalAlpha = fade * (front ? 0.95 : 0.55 + 0.4 * clamp(depth));
    ctx.drawImage(isRose ? rose : sprites[i % 3], -sz, -sz, 2 * sz, 2 * sz);
  }
  ctx.restore();
}

function drawConfetti(g, V, pal, t, T, F, P) {
  const age0 = t - T.boom;
  if (age0 < 0) return;
  const { ctx } = g, T2 = tones(g, pal);
  const nBurst = Math.round(num(P.confetti) ?? 200), rate = num(P.confettiRate) ?? 28;
  const nCont = Math.floor(age0 * rate);
  const [, spin] = scatterAt(F, t, T.boom, T.fps);
  const cols = [pal.gold, T2.warm, pal.goldDeep, pal.gold];
  const [ox, oy] = stPt(V, 0, 140, 0);
  const zl = camZ(V.cam, 0.9), ds = g.scale;
  ctx.save();
  for (let i = 0; i < nBurst + nCont; i++) {
    const burst = i < nBurst;
    const born = burst ? T.boom + 0.2 * hashU(43, i, 0) : T.boom + (i - nBurst + hashU(43, i, 0)) / rate;
    const age = t - born;
    if (age < 0 || age > 4.5) continue;
    const depth = 0.5 + 1.1 * hashU(43, i, 2);
    const ang = -Math.PI / 2 + (hashU(43, i, 3) - 0.5) * (burst ? 2.9 : 3.4);
    const sp = (burst ? 1400 : 760) * (0.4 + 0.8 * hashU(43, i, 4)) * depth;
    const dv = (1 - Math.exp(-2 * age)) / 2;
    const x = ox + (hashU(43, i, 5) - 0.5) * 360 + Math.cos(ang) * sp * dv + Math.sin(age * 3 + i) * 18 * depth;
    const y = oy + Math.sin(ang) * sp * dv + 55 * depth * age * age;
    const [X, Y] = camPt(V.cam, 0.9, x, y);
    if (X < -40 || X > g.W + 40 || Y < -40 || Y > g.H + 40) continue;
    const flip = Math.cos(age * (5 + 6 * hashU(43, i, 8)) + spin * 3 + i);
    const w = 16 * depth, h = 8 * depth * Math.max(0.15, Math.abs(flip));
    const rot = hashU(43, i, 6) * TAU + age * 3;
    const k = zl * ds, cr = Math.cos(rot) * k, sr = Math.sin(rot) * k;
    ctx.setTransform(cr, sr, -sr, cr, X * ds, Y * ds);
    ctx.globalAlpha = clamp(age / 0.1) * clamp((4.5 - age) / 0.6);
    ctx.fillStyle = Math.abs(flip) > 0.88 ? T2.goldHi : cols[i % cols.length];
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- gold light, fireworks, flare

function drawGodRays(g, x, y, amt, t, pal, w) {
  if (amt <= 0.01) return;
  const { ctx } = g, css = g.color.css;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const off = (i - 4) / 4;
    const a0 = Math.PI / 2 + off * 0.4 + Math.sin(t * 0.8 + i * 1.7) * 0.04, spread = 0.035 + 0.04 * hashU(71, i, 1);
    const len = 1400;
    const gr = ctx.createLinearGradient(x, y, x + Math.cos(a0) * len, y + Math.sin(a0) * len);
    gr.addColorStop(0, css(pal.gold, 0.32 * amt * (0.6 + 0.4 * hashU(71, i, 2))));
    gr.addColorStop(1, css(pal.gold, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(x + off * w * 0.45 - 6, y);
    ctx.lineTo(x + off * w * 0.45 + 6, y);
    ctx.lineTo(x + Math.cos(a0 - spread) * len, y + Math.sin(a0 - spread) * len);
    ctx.lineTo(x + Math.cos(a0 + spread) * len, y + Math.sin(a0 + spread) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawGlitter(g, x, y, w, amt, t, pal) {
  if (amt <= 0.01) return;
  const { ctx } = g;
  const gl = g.sprites.glow(pal.gold, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 60; i++) {
    const per = 1.4 + hashU(73, i, 1);
    const ph = frac(t / per + hashU(73, i, 2));
    const px = x + (hashU(73, i, 3) - 0.5) * w * (0.6 + ph) + Math.sin(t * 2 + i) * 12;
    const py = y + ph * 800;
    const r = 3 + 5 * hashU(73, i, 4);
    ctx.globalAlpha = amt * (1 - ph) * (0.55 + 0.45 * Math.sin(t * 9 + i * 3));
    ctx.drawImage(gl, px - r, py - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

/**
 * Searchlights from the stadium's rim into the sky (the coronation): each re-aims on every downbeat
 * (eased), so the whole fan sweeps on the bar, and flares with the kicks.
 */
function drawSearchlights(g, V, pal, t, T, F) {
  const age = t - T.boom;
  if (age < 0.15) return;
  const { ctx } = g, css = g.color.css;
  const fade = smooth((age - 0.15) / 0.6);
  const kick = clamp(F.c.kick || 0);
  const downs = ((F.ev && F.ev.downbeats) || []).filter((d) => d >= T.boom - 1e-6);
  let k = 0, dk = T.boom;
  for (const d of downs) { const dl = landT(d, T.fps); if (dl <= t + 1e-9) { k++; dk = dl; } else break; }
  const ease = outCubic((t - dk) / 0.35);
  const gold = t >= T.chosen;
  const N = 8;
  ctx.save();
  applyCam(ctx, V.cam, PAR.stadium);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < N; i++) {
    const side = i % 2 ? 1 : -1;
    const phi = Math.PI * (0.62 + 0.76 * ((i >> 1) / (N / 2 - 1))) * (side > 0 ? 1 : -1) * 0.5 + (side > 0 ? 0 : Math.PI);
    const [ox, oy] = stPt(V, Math.cos(phi) * 125, H_ROOF, Math.sin(phi) * 100);
    const aim = (n) => -Math.PI / 2 + side * (0.18 + 0.5 * hashU(5151, n, i)) + 0.12 * Math.sin(n * 1.7 + i * 2.1);
    const a = lerp(aim(k - 1), aim(k), ease) + 0.03 * Math.sin(t * 1.3 + i);
    const len = 1500, w0 = 4, w1 = 64;
    const ex = ox + Math.cos(a) * len, ey = oy + Math.sin(a) * len;
    const px = -Math.sin(a), py = Math.cos(a);
    const col = gold && i % 2 === 0 ? pal.gold : pal.stadiumLight;
    const gr = ctx.createLinearGradient(ox, oy, ex, ey);
    gr.addColorStop(0, css(col, (0.16 + 0.18 * kick) * fade));
    gr.addColorStop(1, css(col, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(ox + px * w0, oy + py * w0);
    ctx.lineTo(ex + px * w1, ey + py * w1);
    ctx.lineTo(ex - px * w1, ey - py * w1);
    ctx.lineTo(ox - px * w0, oy - py * w0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Fireworks: a volley at numberT, then one per strong kick, each shell launched to burst on its beat. */
function drawFireworks(g, V, pal, t, T, F, P) {
  if (t < T.number - 0.5) return;
  const { ctx } = g, css = g.color.css, T2 = tones(g, pal);
  const bursts = [];
  const nV = Math.max(0, Math.round(num(P.volley) ?? 8));
  for (let i = 0; i < nV; i++) bursts.push([T.number + (i % 3) * 0.04, 1000 + i, 1.2, i]);
  let lastK = -Infinity;
  for (const [t0, s] of hits(F, 'kick', T.number + 0.3, t + 0.45, num(P.fireMin) ?? 0.72, T.fps)) {
    if (t0 - lastK < 0.3) continue;                           // one shell per beat at most
    lastK = t0;
    bursts.push([t0, Math.round(t0 * 1000), 0.8 + 0.3 * s, -1]);
  }
  ctx.save();
  applyCam(ctx, V.cam, 0.42);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const LIFE = 1.7;
  for (const [tb, id, big, vi] of bursts) {
    const age = t - tb;
    if (age < -0.42 || age > LIFE) continue;
    const H = (k) => hashU(3001, id, k);
    // around the stadium, clear of Kaiser in the middle: the volley alternates sides, kicks pick one
    const side = vi >= 0 ? (vi % 2 ? 1 : -1) : (H(9) < 0.5 ? -1 : 1);
    const k01 = vi >= 0 ? (vi >> 1) / Math.max(1, (nV - 1) >> 1) : H(1);
    const phi = Math.PI / 2 + side * (0.3 + 0.62 * k01) * Math.PI * 0.55;
    const [gx, gy] = stPt(V, Math.cos(phi) * 260, 0, Math.sin(phi) * 190);
    const scl = (0.75 + 0.5 * clamp((gy - V.st.y + 200) / 400)) * big;
    const bx = gx + side * 90 * H(4), by = gy - (330 + 300 * H(2)) * scl;
    const gold = vi >= 0 ? vi % 3 !== 1 : H(3) < 0.55;
    const col = gold ? pal.gold : pal.comet, colHi = gold ? T2.goldHi : T2.ice;
    if (age < 0) {                                            // the rising shell: a spark with a fading trail
      const at = (k) => { const u = clamp(1 + (age - k) / 0.42); return [gx + (bx - gx) * outCubic(u) + Math.sin(u * 9 + id) * 4 * scl, gy + (by - gy) * outCubic(u)]; };
      const [hx, hy2] = at(0);
      for (const [k0, k1, al] of [[0.16, 0.08, 0.2], [0.08, 0.03, 0.45], [0.03, 0, 0.85]]) {
        const [x0, y0] = at(k0), [x1, y1] = at(k1);
        ctx.strokeStyle = css(colHi, al);
        ctx.lineWidth = 2.6 * scl;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      const hr = 10 * scl;
      ctx.drawImage(g.sprites.glow(colHi, 1), hx - hr, hy2 - hr, 2 * hr, 2 * hr);
      continue;
    }
    const n = 46, R = (190 + 110 * H(5)) * scl;
    const fade = clamp(1 - age / LIFE) ** 1.2;
    const flash = dec(t, tb, 0.1);
    if (flash > 0.02) { ctx.globalAlpha = flash; const fw = g.sprites.glow(colHi, 1); ctx.drawImage(fw, bx - R, by - R, 2 * R, 2 * R); ctx.globalAlpha = 1; }
    // each spark: a point of a 3D shell, slowing by drag and sagging under gravity
    const P0 = (i, aa) => {
      const ang = hashU(3002, id, i) * TAU, zc = hashU(3004, id, i) * 2 - 1;
      const sp = R * Math.sqrt(1 - zc * zc) * (0.85 + 0.15 * hashU(3005, id, i));
      const f = 1 - Math.exp(-Math.max(0, aa) / 0.3);
      return [bx + Math.cos(ang) * sp * f, by + Math.sin(ang) * sp * f + 85 * Math.max(0, aa) ** 2 * scl];
    };
    for (const [d0, d1, lw, al, cc] of [[0.3, 0.14, 1.6, 0.22, col], [0.14, 0.05, 2.2, 0.5, col], [0.05, 0, 2.8, 1, colHi]]) {
      ctx.strokeStyle = css(cc, al * fade);
      ctx.lineWidth = lw * scl;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const [x0, y0] = P0(i, age - d0), [x1, y1] = P0(i, age - d1);
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }
    const gl = g.sprites.glow(colHi, 1), hr = 9 * scl;
    for (let i = 0; i < n; i += 2) {
      const tw = age > 0.9 ? (hashU(3003, (F.frame || 0) + i * 7, id) < 0.5 ? 1 : 0.1) : 1;
      const [x1, y1] = P0(i, age);
      ctx.globalAlpha = fade * tw;
      ctx.drawImage(gl, x1 - hr, y1 - hr, 2 * hr, 2 * hr);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function starGlint(ctx, x, y, L, w, color, a) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = color;
  ctx.globalAlpha = clamp(a);
  for (const [ang, l] of [[0, L], [Math.PI / 2, L * 0.7], [Math.PI / 4, L * 0.28], [-Math.PI / 4, L * 0.28]]) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-l, 0); ctx.quadraticCurveTo(0, -w, l, 0); ctx.quadraticCurveTo(0, w, -l, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** An anamorphic lens streak: a thin horizontal bar of light, brightest at its centre. */
function flareStreak(g, x, y, L, h, color, a) {
  if (a <= 0.01 || L <= 1) return;
  const { ctx } = g, css = g.color.css;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gr = ctx.createLinearGradient(x - L, 0, x + L, 0);
  gr.addColorStop(0, css(color, 0)); gr.addColorStop(0.5, css(color, clamp(a))); gr.addColorStop(1, css(color, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(x - L, y - h / 2, 2 * L, h);
  ctx.fillRect(x - L * 0.5, y - h * 0.18, L, h * 0.36);
  ctx.restore();
}

// ---------------------------------------------------------------- the crown's descent

/** The falling crown, in screen space: giant as it slides in from the sky, condensing onto his head. */
function fallingCrown(V, Tm, t, jRef) {
  const f1 = 1 / Tm.fps;
  const u = clamp((t - Tm.chosen + f1) / Math.max(0.2, Tm.crownLand - Tm.chosen + f1));
  const seat = crownSeat(jRef);
  const [sx, sy] = camPt(V.cam, 1, seat.x, seat.y);
  const sw = seat.w * V.cam.z;
  const e = smooth(u);
  const w = lerp(900, sw, e ** 0.6);
  const slide = 1 - outCubic((t - Tm.chosen + f1) / 0.22);
  const y = lerp(300, sy, e) - 700 * slide;
  return { x: lerp(sx + 30, sx, e), y, w, ang: seat.ang * e + Math.sin(t * 3.1) * 0.06 * (1 - e), u, e };
}

// ---------------------------------------------------------------- draw

export function draw(g, t, F, P, S) {
  const { ctx, W, H } = g;
  const pal = palette(S);
  const Tm = moments(F, P, S);
  const V = makeView(t, Tm);
  const css = g.color.css, T2 = tones(g, pal);
  const kick = clamp(F.c.kick || 0), snare = clamp(F.c.snare || 0);
  const frame = F.frame || Math.round(t * Tm.fps);
  const f1 = 1 / Tm.fps;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (V.shot === 'I') {
    drawImpactFrame(g, Math.round((t - Tm.strike) * Tm.fps), V, pal, t);
    return;
  }

  // ---------- the world far below
  drawBackdrop(g, V, pal, t, F);
  drawClouds(g, V, pal, t, 'far');
  const boost = V.shot === 'D' ? dec(t, Tm.boom, 0.7) : V.shot === 'C' ? inQuad((t - Tm.strike) / (Tm.boom - Tm.strike)) * 0.8 : 0;
  drawStadium(g, V, pal, t, F, P, boost);
  if (V.shot === 'C') {                                        // the target lights up as the comet comes in
    const u = clamp((t - Tm.strike) / Math.max(1e-3, Tm.boom - Tm.strike));
    ctx.save();
    applyCam(ctx, V.cam, PAR.stadium);
    ctx.globalCompositeOperation = 'lighter';
    const [cx, cy] = stPt(V, 0, 0, 0);
    const r = (60 + 380 * u ** 3) * V.st.s * 2;
    ctx.globalAlpha = clamp(0.2 + 0.8 * u * u);
    ctx.drawImage(g.sprites.glow(pal.comet, 1), cx - r, cy - r * 0.6, 2 * r, 1.2 * r);
    ctx.restore();
    ctx.save();
    applyCam(ctx, V.cam, PAR.stadium);
    ctx.globalCompositeOperation = 'lighter';
    groundRing(g, V, 20 + 70 * u, 0.3 + 0.7 * u, 6, pal.cometCore, pal.comet);
    ctx.restore();
  }
  if (V.shot === 'D') {
    drawSearchlights(g, V, pal, t, Tm, F);
    const bf = dec(t, Tm.boom, 0.45);
    if (bf > 0.02) { const [fx, fy] = camPt(V.cam, PAR.stadium, ...stPt(V, 0, 30, 0)); flareStreak(g, fx, fy, 1500, 16, T2.ice, 0.9 * bf); }
    drawDome(g, V, pal, t, Tm, F, P);
    drawFireworks(g, V, pal, t, Tm, F, P);
  }
  if (V.shot !== 'D') drawClouds(g, V, pal, t, 'near');
  if (V.shot === 'A') drawRiseBank(g, V, pal, t, Tm);

  if (V.shot === 'B') {                                        // time slows: the world dims and drains
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgba(128,128,128,0.65)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css(pal.sky, 0.5);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  const K = V.K;
  // ---------- pose, cape and the moment's lighting
  let pose, cape, light;
  if (V.shot === 'A') {
    const open = t >= Tm.emperor ? clamp(outBack(clamp((t - Tm.emperor + f1) / 0.2), 2.4), 0, 1.25) : 0;
    const toEmp = smooth((t - Tm.emperor + 0.04) / 0.22);
    const toPow = smooth((t - Tm.power) / 0.4);
    pose = blend(blend(blend(POSE.rise, POSE.hover, smooth((t - Tm.t0) / 0.6)), POSE.emperor, toEmp), POSE.power, toPow * 0.7);
    const gust = dec(t, Tm.emperor, 0.35);
    cape = { t, wind: 0.35 * Math.sin(t * 1.7) + 0.2 * Math.sin(t * 3.1) + 0.5 * gust * Math.sin(t * 19), length: 0.64 + 0.06 * open, open, skew: 0.1 * Math.sin(t * 1.3), stream: 0 };
    light = { aura: 0.32 + 0.22 * kick + 0.35 * toPow, auraColor: pal.rose, rim: 0.7, rimColor: pal.comet, rimDx: 0, rimDy: -6 };
  } else if (V.shot === 'B') {
    const u = clamp((t - Tm.name) / Math.max(1e-3, Tm.strike - Tm.name));
    pose = blend(POSE.sideHover, POSE.windup, outCubic(u * 1.25));
    const slow = Tm.name + (t - Tm.name) * 0.2;
    cape = { t: slow, wind: -0.6, length: 0.7, open: 0, skew: 0, stream: 0.95 + 0.05 * Math.sin(slow * 4) };
    light = { aura: 0.6, auraColor: pal.comet, rim: 0.95, rimColor: T2.ice, rimDx: -7, rimDy: 0 };
  } else if (V.shot === 'C') {
    const u = (t - Tm.impEnd) / 0.8;
    pose = blend(POSE.follow, POSE.sideHover, smooth(u) * 0.45);
    cape = { t: t * 1.5, wind: -0.9, length: 0.72, open: 0, skew: 0, stream: 1.3 + 0.08 * Math.sin(t * 9) };
    light = { aura: 0.6, auraColor: pal.comet, rim: 0.85, rimColor: T2.ice, rimDx: -6, rimDy: -4 };
  } else {
    const toNum = smooth((t - Tm.number + 0.06) / 0.2);
    pose = blend(blend(POSE.emperor, POSE.crowned, smooth((t - Tm.boom - 0.2) / 0.8)), POSE.number, toNum);
    const landed = t >= Tm.crownLand;
    cape = { t, wind: 0.3 * Math.sin(t * 1.5) + 0.15 * Math.sin(t * 2.7), length: 0.72, open: 1, skew: 0.1 * Math.sin(t * 1.1), stream: 0 };
    light = { aura: 0, rim: 0.85, rimColor: landed ? T2.goldHi : T2.ice, rimDx: 0, rimDy: landed ? 6 : -6, glow: 0.5 + 0.35 * kick + 0.5 * dec(t, Tm.boom, 0.5), glowColor: landed ? T2.crownAura : pal.comet };
  }
  const Kp = { ...K, pose, cape };
  const jRef = solve(KAISER, pose, { x: K.x, y: K.y, scale: K.U / KAISER.height, view: K.view, facing: K.facing });

  // ---------- light behind him
  if (V.shot === 'A') {
    const amt = t >= Tm.emperor ? 0.75 + 1.2 * dec(t, Tm.emperor, 0.25) : 0;
    const len = 1800 * outExpo((t - Tm.emperor + f1) / 0.3);
    const [cx, cy] = camPt(V.cam, 1, jRef.neck[0], jRef.neck[1] + 0.04 * jRef.U);
    drawRaysBehind(g, cx, cy, pal.gold, amt, t, len, kick, 0.05 * F.integral('snare', Tm.emperor, t));
    const ra = t - Tm.emperor + f1;
    if (t >= Tm.emperor && ra < 0.5) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      strokeRing(ctx, css, cx, cy, 60 + 1300 * outCubic(ra / 0.5), 1, 0, 12 * (1 - ra / 0.5) + 2, 1 - ra / 0.5, pal.cometCore, pal.gold);
      ctx.restore();
    }
  } else if (V.shot === 'B') {
    const ball = solve(KAISER, POSE.contact, { x: K.x, y: K.y, scale: K.U / KAISER.height, view: 'side', facing: 1 });
    const [bx, by] = camPt(V.cam, 1, ball.toeR[0] + 0.02 * K.U, ball.toeR[1] - 0.01 * K.U);
    ctx.save();
    ctx.globalAlpha = 0.16;
    halftone(g, { cell: 22, angle: 0.5, color: T2.ice, amount: (x, y) => clamp((Math.hypot(x - bx, y - by) - 520) / 900) * 0.85 });
    ctx.restore();
    streakLines(ctx, { angle: 0, n: 46, color: T2.ice, alpha: 0.2, seed: 9, t: Tm.name + (t - Tm.name) * 0.15, speed: -2400 });
    speedLines(ctx, { cx: bx, cy: by, n: 110, inner: 320, outer: 2400, color: '#FFFFFF', alpha: 0.12, seed: 21, frame, hold: 4, width: 0.009 });
  } else if (V.shot === 'C') {
    // the giant shockwave across the sky, and the comet diving onto the stadium
    const jc = solve(KAISER, POSE.contact, { x: K.x, y: K.y, scale: K.U / KAISER.height, view: 'side', facing: 1 });
    const [kx, ky] = camPt(V.cam, 1, jc.toeR[0], jc.toeR[1]);
    const [sx, sy] = camPt(V.cam, PAR.stadium, V.st.x, V.st.y);
    const ang = Math.atan2(sy - ky, sx - kx);
    const age = t - Tm.strike;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fl = g.sprites.glow(pal.comet);
    ctx.globalAlpha = clamp(dec(t, Tm.strike, 0.25));
    ctx.drawImage(fl, kx - 500, ky - 500, 1000, 1000);
    ctx.globalAlpha = 1;
    for (const [d, w0] of [[0, 34], [0.08, 18], [0.17, 10]]) {
      const ra = age - d;
      if (ra < 0) continue;
      const R = 60 + 2300 * outCubic(ra / 0.5);
      strokeRing(ctx, css, kx, ky, R, 0.3, 0.16, w0 * (1 - 0.6 * clamp(ra / 0.5)), clamp(1 - ra / 0.55), pal.cometCore, pal.comet);
    }
    if (age < 0.3) strokeRing(ctx, css, kx, ky, 40 + 380 * outCubic(age / 0.3), 0.42, ang + Math.PI / 2, 14, 1 - age / 0.3, pal.cometCore, pal.comet);
    ctx.restore();
    const u = clamp((t - Tm.strike) / Math.max(1e-3, Tm.boom - Tm.strike)) ** 1.5;
    streakLines(ctx, { angle: ang, n: 50, color: T2.ice, alpha: 0.26, seed: 13, t, speed: 5200 });
    drawComet(g, kx, ky, sx, sy, u, t, pal);
    flareStreak(g, kx + (sx - kx) * u, ky + (sy - ky) * u, 520 - 200 * u, 7, T2.ice, 0.7);
  } else {
    const [cx, cy] = camPt(V.cam, 1, jRef.neck[0], jRef.neck[1]);
    const gold = t >= Tm.chosen;
    const amt = 0.45 + 0.25 * kick + 0.7 * dec(t, Tm.boom, 0.5) + (t >= Tm.crownLand ? 0.5 * dec(t, Tm.crownLand, 0.5) : 0);
    drawRaysBehind(g, cx, cy, gold ? pal.gold : pal.comet, amt, t, 1800, kick, 0.05 * F.integral('snare', Tm.boom, t));
    const fl = dec(t, Tm.loud, 0.25);
    if (fl > 0.01) {                                          // the white-gold bloom, behind him
      const [hx, hy] = camPt(V.cam, 1, jRef.headC[0], jRef.headC[1]);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.5 * fl);
      ctx.drawImage(g.sprites.glow(T2.warm), hx - 700, hy - 700, 1400, 1400);
      ctx.restore();
    }
    // gold light pouring down from the crown (behind him, so his face stays clear)
    if (t >= Tm.chosen) {
      const fin = clamp((t - Tm.chosen + f1) / 0.12);
      if (t < Tm.crownLand) {
        const C = fallingCrown(V, Tm, t, jRef);
        drawGodRays(g, C.x, C.y, 0.85 * fin, t, pal, C.w);
        drawGlitter(g, C.x, C.y, C.w, 0.8 * fin, t, pal);
      } else {
        const s = crownSeat(jRef);
        const [hx, hy] = camPt(V.cam, 1, s.x, s.y);
        drawGodRays(g, hx, hy - 240, 0.3 + 0.5 * dec(t, Tm.crownLand, 0.6) + 0.4 * fl, t, pal, 260);
        drawGlitter(g, hx, hy - 160, 460, 0.55, t, pal);
      }
    }
    drawPetals(g, V, pal, t, Tm, F, P, 'back');
  }

  // ---------- Kaiser (with his crown once it has landed)
  const landed = V.shot === 'D' && t >= Tm.crownLand;
  const crownExtra = landed ? (c, j) => {
    const s = crownSeat(j);
    c.save(); c.translate(s.x, s.y); c.rotate(s.ang);
    drawCrown(c, 0, 0, s.w, { fill: pal.gold, deep: pal.goldDeep, jewel: pal.rose });
    c.restore();
  } : null;
  if (landed) {                                               // a halo behind the head
    const s = crownSeat(jRef);
    const [hx, hy] = camPt(V.cam, 1, s.x, s.y - s.w * 0.45);
    const R = s.w * 2.6 * V.cam.z;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.3 + 0.4 * dec(t, Tm.crownLand, 0.4) + 0.15 * kick);
    ctx.drawImage(g.sprites.glow(pal.gold), hx - R, hy - R, 2 * R, 2 * R);
    ctx.restore();
  }
  if (light.glow > 0.01) {                                    // in the light: a soft glow behind him (cheaper than an aura)
    const gl = g.sprites.glow(light.glowColor);
    const [gx, gy] = camPt(V.cam, 1, jRef.neck[0], (jRef.neck[1] + jRef.pelvis[1]) / 2);
    const R = jRef.U * 0.75 * V.cam.z;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(0.55 * light.glow);
    ctx.drawImage(gl, gx - R, gy - R * 1.2, 2 * R, 2.4 * R);
    ctx.restore();
  }
  const { L, j, box } = kaiserLayer(g, V, Kp, pal, crownExtra);
  compositeKaiser(g, L, box, light);

  // ---------- in front of him
  const ballR = 0.06 * K.U;
  if (V.shot === 'A') {
    const bx0 = jRef.pelvis[0] + 0.21 * jRef.U, by0 = jRef.pelvis[1] + 0.13 * jRef.U + Math.sin(t * 2.6) * 0.012 * jRef.U;
    const [bx, by] = camPt(V.cam, 1, bx0, by0);
    const z = V.cam.z;
    const charge = smooth((t - Tm.power) / Math.max(0.3, Tm.name - Tm.power));
    const flash = t >= Tm.power ? drawConverge(g, bx, by, t, Tm, F, P, pal, z) : 0;
    drawInflow(g, bx, by, charge, t, pal);
    drawBallEnergy(g, bx, by, ballR * z, charge, flash + 0.3 * kick * charge, F, pal, { rot: t * 1.3, arcsN: charge > 0.1 ? Math.round(2 + 4 * charge + 4 * snare) : 0 });
  } else if (V.shot === 'B') {
    const ball = solve(KAISER, POSE.contact, { x: K.x, y: K.y, scale: K.U / KAISER.height, view: 'side', facing: 1 });
    const [bx, by] = camPt(V.cam, 1, ball.toeR[0] + 0.02 * K.U, ball.toeR[1] - 0.01 * K.U);
    drawBallEnergy(g, bx, by, ballR * V.cam.z, 1, 0.3 + 0.4 * kick, F, pal, { rot: 0.4 + (t - Tm.name) * 0.5, arcsN: 7 + Math.round(4 * snare), hold: 4 });
  } else if (V.shot === 'D') {
    drawConfetti(g, V, pal, t, Tm, F, P);
    if (t >= Tm.chosen && !landed) {
      const C = fallingCrown(V, Tm, t, jRef);
      const fin = clamp((t - Tm.chosen + f1) / 0.12);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * fin;
      ctx.drawImage(g.sprites.glow(pal.gold), C.x - C.w * 0.95, C.y - C.w * 0.95, C.w * 1.9, C.w * 1.5);
      ctx.restore();
      ctx.save();
      ctx.translate(C.x, C.y); ctx.rotate(C.ang);
      drawCrown(ctx, 0, 0, C.w, { fill: pal.gold, deep: pal.goldDeep, jewel: pal.rose, alpha: fin, lineW: Math.max(3, C.w * 0.022) });
      ctx.restore();
    } else if (landed) {
      const s = crownSeat(j);
      const [hx, hy] = camPt(V.cam, 1, s.x, s.y);
      const la = t - Tm.crownLand;
      flareStreak(g, hx, hy - 0.25 * s.w * V.cam.z, 700, 8, T2.goldHi, 0.85 * dec(t, Tm.crownLand, 0.18));
      if (la < 0.6) {                                         // it lands: a gold ring and a flash on the beat
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        strokeRing(ctx, css, hx, hy - 0.25 * s.w * V.cam.z, 30 + 760 * outCubic(la / 0.6), 0.36, 0, 12 * (1 - la / 0.6) + 2, 1 - la / 0.6, '#FFFFFF', pal.gold);
        ctx.globalAlpha = clamp(0.8 * dec(t, Tm.crownLand, 0.08));
        ctx.drawImage(g.sprites.glow(T2.goldHi, 1), hx - 200, hy - 260, 400, 400);
        ctx.restore();
      }
      const fl = dec(t, Tm.loud, 0.3);
      const [gx, gy] = camPt(V.cam, 1, s.x + Math.sin(s.ang) * s.w * 0.7, s.y - Math.cos(s.ang) * s.w * 0.7);
      starGlint(ctx, gx, gy, 260 * (0.3 + 1.6 * fl) * V.cam.z, 6 + 6 * fl, '#FFFFFF', 0.2 + 0.8 * fl + 0.2 * kick);
      const lf = t - Tm.loud + f1;
      if (t >= Tm.loud && lf < 0.7) {                         // the crown flares: a ring and a spray of sparks
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        strokeRing(ctx, css, gx, gy, 20 + 900 * outCubic(lf / 0.7), 0.5, 0, 14 * (1 - lf / 0.7) + 2, 1 - lf / 0.7, '#FFFFFF', pal.gold);
        ctx.strokeStyle = css(T2.goldHi, 0.9 * (1 - lf / 0.7));
        ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * TAU + 0.2, d0 = 60 + 700 * outCubic(lf / 0.6) * (0.6 + 0.4 * hashU(77, i, 1)), d1 = d0 * 0.75;
          ctx.moveTo(gx + Math.cos(a) * d1, gy + Math.sin(a) * d1 * 0.8); ctx.lineTo(gx + Math.cos(a) * d0, gy + Math.sin(a) * d0 * 0.8);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    drawPetals(g, V, pal, t, Tm, F, P, 'front');
  }
}

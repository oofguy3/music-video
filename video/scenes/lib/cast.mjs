// The cast of "Kite Season", built on puppet.mjs so every scene draws the same characters.
//
//   import { KIT, JUNE, FRIENDS, crowdDesign } from './lib/cast.mjs';
//   drawPuppet(ctx, KIT.teen, cycles.walk(p), { x, ground, view: 'side', devScale: g.scale });
//
// Ages: child (A1), teen (B1, C1), adult (D1, E1). Heads are plain round faces with hair, dot eyes and
// rosy cheeks: no symbolic heads. Colours are fixed here so a character is recognisable everywhere.

import { design, KID } from './puppet.mjs';

const TAU = Math.PI * 2;
export const INK = '#1E1633';          // outline colour shared by the whole cast

const TEEN = { headR: 0.13, neck: 0.022, torso: 0.29, upperArm: 0.15, foreArm: 0.14, thigh: 0.2, shin: 0.19, foot: 0.058, torsoW: 0.16, legW: 0.066, armW: 0.052 };
const ADULT = { headR: 0.115, neck: 0.025, torso: 0.3, upperArm: 0.16, foreArm: 0.15, thigh: 0.22, shin: 0.21, foot: 0.06, torsoW: 0.16, legW: 0.064, armW: 0.05 };

function hairPath(ctx, r, style, side) {
  const sx = side ? -0.12 * r : 0;                     // in profile the hair sits towards the back
  ctx.beginPath();
  if (style === 'bob') {
    ctx.moveTo(sx - 1.08 * r, 0.45 * r);
    ctx.lineTo(sx - 1.08 * r, -0.1 * r);
    ctx.arc(sx, -0.1 * r, 1.08 * r, Math.PI, 2 * Math.PI);
    ctx.lineTo(sx + 1.08 * r, 0.45 * r);
    ctx.quadraticCurveTo(sx + 0.9 * r, 0.55 * r, sx + 0.75 * r, 0.3 * r);
    ctx.lineTo(sx + 0.7 * r, -0.2 * r);
    ctx.quadraticCurveTo(sx, -0.42 * r, sx - 0.7 * r, -0.2 * r);
    ctx.lineTo(sx - 0.75 * r, 0.3 * r);
    ctx.quadraticCurveTo(sx - 0.9 * r, 0.55 * r, sx - 1.08 * r, 0.45 * r);
  } else {
    ctx.arc(sx, -0.08 * r, 1.04 * r, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(sx + 0.55 * r, -0.5 * r, sx, -0.36 * r);
    ctx.quadraticCurveTo(sx - 0.55 * r, -0.5 * r, sx - 1.03 * r, -0.12 * r);
  }
  ctx.closePath();
  ctx.fill();
  if (style === 'puff') {
    ctx.beginPath();
    ctx.arc(sx - 0.1 * r, -1.12 * r, 0.42 * r, 0, TAU);
    ctx.fill();
  } else if (style === 'spike') {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * (1.15 + 0.22 * i);
      ctx.moveTo(sx + Math.cos(a) * 0.9 * r, -0.08 * r + Math.sin(a) * 0.9 * r);
      ctx.lineTo(sx + Math.cos(a + 0.12) * 1.45 * r, -0.08 * r + Math.sin(a + 0.12) * 1.45 * r);
      ctx.lineTo(sx + Math.cos(a + 0.22) * 0.9 * r, -0.08 * r + Math.sin(a + 0.22) * 0.9 * r);
    }
    ctx.fill();
  }
}

/** A round face with hair, dot eyes and rosy cheeks (a custom puppet head). */
export function kidHead({ skin = '#FFDCC2', hair = '#3A2A1E', style = 'cap', cheek = '#FF8FA3', eyes = INK, face = true } = {}) {
  return (ctx, r, info) => {
    const side = info.joints && info.joints.view === 'side';
    if (info.pass === 'outline') {                       // silhouette only, in the outline colour
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      hairPath(ctx, r, style, side);
      return;
    }
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = hair;
    hairPath(ctx, r, style, side);
    if (!face) return;
    const ex = side ? [r * 0.5] : [-r * 0.36, r * 0.36];
    ctx.fillStyle = cheek;
    ctx.globalAlpha *= 0.55;
    for (const x of ex) { ctx.beginPath(); ctx.arc(x + (side ? 0.08 * r : 0), r * 0.32, r * 0.17, 0, TAU); ctx.fill(); }
    ctx.globalAlpha /= 0.55;
    ctx.fillStyle = eyes;
    for (const x of ex) { ctx.beginPath(); ctx.arc(x, r * 0.06, r * 0.11, 0, TAU); ctx.fill(); }
  };
}

const person = (age, look) => design({
  ...(age === 'child' ? KID : age === 'teen' ? TEEN : ADULT),
  height: age === 'child' ? 170 : age === 'teen' ? 230 : 262,
  outline: INK, outlineW: 3, farShade: 0.78,
  ...look,
});

const kitLook = { fill: '#FFC83D', limbFill: '#2E3A7A', head: kidHead({ hair: '#3A2A1E', style: 'cap' }) };
/** Kit: the singer. Yellow raincoat, navy trousers, short dark hair. */
export const KIT = {
  child: person('child', { ...kitLook, id: 'kit-child' }),
  teen: person('teen', { ...kitLook, id: 'kit-teen' }),
  adult: person('adult', { ...kitLook, torsoShape: 'inv', fill: '#F2B33A', id: 'kit-adult' }),
};

const juneLook = { fill: '#FF6F61', limbFill: '#3B2A5A', torsoShape: 'tri', head: kidHead({ hair: '#6B2D3C', style: 'bob' }) };
/** June: the friend who becomes the first love. Coral dress, dark plum bob. */
export const JUNE = {
  child: person('child', { ...juneLook, id: 'june-child' }),
  teen: person('teen', { ...juneLook, id: 'june-teen' }),
  adult: person('adult', { ...juneLook, id: 'june-adult' }),
};

const FRIEND_LOOKS = [
  { fill: '#7FE3C4', limbFill: '#2B4A5A', head: kidHead({ hair: '#22313F', style: 'spike' }) },
  { fill: '#B79CFF', limbFill: '#3A2A5E', head: kidHead({ hair: '#C9A26B', style: 'puff' }) },
  { fill: '#7CC6FF', limbFill: '#26365E', head: kidHead({ hair: '#5A3A22', style: 'cap', skin: '#D9A27E' }) },
  { fill: '#FFB38A', limbFill: '#4A2E3A', head: kidHead({ hair: '#1B1B2A', style: 'bob', skin: '#B87A55' }) },
];
/** The four friends from the kite days: mint, lilac, sky and peach jackets. */
export const FRIENDS = FRIEND_LOOKS.map((look, i) => ({
  child: person('child', { ...look, id: `friend${i}-child` }),
  teen: person('teen', { ...look, id: `friend${i}-teen` }),
  adult: person('adult', { ...look, id: `friend${i}-adult` }),
}));

const crowdCache = new Map();
/** A faceless crowd figure in one flat colour (for stamped crowds); cached per colour and age. */
export function crowdDesign(color, age = 'adult', outline = null) {
  const k = `${color}|${age}|${outline}`;
  let d = crowdCache.get(k);
  if (!d) {
    d = person(age, { fill: color, limbFill: color, headFill: color, head: 'round', face: 'none', outline, outlineW: outline ? 2 : 0, id: `crowd-${k}` });
    crowdCache.set(k, d);
  }
  return d;
}

// Colour utilities. Palettes are authored as hex in the treatment; hue rotation for the key-change
// "lift" happens in OKLCH so lightness and chroma stay put while the hue turns.

const cssCache = new Map();

export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]) {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [lr, lg, lb].map((v) => toSrgb(Math.max(0, Math.min(1, v))));
}

export function rgbToOklch(rgb) {
  const [L, a, b] = rgbToOklab(rgb);
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI];
}

function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** OKLCH -> sRGB, keeping hue and lightness: chroma is reduced until the colour fits the gamut. */
export function oklchToRgb([L, C, h]) {
  const r = (h * Math.PI) / 180;
  const fits = (c) => oklabToLinear([L, c * Math.cos(r), c * Math.sin(r)]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let c = C;
  if (!fits(c)) {
    let lo = 0, hi = C;
    for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    c = lo;
  }
  return oklabToRgb([L, c * Math.cos(r), c * Math.sin(r)]);
}

/** Rotate a colour's hue by `deg` in OKLCH (keeps lightness and chroma). */
export function rotateHue(hex, deg) {
  if (!deg) return hex;
  const [L, C, h] = rgbToOklch(hexToRgb(hex));
  return rgbToHex(oklchToRgb([L, C, h + deg]));
}

/** Scale chroma (0 = grey) in OKLCH. */
export function saturate(hex, k) {
  const [L, C, h] = rgbToOklch(hexToRgb(hex));
  return rgbToHex(oklchToRgb([L, C * k, h]));
}

/** Mix two hex colours in OKLab (perceptually even), t in [0, 1]. */
export function mix(hexA, hexB, t) {
  if (t <= 0) return hexA;
  if (t >= 1) return hexB;
  const A = rgbToOklab(hexToRgb(hexA)), B = rgbToOklab(hexToRgb(hexB));
  return rgbToHex(oklabToRgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]));
}

/** CSS rgba() string, cached by quantised inputs. alpha in [0, 1]. */
export function css(hex, alpha = 1) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000;
  const key = hex + a;
  let s = cssCache.get(key);
  if (!s) {
    const [r, g, b] = hexToRgb(hex);
    s = `rgba(${r},${g},${b},${a})`;
    if (cssCache.size > 50000) cssCache.clear();
    cssCache.set(key, s);
  }
  return s;
}

/** Scale brightness of a hex colour (multiplies sRGB channels, clamps). */
export function scale(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * k, g * k, b * k]);
}

/**
 * Resolve a palette ({name: hex}) for a hue rotation in degrees. Cached per (palette object,
 * quantised rotation) so scenes can call it every frame.
 */
const palCache = new WeakMap();
export function rotatePalette(palette, deg) {
  const q = Math.round(deg * 4) / 4;
  let m = palCache.get(palette);
  if (!m) { m = new Map(); palCache.set(palette, m); }
  let out = m.get(q);
  if (!out) {
    out = {};
    for (const [k, v] of Object.entries(palette)) out[k] = typeof v === 'string' && v.startsWith('#') ? rotateHue(v, q) : v;
    m.set(q, out);
  }
  return out;
}

// One place that loads the native canvas (CommonJS) for ESM modules and worker threads.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const napi = require('@napi-rs/canvas');

export const { createCanvas, GlobalFonts, Path2D, ImageData } = napi;

let fontsReady = false;
/** Register the fonts the title card uses (system Inter if present). Safe to call repeatedly. */
export function ensureFonts() {
  if (fontsReady) return;
  fontsReady = true;
  const tryReg = (path, name) => { try { GlobalFonts.registerFromPath(path, name); } catch { /* optional */ } };
  tryReg('/usr/share/fonts/opentype/inter/Inter-Light.otf', 'Inter Light');
  tryReg('/usr/share/fonts/opentype/inter/Inter-Regular.otf', 'Inter');
  tryReg('/usr/share/fonts/opentype/inter/InterDisplay-Light.otf', 'Inter Display Light');
}

// Scene registry. Each scene module exports:
//   export const meta = { type, budgetMs }       // budgetMs: p95 target at 1080p, one thread
//   export const defaults = { ... }              // parameter defaults (treatment params override)
//   export function draw(g, t, F, P, S) { ... }  // PURE: same inputs -> same pixels
// See video/README.md for the full contract. Missing modules are skipped so the registry works
// while scenes are still being built.

const NAMES = ['debug', 'title', 'transitions', 'dusk', 'milksea', 'deep', 'goldlake', 'storm', 'lastkite',
  'kzRise', 'kzField', 'kzImpact', 'kzThrone', 'kzCity', 'kzPanels', 'kzRival', 'kzCrown', 'kzReign'];

let cached = null;

export async function loadScenes() {
  if (cached) return cached;
  const reg = {};
  for (const name of NAMES) {
    try {
      reg[name] = await import(`./${name}.mjs`);
    } catch (e) {
      if (e && e.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(`${name}.mjs`)) continue;
      throw e;
    }
  }
  cached = reg;
  return reg;
}

export const SCENE_NAMES = NAMES;

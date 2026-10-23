/** Stable unsigned 32-bit integer mixer. Arithmetic intentionally wraps at 32 bits. */
function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

/** Deterministic coordinate hash; not a cryptographic PRNG. */
export function hash01(x: number, y: number, seed: number): number {
  return mix(seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) / 0xffffffff;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Bilinearly interpolated value noise, in [0, 1]. */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = smooth(x - ix);
  const ty = smooth(y - iy);
  return lerp(
    lerp(hash01(ix, iy, seed), hash01(ix + 1, iy, seed), tx),
    lerp(hash01(ix, iy + 1, seed), hash01(ix + 1, iy + 1, seed), tx), ty,
  );
}

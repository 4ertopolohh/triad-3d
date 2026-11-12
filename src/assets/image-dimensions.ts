export type ImageFormat = "png" | "jpg" | "webp" | "hdr" | "exr";
export const IMAGE_LIMITS = Object.freeze({
  // Temporary RAM budget: one RGBA Float32 buffer and equal decoder scratch space.
  maxDimension: 16384,
  maxDecodedBytes: 128 * 1024 * 1024,
});
const at = (bytes: Uint8Array, i: number) => bytes[i] ?? 0;
const u32be = (b: Uint8Array, i: number) => ((at(b, i) * 0x1000000) + (at(b, i + 1) << 16) + (at(b, i + 2) << 8) + at(b, i + 3)) >>> 0;
const u32le = (b: Uint8Array, i: number) => (at(b, i) + (at(b, i + 1) << 8) + (at(b, i + 2) << 16) + at(b, i + 3) * 0x1000000) >>> 0;
const i32le = (b: Uint8Array, i: number) => new DataView(b.buffer, b.byteOffset + i, 4).getInt32(0, true);
const ascii = (b: Uint8Array, i: number, n: number) => new TextDecoder("ascii").decode(b.subarray(i, i + n));
export function imageDimensions(bytes: Uint8Array, format: ImageFormat): [number, number] | null {
  if (format === "png") {
    if (bytes.length < 33 || ascii(bytes, 1, 3) !== "PNG" || at(bytes, 0) !== 137 || at(bytes, 4) !== 13 || at(bytes, 5) !== 10 || at(bytes, 6) !== 26 || at(bytes, 7) !== 10 || u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
    return [u32be(bytes, 16), u32be(bytes, 20)];
  }
  if (format === "jpg") {
    if (at(bytes, 0) !== 0xff || at(bytes, 1) !== 0xd8) return null;
    for (let p = 2; p + 4 < bytes.length;) {
      if (at(bytes, p++) !== 0xff) return null;
      while (at(bytes, p) === 0xff) p++;
      const marker = at(bytes, p++);
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = at(bytes, p) * 256 + at(bytes, p + 1);
      if (length < 2 || p + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return length >= 7 ? [at(bytes, p + 5) * 256 + at(bytes, p + 6), at(bytes, p + 3) * 256 + at(bytes, p + 4)] : null;
      p += length;
    }
    return null;
  }
  if (format === "webp") {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" || u32le(bytes, 4) + 8 !== bytes.length) return null;
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X" && bytes.length >= 30) return [1 + at(bytes, 24) + (at(bytes, 25) << 8) + (at(bytes, 26) << 16), 1 + at(bytes, 27) + (at(bytes, 28) << 8) + (at(bytes, 29) << 16)];
    if (chunk === "VP8 " && bytes.length >= 30 && at(bytes, 23) === 0x9d && at(bytes, 24) === 0x01 && at(bytes, 25) === 0x2a)
      return [(at(bytes, 26) + (at(bytes, 27) << 8)) & 0x3fff, (at(bytes, 28) + (at(bytes, 29) << 8)) & 0x3fff];
    if (chunk === "VP8L" && bytes.length >= 25 && at(bytes, 20) === 0x2f)
      return [1 + at(bytes, 21) + ((at(bytes, 22) & 0x3f) << 8), 1 + (at(bytes, 22) >> 6) + (at(bytes, 23) << 2) + ((at(bytes, 24) & 15) << 10)];
    return null;
  }
  if (format === "hdr") {
    const header = ascii(bytes, 0, Math.min(bytes.length, 4096));
    if (!/^#\?(?:RADIANCE|RGBE)\r?\n/.test(header) || !/FORMAT=32-bit_rle_rgbe/.test(header)) return null;
    const match = header.match(/\r?\n\r?\n-Y (\d+) \+X (\d+)\r?\n/);
    return match ? [Number(match[2]), Number(match[1])] : null;
  }
  if (bytes.length < 16 || u32le(bytes, 0) !== 20000630 || (u32le(bytes, 4) & 0xff) !== 2 || (u32le(bytes, 4) & ~0xff) !== 0) return null;
  let window: [number, number] | null = null;
  let compression: number | null = null;
  for (let p = 8; p < Math.min(bytes.length, 65536);) {
    const endName = bytes.indexOf(0, p);
    if (endName < 0 || endName >= 65536) return null;
    if (endName === p) break;
    const name = ascii(bytes, p, endName - p);
    p = endName + 1;
    const endType = bytes.indexOf(0, p);
    if (endType < 0 || endType + 5 > bytes.length) return null;
    p = endType + 1;
    const length = u32le(bytes, p); p += 4;
    if (length > bytes.length - p) return null;
    if (name === "dataWindow" && length === 16) window = [i32le(bytes, p + 8) - i32le(bytes, p) + 1, i32le(bytes, p + 12) - i32le(bytes, p + 4) + 1];
    if (name === "compression" && length === 1) compression = at(bytes, p);
    p += length;
  }
  // Restrict to lossless encodings supported by the installed loader.
  return window && compression !== null && [0, 1, 2, 3, 4].includes(compression) ? window : null;
}
export function withinImageBudget(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    && width <= IMAGE_LIMITS.maxDimension && height <= IMAGE_LIMITS.maxDimension
    && width * height * 32 <= IMAGE_LIMITS.maxDecodedBytes;
}

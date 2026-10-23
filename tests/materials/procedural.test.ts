import { describe, expect, it } from "vitest";
import { generateProceduralMap } from "../../src/materials/procedural";
import type { ProceduralMapRequest, ProceduralPatternKind } from "../../src/materials/procedural";

const request = (kind: ProceduralPatternKind, overrides: Partial<ProceduralMapRequest> = {}): ProceduralMapRequest => ({
  kind, width: 48, height: 40, seed: 0x12345678, scale: 5, intensity: 0.8,
  ...(kind === "scratches" ? { directionRadians: 0.4 } : {}), ...overrides,
});

function pixels(input: unknown): Uint8Array {
  const result = generateProceduralMap(input);
  if (!result.ok) throw new Error(`${result.error.field}: ${result.error.message}`);
  return result.value.pixels;
}

function checksum(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

describe("procedural scalar maps", () => {
  const kinds: ProceduralPatternKind[] = ["grain", "scratches", "stone"];

  for (const kind of kinds) {
    it(`${kind}: deterministic, seeded, scaled, bounded and independent`, () => {
      const base = request(kind);
      const first = pixels(base);
      expect(first).toEqual(pixels(base));
      expect(first).not.toEqual(pixels(request(kind, { seed: base.seed + 1 })));
      expect(first).not.toEqual(pixels(request(kind, { scale: 12 })));
      expect(first.length).toBe(base.width * base.height);
      expect(new Set(first).size).toBeGreaterThan(8);
      expect([...first].every(value => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true);
      const saved = first.slice();
      pixels(request(kind, { seed: 1 }));
      expect(first).toEqual(saved);
      expect(pixels(base)).toEqual(saved);
    });

    it(`${kind}: zero intensity is a neutral scalar map`, () => {
      expect([...pixels(request(kind, { intensity: 0 }))].every(value => value === 128)).toBe(true);
    });
  }

  it("patterns are distinct and channels are assigned", () => {
    for (const kind of kinds) {
      const result = generateProceduralMap(request(kind));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.channel).toBe(kind === "stone" ? "height" : "roughness");
    }
    expect(pixels(request("grain"))).not.toEqual(pixels(request("stone")));
    expect(pixels(request("scratches"))).not.toEqual(pixels(request("stone")));
    expect(pixels(request("grain"))).not.toEqual(pixels(request("scratches")));
  });

  it("scratch direction changes the map", () => {
    const horizontal = pixels(request("scratches", { directionRadians: 0 }));
    const vertical = pixels(request("scratches", { directionRadians: Math.PI / 2 }));
    expect(horizontal).not.toEqual(vertical);
    const gradients = (map: Uint8Array): [number, number] => {
      let dx = 0; let dy = 0;
      for (let y = 1; y < 40; y++) for (let x = 1; x < 48; x++) {
        dx += Math.abs(map[y * 48 + x]! - map[y * 48 + x - 1]!);
        dy += Math.abs(map[y * 48 + x]! - map[(y - 1) * 48 + x]!);
      }
      return [dx, dy];
    };
    const [horizontalDx, horizontalDy] = gradients(horizontal);
    const [verticalDx, verticalDy] = gradients(vertical);
    expect(horizontalDy).toBeGreaterThan(horizontalDx);
    expect(verticalDx).toBeGreaterThan(verticalDy);
  });

  it("does not mutate the request", () => {
    const input = Object.freeze(request("grain"));
    pixels(input);
    expect(input).toEqual(request("grain"));
  });

  it("rejects bad requests before creating a result", () => {
    const base = request("grain");
    const invalid = [null, [], { ...base, width: 513 }, { ...base, height: -1 },
      { ...base, seed: -1 }, { ...base, seed: 2 ** 32 }, { ...base, scale: NaN },
      { ...base, intensity: Infinity }, { ...base, kind: "unknown" },
      { ...base, surprise: true }, { ...base, directionRadians: 0 },
      { ...request("scratches"), directionRadians: Math.PI + 0.01 }];
    for (const value of invalid) {
      const result = generateProceduralMap(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_REQUEST");
    }
  });

  it("enforces maximum dimensions", () => {
    const result = generateProceduralMap(request("stone", { width: 512, height: 512, intensity: 0 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.pixels.byteLength).toBe(512 * 512);
  });

  it("keeps the reference byte checksum stable", () => {
    expect(kinds.map(kind => checksum(pixels(request(kind))))).toEqual(["37a033e6", "e973f075", "617e7edd"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { ProceduralRoughnessTextures } from "../../src/renderer/procedural-roughness-textures";
import { generateProceduralMap } from "../../src/materials/procedural";

const config = { kind: "grain" as const, seed: 7, scale: 4, intensity: .5, resolution: 128 as const };

describe("derived roughness texture", () => {
  it("writes absolute roughness to green and shares/disposes it by reference", () => {
    const cache = new ProceduralRoughnessTextures();
    const first = new T.MeshPhysicalMaterial({ roughness: .3, metalness: .8, color: 0xff0000 });
    const second = new T.MeshPhysicalMaterial({ roughness: .3 });
    expect(cache.bind(first, config, .3)).toBeUndefined();
    expect(cache.bind(second, config, .3)).toBeUndefined();
    expect(first.roughnessMap).toBe(second.roughnessMap);
    expect(first.roughness).toBe(1);
    expect(first.metalness).toBe(.8);
    expect(first.color.getHex()).toBe(0xff0000);
    const map = first.roughnessMap as T.DataTexture;
    expect(map.colorSpace).toBe(T.NoColorSpace);
    const generated = generateProceduralMap({ kind: config.kind, seed: config.seed, scale: config.scale, intensity: config.intensity, width: 128, height: 128 });
    if (!generated.ok) throw new Error(generated.error.message);
    const data = map.image.data as Uint8Array;
    expect(data[1]).toBe(Math.round(255 * Math.min(1, Math.max(0, .3 + (generated.value.pixels[0]! - 128) / 255))));
    const dispose = vi.spyOn(map, "dispose");
    cache.release(first); expect(dispose).not.toHaveBeenCalled();
    cache.release(second); expect(dispose).toHaveBeenCalledOnce();
  });
  it("does not attach or quantize a zero intensity map", () => {
    const cache = new ProceduralRoughnessTextures();
    const material = new T.MeshPhysicalMaterial({ roughness: .333 });
    cache.bind(material, { ...config, intensity: 0 }, .333);
    expect(material.roughnessMap).toBeNull();
    expect(material.roughness).toBe(.333);
  });
});

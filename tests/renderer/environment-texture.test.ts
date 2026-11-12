import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { EnvironmentTexture, type EnvironmentDecoder } from "../../src/renderer/environment-texture";
import type { Asset } from "../../src/domain/types";

const asset: Asset = { id: "hdr", hash: "a".repeat(64), path: `assets/${"a".repeat(64)}.hdr`, mediaType: "image/vnd.radiance", colorSpace: "linear" };
const background = { color: [0, 0, 0] as const, intensity: 1, environmentAssetId: "hdr", environmentRotation: 1, environmentIntensity: 2 };
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("environment resource lifecycle", () => {
  it("shares an unchanged environment, updates lighting without redecoding and releases on clear", async () => {
    const scene = new T.Scene(), texture = new T.DataTexture();
    const decode = vi.fn<EnvironmentDecoder>(async () => texture);
    const dispose = vi.spyOn(texture, "dispose");
    const resource = new EnvironmentTexture(scene, () => {}, decode);
    resource.sync(background, [asset], () => new Uint8Array([1]));
    await settle();
    expect(scene.environment).toBe(texture);
    resource.sync({ ...background, environmentIntensity: 4, environmentRotation: 2 }, [asset], () => new Uint8Array([1]));
    expect(decode).toHaveBeenCalledOnce();
    expect(scene.environmentIntensity).toBe(4);
    expect(scene.environmentRotation.y).toBe(2);
    resource.clear(); resource.clear();
    expect(scene.environment).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("aborts a load at project replacement and disposes its late result", async () => {
    const scene = new T.Scene(), texture = new T.DataTexture();
    let finish!: (texture: T.DataTexture) => void;
    let signal!: AbortSignal;
    const resource = new EnvironmentTexture(scene, () => {}, async (_bytes, _mime, current) => { signal = current; return new Promise(resolve => { finish = resolve; }); });
    resource.sync(background, [asset], () => new Uint8Array([1])); await settle();
    resource.clear(); expect(signal.aborted).toBe(true);
    const dispose = vi.spyOn(texture, "dispose"); finish(texture); await settle();
    expect(scene.environment).toBeNull(); expect(dispose).toHaveBeenCalledOnce();
  });
  it("uses neutral light after decode failure and removes it when the environment is cleared", async () => {
    const scene = new T.Scene();
    const resource = new EnvironmentTexture(scene, () => {}, async () => { throw new Error("Битый EXR"); });
    resource.sync(background, [asset], () => new Uint8Array([1])); await settle();
    expect(resource.loading).toBe(false);
    expect(resource.diagnostic).toContain("Битый EXR");
    expect(scene.children.some(o => o instanceof T.HemisphereLight)).toBe(true);
    resource.sync({ color: [0, 0, 0], intensity: 1 }, [], () => undefined);
    expect(resource.diagnostic).toBeUndefined(); expect(scene.children).toHaveLength(0);
  });
});

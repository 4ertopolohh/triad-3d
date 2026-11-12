import { afterEach, expect, it, vi } from "vitest";
import * as T from "three";
import { SurfaceTextures } from "../../src/renderer/surface-textures";
import { createMaterialAnimationProject } from "../fixtures/projects";

afterEach(() => vi.unstubAllGlobals());

it("shares deterministic relief and disposes it only after its last user", () => {
  const cache = new SurfaceTextures(() => {});
  const material = createMaterialAnimationProject().materials[0]!;
  material.proceduralMaps = { height: { kind: "stone", seed: 4, scale: 2, intensity: .5, resolution: 128, strength: .2 } };
  const a = new T.MeshPhysicalMaterial(), b = new T.MeshPhysicalMaterial();
  cache.bind(a, material, [], () => undefined);
  cache.bind(b, material, [], () => undefined);
  expect(a.bumpMap).toBe(b.bumpMap);
  expect(a.bumpScale).toBe(.2);
  expect(a.bumpMap!.colorSpace).toBe(T.NoColorSpace);
  const raster = new T.Texture();
  expect([a.bumpMap!.magFilter,a.bumpMap!.minFilter,a.bumpMap!.generateMipmaps]).toEqual([raster.magFilter,raster.minFilter,raster.generateMipmaps]);
  raster.dispose();
  const dispose = vi.spyOn(a.bumpMap!, "dispose");
  cache.release(a); expect(dispose).not.toHaveBeenCalled();
  cache.release(b); expect(dispose).toHaveBeenCalledOnce();
});

it("closes a late bitmap after material removal without assigning a disposed map", async () => {
  let resolve!: (bitmap: ImageBitmap) => void;
  vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise<ImageBitmap>(done => { resolve = done; })));
  const cache = new SurfaceTextures(() => {});
  const material = createMaterialAnimationProject().materials[0]!;
  material.textureSlots = { normal: "image" };
  const owner = new T.MeshPhysicalMaterial();
  cache.bind(owner, material, [{ id: "image", hash: "a".repeat(64), path: "assets/image.png", mediaType: "image/png", colorSpace: "srgb" }], () => new Uint8Array([1]));
  await Promise.resolve(); cache.release(owner);
  const close = vi.fn(); resolve({ close } as unknown as ImageBitmap);
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(owner.normalMap).toBeNull();
});

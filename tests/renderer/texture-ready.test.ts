import { afterEach, expect, it, vi } from "vitest";
import * as T from "three";
import { BaseColorTextures } from "../../src/renderer/base-color-textures";
import { SurfaceTextures } from "../../src/renderer/surface-textures";
import { createMaterialAnimationProject } from "../fixtures/projects";
afterEach(()=>vi.unstubAllGlobals());
it("waits for color and surface maps before capture and releases decoded bitmaps",async()=>{
  const pending:((bitmap:ImageBitmap)=>void)[]=[];
  vi.stubGlobal("createImageBitmap",()=>new Promise<ImageBitmap>(resolve=>pending.push(resolve)));
  const base=new BaseColorTextures(()=>{}),surface=new SurfaceTextures(()=>{}),owner=new T.MeshPhysicalMaterial();
  const asset={id:"image",hash:"a".repeat(64),path:"assets/image.png",mediaType:"image/png",colorSpace:"srgb" as const};
  const material=createMaterialAnimationProject().materials[0]!;material.textureSlots={normal:asset.id};
  base.bind(owner,asset,()=>new Uint8Array([1]));surface.bind(owner,material,[asset],()=>new Uint8Array([1]));
  let ready=false;const loaded=Promise.all([base.ready(),surface.ready()]).then(()=>{ready=true;});
  await Promise.resolve();expect(ready).toBe(false);expect(pending).toHaveLength(2);
  const close=vi.fn();for(const resolve of pending)resolve({close} as unknown as ImageBitmap);
  await loaded;expect(owner.map).not.toBeNull();expect(owner.normalMap).not.toBeNull();
  base.dispose();surface.dispose();owner.dispose();expect(close).toHaveBeenCalledTimes(2);
});

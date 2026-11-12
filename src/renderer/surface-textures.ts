import * as T from "three";
import type { Material, Asset } from "../domain/types";
import type { DeepReadonly } from "../app/editor-store";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { generateProceduralMap } from "../materials/procedural";
type Owner = T.MeshPhysicalMaterial | MeshPhysicalNodeMaterial;
type Channel = "normal" | "bump" | "roughness" | "metalness" | "emissive";
const property = { normal: "normalMap", bump: "bumpMap", roughness: "roughnessMap", metalness: "metalnessMap", emissive: "emissiveMap" } as const;
type Entry = { texture?: T.Texture; bitmap?: ImageBitmap; users: Map<Owner, Set<Channel>>; error?: string };

/** Linear data maps never share an sRGB sampler with color images. */
export class SurfaceTextures {
  private entries = new Map<string, Entry>();
  constructor(private changed: () => void) {}
  bind(owner: Owner, material: DeepReadonly<Material>, assets: readonly DeepReadonly<Asset>[], read: (id: string) => Uint8Array | undefined): void {
    owner.normalScale.setScalar(material.textureStrengths?.normal ?? 1);
    owner.bumpScale = material.textureStrengths?.bump ?? 1;
    for (const channel of Object.keys(property) as Channel[]) {
      const id = material.textureSlots?.[channel]; if (!id) continue;
      const asset = assets.find(a => a.id === id); if (!asset) continue;
      const key = `${asset.hash}:${channel === "emissive" ? "srgb" : "linear"}`;
      let entry = this.entries.get(key);
      if (!entry) {
        entry = { users: new Map() }; this.entries.set(key, entry);
        const current = entry;
        void Promise.resolve().then(async () => {
          const bytes = read(id); if (!bytes) throw new Error("Байты карты отсутствуют.");
          const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: asset.mediaType }), { imageOrientation: "flipY", colorSpaceConversion: "none", premultiplyAlpha: "none" });
          if (this.entries.get(key) !== current) { bitmap.close(); return; }
          const texture = new T.Texture(bitmap); texture.colorSpace = channel === "emissive" ? T.SRGBColorSpace : T.NoColorSpace;
          texture.userData.triadSharedTexture = true; texture.needsUpdate = true;
          current.texture = texture; current.bitmap = bitmap;
          for (const [user, channels] of current.users) for (const kind of channels) { user[property[kind]] = texture; user.needsUpdate = true; }
        }).catch(() => { current.error = `Не удалось загрузить карту ${channel}: ${id}.`; }).finally(this.changed);
      }
      const channels = entry.users.get(owner) ?? new Set<Channel>(); channels.add(channel); entry.users.set(owner, channels);
      if (entry.texture) { owner[property[channel]] = entry.texture; owner.needsUpdate = true; }
    }
    const height = material.proceduralMaps?.height;
    if (height && height.intensity && height.strength && !material.textureSlots?.bump && !material.textureSlots?.normal) {
      const key = `height:${JSON.stringify(height)}`;
      let entry = this.entries.get(key);
      if (!entry) {
        const result = generateProceduralMap({ kind: "stone", width: height.resolution, height: height.resolution, seed: height.seed, scale: height.scale, intensity: height.intensity });
        if (!result.ok) return;
        const rgba = new Uint8Array(result.value.pixels.length * 4);
        result.value.pixels.forEach((v, i) => { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; });
        const texture = new T.DataTexture(rgba, height.resolution, height.resolution); texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;texture.generateMipmaps=true; texture.colorSpace = T.NoColorSpace; texture.needsUpdate = true; texture.userData.triadSharedTexture = true;
        entry = { texture, users: new Map() }; this.entries.set(key, entry);
      }
      entry.users.set(owner, new Set(["bump"])); owner.bumpMap = entry.texture!; owner.bumpScale = height.strength; owner.needsUpdate = true;
    }
  }
  release(material: T.Material): void {
    if (!(material instanceof T.MeshPhysicalMaterial) && !(material instanceof MeshPhysicalNodeMaterial)) return;
    for (const [key, entry] of this.entries) {
      const channels = entry.users.get(material); if (!channels) continue;
      for (const channel of channels) material[property[channel]] = null;
      entry.users.delete(material);
      if (!entry.users.size) { entry.texture?.dispose(); entry.bitmap?.close(); this.entries.delete(key); }
    }
  }
  releaseObject(root: T.Object3D): void { root.traverse(o => { if (o instanceof T.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.release(m); }); }
  diagnostics(): string[] { return [...this.entries.values()].flatMap(e => e.error ? [e.error] : []); }
  dispose(): void { for (const entry of this.entries.values()) for (const owner of [...entry.users.keys()]) this.release(owner); }
}

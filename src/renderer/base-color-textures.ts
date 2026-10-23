import * as T from "three";
import type { Asset } from "../domain/types";
import type { BaseColorProjection } from "../domain/types";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { bindTriplanarTexture } from "./triplanar-material";

type Owner = T.MeshPhysicalMaterial | MeshPhysicalNodeMaterial;
type Entry = { texture?: T.Texture; bitmap?: ImageBitmap; users: Set<Owner>; error?: string; pending?: Promise<void> | undefined };

/** Owned by one SceneSync. Materials borrow textures; the cache alone disposes them. */
export class BaseColorTextures {
  private entries = new Map<string, Entry>();
  private owners = new Map<Owner, { key: string; projection?: Extract<BaseColorProjection, { mode: "triplanar" }> }>();
  constructor(private changed: () => void) {}

  bind(material: Owner, asset: Readonly<Asset>, read: (id: string) => Uint8Array | undefined, repeat = false, projection?: Extract<BaseColorProjection, { mode: "triplanar" }>): void {
    const key = `${asset.id}:${asset.hash}:${repeat ? "repeat" : "default"}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { users: new Set() };
      this.entries.set(key, entry);
      const current = entry;
      const bytes = read(asset.id);
      if (!bytes) current.error = `Ресурс ${asset.id}: байты изображения отсутствуют в памяти.`;
      else current.pending = (async () => {
        let bitmap: ImageBitmap | undefined;
        try {
          bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: asset.mediaType }), { imageOrientation: "flipY" });
          if (this.entries.get(key) !== current || !current.users.size) { bitmap.close(); return; }
          const texture = new T.Texture(bitmap);
          texture.colorSpace = T.SRGBColorSpace;
          if (repeat) texture.wrapS = texture.wrapT = T.RepeatWrapping;
          texture.needsUpdate = true;
          texture.userData.triadSharedTexture = true;
          current.bitmap = bitmap; current.texture = texture;
          for (const user of current.users) this.assign(user, texture);
        } catch { bitmap?.close(); current.error = `Ресурс ${asset.id}: не удалось декодировать изображение.`; }
        finally { current.pending = undefined; this.changed(); }
      })();
    }
    entry.users.add(material);
    this.owners.set(material, projection ? { key, projection } : { key });
    if (entry.texture) this.assign(material, entry.texture);
  }

  private assign(material: Owner, image: T.Texture): void {
    const owner = this.owners.get(material);
    if (!owner) return;
    if (material instanceof MeshPhysicalNodeMaterial && owner.projection) bindTriplanarTexture(material, image, owner.projection);
    else if (material instanceof T.MeshPhysicalMaterial) { material.map = image; material.needsUpdate = true; }
  }

  release(material: T.Material): void {
    if (!(material instanceof T.MeshPhysicalMaterial) && !(material instanceof MeshPhysicalNodeMaterial)) return;
    const owner = this.owners.get(material);
    if (!owner) return;
    const { key } = owner;
    this.owners.delete(material);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.users.delete(material);
    if (material instanceof MeshPhysicalNodeMaterial) material.colorNode = null;
    else material.map = null;
    if (!entry.users.size) {
      this.entries.delete(key);
      entry.texture?.dispose(); entry.bitmap?.close();
    }
  }

  releaseObject(root: T.Object3D): void {
    root.traverse(object => { if (object instanceof T.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) this.release(material); });
  }
  diagnostics(): string[] { return [...this.entries.values()].flatMap(entry => entry.error ? [entry.error] : []); }
  dispose(): void { for (const material of [...this.owners.keys()]) this.release(material); }
}

import * as T from "three";
import type { Asset } from "../domain/types";

type Entry = { texture?: T.Texture; bitmap?: ImageBitmap; users: Set<T.MeshPhysicalMaterial>; error?: string; pending?: Promise<void> | undefined };

/** Owned by one SceneSync. Materials borrow textures; the cache alone disposes them. */
export class BaseColorTextures {
  private entries = new Map<string, Entry>();
  private owners = new Map<T.MeshPhysicalMaterial, string>();
  constructor(private changed: () => void) {}

  bind(material: T.MeshPhysicalMaterial, asset: Readonly<Asset>, read: (id: string) => Uint8Array | undefined): void {
    const key = `${asset.id}:${asset.hash}`;
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
          texture.needsUpdate = true;
          texture.userData.triadSharedTexture = true;
          current.bitmap = bitmap; current.texture = texture;
          for (const user of current.users) { user.map = texture; user.needsUpdate = true; }
        } catch { bitmap?.close(); current.error = `Ресурс ${asset.id}: не удалось декодировать изображение.`; }
        finally { current.pending = undefined; this.changed(); }
      })();
    }
    entry.users.add(material);
    this.owners.set(material, key);
    if (entry.texture) { material.map = entry.texture; material.needsUpdate = true; }
  }

  release(material: T.Material): void {
    if (!(material instanceof T.MeshPhysicalMaterial)) return;
    const key = this.owners.get(material);
    if (!key) return;
    this.owners.delete(material);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.users.delete(material);
    material.map = null;
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

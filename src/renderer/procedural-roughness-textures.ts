import * as T from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import type { ProceduralRoughnessConfig } from "../domain/types";
import { generateProceduralMap } from "../materials/procedural";

type Owner = T.MeshPhysicalMaterial | MeshPhysicalNodeMaterial;
type Entry = { texture: T.DataTexture; users: Set<Owner> };

/** Derived, scene-local GPU resources. Domain parameters alone determine every pixel. */
export class ProceduralRoughnessTextures {
  private entries = new Map<string, Entry>();
  private owners = new Map<Owner, string>();

  bind(material: Owner, config: Readonly<ProceduralRoughnessConfig>, baseRoughness: number): string | undefined {
    if (config.intensity === 0) return;
    const key = JSON.stringify([config.kind, config.seed, config.scale, config.intensity, config.resolution, config.kind === "scratches" ? config.directionRadians : null, baseRoughness]);
    let entry = this.entries.get(key);
    if (!entry) {
      const result = generateProceduralMap({ kind: config.kind, width: config.resolution, height: config.resolution,
        seed: config.seed, scale: config.scale, intensity: config.intensity,
        ...(config.kind === "scratches" ? { directionRadians: config.directionRadians } : {}) });
      if (!result.ok) return result.error.message;
      try {
        const pixels = result.value.pixels;
        const rgb = new Uint8Array(pixels.length * 4);
        for (let i = 0; i < pixels.length; i++) {
          rgb[i * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, baseRoughness + (pixels[i]! - 128) / 255)));
          rgb[i * 4 + 3] = 255;
        }
        const texture = new T.DataTexture(rgb, config.resolution, config.resolution, T.RGBAFormat);
        texture.colorSpace = T.NoColorSpace;
        texture.needsUpdate = true;
        texture.userData.triadSharedTexture = true;
        entry = { texture, users: new Set() };
        this.entries.set(key, entry);
      } catch { return "Не удалось создать GPU-карту шероховатости."; }
    }
    entry.users.add(material);
    this.owners.set(material, key);
    material.roughnessMap = entry.texture;
    material.roughness = 1;
    material.needsUpdate = true;
  }

  release(material: T.Material): void {
    if (!(material instanceof T.MeshPhysicalMaterial) && !(material instanceof MeshPhysicalNodeMaterial)) return;
    const key = this.owners.get(material);
    if (!key) return;
    this.owners.delete(material);
    material.roughnessMap = null;
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.users.delete(material);
    if (!entry.users.size) { this.entries.delete(key); entry.texture.dispose(); }
  }

  releaseObject(root: T.Object3D): void {
    root.traverse(object => { if (object instanceof T.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) this.release(material); });
  }
  dispose(): void { for (const owner of [...this.owners.keys()]) this.release(owner); }
}

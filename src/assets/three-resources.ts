import { Mesh, Texture, type Object3D } from "three";

/** Each decoded/primitive subtree owns its resources; sharing inside it is deduplicated.
 * No resources are shared across independently owned subtrees. */
export function disposeObject(root: Object3D): void {
  const resources = new Set<{ dispose(): void }>();
  const images = new Set<ImageBitmap>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    resources.add(object.geometry);
    const retained = object.userData.originalMaterials as unknown;
    const originals = Array.isArray(retained) ? retained.filter((item): item is typeof object.material => item && typeof item === "object" && "dispose" in item) : [];
    for (const material of [...(Array.isArray(object.material) ? object.material : [object.material]), ...originals].flat()) {
      resources.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) {
        if (value.userData.triadSharedTexture) continue;
        resources.add(value);
        if (typeof ImageBitmap !== "undefined" && value.image instanceof ImageBitmap) images.add(value.image);
      }
    }
  });
  for (const resource of resources) resource.dispose();
  for (const image of images) image.close();
  root.removeFromParent();
  root.clear();
}

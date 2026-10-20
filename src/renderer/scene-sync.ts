import * as T from "three";
import type { DeepReadonly } from "../app/editor-store";
import type { Project, Transform, Material } from "../domain/types";
import { decodeStaticGlb } from "../importers/gltf/import-glb";
import { disposeObject } from "../assets/three-resources";
import { primitiveGeometry } from "./primitive";

export type RenderProject = DeepReadonly<Project>;
export type AssetReader = (id: string) => Uint8Array | undefined;
export type SceneStatus = { loading: number; diagnostics: string[]; errors: number; empty: boolean };
type Entry = { object: T.Group; key: string; content?: T.Object3D; loading: boolean; error?: string };
export type AssetDecoder = (bytes: Uint8Array) => Promise<T.Object3D>;
const decode: AssetDecoder = async bytes => {
  const result = await decodeStaticGlb(bytes);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.root;
};

export function applyTransform(object: T.Object3D, transform: Transform): void {
  const { position, rotationQuat, scale } = transform;
  const length = Math.hypot(...rotationQuat);
  if (![...position, ...rotationQuat, ...scale].every(Number.isFinite) || length < 1e-10) throw new Error("Некорректная матрица объекта.");
  const matrix = new T.Matrix4().compose(new T.Vector3(...position), new T.Quaternion(...rotationQuat).normalize(), new T.Vector3(...scale));
  if (!matrix.elements.every(Number.isFinite)) throw new Error("Некорректная матрица объекта.");
  object.position.fromArray(position); object.quaternion.fromArray(rotationQuat).normalize(); object.scale.fromArray(scale);
  object.updateMatrix();
}
function material(value?: DeepReadonly<Material>): T.MeshPhysicalMaterial {
  if (!value) return new T.MeshPhysicalMaterial({ color: 0xaaaaaa, roughness: .65 });
  return new T.MeshPhysicalMaterial({ color: new T.Color(...value.baseColor), metalness: value.metalness, roughness: value.roughness,
    emissive: new T.Color(...value.emissive), opacity: value.transmission > 0 ? 1 : value.opacity, transparent: value.transmission === 0 && value.opacity < 1,
    transmission: value.transmission, ior: value.ior, clearcoat: value.clearcoat, envMapIntensity: value.envIntensity });
}

export class SceneSync {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera();
  readonly objects = new Map<string, Entry>();
  private lights = new T.Group();
  private projectId = "";
  private epoch: object | undefined;
  private lightKey = "";
  private diagnostics: string[] = [];
  private closed = false;
  constructor(private report: (status: SceneStatus) => void, private decoder: AssetDecoder = decode) { this.scene.add(this.lights); }
  sync(project: RenderProject, readAsset: AssetReader, epoch?: object): void {
    if (this.closed) return;
    if (this.projectId !== project.id || this.epoch !== epoch) { this.clear(); this.projectId = project.id; this.epoch = epoch; }
    this.diagnostics = [];
    const camera = project.scene.camera;
    if (![...camera.position, ...camera.target, camera.near, camera.far, camera.fovDegrees].every(Number.isFinite)
      || camera.near <= 0 || camera.far <= camera.near || camera.fovDegrees <= 0 || camera.fovDegrees >= 180) throw new Error("Некорректная камера сцены.");
    this.camera.position.fromArray(camera.position); this.camera.lookAt(new T.Vector3(...camera.target));
    this.camera.near = camera.near; this.camera.far = camera.far; this.camera.fov = camera.fovDegrees; this.camera.updateProjectionMatrix();
    this.scene.background = new T.Color(...project.scene.background.color).multiplyScalar(project.scene.background.intensity);
    if (project.scene.background.environmentAssetId) this.diagnostics.push("HDRI-окружение пока не отображается.");
    if (project.scene.instances.length) this.diagnostics.push("Показан предпросмотр основной модели; экземпляры сцены пока не отображаются.");
    if (project.modifiers.some(m => m.enabled)) this.diagnostics.push("Предпросмотр исходной геометрии: модификаторы пока не вычисляются.");
    const lightKey = JSON.stringify(project.scene.lights);
    if (lightKey !== this.lightKey) {
      this.lights.clear(); this.lightKey = lightKey;
      for (const light of project.scene.lights) {
        const color = new T.Color(...light.color);
        const object = light.kind === "ambient" ? new T.AmbientLight(color, light.intensity) : light.kind === "directional" ? new T.DirectionalLight(color, light.intensity)
          : light.kind === "point" ? new T.PointLight(color, light.intensity) : new T.SpotLight(color, light.intensity);
        object.position.fromArray(light.position);
        if (object instanceof T.DirectionalLight || object instanceof T.SpotLight) { object.target.position.fromArray(light.target); this.lights.add(object.target); }
        this.lights.add(object);
      }
    }
    const ids = new Set(project.nodes.map(n => n.id));
    for (const [id, entry] of this.objects) if (!ids.has(id)) { this.remove(entry); this.objects.delete(id); }
    for (const node of project.nodes) {
      let entry = this.objects.get(node.id);
      if (!entry) { entry = { object: new T.Group(), key: "", loading: false }; entry.object.userData.nodeId = node.id; this.objects.set(node.id, entry); }
      entry.object.name = node.name; applyTransform(entry.object, node.transform); entry.object.visible = node.visible;
      const materials = node.materialSlots.map(slot => project.materials.find(m => m.id === slot.materialId));
      if (materials.some(m => m?.textureAssetIds.length)) this.diagnostics.push(`${node.name}: текстуры доменного материала пока не отображаются.`);
      const source = node.kind === "mesh" ? node.meshSource : null;
      const asset = source?.kind === "asset" ? project.assets.find(a => a.id === source.assetId) : undefined;
      const key = JSON.stringify([source, asset, materials]);
      if (key === entry.key) continue;
      if (entry.content) { disposeObject(entry.content); delete entry.content; }
      // Replacement token prevents late assets from attaching after delete, undo, or another source.
      const next: Entry = { object: entry.object, key, loading: false }; this.objects.set(node.id, next);
      if (!source) continue;
      const assign = (content: T.Object3D) => {
        if (this.closed || this.objects.get(node.id) !== next) { disposeObject(content); return; }
        next.content = content; next.loading = false; next.object.add(content); this.emit();
      };
      try {
        if (source.kind === "primitive") assign(new T.Mesh(primitiveGeometry(source), material(materials[0])));
        else {
          if (!asset || asset.mediaType !== "model/gltf-binary") throw new Error("Ресурс GLB отсутствует или имеет неподдерживаемый тип.");
          const bytes = readAsset(source.assetId);
          if (!bytes) throw new Error("Байты GLB отсутствуют в памяти.");
          next.loading = true;
          void this.decoder(bytes).then(content => {
            // Keep imported materials when there is no explicit domain slot assignment.
            if (materials.length && this.objects.get(node.id) === next && !this.closed) {
              const oldMaterials = new Set<T.Material>(); const oldTextures = new Set<T.Texture>();
              content.traverse(o => { if (o instanceof T.Mesh) {
                for (const m of Array.isArray(o.material) ? o.material : [o.material]) { oldMaterials.add(m); for (const v of Object.values(m)) if (v instanceof T.Texture) oldTextures.add(v); }
                o.material = materials.map(m => material(m));
              } });
              for (const m of oldMaterials) m.dispose();
              for (const t of oldTextures) { t.dispose(); if (typeof ImageBitmap !== "undefined" && t.image instanceof ImageBitmap) t.image.close(); }
            }
            assign(content);
          }).catch((error: unknown) => { if (!this.closed && this.objects.get(node.id) === next) { next.loading = false; next.error = error instanceof Error ? error.message : "Ошибка декодирования GLB."; this.emit(); } });
        }
      } catch (error) { next.error = error instanceof Error ? error.message : "Ошибка геометрии."; }
    }
    for (const node of project.nodes) {
      const object = this.objects.get(node.id)!.object;
      const parent = node.id === project.model.rootNodeId ? this.scene : node.parentId ? this.objects.get(node.parentId)?.object : undefined;
      if (parent && object.parent !== parent) parent.add(object);
    }
    this.scene.updateMatrixWorld(true);
    for (const entry of this.objects.values()) if (!entry.object.matrixWorld.elements.every(Number.isFinite)) throw new Error("Некорректная мировая матрица объекта.");
    this.emit();
  }
  private emit(): void { this.report({ loading: [...this.objects.values()].filter(e => e.loading).length,
    errors: [...this.objects.values()].filter(e => e.error).length,
    empty: ![...this.objects.values()].some(e => e.content || e.loading), diagnostics: [...new Set([...this.diagnostics, ...[...this.objects.values()].flatMap(e => e.error ? [e.error] : [])])] }); }
  private remove(entry: Entry): void { if (entry.content) disposeObject(entry.content); entry.object.removeFromParent(); entry.object.clear(); }
  private clear(): void { for (const entry of this.objects.values()) this.remove(entry); this.objects.clear(); }
  dispose(): void { if (this.closed) return; this.closed = true; this.clear(); this.lights.clear(); this.scene.clear(); }
}

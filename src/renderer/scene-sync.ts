import * as T from "three";
import type { DeepReadonly } from "../app/editor-store";
import type { Project, Transform, Material } from "../domain/types";
import { decodeStaticGlb } from "../importers/gltf/import-glb";
import { disposeObject } from "../assets/three-resources";
import { primitiveGeometry } from "./primitive";
import { SurfaceQuery } from "../geometry/surface-query";
import { validateMesh, type MeshData } from "../geometry/csg";

export type RenderProject = DeepReadonly<Project>;
export type AssetReader = (id: string) => Uint8Array | undefined;
export type SceneStatus = { loading: number; diagnostics: string[]; errors: number; empty: boolean };
type Entry = { object: T.Group; key: string; sourceKey: string; content?: T.Object3D; loading: boolean; error?: string };
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
function replaceMaterials(content: T.Object3D, values: readonly (DeepReadonly<Material> | undefined)[]): void {
  const oldMaterials = new Set<T.Material>(); const oldTextures = new Set<T.Texture>();
  content.traverse(object => { if (!(object instanceof T.Mesh)) return;
    for (const old of Array.isArray(object.material) ? object.material : [object.material]) {
      oldMaterials.add(old);
      for (const value of Object.values(old)) if (value instanceof T.Texture) oldTextures.add(value);
    }
    object.material = values.length > 1 ? values.map(value => material(value)) : material(values[0]);
  });
  for (const old of oldMaterials) old.dispose();
  for (const texture of oldTextures) { texture.dispose(); if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close(); }
}

export class SceneSync {
  readonly surfaces = new SurfaceQuery(undefined, undefined, () => this.emit());
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera();
  readonly cameraTarget = new T.Vector3();
  cameraVersion = 0;
  readonly objects = new Map<string, Entry>();
  private lights = new T.Group();
  private projectId = "";
  private epoch: object | undefined;
  private lightKey = "";
  private cameraKey = "";
  private diagnostics: string[] = [];
  private modifierDiagnostics = new Map<string, string[]>();
  private derived = new Set<string>();
  private nodeMaterials = new Map<string, DeepReadonly<Material> | undefined>();
  private closed = false;
  constructor(private report: (status: SceneStatus) => void, private decoder: AssetDecoder = decode) { this.scene.add(this.lights); }
  sync(project: RenderProject, readAsset: AssetReader, epoch?: object): void {
    if (this.closed) return;
    if (this.projectId !== project.id || this.epoch !== epoch) { this.clear(); this.projectId = project.id; this.epoch = epoch; this.cameraKey = ""; }
    this.diagnostics = [];
    const camera = project.scene.camera;
    if (![...camera.position, ...camera.target, camera.near, camera.far, camera.fovDegrees].every(Number.isFinite)
      || camera.near <= 0 || camera.far <= camera.near || camera.fovDegrees <= 0 || camera.fovDegrees >= 180) throw new Error("Некорректная камера сцены.");
    const cameraKey = JSON.stringify(camera);
    if (cameraKey !== this.cameraKey) {
      this.cameraKey = cameraKey;
      this.cameraTarget.fromArray(camera.target);
      this.camera.position.fromArray(camera.position); this.camera.lookAt(this.cameraTarget);
      this.camera.near = camera.near; this.camera.far = camera.far; this.camera.fov = camera.fovDegrees; this.camera.updateProjectionMatrix();
      this.cameraVersion += 1;
    }
    this.scene.background = new T.Color(...project.scene.background.color).multiplyScalar(project.scene.background.intensity);
    if (project.scene.background.environmentAssetId) this.diagnostics.push("HDRI-окружение пока не отображается.");
    if (project.scene.instances.length) this.diagnostics.push("Показан предпросмотр основной модели; экземпляры сцены пока не отображаются.");
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
    for (const [id, entry] of this.objects) if (!ids.has(id)) { this.remove(entry); this.objects.delete(id); this.derived.delete(id); this.modifierDiagnostics.delete(id); this.nodeMaterials.delete(id); }
    for (const node of project.nodes) {
      let entry = this.objects.get(node.id);
      if (!entry) { entry = { object: new T.Group(), key: "", sourceKey: "", loading: false }; entry.object.userData.nodeId = node.id; this.objects.set(node.id, entry); }
      entry.object.name = node.name; applyTransform(entry.object, node.transform); entry.object.visible = node.visible;
      const materials = node.materialSlots.map(slot => project.materials.find(m => m.id === slot.materialId));
      this.nodeMaterials.set(node.id, materials[0]);
      if (materials.some(m => m?.textureAssetIds.length)) this.diagnostics.push(`${node.name}: текстуры доменного материала пока не отображаются.`);
      const source = node.kind === "mesh" ? node.meshSource : null;
      const asset = source?.kind === "asset" ? project.assets.find(a => a.id === source.assetId) : undefined;
      const key = JSON.stringify([source, asset, materials]);
      if (key === entry.key) continue;
      const sourceKey = JSON.stringify([source, asset]);
      if (entry.content && entry.sourceKey === sourceKey && (source?.kind === "primitive" || materials.length > 0)) {
        replaceMaterials(entry.content, materials);
        entry.key = key;
        continue;
      }
      if (entry.content) { this.surfaces.release(entry.content); disposeObject(entry.content); delete entry.content; }
      // Replacement token prevents late assets from attaching after delete, undo, or another source.
      const next: Entry = { object: entry.object, key, sourceKey, loading: false }; this.objects.set(node.id, next);
      if (!source) continue;
      const assign = (content: T.Object3D) => {
        if (this.closed || this.objects.get(node.id) !== next) { disposeObject(content); return; }
        next.content = content; next.loading = false; next.object.add(content);
        this.surfaces.register(node.id, next.object, content); this.emit();
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
            if (materials.length && this.objects.get(node.id) === next && !this.closed) replaceMaterials(content, materials);
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
    for (const node of project.nodes) {
      const parent = this.objects.get(node.id)?.object;
      if (!parent) continue;
      const ordered = node.children.map(id => this.objects.get(id)?.object).filter((item): item is T.Group => !!item);
      if (ordered.some((item, i) => parent.children[i] !== item)) {
        for (const item of ordered) parent.remove(item);
        for (const item of ordered) parent.add(item);
      }
    }
    this.scene.updateMatrixWorld(true);
    for (const entry of this.objects.values()) if (!entry.object.matrixWorld.elements.every(Number.isFinite)) throw new Error("Некорректная мировая матрица объекта.");
    this.emit();
  }
  /** Derived buffers belong to the renderer and are never attached to the domain document. */
  setDerived(nodeId: string, mesh: MeshData, empty: boolean, diagnostics: string[] = []): void {
    if (this.closed) return;
    const entry = this.objects.get(nodeId);
    if (!entry) return;
    validateMesh(mesh, empty);
    if (empty !== (mesh.indices.length === 0)) throw new Error("Некорректный пустой результат Boolean.");
    const geometry = new T.BufferGeometry();
    let content: T.Mesh | undefined;
    try {
      if (!empty) {
        geometry.setAttribute("position", new T.BufferAttribute(mesh.positions.slice(), 3));
        geometry.setIndex(new T.BufferAttribute(mesh.indices.slice(), 1));
        geometry.computeVertexNormals();
        content = new T.Mesh(geometry, material(this.nodeMaterials.get(nodeId)));
      }
      if (entry.content) { this.surfaces.release(entry.content); disposeObject(entry.content); delete entry.content; }
      if (content) { entry.object.add(content); entry.content = content; this.surfaces.register(nodeId, entry.object, content); }
      else geometry.dispose();
      this.derived.add(nodeId);
      this.setModifierDiagnostics(nodeId, diagnostics);
    } catch (error) { if (content) disposeObject(content); else geometry.dispose(); throw error; }
  }
  setModifierDiagnostics(nodeId: string, diagnostics: string[]): void {
    if (this.closed || !this.objects.has(nodeId)) return;
    if (diagnostics.length) this.modifierDiagnostics.set(nodeId, diagnostics.map(message => `${nodeId}: ${message}`));
    else this.modifierDiagnostics.delete(nodeId);
    this.emit();
  }
  resetDerived(project: RenderProject, readAsset: AssetReader, epoch?: object): void {
    if (this.closed) return;
    for (const id of this.derived) { const entry = this.objects.get(id); if (entry) { entry.key = ""; entry.sourceKey = ""; } }
    this.derived.clear(); this.modifierDiagnostics.clear();
    this.sync(project, readAsset, epoch);
  }
  private emit(): void { this.report({ loading: [...this.objects.values()].filter(e => e.loading).length,
    errors: [...this.objects.values()].filter(e => e.error).length,
    empty: ![...this.objects.values()].some(e => e.content || e.loading), diagnostics: [...new Set([...this.diagnostics, ...this.surfaces.diagnostics, ...[...this.modifierDiagnostics.values()].flat(), ...[...this.objects.values()].flatMap(e => e.error ? [e.error] : [])])] }); }
  private remove(entry: Entry): void { if (entry.content) { this.surfaces.release(entry.content); disposeObject(entry.content); } entry.object.removeFromParent(); entry.object.clear(); }
  private clear(): void { for (const entry of this.objects.values()) this.remove(entry); this.objects.clear(); this.derived.clear(); this.modifierDiagnostics.clear(); this.nodeMaterials.clear(); this.surfaces.clear(); }
  dispose(): void { if (this.closed) return; this.closed = true; this.clear(); this.surfaces.dispose(); this.lights.clear(); this.scene.clear(); }
}

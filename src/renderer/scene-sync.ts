import * as T from "three";
import type { DeepReadonly } from "../app/editor-store";
import type { Project, Transform, Material } from "../domain/types";
import { decodeStaticGlb } from "../importers/gltf/import-glb";
import { disposeObject } from "../assets/three-resources";
import { primitiveGeometry } from "./primitive";
import { editableGeometry } from "../geometry/mesh-edit";
import { SurfaceQuery } from "../geometry/surface-query";
import { validateMesh, type MeshData } from "../geometry/csg";
import { createPhysicalMaterial } from "./pbr-material";
import { BaseColorTextures } from "./base-color-textures";
import { ProjectionGeometry } from "./planar-projection";

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
const editorMaterials = new WeakSet<T.Material>();
function ownedMaterial(value?: DeepReadonly<Material>): T.MeshPhysicalMaterial {
  const created = createPhysicalMaterial(value); editorMaterials.add(created); return created;
}
function replaceMaterials(content: T.Object3D, values: readonly (DeepReadonly<Material> | undefined)[], make: (value: DeepReadonly<Material> | undefined, geometry: T.BufferGeometry) => T.MeshPhysicalMaterial, release: (material: T.Material) => void): void {
  const oldMaterials = new Set<T.Material>();
  content.traverse(object => { if (!(object instanceof T.Mesh)) return;
    for (const old of Array.isArray(object.material) ? object.material : [object.material]) {
      if (editorMaterials.has(old)) oldMaterials.add(old);
      else if (!object.userData.originalMaterials) object.userData.originalMaterials = Array.isArray(object.material) ? [...object.material] : [object.material];
    }
    object.material = values.length > 1 && object.geometry.groups.length > 0
      ? values.map(value => make(value, object.geometry)) : make(values[0], object.geometry);
  });
  for (const old of oldMaterials) { release(old); old.dispose(); }
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
  private textures = new BaseColorTextures(() => this.emit());
  private projection = new ProjectionGeometry();
  private assets = new Map<string, DeepReadonly<Project["assets"][number]>>();
  private readAsset: AssetReader = () => undefined;
  constructor(private report: (status: SceneStatus) => void, private decoder: AssetDecoder = decode) { this.scene.add(this.lights); }
  private makeMaterial(value: DeepReadonly<Material> | undefined, geometry: T.BufferGeometry, name: string, imported = false): T.MeshPhysicalMaterial {
    const material = ownedMaterial(value);
    const id = value?.textureSlots?.baseColor;
    if (!id) return material;
    if (imported && value?.textureMappings?.baseColor?.mode !== undefined && value.textureMappings.baseColor.mode !== "uv") { this.diagnostics.push(`${name}: проекция для импортированного GLB недоступна.`); return material; }
    if (!geometry.getAttribute("uv")) { this.diagnostics.push(`${name}: у геометрии нет UV; текстура основного цвета не отображается.`); return material; }
    const asset = this.assets.get(id);
    if (!asset || !["image/png", "image/jpeg", "image/webp"].includes(asset.mediaType)) { this.diagnostics.push(`${name}: ресурс основного цвета недоступен или имеет неподдерживаемый формат.`); return material; }
    this.textures.bind(material, asset, this.readAsset, value?.textureMappings?.baseColor?.mode !== undefined && value.textureMappings.baseColor.mode !== "uv");
    return material;
  }
  private disposeContent(content: T.Object3D): void { this.textures.releaseObject(content); content.traverse(object => { if (object instanceof T.Mesh) this.projection.releaseMesh(object); }); disposeObject(content); }
  sync(project: RenderProject, readAsset: AssetReader, epoch?: object): void {
    if (this.closed) return;
    if (this.projectId !== project.id || this.epoch !== epoch) { this.clear(); this.projectId = project.id; this.epoch = epoch; this.cameraKey = ""; }
    this.diagnostics = [];
    this.assets = new Map(project.assets.map(asset => [asset.id, asset])); this.readAsset = readAsset;
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
      if (materials.some(m => m?.textureAssetIds.length)) this.diagnostics.push(`${node.name}: у legacy-ссылок на текстуры канал не определён.`);
      const source = node.kind === "mesh" ? node.meshSource : null;
      const asset = source?.kind === "asset" ? project.assets.find(a => a.id === source.assetId) : undefined;
      const key = JSON.stringify([source, asset, materials]);
      if (key === entry.key) continue;
      const sourceKey = JSON.stringify([source, asset]);
      if (entry.content && entry.sourceKey === sourceKey && (source?.kind !== "asset" || materials.length > 0)) {
        if (source?.kind !== "asset") {
          let projectionFailed = false;
          const meshes: T.Mesh[] = [];
          entry.content.traverse(object => { if (object instanceof T.Mesh) meshes.push(object); });
          const mapping = materials[0]?.textureMappings?.baseColor;
          const replaceGeometry = meshes.some(mesh => this.projection.needsUpdate(mesh, mapping) && this.projection.replacesGeometry(mesh, mapping));
          if (replaceGeometry) this.surfaces.release(entry.content);
          try { for (const mesh of meshes) this.projection.applyMesh(mesh, mapping); }
          catch (error) { projectionFailed = true; this.diagnostics.push(`${node.name}: ${error instanceof Error ? error.message : "Ошибка проекции."}`); }
          finally { if (replaceGeometry) this.surfaces.register(node.id, entry.object, entry.content); }
          if (projectionFailed) continue;
        }
        if (this.derived.has(node.id)) {
          const warnings = (this.modifierDiagnostics.get(node.id) ?? []).filter(message => !message.includes("у результата модификатора нет UV"));
          if (materials[0]?.textureSlots?.baseColor && entry.content instanceof T.Mesh && !entry.content.geometry.getAttribute("uv")) warnings.push(`${node.id}: у результата модификатора нет UV; текстура основного цвета не отображается.`);
          if (warnings.length) this.modifierDiagnostics.set(node.id, warnings); else this.modifierDiagnostics.delete(node.id);
        }
        replaceMaterials(entry.content, materials, (value, geometry) => this.makeMaterial(value, geometry, node.name, source?.kind === "asset"), material => this.textures.release(material));
        entry.key = key;
        continue;
      }
      if (entry.content) { this.surfaces.release(entry.content); this.disposeContent(entry.content); delete entry.content; }
      // Replacement token prevents late assets from attaching after delete, undo, or another source.
      const next: Entry = { object: entry.object, key, sourceKey, loading: false }; this.objects.set(node.id, next);
      if (!source) continue;
      const assign = (content: T.Object3D) => {
        if (this.closed || this.objects.get(node.id) !== next) { this.disposeContent(content); return; }
        next.content = content; next.loading = false; next.object.add(content);
        this.surfaces.register(node.id, next.object, content); this.emit();
      };
      try {
        if (source.kind === "primitive" || source.kind === "editable") {
          const geometry = source.kind === "primitive" ? primitiveGeometry(source) : editableGeometry(source);
          const content = new T.Mesh(geometry);
          try { this.projection.applyMesh(content, materials[0]?.textureMappings?.baseColor); }
          catch (error) { this.diagnostics.push(`${node.name}: ${error instanceof Error ? error.message : "Ошибка проекции."}`); }
          content.material = this.makeMaterial(materials[0], content.geometry, node.name);
          assign(content);
        }
        else {
          if (!asset || asset.mediaType !== "model/gltf-binary") throw new Error("Ресурс GLB отсутствует или имеет неподдерживаемый тип.");
          const bytes = readAsset(source.assetId);
          if (!bytes) throw new Error("Байты GLB отсутствуют в памяти.");
          next.loading = true;
          void this.decoder(bytes).then(content => {
            // Keep imported materials when there is no explicit domain slot assignment.
            if (materials.length && this.objects.get(node.id) === next && !this.closed) replaceMaterials(content, materials, (value, geometry) => this.makeMaterial(value, geometry, node.name, true), material => this.textures.release(material));
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
        content = new T.Mesh(geometry);
        this.projection.applyMesh(content, this.nodeMaterials.get(nodeId)?.textureMappings?.baseColor);
        content.material = this.makeMaterial(this.nodeMaterials.get(nodeId), content.geometry, nodeId);
      }
      if (entry.content) { this.surfaces.release(entry.content); this.disposeContent(entry.content); delete entry.content; }
      if (content) { entry.object.add(content); entry.content = content; this.surfaces.register(nodeId, entry.object, content); }
      else geometry.dispose();
      this.derived.add(nodeId);
      this.setModifierDiagnostics(nodeId, this.nodeMaterials.get(nodeId)?.textureSlots?.baseColor && !content?.geometry.getAttribute("uv")
        ? [...diagnostics, "у результата модификатора нет UV; текстура основного цвета не отображается."] : diagnostics);
    } catch (error) { if (content) this.disposeContent(content); else geometry.dispose(); throw error; }
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
  private emit(): void { if (this.closed) return; this.report({ loading: [...this.objects.values()].filter(e => e.loading).length,
    errors: [...this.objects.values()].filter(e => e.error).length,
    empty: ![...this.objects.values()].some(e => e.content || e.loading), diagnostics: [...new Set([...this.diagnostics, ...this.textures.diagnostics(), ...this.surfaces.diagnostics, ...[...this.modifierDiagnostics.values()].flat(), ...[...this.objects.values()].flatMap(e => e.error ? [e.error] : [])])] }); }
  private remove(entry: Entry): void { if (entry.content) { this.surfaces.release(entry.content); this.disposeContent(entry.content); } entry.object.removeFromParent(); entry.object.clear(); }
  private clear(): void { for (const entry of this.objects.values()) this.remove(entry); this.objects.clear(); this.derived.clear(); this.modifierDiagnostics.clear(); this.nodeMaterials.clear(); this.surfaces.clear(); }
  dispose(): void { if (this.closed) return; this.closed = true; this.clear(); this.textures.dispose(); this.surfaces.dispose(); this.lights.clear(); this.scene.clear(); }
}

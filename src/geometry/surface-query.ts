import * as T from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { GenerateMeshBVHWorker } from "three-mesh-bvh/worker";

/** Initial engineering heuristic, not a measured performance boundary. */
export const DEFAULT_WORKER_TRIANGLES = 20_000;
const MAX_TRIANGLES = 2_000_000;
type IndexedGeometry = T.BufferGeometry & { boundsTree?: MeshBVH };
type WorkerLike = Pick<GenerateMeshBVHWorker, "generate" | "dispose">;
type Record = { geometry: IndexedGeometry; meshes: Set<T.Mesh>; state: "queued" | "building" | "ready" | "failed"; valid: boolean; generation: number };
type Owner = { nodeId: string; wrapper: T.Object3D };

/** Coordinates: pointLocal/normalLocal are in Mesh geometry space; pointNodeLocal is in the
 * domain node wrapper's space; pointWorld/normalWorld are in scene world space. */
export type SurfaceHit = {
  nodeId: string; mesh: T.Mesh; pointWorld: T.Vector3; pointLocal: T.Vector3;
  pointNodeLocal: T.Vector3; normalWorld: T.Vector3; normalLocal: T.Vector3;
  distance: number; faceIndex?: number; uv?: T.Vector2;
};

function finite(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false;
  return true;
}

function shapeValid(geometry: T.BufferGeometry): boolean {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize < 3 || position.count < 3 || position.count % 3 !== 0 && !geometry.index) return false;
  const index = geometry.index;
  const triangles = (index ? index.count : position.count) / 3;
  return Number.isInteger(triangles) && triangles >= 1 && triangles <= MAX_TRIANGLES;
}

function suitable(geometry: T.BufferGeometry): boolean {
  if (!shapeValid(geometry)) return false;
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  for (let i = 0; i < position.count; i++) {
    if (![position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)) return false;
  }
  if (index) for (let i = 0; i < index.count; i++) {
    const n = index.getX(i);
    if (!Number.isInteger(n) || n < 0 || n >= position.count) return false;
  }
  return true;
}

async function workerCopy(geometry: T.BufferGeometry, current: () => boolean): Promise<T.BufferGeometry> {
  // GenerateMeshBVHWorker transfers these arrays. Clone them, never live renderer buffers.
  const copy = new T.BufferGeometry();
  const source = geometry.getAttribute("position");
  const positions = new Float32Array(source.count * 3);
  for (let i = 0; i < source.count; i++) {
    const x = source.getX(i), y = source.getY(i), z = source.getZ(i);
    if (![x, y, z].every(Number.isFinite)) throw new Error("Invalid vertex position");
    positions.set([x, y, z], i * 3);
    if (i % 8192 === 8191) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (!current()) throw new Error("Stale geometry"); }
  }
  copy.setAttribute("position", new T.BufferAttribute(positions, 3));
  if (geometry.index) {
    const values = new Uint32Array(geometry.index.count);
    for (let i = 0; i < values.length; i++) {
      const value = geometry.index.getX(i);
      if (!Number.isInteger(value) || value < 0 || value >= source.count) throw new Error("Invalid triangle index");
      values[i] = value;
      if (i % 24576 === 24575) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (!current()) throw new Error("Stale geometry"); }
    }
    copy.setIndex(new T.BufferAttribute(values, 1));
  }
  for (const group of geometry.groups) copy.addGroup(group.start, group.count, group.materialIndex);
  return copy;
}

export class SurfaceQuery {
  private warnings = new Map<Record, string>();
  get diagnostics(): string[] { return [...this.warnings.values()]; }
  private owners = new Map<T.Mesh, Owner>();
  private records = new Map<T.BufferGeometry, Record>();
  private queue: Record[] = [];
  private worker: WorkerLike | undefined;
  private active = false;
  private closed = false;
  private generation = 0;
  constructor(private workerTriangles = DEFAULT_WORKER_TRIANGLES,
    private makeWorker: () => WorkerLike = () => new GenerateMeshBVHWorker(), private onDiagnostic: () => void = () => {}) {}

  private note(record: Record, message: string): void {
    const nodeId = this.owners.get(record.meshes.values().next().value as T.Mesh)?.nodeId ?? "?";
    this.warnings.set(record, `${nodeId}: ${message}`);
    this.onDiagnostic();
  }

  register(nodeId: string, wrapper: T.Object3D, content: T.Object3D): void {
    if (this.closed) return;
    content.traverse(object => {
      if (!(object instanceof T.Mesh) || object instanceof T.SkinnedMesh || object.morphTargetInfluences?.length || !(object.geometry instanceof T.BufferGeometry)) return;
      const mesh = object;
      this.owners.set(mesh, { nodeId, wrapper });
      const geometry = mesh.geometry as IndexedGeometry;
      let record = this.records.get(geometry);
      if (!record) {
        const heavy = (geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0) / 3 >= this.workerTriangles && typeof Worker !== "undefined";
        record = { geometry, meshes: new Set(), state: "queued", valid: heavy ? false : suitable(geometry), generation: this.generation };
        this.records.set(geometry, record);
        record.meshes.add(mesh);
        if (heavy && shapeValid(geometry)) {
          this.queue.push(record); this.pump();
        } else if (!record.valid) { record.state = "failed"; this.note(record, "Некорректная треугольная геометрия; выбор поверхности отключён."); }
        else {
          try { geometry.boundsTree = new MeshBVH(geometry, { indirect: true }); record.state = "ready"; }
          catch { record.state = "failed"; this.note(record, "BVH не построен; используется обычный выбор поверхности."); }
        }
      }
      record.meshes.add(mesh);
      if (record.state === "ready") mesh.raycast = acceleratedRaycast;
    });
  }

  release(content: T.Object3D): void {
    content.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      this.owners.delete(object);
      const geometry = object.geometry as IndexedGeometry;
      const record = this.records.get(geometry);
      if (!record) return;
      record.meshes.delete(object);
      if (record.meshes.size === 0) {
        const building = record.state === "building";
        record.generation = -1;
        delete geometry.boundsTree;
        this.records.delete(geometry);
        this.warnings.delete(record);
        this.queue = this.queue.filter(item => item !== record);
        if (building) {
          this.generation++;
          for (const remaining of this.records.values()) remaining.generation = this.generation;
          this.worker?.dispose(); this.worker = undefined; this.active = false; this.pump();
        }
      }
    });
  }

  private pump(): void {
    if (this.active || this.closed) return;
    const record = this.queue.shift();
    if (!record) return;
    this.active = true; record.state = "building";
    const generation = this.generation;
    void this.build(record, generation);
  }

  private async build(record: Record, generation: number): Promise<void> {
    let copy: T.BufferGeometry | undefined;
    const current = () => !this.closed && generation === this.generation && record.generation === generation && this.records.get(record.geometry) === record;
    try {
      copy = await workerCopy(record.geometry, current);
      if (!current()) return;
      record.valid = true; // Standard raycast remains available while the Worker builds.
      this.worker ??= this.makeWorker();
      const bvh = await this.worker.generate(copy, { indirect: true });
      if (!current()) return;
      const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false });
      // Indirect mode preserves triangle ordering. The worker may add an identity index
      // for non-indexed geometry; mirror it only when needed by BVH traversal.
      if (!record.geometry.index && serialized.index) record.geometry.setIndex(new T.BufferAttribute(serialized.index.slice(), 1));
      record.geometry.boundsTree = MeshBVH.deserialize(serialized, record.geometry, { setIndex: false });
      record.state = "ready";
      for (const mesh of record.meshes) mesh.raycast = acceleratedRaycast;
    } catch {
      if (current()) { record.state = "failed"; this.note(record, record.valid
        ? "BVH не построен; используется обычный выбор поверхности."
        : "Некорректная треугольная геометрия; выбор поверхности отключён.");
        this.worker?.dispose(); this.worker = undefined; }
    } finally {
      copy?.dispose();
      if (generation === this.generation) { this.active = false; this.pump(); }
    }
  }

  nearest(ray: T.Ray, near = 0, far = Infinity): SurfaceHit | null {
    if (this.closed || !finite(ray.origin.toArray()) || !finite(ray.direction.toArray()) || ray.direction.lengthSq() < 1e-20) return null;
    const caster = new T.Raycaster(ray.origin, ray.direction.clone().normalize(), near, far) as T.Raycaster & { firstHitOnly?: boolean };
    caster.firstHitOnly = true;
    let best: SurfaceHit | null = null;
    for (const [mesh, owner] of this.owners) {
      let parent: T.Object3D | null = mesh;
      let visible = true; let owned = false;
      while (parent) { if (!parent.visible) { visible = false; break; } if (parent === owner.wrapper) owned = true; parent = parent.parent; }
      if (!visible || !owned || !this.records.get(mesh.geometry)?.valid) continue;
      mesh.updateWorldMatrix(true, false);
      owner.wrapper.updateWorldMatrix(true, false);
      const determinant = mesh.matrixWorld.determinant();
      const nodeDeterminant = owner.wrapper.matrixWorld.determinant();
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12 || !Number.isFinite(nodeDeterminant) || Math.abs(nodeDeterminant) < 1e-12) continue;
      const intersections: T.Intersection[] = [];
      try { mesh.raycast(caster, intersections); } catch { continue; }
      for (const hit of intersections) {
        if (!Number.isFinite(hit.distance) || hit.distance < near || hit.distance > far || best && hit.distance >= best.distance) continue;
        const local = hit.point.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
        const nodeLocal = hit.point.clone().applyMatrix4(owner.wrapper.matrixWorld.clone().invert());
        const faceIndex = hit.faceIndex ?? undefined;
        if (faceIndex === undefined) continue;
        const position = mesh.geometry.getAttribute("position");
        const index = mesh.geometry.index;
        const a = index ? index.getX(faceIndex * 3) : faceIndex * 3;
        const b = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
        const c = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;
        if ([a, b, c].some(n => n >= position.count)) continue;
        const va = new T.Vector3().fromBufferAttribute(position, a);
        const vb = new T.Vector3().fromBufferAttribute(position, b);
        const vc = new T.Vector3().fromBufferAttribute(position, c);
        const normalLocal = vb.sub(va).cross(vc.sub(va)).normalize();
        const normalWorld = normalLocal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
        if (!finite([...local.toArray(), ...nodeLocal.toArray(), ...normalWorld.toArray()]) || normalLocal.lengthSq() < 0.5) continue;
        const uv = mesh.geometry.getAttribute("uv") && hit.uv ? hit.uv.clone() : undefined;
        best = { nodeId: owner.nodeId, mesh, pointWorld: hit.point.clone(), pointLocal: local, pointNodeLocal: nodeLocal,
          normalLocal, normalWorld, distance: hit.distance, faceIndex, ...(uv && finite(uv.toArray()) ? { uv } : {}) };
      }
    }
    return best;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true; this.clear();
  }

  clear(): void {
    this.generation++;
    for (const record of this.records.values()) delete record.geometry.boundsTree;
    this.records.clear(); this.owners.clear(); this.queue = [];
    this.warnings.clear();
    this.worker?.dispose(); this.worker = undefined;
    this.active = false;
  }
}

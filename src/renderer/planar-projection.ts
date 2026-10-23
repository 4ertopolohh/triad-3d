import * as T from "three";
import type { BaseColorProjection } from "../domain/types";

/** Local coordinates, fixed orientation: X => Z/Y, Y => X/Z, Z => X/Y. */
export function planarUv(positions: ArrayLike<number>, projection: Extract<BaseColorProjection, { mode: "planar" }>): Float32Array {
  const result = new Float32Array(positions.length / 3 * 2);
  const [uAxis, vAxis] = projection.axis === "x" ? [2, 1] : projection.axis === "y" ? [0, 2] : [0, 1];
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    result[j] = positions[i + uAxis]! * projection.tiling[0] + projection.offset[0];
    result[j + 1] = positions[i + vAxis]! * projection.tiling[1] + projection.offset[1];
  }
  return result;
}

/** Triangle order is retained; each render corner carries its original vertex index. */
export function boxGeometry(source: T.BufferGeometry, projection: Extract<BaseColorProjection, { mode: "box" }>): T.BufferGeometry {
  const position = source.getAttribute("position");
  const index = source.getIndex();
  const corners = index?.count ?? position?.count ?? 0;
  const bytesPerCorner = Object.values(source.attributes).reduce((sum, attribute) => sum + attribute.itemSize * 4, 12) + 8;
  if (!position || position.itemSize < 3 || !corners || corners % 3 || corners * bytesPerCorner > 64 * 1024 * 1024)
    throw new Error("Box: геометрия некорректна или превышает лимит временной памяти.");
  if (projection.tiling.length !== 2 || projection.offset.length !== 2 || projection.tiling.some(value => !Number.isFinite(value) || value <= 0 || value > 1024)
    || projection.offset.some(value => !Number.isFinite(value) || Math.abs(value) > 100000)) throw new Error("Box: некорректные параметры проекции.");
  const mapping = new Uint32Array(corners);
  for (let i = 0; i < corners; i++) {
    const vertex = index ? index.getX(i) : i;
    if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= position.count) throw new Error("Box: индекс вершины вне диапазона.");
    mapping[i] = vertex;
  }
  const geometry = index ? source.toNonIndexed() : source.clone();
  try {
    const points = geometry.getAttribute("position");
    const uv = new Float32Array(corners * 2);
    for (let i = 0; i < corners; i += 3) {
      const a = new T.Vector3().fromBufferAttribute(points, i);
      const b = new T.Vector3().fromBufferAttribute(points, i + 1);
      const c = new T.Vector3().fromBufferAttribute(points, i + 2);
      if (![...a, ...b, ...c].every(Number.isFinite)) throw new Error("Box: координаты должны быть конечными.");
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      if (!Number.isFinite(normal.lengthSq()) || normal.lengthSq() < 1e-20) throw new Error("Box: вырожденный треугольник.");
      const abs = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
      const axis = abs[0]! >= abs[1]! && abs[0]! >= abs[2]! ? 0 : abs[1]! >= abs[2]! ? 1 : 2;
      const sign = normal.getComponent(axis) >= 0 ? 1 : -1;
      for (let corner = 0; corner < 3; corner++) {
        const point = [a, b, c][corner]!;
        const u = axis === 0 ? -sign * point.z : axis === 1 ? point.x : sign * point.x;
        const v = axis === 0 ? point.y : axis === 1 ? -sign * point.z : point.y;
        const x = u * projection.tiling[0] + projection.offset[0];
        const y = v * projection.tiling[1] + projection.offset[1];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(Math.fround(x)) || !Number.isFinite(Math.fround(y))) throw new Error("Box: UV выходят за диапазон Float32.");
        uv[2 * (i + corner)] = x; uv[2 * (i + corner) + 1] = y;
      }
    }
    geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
    geometry.userData.sourceVertexIndices = mapping;
    return geometry;
  } catch (error) { geometry.dispose(); throw error; }
}

/** Geometry belongs to SceneSync. Keep authored UV for exact Planar -> UV restoration. */
export class ProjectionGeometry {
  private authored = new WeakMap<T.BufferGeometry, T.BufferAttribute | T.InterleavedBufferAttribute | undefined>();
  private originals = new WeakMap<T.Mesh, T.BufferGeometry>();
  private applied = new WeakMap<T.Mesh, string>();
  needsUpdate(mesh: T.Mesh, projection?: BaseColorProjection): boolean { return this.applied.get(mesh) !== JSON.stringify(projection ?? { mode: "uv" }); }
  replacesGeometry(mesh: T.Mesh, projection?: BaseColorProjection): boolean { return projection?.mode === "box" || this.originals.has(mesh); }
  /** Returns true when the render geometry identity changed. A failed build leaves the mesh intact. */
  applyMesh(mesh: T.Mesh, projection?: BaseColorProjection): boolean {
    if (!this.needsUpdate(mesh, projection)) return false;
    const key = JSON.stringify(projection ?? { mode: "uv" });
    const original = this.originals.get(mesh) ?? mesh.geometry;
    if (projection?.mode === "box") {
      const next = boxGeometry(original, projection);
      if (!this.originals.has(mesh)) this.originals.set(mesh, original);
      const previous = mesh.geometry;
      mesh.geometry = next;
      if (previous !== original) previous.dispose();
      this.applied.set(mesh, key);
      return true;
    }
    this.apply(original, projection);
    this.applied.set(mesh, key);
    if (mesh.geometry === original) return false;
    mesh.geometry.dispose(); mesh.geometry = original;
    return true;
  }
  releaseMesh(mesh: T.Mesh): void {
    const original = this.originals.get(mesh);
    if (original && original !== mesh.geometry) original.dispose();
    this.originals.delete(mesh);
    this.applied.delete(mesh);
  }
  apply(geometry: T.BufferGeometry, projection?: BaseColorProjection): void {
    if (!this.authored.has(geometry)) this.authored.set(geometry, geometry.getAttribute("uv"));
    const original = this.authored.get(geometry);
    if (projection?.mode === "planar") {
      const position = geometry.getAttribute("position");
      if (!position) return;
      const positions = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        positions[3 * i] = position.getX(i);
        positions[3 * i + 1] = position.getY(i);
        positions[3 * i + 2] = position.getZ(i);
      }
      geometry.setAttribute("uv", new T.BufferAttribute(planarUv(positions, projection), 2));
    } else if (original) geometry.setAttribute("uv", original);
    else geometry.deleteAttribute("uv");
  }
}

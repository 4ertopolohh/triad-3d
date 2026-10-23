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

/** Geometry belongs to SceneSync. Keep authored UV for exact Planar -> UV restoration. */
export class ProjectionGeometry {
  private authored = new WeakMap<T.BufferGeometry, T.BufferAttribute | T.InterleavedBufferAttribute | undefined>();
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

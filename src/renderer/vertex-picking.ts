import * as T from "three";
import type { SurfaceHit } from "../geometry/surface-query";
import { vertexKey } from "../geometry/vertex-selection";

export function pickEditableVertex(hit: SurfaceHit, source: { readonly positions: readonly number[] }, camera: T.Camera,
  clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">, tolerance = 12): number | null {
  const geometry = hit.mesh.geometry;
  const positions = geometry.getAttribute("position");
  const index = geometry.index;
  const sourceIndices = geometry.userData.sourceVertexIndices as Uint32Array | undefined;
  const face = hit.faceIndex;
  if (!positions || face === undefined || rect.width <= 0 || rect.height <= 0) return null;
  const representatives = new Map<string, number>();
  for (let i = 0; i < source.positions.length / 3; i++) {
    const key = vertexKey(source.positions, i);
    if (!representatives.has(key)) representatives.set(key, i);
  }
  hit.mesh.updateWorldMatrix(true, false);
  let best: number | null = null;
  let distance = tolerance * tolerance;
  for (let corner = 0; corner < 3; corner++) {
    const renderIndex = index ? index.getX(face * 3 + corner) : face * 3 + corner;
    const sourceIndex = sourceIndices?.[renderIndex] ?? renderIndex;
    if (!Number.isSafeInteger(renderIndex) || renderIndex < 0 || renderIndex >= positions.count || sourceIndex >= source.positions.length / 3) continue;
    const point = new T.Vector3().fromBufferAttribute(positions, renderIndex).applyMatrix4(hit.mesh.matrixWorld).project(camera);
    if (point.z < -1 || point.z > 1) continue;
    const x = rect.left + (point.x + 1) * rect.width / 2;
    const y = rect.top + (1 - point.y) * rect.height / 2;
    const squared = (x - clientX) ** 2 + (y - clientY) ** 2;
    if (squared <= distance) { distance = squared; best = representatives.get(vertexKey(source.positions, sourceIndex)) ?? null; }
  }
  return best;
}

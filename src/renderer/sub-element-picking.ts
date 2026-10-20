import * as T from "three";
import type { SurfaceHit } from "../geometry/surface-query";
import type { MeshTopology } from "../geometry/mesh-topology";
type EditableMeshSource = { readonly positions: readonly number[] };

/** Eight CSS pixels from a front surface segment; the surface hit prevents picking occluded objects. */
export const EDGE_PICK_TOLERANCE = 8;

export function pickEditableEdge(hit: SurfaceHit, source: EditableMeshSource, topology: MeshTopology, camera: T.Camera,
  clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">): string | null {
  if (hit.faceIndex === undefined || rect.width <= 0 || rect.height <= 0) return null;
  hit.mesh.updateWorldMatrix(true, false);
  const project = (index: number) => {
    const point = new T.Vector3(...source.positions.slice(index * 3, index * 3 + 3) as [number, number, number]);
    point.applyMatrix4(hit.mesh.matrixWorld).project(camera);
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2, z: point.z };
  };
  let best: string | null = null, distance = EDGE_PICK_TOLERANCE ** 2;
  for (const edge of topology.edges) {
    if (!edge.triangles.includes(hit.faceIndex)) continue;
    const a = project(edge.vertices[0]), b = project(edge.vertices[1]);
    if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((clientX - a.x) * dx + (clientY - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const squared = (clientX - a.x - t * dx) ** 2 + (clientY - a.y - t * dy) ** 2;
    if (squared <= distance) { distance = squared; best = edge.id; }
  }
  return best;
}

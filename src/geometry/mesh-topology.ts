type EditableMeshSource = { readonly kind: "editable"; readonly positions: readonly number[]; readonly indices: readonly number[]; readonly uv?: readonly number[] };
import { vertexKey } from "./vertex-selection";

export type TopologyEdge = { id: string; vertices: readonly [number, number]; triangles: readonly number[] };
export type TopologyFace = { id: number; triangles: readonly number[]; vertices: readonly number[] };
export type MeshTopology = { edges: readonly TopologyEdge[]; faces: readonly TopologyFace[]; triangleFace: readonly number[] };

/** Face tolerance allows Float32 quantization, but rejects visibly bent surfaces. */
export const FACE_NORMAL_DOT = 0.999999;
const PLANE_TOLERANCE = 2e-6;
export const MAX_TOPOLOGY_TRIANGLES = 100_000;
const cache = new WeakMap<object, MeshTopology | null>();

export function buildMeshTopology(source: EditableMeshSource): MeshTopology | null {
  if (Object.isFrozen(source) && cache.has(source)) return cache.get(source)!;
  const { positions, indices } = source;
  if (positions.length % 3 || indices.length % 3 || !indices.length || indices.length / 3 > MAX_TOPOLOGY_TRIANGLES ||
    positions.some(value => !Number.isFinite(value)) ||
    indices.some(value => !Number.isSafeInteger(value) || value < 0 || value >= positions.length / 3)) return null;
  const representatives = new Map<string, number>();
  const canonical = Array.from({ length: positions.length / 3 }, (_, index) => {
    const key = vertexKey(positions, index);
    if (!representatives.has(key)) representatives.set(key, index);
    return representatives.get(key)!;
  });
  const edgeTriangles = new Map<string, { vertices: [number, number]; triangles: number[] }>();
  const normals: number[][] = [];
  const points: number[][] = [];
  const corners: number[][] = [];
  const point = (index: number) => positions.slice(index * 3, index * 3 + 3);
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    const render = indices.slice(triangle * 3, triangle * 3 + 3);
    const vertices = render.map(index => canonical[index]!);
    if (new Set(vertices).size !== 3) return null;
    const a = point(render[0]!), b = point(render[1]!), c = point(render[2]!);
    const u = b.map((value, axis) => value - a[axis]!);
    const v = c.map((value, axis) => value - a[axis]!);
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const length = Math.hypot(...cross);
    if (!Number.isFinite(length) || length <= 1e-12) return null;
    normals.push(cross.map(value => value / length)); points.push(a); corners.push(vertices);
    for (let edge = 0; edge < 3; edge++) {
      const pair = [vertices[edge]!, vertices[(edge + 1) % 3]!].sort((x, y) => x - y) as [number, number];
      const id = `${pair[0]}:${pair[1]}`;
      const entry = edgeTriangles.get(id) ?? { vertices: pair, triangles: [] };
      entry.triangles.push(triangle); edgeTriangles.set(id, entry);
    }
  }
  const edges = [...edgeTriangles].sort((a, b) => a[1].vertices[0] - b[1].vertices[0] || a[1].vertices[1] - b[1].vertices[1])
    .map(([id, value]) => ({ id, vertices: value.vertices, triangles: value.triangles }));
  const neighbors = Array.from({ length: corners.length }, () => new Set<number>());
  // A non-manifold edge has no unambiguous face continuation.
  for (const edge of edges) if (edge.triangles.length === 2) {
    const [a, b] = edge.triangles;
    neighbors[a!]!.add(b!); neighbors[b!]!.add(a!);
  }
  const triangleFace = Array<number>(corners.length).fill(-1);
  const faces: TopologyFace[] = [];
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, axis) => sum + value * b[axis]!, 0);
  for (let seed = 0; seed < corners.length; seed++) {
    if (triangleFace[seed] !== -1) continue;
    const stack = [seed], region: number[] = [], reference = normals[seed]!, origin = points[seed]!;
    triangleFace[seed] = seed;
    while (stack.length) {
      const current = stack.pop()!; region.push(current);
      for (const candidate of neighbors[current]!) {
        if (triangleFace[candidate] !== -1 || dot(reference, normals[candidate]!) < FACE_NORMAL_DOT) continue;
        if (corners[candidate]!.some(index => Math.abs(dot(reference, point(index).map((value, axis) => value - origin[axis]!))) > PLANE_TOLERANCE)) continue;
        triangleFace[candidate] = seed; stack.push(candidate);
      }
    }
    region.sort((a, b) => a - b);
    faces.push({ id: seed, triangles: region, vertices: [...new Set(region.flatMap(index => corners[index]!))].sort((a, b) => a - b) });
  }
  const topology = { edges, faces, triangleFace };
  if (Object.isFrozen(source)) cache.set(source, topology);
  return topology;
}

export function selectedTopologyVertices(topology: MeshTopology, mode: "edge" | "face", ids: readonly string[] | readonly number[]): number[] | null {
  const byId = new Map<string | number, readonly number[]>(mode === "edge" ? topology.edges.map(element => [element.id, element.vertices]) : topology.faces.map(element => [element.id, element.vertices]));
  const vertices = new Set<number>();
  for (const id of ids) {
    const found = byId.get(id);
    if (!found) return null;
    for (const vertex of found) vertices.add(vertex);
  }
  return [...vertices].sort((a, b) => a - b);
}

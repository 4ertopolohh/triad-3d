import { MAX_CSG_INPUT_BYTES, manifoldModule, validateMesh } from "../csg/core";
import { CsgError, type MeshData } from "../csg/types";
import { buildMeshTopology } from "../mesh-topology";
import { vertexKey } from "../vertex-selection";
import type { BevelParameters } from "./types";

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const point = (mesh: MeshData, index: number): Vec => [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw new CsgError("JOB_CANCELLED", "Вычисление фаски отменено."); };
const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function parseBevelParameters(value: unknown): BevelParameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BevelError("INVALID_MODIFIER", "Параметры Bevel должны быть объектом.");
  const p = value as Record<string, unknown>;
  const keys = Object.keys(p);
  if (!keys.includes("width") || keys.some(key => key !== "width" && key !== "angleDegrees") ||
    typeof p.width !== "number" || !Number.isFinite(p.width) || p.width < 0 || !Number.isFinite(Math.fround(p.width)) || (p.width > 0 && Math.fround(p.width) === 0) ||
    ("angleDegrees" in p && (typeof p.angleDegrees !== "number" || !Number.isFinite(p.angleDegrees) || p.angleDegrees < 0 || p.angleDegrees > 180)))
    throw new BevelError("INVALID_MODIFIER", "Bevel требует конечную неотрицательную width и angleDegrees от 0 до 180 без лишних полей.");
  return "angleDegrees" in p ? { width: p.width, angleDegrees: p.angleDegrees as number } : { width: p.width };
}

export class BevelError extends Error {
  constructor(readonly code: "INVALID_MODIFIER" | "GEOMETRY_NON_MANIFOLD" | "GEOMETRY_DEGENERATE" | "BEVEL_WIDTH_TOO_LARGE" | "RESOURCE_TOO_LARGE" | "JOB_CANCELLED" | "WORKER_FAILED", message: string) { super(message); }
}

/** Single flat chamfer of sharp edges on a positively oriented convex solid. */
export async function evaluateBevel(mesh: MeshData, params: BevelParameters, signal?: AbortSignal): Promise<MeshData> {
  check(signal);
  params = parseBevelParameters(params);
  validateMesh(mesh);
  if (params.width === 0) return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
  // The topology routine groups coincident render vertices, including UV seams.
  // Keep the cut count small because each trim is a synchronous WASM operation.
  if (mesh.indices.length / 3 > 4096) throw new BevelError("RESOURCE_TOO_LARGE", "Bevel ограничен 4096 входными треугольниками.");
  const sourcePositions = Array.from(mesh.positions);
  const topology = buildMeshTopology({ kind: "editable", positions: sourcePositions, indices: Array.from(mesh.indices) });
  if (!topology || topology.edges.some(edge => edge.triangles.length !== 2))
    throw new BevelError("GEOMETRY_NON_MANIFOLD", "Bevel требует замкнутую manifold-сетку.");
  const representatives = new Map<string, number>();
  const canonical = Array.from({ length: mesh.positions.length / 3 }, (_, i) => {
    const key = vertexKey(sourcePositions, i);
    if (!representatives.has(key)) representatives.set(key, i);
    return representatives.get(key)!;
  });
  const normals: Vec[] = [];
  const edgesById = new Map(topology.edges.map(edge => [edge.id, edge]));
  const vertices = [...representatives.values()].map(i => point(mesh, i));
  const mins: Vec = [Infinity, Infinity, Infinity], maxs: Vec = [-Infinity, -Infinity, -Infinity];
  for (const p of vertices) for (let k = 0; k < 3; k++) { mins[k] = Math.min(mins[k]!, p[k]!); maxs[k] = Math.max(maxs[k]!, p[k]!); }
  const span = Math.hypot(maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]);
  const magnitude = Math.max(...mins.map(Math.abs), ...maxs.map(Math.abs));
  if (!(span > 1e-4) || !Number.isFinite(span) || params.width < Math.max(span * 1e-6, magnitude * 1e-7))
    throw new BevelError("GEOMETRY_DEGENERATE", "Ширина фаски численно неразличима с размером или положением сетки.");
  const tolerance = Math.max(span * 1e-6, magnitude * 1e-7);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = point(mesh, mesh.indices[t]!), b = point(mesh, mesh.indices[t + 1]!), c = point(mesh, mesh.indices[t + 2]!);
    const raw = cross(minus(b, a), minus(c, a)), length = Math.hypot(...raw);
    if (!(length > tolerance * tolerance)) throw new BevelError("GEOMETRY_DEGENERATE", "Вход содержит слишком маленький треугольник.");
    normals.push(raw.map(n => n / length) as Vec);
  }
  // Each edge must occur once in each direction after seam welding.
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [canonical[mesh.indices[t]!]!, canonical[mesh.indices[t + 1]!]!, canonical[mesh.indices[t + 2]!]!];
    for (let e = 0; e < 3; e++) {
      const from = tri[e]!, to = tri[(e + 1) % 3]!;
      const edge = edgesById.get(`${Math.min(from, to)}:${Math.max(from, to)}`);
      if (!edge || edge.triangles.length !== 2) throw new BevelError("GEOMETRY_NON_MANIFOLD", "Нарушена смежность рёбер.");
      const other = edge.triangles.find(candidate => candidate !== t / 3)!;
      const at = other * 3, opposite = [canonical[mesh.indices[at]!]!, canonical[mesh.indices[at + 1]!]!, canonical[mesh.indices[at + 2]!]!];
      if (!opposite.some((v, i) => v === to && opposite[(i + 1) % 3] === from))
        throw new BevelError("GEOMETRY_NON_MANIFOLD", "Треугольники имеют противоречивую ориентацию.");
    }
  }
  for (const face of topology.faces) {
    const tri = face.triangles[0]!, normal = normals[tri]!, origin = point(mesh, mesh.indices[tri * 3]!);
    if (vertices.some(vertex => dot(normal, minus(vertex, origin)) > tolerance))
      throw new BevelError("GEOMETRY_NON_MANIFOLD", "Bevel поддерживает только выпуклое тело с наружной ориентацией граней.");
  }
  const cuts: { normal: Vec; offset: number }[] = [];
  let minimumEdge = Infinity;
  for (const edge of topology.edges) {
    const [u, v] = edge.vertices;
    const length = Math.hypot(...minus(point(mesh, u), point(mesh, v)));
    minimumEdge = Math.min(minimumEdge, length);
    const a = normals[edge.triangles[0]!]!, b = normals[edge.triangles[1]!]!;
    const cosine = Math.max(-1, Math.min(1, dot(a, b)));
    if (cosine > Math.cos((params.angleDegrees ?? 30) * Math.PI / 180) - 1e-8) continue;
    const sum: Vec = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const norm = Math.hypot(...sum);
    if (norm < 1e-5) throw new BevelError("GEOMETRY_NON_MANIFOLD", "Непригодный угол смежных граней.");
    const outward = sum.map(value => value / norm) as Vec;
    // On either adjacent face the cut intercept is width from the original edge.
    const offset = dot(outward, point(mesh, u)) - params.width * Math.sqrt(1 - cosine * cosine) / norm;
    cuts.push({ normal: outward.map(value => -value) as Vec, offset: -offset });
  }
  if (params.width >= minimumEdge / 2) throw new BevelError("BEVEL_WIDTH_TOO_LARGE", "Ширина фаски слишком велика относительно рёбер тела.");
  if (cuts.length > 256) throw new BevelError("RESOURCE_TOO_LARGE", "Bevel ограничен 256 срезами.");
  check(signal);
  const api = await manifoldModule();
  check(signal);
  const owned = new Set<InstanceType<typeof api.Manifold>>();
  try {
    const input = new api.Mesh({ numProp: 3, vertProperties: mesh.positions.slice(), triVerts: mesh.indices.slice() });
    input.merge();
    let solid = new api.Manifold(input);
    owned.add(solid);
    if (solid.status() !== "NoError" || solid.isEmpty()) throw new BevelError("GEOMETRY_NON_MANIFOLD", "Manifold отклонил входную сетку.");
    if (!cuts.length) return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
    const volume = solid.volume();
    for (let i = 0; i < cuts.length; i++) {
      check(signal);
      const cut = cuts[i]!;
      const next = solid.trimByPlane(cut.normal, cut.offset);
      owned.add(next);
      if (next.status() !== "NoError" || next.isEmpty()) throw new BevelError("BEVEL_WIDTH_TOO_LARGE", "Фаска уничтожает тело или нарушает топологию.");
      solid.delete(); owned.delete(solid); solid = next;
      if (next.numVert() * 12 + next.numTri() * 12 > MAX_CSG_INPUT_BYTES)
        throw new BevelError("RESOURCE_TOO_LARGE", "Промежуточные буферы Bevel превышают лимит 64 MiB.");
      await turn(); check(signal);
    }
    if (cuts.length && !(solid.volume() < volume - Math.max(volume * 1e-8, tolerance ** 3)))
      throw new BevelError("BEVEL_WIDTH_TOO_LARGE", "Фаска не создала различимое уменьшение объёма.");
    const result = solid.getMesh();
    if (result.vertProperties.byteLength + result.triVerts.byteLength > MAX_CSG_INPUT_BYTES)
      throw new BevelError("RESOURCE_TOO_LARGE", "Выход Bevel превышает лимит 64 MiB.");
    const output = { positions: new Float32Array(result.vertProperties), indices: new Uint32Array(result.triVerts) };
    validateMesh(output);
    const roundTrip = new api.Mesh({ numProp: 3, vertProperties: output.positions.slice(), triVerts: output.indices.slice() });
    roundTrip.merge();
    const verified = new api.Manifold(roundTrip);
    owned.add(verified);
    if (verified.status() !== "NoError" || verified.isEmpty()) throw new BevelError("GEOMETRY_NON_MANIFOLD", "Выход Bevel не является замкнутым телом после Float32 округления.");
    check(signal);
    return output;
  } catch (error) {
    if (error instanceof BevelError || error instanceof CsgError) throw error;
    if (error instanceof Error && /not manifold|merge vectors wrong length/i.test(error.message))
      throw new BevelError("GEOMETRY_NON_MANIFOLD", "Manifold отклонил топологию сетки.");
    throw new BevelError("WORKER_FAILED", `Ошибка геометрического вычисления Bevel: ${error instanceof Error ? error.message : String(error)}`);
  } finally { for (const item of owned) item.delete(); }
}

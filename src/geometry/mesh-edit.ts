import * as T from "three";
import type { MeshSource, Vec3 } from "../domain/types";
import { primitiveGeometry } from "./primitive-geometry";
import { MAX_CSG_INPUT_BYTES, validateMesh, type MeshData } from "./csg/core";
import { buildMeshTopology, MAX_TOPOLOGY_TRIANGLES } from "./mesh-topology";

export type EditableMeshSource = Extract<MeshSource, { kind: "editable" }>;
type EditableInput = { readonly kind: "editable"; readonly positions: readonly number[]; readonly indices: readonly number[]; readonly uv?: readonly number[] };
type PrimitiveSource = Extract<MeshSource, { kind: "primitive" }>;

/** Absolute coordinate quantization at 1e-6 local units. Keys are never written to the Project. */
export const SEAM_TOLERANCE = 1e-6;
const key = (positions: readonly number[], i: number): string =>
  [0, 1, 2].map(axis => Math.round(positions[3 * i + axis]! / SEAM_TOLERANCE)).join(":");

type Checked = { error: string; mesh?: never } | { error: null; mesh: MeshData };
const invalid = (error: string): Checked => ({ error });

function checkedEditableData(value: unknown): Checked {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Редактируемая сетка должна быть объектом.");
  const source = value as Partial<EditableMeshSource>;
  if (Object.keys(source).some(k => !["kind", "positions", "indices", "uv"].includes(k)) || source.kind !== "editable")
    return invalid("Некорректный тип или поле редактируемой сетки.");
  if (!Array.isArray(source.positions) || !Array.isArray(source.indices) || source.positions.length % 3 || source.indices.length % 3 || !source.indices.length)
    return invalid("Позиции и индексы должны задавать треугольники.");
  if ((source.positions.length + source.indices.length + (Array.isArray(source.uv) ? source.uv.length : 0)) * 4 > MAX_CSG_INPUT_BYTES) return invalid("Сетка превышает лимит 64 MiB.");
  if (source.positions.some(n => typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(Math.fround(n)))) return invalid("Координаты должны быть конечными Float32 числами.");
  if (source.indices.some(n => !Number.isSafeInteger(n) || n < 0 || n >= source.positions!.length / 3 || n > 0xffffffff)) return invalid("Индекс вершины вне диапазона.");
  if (source.uv !== undefined && (!Array.isArray(source.uv) || source.uv.length !== source.positions.length / 3 * 2 || source.uv.some(n => typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(Math.fround(n)))))
    return invalid("UV должны содержать две конечные координаты на render vertex.");
  const mesh = { positions: Float32Array.from(source.positions), indices: Uint32Array.from(source.indices) };
  try { validateMesh(mesh); }
  catch (error) { return invalid(error instanceof Error ? error.message : "Некорректная геометрия."); }
  return { error: null, mesh };
}

export function validateEditableSource(value: unknown): string | null {
  return checkedEditableData(value).error;
}

export function editableMeshData(source: EditableInput) {
  const checked = checkedEditableData(source);
  if (checked.error !== null) throw new Error(checked.error);
  return checked.mesh;
}

export function editableGeometry(source: EditableInput): T.BufferGeometry {
  const data = editableMeshData(source);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(data.positions, 3));
  geometry.setIndex(new T.BufferAttribute(data.indices, 1));
  if (source.uv) geometry.setAttribute("uv", new T.Float32BufferAttribute(source.uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export function convertPrimitiveToEditable(source: PrimitiveSource): EditableMeshSource {
  if (source.primitive === "plane") throw new Error("Плоскость не является замкнутой сеткой для преобразования.");
  const geometry = primitiveGeometry(source);
  try {
    const position = geometry.getAttribute("position");
    const uvAttribute = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    if (!position || position.itemSize !== 3) throw new Error("Примитив не содержит XYZ координат.");
    const result: EditableMeshSource = {
      kind: "editable",
      positions: Array.from({ length: position.count * 3 }, (_, i) => position.getComponent(Math.floor(i / 3), i % 3)),
      indices: index ? Array.from(index.array) : Array.from({ length: position.count }, (_, i) => i),
      ...(uvAttribute ? { uv: Array.from({ length: uvAttribute.count * 2 }, (_, i) => uvAttribute.getComponent(Math.floor(i / 2), i % 2)) } : {}),
    };
    const error = validateEditableSource(result);
    if (error) throw new Error(`Примитив нельзя преобразовать без потерь: ${error}`);
    return result;
  } finally { geometry.dispose(); }
}

/** Selection uses render vertex indices; all vertices with the same quantized local XYZ move together. */
export function translateEditableVertices(source: EditableMeshSource, selected: readonly number[], delta: Vec3): EditableMeshSource {
  const error = validateEditableSource(source);
  if (error) throw new Error(error);
  if (!Array.isArray(selected) || !selected.length || selected.some(i => !Number.isSafeInteger(i) || i < 0 || i >= source.positions.length / 3))
    throw new Error("Выбор содержит несуществующую вершину.");
  if (!Array.isArray(delta) || delta.length !== 3 || delta.some(n => !Number.isFinite(n))) throw new Error("Delta должна содержать три конечных числа.");
  if (delta.every(n => n === 0)) return source;
  const selectedKeys = new Set(selected.map(i => key(source.positions, i)));
  const positions = source.positions.slice();
  for (let i = 0; i < positions.length / 3; i++) {
    if (!selectedKeys.has(key(source.positions, i))) continue;
    for (let axis = 0; axis < 3; axis++) positions[3 * i + axis] = Math.fround(source.positions[3 * i + axis]! + delta[axis]!);
  }
  const result: EditableMeshSource = { ...source, positions };
  const resultError = validateEditableSource(result);
  if (resultError) throw new Error(resultError);
  return result;
}

/** Scale geometric vertices around their shared local centroid; UV seam copies stay coincident. */
export function scaleEditableVertices(source: EditableMeshSource, selected: readonly number[], factors: Vec3): EditableMeshSource {
  const error = validateEditableSource(source);
  if (error) throw new Error(error);
  if (!Array.isArray(selected) || !selected.length || selected.some(i => !Number.isSafeInteger(i) || i < 0 || i >= source.positions.length / 3))
    throw new Error("Выбор содержит несуществующую вершину.");
  if (!Array.isArray(factors) || factors.length !== 3 || factors.some(n => typeof n !== "number" || !Number.isFinite(n)))
    throw new Error("Масштаб должен содержать три конечных числа.");
  if (factors.some(n => n <= 0)) throw new Error("Коэффициенты масштаба должны быть строго положительными.");
  if (factors.every(n => n === 1)) return source;

  const selectedKeys = new Set(selected.map(i => key(source.positions, i)));
  const representatives = new Map<string, number>();
  for (let i = 0; i < source.positions.length / 3; i++) {
    const positionKey = key(source.positions, i);
    if (selectedKeys.has(positionKey) && !representatives.has(positionKey)) representatives.set(positionKey, i);
  }
  if (representatives.size === 1) return source;
  const mean = (axis: number) => {
    let mean = 0;
    for (const i of representatives.values()) mean += source.positions[3 * i + axis]! / representatives.size;
    return mean;
  };
  const center: Vec3 = [mean(0), mean(1), mean(2)];
  const positions = source.positions.slice();
  let changed = false;
  for (let i = 0; i < positions.length / 3; i++) {
    if (!selectedKeys.has(key(source.positions, i))) continue;
    for (let axis = 0; axis < 3; axis++) {
      const before = source.positions[3 * i + axis]!;
      const after = Math.fround(center[axis]! + (before - center[axis]!) * factors[axis]!);
      positions[3 * i + axis] = after;
      if (after !== before) changed = true;
    }
  }
  if (!changed) return source;
  const result: EditableMeshSource = { ...source, positions };
  const resultError = validateEditableSource(result);
  if (resultError) throw new Error(resultError);
  return result;
}

type DirectedEdge = { from: number; to: number; triangle: number; renderFrom: number; renderTo: number };

/** A closed, consistently wound geometric shell is required; UV seam render vertices share a geometric vertex. */
function shellEdges(source: EditableMeshSource) {
  const representatives = new Map<string, number>();
  const canonical = Array.from({ length: source.positions.length / 3 }, (_, i) => {
    const positionKey = key(source.positions, i);
    const existing = representatives.get(positionKey);
    if (existing !== undefined) {
      if ([0, 1, 2].some(axis => source.positions[3 * existing + axis] !== source.positions[3 * i + axis]))
        throw new Error("Неоднозначное совпадение вершин после квантования координат.");
      return existing;
    }
    representatives.set(positionKey, i);
    return i;
  });
  const edges = new Map<string, DirectedEdge[]>();
  const vertexTriangles = new Map<number, Set<number>>();
  for (let triangle = 0; triangle < source.indices.length / 3; triangle++) {
    const render = source.indices.slice(triangle * 3, triangle * 3 + 3);
    const corners = render.map(i => canonical[i]!);
    if (new Set(corners).size !== 3) throw new Error("Треугольник вырожден после объединения UV-швов.");
    for (let side = 0; side < 3; side++) {
      const from = corners[side]!, to = corners[(side + 1) % 3]!;
      const id = from < to ? `${from}:${to}` : `${to}:${from}`;
      const list = edges.get(id) ?? [];
      list.push({ from, to, triangle, renderFrom: render[side]!, renderTo: render[(side + 1) % 3]! });
      edges.set(id, list);
      const incident = vertexTriangles.get(from) ?? new Set<number>(); incident.add(triangle); vertexTriangles.set(from, incident);
    }
  }
  const neighbors = Array.from({ length: source.indices.length / 3 }, () => new Set<number>());
  for (const list of edges.values()) {
    if (list.length !== 2 || list[0]!.from !== list[1]!.to || list[0]!.to !== list[1]!.from)
      throw new Error("Сетка должна быть замкнутой, ориентированной и manifold по каждому ребру.");
    neighbors[list[0]!.triangle]!.add(list[1]!.triangle);
    neighbors[list[1]!.triangle]!.add(list[0]!.triangle);
  }
  const visit = (seed: number, allowed: ReadonlySet<number>) => {
    const reached = new Set([seed]), stack = [seed];
    while (stack.length) for (const next of neighbors[stack.pop()!]!) if (allowed.has(next) && !reached.has(next)) { reached.add(next); stack.push(next); }
    return reached.size === allowed.size;
  };
  const all = new Set(neighbors.map((_, i) => i));
  if (!visit(0, all)) throw new Error("Сетка содержит несвязанные оболочки.");
  for (const incident of vertexTriangles.values()) if (!visit(incident.values().next().value!, incident))
    throw new Error("Вершина имеет несвязные треугольные веера (non-manifold).");
  return { canonical, edges };
}

/** Extrudes one planar face of a closed shell into the outward half-space. */
export function extrudeEditableFace(source: EditableMeshSource, faceId: number, distance: number): EditableMeshSource {
  const error = validateEditableSource(source);
  if (error) throw new Error(error);
  if (typeof distance !== "number" || !Number.isFinite(distance) || !Number.isFinite(Math.fround(distance)))
    throw new Error("Глубина должна быть конечным числом Float32.");
  if (!Number.isSafeInteger(faceId) || faceId < 0) throw new Error("Некорректный идентификатор грани.");
  const topology = buildMeshTopology(source);
  if (!topology) throw new Error("Топология сетки недоступна или превышен предел треугольников.");
  const face = topology.faces.find(item => item.id === faceId);
  if (!face) throw new Error("Выбранная грань не найдена.");
  if (distance === 0) return source;
  if (distance < 1e-6) throw new Error("Глубина должна быть положительной и не меньше 0.000001.");
  const { canonical, edges } = shellEdges(source);
  const selected = new Set(face.triangles);
  const point = (i: number) => new T.Vector3().fromArray(source.positions, 3 * i);
  const first = source.indices.slice(face.triangles[0]! * 3, face.triangles[0]! * 3 + 3);
  const origin = point(first[0]!);
  const normal = point(first[1]!).sub(origin).cross(point(first[2]!).sub(origin)).normalize();
  if (![normal.x, normal.y, normal.z].every(Number.isFinite)) throw new Error("Нормаль грани недопустима.");
  for (const triangle of face.triangles) {
    const render = source.indices.slice(3 * triangle, 3 * triangle + 3);
    const a = point(render[0]!), b = point(render[1]!), c = point(render[2]!);
    if (b.sub(a).cross(c.sub(a)).normalize().dot(normal) < 0.999999 || render.some(i => Math.abs(point(i).sub(origin).dot(normal)) > 2e-6))
      throw new Error("Выбранная грань не является согласованной плоской областью.");
  }
  // The selected face must support the whole shell. Its outward prism then cannot intersect old geometry.
  for (let i = 0; i < canonical.length; i++) if (point(i).sub(origin).dot(normal) > 2e-6)
    throw new Error("В направлении выдавливания есть другая геометрия; грань не является внешней опорной плоскостью.");
  const boundary = [...edges.values()].filter(list => selected.has(list[0]!.triangle) !== selected.has(list[1]!.triangle))
    .map(list => selected.has(list[0]!.triangle) ? list[0]! : list[1]!);
  if (boundary.length < 3 || boundary.length > 4096) throw new Error("Граница грани слишком сложная или отсутствует.");
  const outgoing = new Map<number, DirectedEdge>(), incoming = new Set<number>();
  for (const edge of boundary) {
    if (outgoing.has(edge.from) || incoming.has(edge.to)) throw new Error("Граница грани имеет развилки или отверстия.");
    outgoing.set(edge.from, edge); incoming.add(edge.to);
  }
  const loop: DirectedEdge[] = [], visited = new Set<number>();
  let current = boundary[0]!.from;
  while (!visited.has(current)) {
    visited.add(current);
    const edge = outgoing.get(current);
    if (!edge) throw new Error("Граница грани разомкнута.");
    loop.push(edge); current = edge.to;
  }
  if (current !== boundary[0]!.from || loop.length !== boundary.length) throw new Error("Граница грани содержит отверстие или несколько контуров.");
  // Project to the dominant plane and reject crossing/nonadjacent touching boundary segments.
  const drop = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].indexOf(Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)));
  const xy = (i: number): [number, number] => [source.positions[3 * i + (drop + 1) % 3]!, source.positions[3 * i + (drop + 2) % 3]!];
  const orient = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < loop.length; i++) for (let j = i + 2; j < loop.length; j++) {
    if (i === 0 && j === loop.length - 1) continue;
    const a = xy(loop[i]!.from), b = xy(loop[i]!.to), c = xy(loop[j]!.from), d = xy(loop[j]!.to);
    const s1 = orient(a, b, c), s2 = orient(a, b, d), s3 = orient(c, d, a), s4 = orient(c, d, b);
    if (Math.abs(s1) < 1e-12 || Math.abs(s2) < 1e-12 || Math.abs(s3) < 1e-12 || Math.abs(s4) < 1e-12 || s1 * s2 < 0 && s3 * s4 < 0)
      throw new Error("Граница грани пересекается или касается сама себя.");
  }
  const selectedRender = new Set(face.triangles.flatMap(triangle => source.indices.slice(3 * triangle, 3 * triangle + 3))).size;
  const prospectiveVertices = source.positions.length / 3 + selectedRender + loop.length * 4;
  const prospectiveIndices = source.indices.length + loop.length * 6;
  if ((prospectiveVertices * (source.uv ? 5 : 3) + prospectiveIndices) * 4 > MAX_CSG_INPUT_BYTES)
    throw new Error("Результат превышает лимит 64 MiB.");
  const positions = source.positions.slice(), uv = source.uv?.slice(), indices: number[] = [];
  const add = (i: number, top: boolean, tex?: [number, number]) => {
    const index = positions.length / 3;
    const base = point(i);
    if (top) base.addScaledVector(normal, distance);
    positions.push(Math.fround(base.x), Math.fround(base.y), Math.fround(base.z));
    if (uv) uv.push(...(tex ?? [source.uv![2 * i]!, source.uv![2 * i + 1]!]));
    return index;
  };
  const top = new Map<number, number>();
  for (let triangle = 0; triangle < source.indices.length / 3; triangle++) {
    const render = source.indices.slice(3 * triangle, 3 * triangle + 3);
    if (selected.has(triangle)) indices.push(...render.map(i => {
      let next = top.get(i);
      if (next === undefined) { next = add(i, true); top.set(i, next); }
      return next;
    }));
    else indices.push(...render);
  }
  for (const edge of loop) {
    const length = point(edge.renderFrom).distanceTo(point(edge.renderTo));
    if (length <= 1e-6) throw new Error("Граничное ребро вырождено.");
    const a = add(edge.renderFrom, false, [0, 0]), b = add(edge.renderTo, false, [length, 0]);
    const c = add(edge.renderTo, true, [length, distance]), d = add(edge.renderFrom, true, [0, distance]);
    indices.push(a, b, c, a, c, d);
  }
  if (indices.length / 3 > MAX_TOPOLOGY_TRIANGLES) throw new Error("Результат превышает предел треугольников.");
  // Remove orphaned render vertices from the replaced face.
  const used = [...new Set(indices)].sort((a, b) => a - b);
  const compact = new Map(used.map((old, next) => [old, next]));
  const result: EditableMeshSource = { kind: "editable", positions: used.flatMap(i => positions.slice(3 * i, 3 * i + 3)), indices: indices.map(i => compact.get(i)!),
    ...(uv ? { uv: used.flatMap(i => uv.slice(2 * i, 2 * i + 2)) } : {}) };
  const resultError = validateEditableSource(result);
  if (resultError) throw new Error(resultError);
  const resultTopology = buildMeshTopology(result);
  if (!resultTopology) throw new Error("Результат имеет недопустимую топологию.");
  shellEdges(result);
  return result;
}

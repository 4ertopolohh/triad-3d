import * as T from "three";
import type { MeshSource, Vec3 } from "../domain/types";
import { primitiveGeometry } from "./primitive-geometry";
import { MAX_CSG_INPUT_BYTES, validateMesh, type MeshData } from "./csg/core";

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

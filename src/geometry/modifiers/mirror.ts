import { CsgError, validateMesh, type CsgRequest, type CsgResult, type MeshData } from "../csg";
import { MAX_CSG_INPUT_BYTES } from "../csg/core";
import type { GeometryAttributes, MirrorParameters, ModifierWarning } from "./types";

export class MirrorError extends Error {
  constructor(readonly code: "INVALID_MODIFIER" | "RESOURCE_TOO_LARGE" | "JOB_CANCELLED", message: string) { super(message); }
}

export function parseMirrorParameters(value: unknown): MirrorParameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MirrorError("INVALID_MODIFIER", "Параметры Mirror должны быть объектом.");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).length !== 3 || Object.keys(p).some(key => !["axes", "pivot", "mergeSeam"].includes(key))
    || typeof p.axes !== "string" || !["x", "y", "z", "xy", "xz", "yz", "xyz"].includes(p.axes)
    || !Array.isArray(p.pivot) || p.pivot.length !== 3 || !p.pivot.every(n => typeof n === "number" && Number.isFinite(n))
    || typeof p.mergeSeam !== "boolean")
    throw new MirrorError("INVALID_MODIFIER", "Mirror требует axes (x/y/z/xy/xz/yz/xyz), конечный pivot из трёх чисел и mergeSeam boolean без лишних полей.");
  return { axes: p.axes as MirrorParameters["axes"], pivot: p.pivot as [number, number, number], mergeSeam: p.mergeSeam };
}

/** Bit order X=1, Y=2, Z=4; ascending nonzero masks follow the original (mask 0). */
export function mirrorMasks(axes: MirrorParameters["axes"]): number[] {
  const enabled = (axes.includes("x") ? 1 : 0) | (axes.includes("y") ? 2 : 0) | (axes.includes("z") ? 4 : 0);
  return Array.from({ length: 8 }, (_, mask) => mask).filter(mask => (mask & ~enabled) === 0);
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MirrorError("JOB_CANCELLED", "Вычисление Mirror отменено.");
}
function bounded(mesh: MeshData, copies: number): void {
  const vertices = mesh.positions.length / 3 * copies;
  const positions = mesh.positions.length * copies;
  const indices = mesh.indices.length * copies;
  const bytes = (positions + indices) * 4;
  if (!Number.isSafeInteger(vertices) || vertices > 0xffffffff || !Number.isSafeInteger(positions) || !Number.isSafeInteger(indices)
    || !Number.isSafeInteger(bytes) || bytes > MAX_CSG_INPUT_BYTES)
    throw new MirrorError("RESOURCE_TOO_LARGE", "Mirror превысит лимит геометрических буферов 64 MiB.");
}

/** Produces detached buffers. Float32 overflow is rejected before publishing any output. */
async function reflect(mesh: MeshData, pivot: MirrorParameters["pivot"], mask: number, signal?: AbortSignal): Promise<MeshData> {
  check(signal);
  const positions = new Float32Array(mesh.positions.length);
  const indices = new Uint32Array(mesh.indices.length);
  for (let at = 0; at < positions.length; at += 3) {
    if (at && at % 300000 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); check(signal); }
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[at + axis]!;
      const result = mask & (1 << axis) ? 2 * pivot[axis]! - value : value;
      const rounded = Math.fround(result);
      if (!Number.isFinite(rounded)) throw new MirrorError("INVALID_MODIFIER", "Координаты Mirror переполнены при преобразовании в Float32.");
      positions[at + axis] = rounded;
    }
  }
  const flip = ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1)) % 2 !== 0;
  for (let at = 0; at < indices.length; at += 3) {
    if (at && at % 300000 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); check(signal); }
    indices[at] = mesh.indices[at]!;
    indices[at + 1] = mesh.indices[at + (flip ? 2 : 1)]!;
    indices[at + 2] = mesh.indices[at + (flip ? 1 : 2)]!;
  }
  return { positions, indices };
}

type Runner = { run(request: CsgRequest, signal?: AbortSignal): Promise<CsgResult> };
export type MirrorResult = { mesh: MeshData; warnings: ModifierWarning[] };

/** mergeSeam unions complete reflected solids; it does not clip a half mesh or weld an open seam. */
export async function evaluateMirror(mesh: MeshData, params: MirrorParameters, signal?: AbortSignal,
  csg?: { runner: Runner; jobId: () => string; attributes?: GeometryAttributes }): Promise<MirrorResult> {
  check(signal);
  validateMesh(mesh);
  const masks = mirrorMasks(params.axes);
  bounded(mesh, params.mergeSeam ? 1 : masks.length);
  const warnings: ModifierWarning[] = [];
  const attributes = csg?.attributes;
  if (attributes?.uv) warnings.push({ code: "UV_DROPPED", message: "Mirror MeshData не переносит исходные UV." });
  if (attributes?.normals) warnings.push({ code: "NORMALS_RECOMPUTED", message: "Авторские нормали не сохраняются; отображение может пересчитать их." });
  if (attributes?.materialGroups || (attributes?.materialSlots ?? 0) > 1) warnings.push({ code: "MATERIALS_DROPPED", message: "Группы и слоты материалов не сохраняются." });
  if (params.mergeSeam) {
    if (!csg) throw new MirrorError("INVALID_MODIFIER", "Для mergeSeam требуется CSG runner.");
    let current = await reflect(mesh, params.pivot, 0, signal);
    for (const mask of masks.slice(1)) {
      check(signal);
      const reflected = await reflect(mesh, params.pivot, mask, signal);
      if (current.positions.byteLength + current.indices.byteLength + reflected.positions.byteLength + reflected.indices.byteLength > MAX_CSG_INPUT_BYTES)
        throw new MirrorError("RESOURCE_TOO_LARGE", "Входы CSG union превысили лимит 64 MiB.");
      const attributePart = csg.attributes ? { attributes: csg.attributes } : {};
      const result = await csg.runner.run({ jobId: csg.jobId(), operation: "union", target: { mesh: current, ...attributePart }, cutter: { mesh: reflected, ...attributePart } }, signal);
      check(signal);
      if (result.coordinateSpace !== "target-local" || result.empty || result.output.indices.length === 0)
        throw new CsgError("GEOMETRY_NON_MANIFOLD", "CSG union Mirror вернул пустую или некорректную сетку.");
      validateMesh(result.output);
      current = { positions: result.output.positions.slice(), indices: result.output.indices.slice() };
      for (const warning of result.warnings) if (!warnings.some(existing => existing.code === warning.code)) warnings.push(warning);
    }
    return { mesh: current, warnings };
  }
  const positions = new Float32Array(mesh.positions.length * masks.length);
  const indices = new Uint32Array(mesh.indices.length * masks.length);
  for (const [copy, mask] of masks.entries()) {
    check(signal);
    const part = await reflect(mesh, params.pivot, mask, signal);
    positions.set(part.positions, copy * mesh.positions.length);
    const offset = copy * mesh.positions.length / 3;
    for (let at = 0; at < part.indices.length; at++) {
      if (at && at % 300000 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); check(signal); }
      indices[copy * part.indices.length + at] = part.indices[at]! + offset;
    }
  }
  check(signal);
  const output = { positions, indices };
  validateMesh(output);
  warnings.push({ code: "MIRROR_UNMERGED", message: "Отражённые части объединены только в буфере; совпадения, касания и пересечения не сшиты топологически." });
  return { mesh: output, warnings };
}

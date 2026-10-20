import type { MeshData } from "../csg";
import { MAX_CSG_INPUT_BYTES } from "../csg/core";
import type { ArrayParameters } from "./types";

export class ArrayError extends Error {
  constructor(readonly code: "INVALID_MODIFIER" | "RESOURCE_TOO_LARGE" | "JOB_CANCELLED", message: string) { super(message); }
}
const vector = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === "number" && Number.isFinite(n));
const axisIndex = { x: 0, y: 1, z: 2 } as const;

export function parseArrayParameters(value: unknown): ArrayParameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ArrayError("INVALID_MODIFIER", "Параметры массива должны быть объектом.");
  const p = value as Record<string, unknown>;
  const mode = p.mode;
  const keys = mode === "linear" ? ["mode", "count", "axis", "step", "offset"] : mode === "radial" ? ["mode", "count", "axis", "angleStepDegrees", "pivot", "offset"] : [];
  if (!keys.length || Object.keys(p).length !== keys.length || Object.keys(p).some(key => !keys.includes(key))
    || !Number.isSafeInteger(p.count) || (p.count as number) < 1 || !(p.axis === "x" || p.axis === "y" || p.axis === "z") || !vector(p.offset)
    || (mode === "linear" ? typeof p.step !== "number" || !Number.isFinite(p.step) : typeof p.angleStepDegrees !== "number" || !Number.isFinite(p.angleStepDegrees) || !vector(p.pivot)))
    throw new ArrayError("INVALID_MODIFIER", "Некорректные параметры массива: проверьте тип, ось, количество и конечность чисел.");
  const count = p.count as number, axis = p.axis as ArrayParameters["axis"], offset = p.offset as [number, number, number];
  if (mode === "linear") {
    const step = p.step as number;
    const delta = [...offset]; delta[axisIndex[axis]]! += step;
    if (count > 1 && delta.every(n => Math.abs(n) < 1e-12)) throw new ArrayError("INVALID_MODIFIER", "Копии линейного массива полностью совпадают.");
    return { mode, count, axis, step, offset };
  }
  const angleStepDegrees = p.angleStepDegrees as number, pivot = p.pivot as [number, number, number];
  if (count > 1 && offset.every(n => Math.abs(n) < 1e-12) && Math.abs(angleStepDegrees % 360) < 1e-12)
    throw new ArrayError("INVALID_MODIFIER", "Копии радиального массива полностью совпадают.");
  return { mode: "radial", count, axis, angleStepDegrees, pivot, offset };
}

export function arrayResultBytes(mesh: MeshData, count: number): number {
  const vertices = mesh.positions.length / 3 * count;
  const indices = mesh.indices.length * count;
  const size = mesh.positions.byteLength * count + mesh.indices.byteLength * count;
  if (!Number.isSafeInteger(vertices) || vertices > 0xffffffff || !Number.isSafeInteger(indices) || !Number.isSafeInteger(size) || size > MAX_CSG_INPUT_BYTES)
    throw new ArrayError("RESOURCE_TOO_LARGE", "Массив превысит лимит геометрических буферов 64 MiB.");
  return size;
}

/** Detached local-space output. Yield at copy boundaries so cancellation can be processed. */
export async function evaluateArray(mesh: MeshData, params: ArrayParameters, signal?: AbortSignal): Promise<MeshData> {
  arrayResultBytes(mesh, params.count);
  if (signal?.aborted) throw new ArrayError("JOB_CANCELLED", "Вычисление массива отменено.");
  if (!mesh.indices.length || !mesh.positions.length) return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
  const positions = new Float32Array(mesh.positions.length * params.count);
  const indices = new Uint32Array(mesh.indices.length * params.count);
  const axis = axisIndex[params.axis];
  const pivot = params.mode === "radial" ? params.pivot : [0, 0, 0];
  for (let copy = 0; copy < params.count; copy++) {
    if (signal?.aborted) throw new ArrayError("JOB_CANCELLED", "Вычисление массива отменено.");
    const angle = params.mode === "radial" ? copy * params.angleStepDegrees * Math.PI / 180 : 0;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    for (let at = 0; at < mesh.positions.length; at += 3) {
      if (at > 0 && at % 300000 === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) throw new ArrayError("JOB_CANCELLED", "Вычисление массива отменено.");
      }
      const p = [mesh.positions[at]! - pivot[0]!, mesh.positions[at + 1]! - pivot[1]!, mesh.positions[at + 2]! - pivot[2]!];
      const a = (axis + 1) % 3, b = (axis + 2) % 3;
      const x = p[a]!, y = p[b]!;
      p[a] = x * cosine - y * sine; p[b] = x * sine + y * cosine;
      for (let component = 0; component < 3; component++) {
        const linear = params.mode === "linear" && component === axis ? copy * params.step : 0;
        const result = p[component]! + pivot[component]! + copy * params.offset[component]! + linear;
        if (!Number.isFinite(result) || Math.abs(result) > 3.4e38) throw new ArrayError("INVALID_MODIFIER", "Координаты массива переполнены.");
        positions[copy * mesh.positions.length + at + component] = result;
      }
    }
    const vertexOffset = copy * mesh.positions.length / 3;
    for (let at = 0; at < mesh.indices.length; at++) indices[copy * mesh.indices.length + at] = mesh.indices[at]! + vertexOffset;
    if (copy % 16 === 15) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return { positions, indices };
}

import type { MeshData } from "../csg";
import { MAX_CSG_INPUT_BYTES } from "../csg/core";
import type { BendParameters, DeformAxis, TaperParameters, TwistParameters } from "./types";

export class DeformError extends Error {
  constructor(readonly code: "INVALID_MODIFIER" | "RESOURCE_TOO_LARGE" | "JOB_CANCELLED" | "GEOMETRY_DEGENERATE" | "FILE_INVALID", message: string) { super(message); }
}
const axes: Record<DeformAxis, number> = { x: 0, y: 1, z: 2 };
const isAxis = (v: unknown): v is DeformAxis => v === "x" || v === "y" || v === "z";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vector = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(finite) && v.every(n => Number.isFinite(Math.fround(n)));
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k)))
    throw new DeformError("INVALID_MODIFIER", `Ожидаются только параметры: ${keys.join(", ")}.`);
  return value as Record<string, unknown>;
}
function angle(value: unknown): value is number {
  // Ten full turns bound repeated folding and loss of angular precision.
  return finite(value) && Math.abs(value) <= 3600;
}
export function parseBendParameters(value: unknown): BendParameters {
  const p = record(value, ["axis", "direction", "angleDegrees", "pivot"]);
  if (!isAxis(p.axis) || !isAxis(p.direction) || p.axis === p.direction || !angle(p.angleDegrees) || !vector(p.pivot))
    throw new DeformError("INVALID_MODIFIER", "Bend требует разные оси, угол не более 10 оборотов и конечный pivot.");
  return { axis: p.axis, direction: p.direction, angleDegrees: p.angleDegrees, pivot: p.pivot };
}
export function parseTwistParameters(value: unknown): TwistParameters {
  const p = record(value, ["axis", "angleDegrees", "pivot"]);
  if (!isAxis(p.axis) || !angle(p.angleDegrees) || !vector(p.pivot))
    throw new DeformError("INVALID_MODIFIER", "Twist требует ось, угол не более 10 оборотов и конечный pivot.");
  return { axis: p.axis, angleDegrees: p.angleDegrees, pivot: p.pivot };
}
export function parseTaperParameters(value: unknown): TaperParameters {
  const p = record(value, ["axis", "startScale", "endScale", "pivot"]);
  // The range limits near-collapse and excessive amplification before Float32 rounding.
  if (!isAxis(p.axis) || !finite(p.startScale) || !finite(p.endScale) || p.startScale < 1e-6 || p.endScale < 1e-6 || p.startScale > 1e6 || p.endScale > 1e6 || !vector(p.pivot))
    throw new DeformError("INVALID_MODIFIER", "Taper требует положительные масштабы от 1e-6 до 1e6, ось и конечный pivot.");
  return { axis: p.axis, startScale: p.startScale, endScale: p.endScale, pivot: p.pivot };
}
const yieldTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function areaSquared(positions: Float32Array, a: number, b: number, c: number): number {
  const ax = positions[b * 3]! - positions[a * 3]!, ay = positions[b * 3 + 1]! - positions[a * 3 + 1]!, az = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
  const bx = positions[c * 3]! - positions[a * 3]!, by = positions[c * 3 + 1]! - positions[a * 3 + 1]!, bz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return cx * cx + cy * cy + cz * cz;
}
function check(signal?: AbortSignal): void { if (signal?.aborted) throw new DeformError("JOB_CANCELLED", "Деформация отменена."); }
function bounded(mesh: MeshData): void {
  if (!(mesh.positions instanceof Float32Array) || !(mesh.indices instanceof Uint32Array) || mesh.positions.length % 3 || mesh.indices.length % 3)
    throw new DeformError("FILE_INVALID", "Некорректные буферы сетки.");
  if (mesh.positions.byteLength + mesh.indices.byteLength > MAX_CSG_INPUT_BYTES) throw new DeformError("RESOURCE_TOO_LARGE", "Сетка превышает лимит 64 MiB.");
}
function sinc(x: number): number { return Math.abs(x) < 1e-4 ? 1 - x * x / 6 + x ** 4 / 120 : Math.sin(x) / x; }
function cosc(x: number): number { return Math.abs(x) < 1e-4 ? x / 2 - x ** 3 / 24 + x ** 5 / 720 : (1 - Math.cos(x)) / x; }

/** Local-space deformation with detached buffers and cooperative, chunked validation. */
export async function evaluateDeform(mesh: MeshData, kind: "bend", params: BendParameters, signal?: AbortSignal): Promise<MeshData>;
export async function evaluateDeform(mesh: MeshData, kind: "twist", params: TwistParameters, signal?: AbortSignal): Promise<MeshData>;
export async function evaluateDeform(mesh: MeshData, kind: "taper", params: TaperParameters, signal?: AbortSignal): Promise<MeshData>;
export async function evaluateDeform(mesh: MeshData, kind: "bend" | "twist" | "taper", params: BendParameters | TwistParameters | TaperParameters, signal?: AbortSignal): Promise<MeshData> {
  check(signal); bounded(mesh);
  const source = mesh.positions, axis = axes[params.axis], vertexCount = source.length / 3;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < source.length; i += 3) {
    if (i && i % 300000 === 0) { await yieldTurn(); check(signal); }
    const x = source[i + axis]!;
    if (!Number.isFinite(x)) throw new DeformError("FILE_INVALID", "Вход содержит нечисловую координату.");
    min = Math.min(min, x); max = Math.max(max, x);
  }
  const span = max - min;
  const identity = kind === "taper" ? (params as TaperParameters).startScale === 1 && (params as TaperParameters).endScale === 1 : (params as BendParameters | TwistParameters).angleDegrees === 0;
  if (!identity && !(span > Math.max(1e-7, Math.max(Math.abs(min), Math.abs(max)) * 1e-7)))
    throw new DeformError("GEOMETRY_DEGENERATE", "Диапазон вдоль оси деформации численно неразличим.");
  const output = new Float32Array(source.length);
  const a = (axis + 1) % 3, b = (axis + 2) % 3;
  for (let i = 0; i < source.length; i += 3) {
    if (i && i % 300000 === 0) { await yieldTurn(); check(signal); }
    const x = source[i]!, y = source[i + 1]!, z = source[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new DeformError("FILE_INVALID", "Вход содержит нечисловую координату.");
    const p = [x, y, z];
    if (!identity) {
      const t = (p[axis]! - min) / span;
      if (kind === "bend") {
        const bend = params as BendParameters, d = axes[bend.direction], theta = bend.angleDegrees * Math.PI / 180 * t;
        const longitudinal = p[axis]! - min, transverse = p[d]! - bend.pivot[d]!;
        p[axis] = min + longitudinal * sinc(theta) - transverse * Math.sin(theta);
        p[d] = bend.pivot[d]! + longitudinal * cosc(theta) + transverse * Math.cos(theta);
      } else if (kind === "twist") {
        const theta = (params as TwistParameters).angleDegrees * Math.PI / 180 * t;
        const u = p[a]! - params.pivot[a]!, v = p[b]! - params.pivot[b]!;
        p[a] = params.pivot[a]! + u * Math.cos(theta) - v * Math.sin(theta);
        p[b] = params.pivot[b]! + u * Math.sin(theta) + v * Math.cos(theta);
      } else {
        const taper = params as TaperParameters, scale = taper.startScale + (taper.endScale - taper.startScale) * t;
        p[a] = params.pivot[a]! + (p[a]! - params.pivot[a]!) * scale;
        p[b] = params.pivot[b]! + (p[b]! - params.pivot[b]!) * scale;
      }
    }
    for (let component = 0; component < 3; component++) {
      const rounded = Math.fround(p[component]!);
      if (!Number.isFinite(rounded)) throw new DeformError("INVALID_MODIFIER", "Результат деформации переполнен в Float32.");
      output[i + component] = rounded;
    }
  }
  const indices = mesh.indices.slice();
  for (let i = 0; i < indices.length; i += 3) {
    if (i && i % 300000 === 0) { await yieldTurn(); check(signal); }
    const ia = indices[i]!, ib = indices[i + 1]!, ic = indices[i + 2]!;
    if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) throw new DeformError("FILE_INVALID", "Индекс вне диапазона.");
    if (areaSquared(source, ia, ib, ic) < 1e-20) throw new DeformError("GEOMETRY_DEGENERATE", `Вырожденный входной треугольник ${i / 3}.`);
    if (areaSquared(output, ia, ib, ic) < 1e-20) throw new DeformError("GEOMETRY_DEGENERATE", `Вырожденный треугольник ${i / 3}.`);
  }
  check(signal);
  return { positions: output, indices };
}

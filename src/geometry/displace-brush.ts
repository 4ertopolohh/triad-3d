import type { Vec3 } from "../domain/types";
import { SEAM_TOLERANCE, validateEditableSource, type EditableMeshSource } from "./mesh-edit";

type ReadonlyEditable = { readonly kind: "editable"; readonly positions: readonly number[]; readonly indices: readonly number[]; readonly uv?: readonly number[] };

export const MAX_BRUSH_VERTICES = 20_000;
export const MAX_BRUSH_SAMPLES = 512;
export const BRUSH_RADIUS_MIN = 0.01;
export const BRUSH_RADIUS_MAX = 10;
export const BRUSH_STRENGTH_MAX = 0.5;
export type BrushSymmetry = "off" | "x" | "y" | "z";
export const isBrushSymmetry = (value: unknown): value is BrushSymmetry =>
  value === "off" || value === "x" || value === "y" || value === "z";

/** Centers of one sample in mesh-local coordinates. Coincident centers act once. */
export function brushCenters(point: readonly number[], symmetry: BrushSymmetry = "off"): readonly (readonly number[])[] {
  if (symmetry === "off") return [point];
  const axis = { x: 0, y: 1, z: 2 }[symmetry];
  const reflected = [...point];
  reflected[axis] = -reflected[axis]!;
  return reflected[axis] === point[axis] ? [point] : [point, reflected];
}

export function brushParameters(radius: number, strength: number): boolean {
  return Number.isFinite(radius) && radius >= BRUSH_RADIUS_MIN && radius <= BRUSH_RADIUS_MAX
    && Number.isFinite(strength) && Math.abs(strength) <= BRUSH_STRENGTH_MAX;
}

const vertexKey = (p: readonly number[], i: number) => [0, 1, 2].map(a => Math.round(p[3 * i + a]! / SEAM_TOLERANCE)).join(":");

export function brushAffectedVertices(source: ReadonlyEditable, point: readonly number[], radius: number, symmetry: BrushSymmetry = "off"): number[] {
  if (!Number.isFinite(radius) || radius <= 0 || point.length !== 3 || !point.every(Number.isFinite)) return [];
  const result: number[] = [];
  const centers = brushCenters(point, symmetry);
  for (let i = 0; i < source.positions.length / 3; i++) {
    if (centers.some(center => {
      const x = source.positions[3 * i]! - center[0]!;
      const y = source.positions[3 * i + 1]! - center[1]!;
      const z = source.positions[3 * i + 2]! - center[2]!;
      return x * x + y * y + z * z < radius * radius;
    })) result.push(i);
  }
  return result;
}

/** Pure local-space stroke. A canonical geometric vertex receives one displacement across UV seams. */
export function displaceStroke(source: EditableMeshSource, samples: readonly (readonly number[])[], radius: number, strength: number, symmetry: BrushSymmetry = "off"): EditableMeshSource {
  if (!brushParameters(radius, strength) || !samples.length || samples.length > MAX_BRUSH_SAMPLES
    || !isBrushSymmetry(symmetry) || samples.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error("Недопустимые параметры или точки мазка.");
  if (source.positions.length / 3 > MAX_BRUSH_VERTICES) throw new Error(`Кисть поддерживает не более ${MAX_BRUSH_VERTICES} вершин.`);
  const error = validateEditableSource(source);
  if (error) throw new Error(error);
  if (strength === 0) return source;
  const p = source.positions, count = p.length / 3;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const key = vertexKey(p, i);
    const list = groups.get(key) ?? [];
    if (list.length && [0, 1, 2].some(a => p[3 * list[0]! + a] !== p[3 * i + a])) throw new Error("Неоднозначное совпадение вершин после канонизации.");
    list.push(i); groups.set(key, list);
  }
  const normals = new Map<string, [number, number, number]>();
  const edgeUses = new Map<string, { count: number; winding: number }>();
  let minEdge = Infinity;
  const triangleNormals: number[][] = [];
  for (let t = 0; t < source.indices.length; t += 3) {
    const ids = source.indices.slice(t, t + 3);
    const a = ids[0]!, b = ids[1]!, c = ids[2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const from = vertexKey(p, u!), to = vertexKey(p, v!);
      if (from === to) throw new Error("Вырожденное ребро сетки.");
      const forward = from < to;
      const edgeKey = forward ? `${from}|${to}` : `${to}|${from}`;
      const use = edgeUses.get(edgeKey) ?? { count: 0, winding: 0 };
      use.count++; use.winding += forward ? 1 : -1; edgeUses.set(edgeKey, use);
    }
    const ab = [0, 1, 2].map(k => p[3 * b + k]! - p[3 * a + k]!);
    const ac = [0, 1, 2].map(k => p[3 * c + k]! - p[3 * a + k]!);
    const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
    triangleNormals.push(cross);
    for (const i of ids) {
      const key = vertexKey(p, i), n = normals.get(key) ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) n[k] = n[k]! + cross[k]! / groups.get(key)!.length;
      normals.set(key, n);
    }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const length = Math.hypot(...[0, 1, 2].map(k => p[3 * u! + k]! - p[3 * v! + k]!));
      if (length > 1e-9) minEdge = Math.min(minEdge, length);
    }
  }
  if (!Number.isFinite(minEdge)) throw new Error("Невозможно определить масштаб сетки.");
  if ([...edgeUses.values()].some(edge => edge.count !== 2 || edge.winding !== 0))
    throw new Error("Кисть поддерживает только замкнутую согласованно ориентированную сетку.");
  const next = p.slice();
  const centers = samples.flatMap(point => brushCenters(point, symmetry));
  const maxDisplacement = Math.min(Math.abs(strength), minEdge * 0.1);
  let changed = false;
  for (const [key, ids] of groups) {
    const i = ids[0]!, n = normals.get(key) ?? [0, 0, 0];
    const length = Math.hypot(...n);
    if (length < 1e-12) continue;
    let influence = 0;
    for (const point of centers) {
      const d = Math.hypot(p[3 * i]! - point[0]!, p[3 * i + 1]! - point[1]!, p[3 * i + 2]! - point[2]!);
      if (d < radius) influence = Math.max(influence, (1 - d / radius) ** 2);
    }
    const amount = Math.sign(strength) * Math.min(maxDisplacement, Math.abs(strength) * influence);
    if (!amount) continue;
    const moved = [0, 1, 2].map(k => Math.fround(p[3 * i + k]! + n[k]! / length * amount));
    if (!moved.every(Number.isFinite)) throw new Error("Переполнение координат Float32.");
    for (const member of ids) for (let k = 0; k < 3; k++) { next[3 * member + k] = moved[k]!; if (moved[k] !== p[3 * member + k]) changed = true; }
  }
  if (!changed) return source;
  const result: EditableMeshSource = { ...source, positions: next };
  const resultError = validateEditableSource(result);
  if (resultError) throw new Error(resultError);
  for (let t = 0; t < source.indices.length; t += 3) {
    const [a, b, c] = source.indices.slice(t, t + 3);
    const ab = [0, 1, 2].map(k => next[3 * b! + k]! - next[3 * a! + k]!);
    const ac = [0, 1, 2].map(k => next[3 * c! + k]! - next[3 * a! + k]!);
    const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
    if (cross.reduce((sum, v, k) => sum + v * triangleNormals[t / 3]![k]!, 0) <= 0) throw new Error("Мазок переворачивает треугольник.");
  }
  return result;
}

export type BrushPoint = Vec3;

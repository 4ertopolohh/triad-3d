import { SEAM_TOLERANCE } from "./mesh-edit";

export const MAX_VISIBLE_VERTICES = 50000;

export function vertexKey(positions: readonly number[], index: number): string {
  return [0, 1, 2].map(axis => Math.round(positions[index * 3 + axis]! / SEAM_TOLERANCE)).join(":");
}

/** First render index at each geometric position is the stable command representative. */
export function vertexRepresentatives(source: { readonly positions: readonly number[] }): number[] {
  const seen = new Set<string>();
  const result: number[] = [];
  for (let index = 0; index < source.positions.length / 3; index++) {
    const key = vertexKey(source.positions, index);
    if (!seen.has(key)) { seen.add(key); result.push(index); }
  }
  return result;
}

export function normalizeVertexIndices(source: { readonly positions: readonly number[] }, indices: readonly number[]): number[] | null {
  const representatives = new Map<string, number>();
  for (const index of vertexRepresentatives(source)) representatives.set(vertexKey(source.positions, index), index);
  const result = new Set<number>();
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= source.positions.length / 3) return null;
    result.add(representatives.get(vertexKey(source.positions, index))!);
  }
  return [...result].sort((a, b) => a - b);
}

import { describe, expect, it } from "vitest";
import { convertPrimitiveToEditable, extrudeEditableFace, validateEditableSource } from "../../src/geometry/mesh-edit";
import { buildMeshTopology } from "../../src/geometry/mesh-topology";
import { createNestedMeshProject } from "../fixtures/projects";
import { Vector3 } from "three";

const cube = () => {
  const node = createNestedMeshProject().nodes.find(item => item.id === "mesh-node");
  if (node?.kind !== "mesh" || node.meshSource.kind !== "primitive") throw new Error("fixture");
  return convertPrimitiveToEditable(node.meshSource);
};

function orientedEdgeCounts(source: ReturnType<typeof cube>) {
  const points = new Map<string, number>();
  const canonical = Array.from({ length: source.positions.length / 3 }, (_, i) => {
    const key = source.positions.slice(3 * i, 3 * i + 3).join(":");
    if (!points.has(key)) points.set(key, i);
    return points.get(key)!;
  });
  const edges = new Map<string, number[]>();
  for (let i = 0; i < source.indices.length; i += 3) for (let side = 0; side < 3; side++) {
    const a = canonical[source.indices[i + side]!]!, b = canonical[source.indices[i + (side + 1) % 3]!]!;
    const key = [Math.min(a, b), Math.max(a, b)].join(":");
    edges.set(key, [...(edges.get(key) ?? []), a < b ? 1 : -1]);
  }
  return edges;
}

describe("safe editable face extrude", () => {
  it("creates a closed oriented cube protrusion with top and sides, preserving old UV", () => {
    const source = cube();
    const face = buildMeshTopology(source)!.faces[0]!;
    const original = structuredClone(source);
    const result = extrudeEditableFace(source, face.id, 0.25);
    expect(source).toEqual(original);
    expect(result).toEqual(extrudeEditableFace(source, face.id, 0.25));
    expect(validateEditableSource(result)).toBeNull();
    expect(result.indices.length / 3).toBe(source.indices.length / 3 + 8);
    expect(result.uv?.length).toBe(result.positions.length / 3 * 2);
    const oldPositions = new Set(Array.from({ length: source.positions.length / 3 }, (_, i) => source.positions.slice(3 * i, 3 * i + 3).join(":")));
    const newPositions = new Set(Array.from({ length: result.positions.length / 3 }, (_, i) => result.positions.slice(3 * i, 3 * i + 3).join(":")));
    expect([...oldPositions].every(p => newPositions.has(p))).toBe(true);
    expect(newPositions.size).toBe(oldPositions.size + 4);
    const triangle = source.indices.slice(3 * face.triangles[0]!, 3 * face.triangles[0]! + 3);
    const at = (i: number) => new Vector3().fromArray(source.positions, 3 * i);
    const normal = at(triangle[1]!).sub(at(triangle[0]!)).cross(at(triangle[2]!).sub(at(triangle[0]!))).normalize();
    const expectedTop = at(triangle[0]!).addScaledVector(normal, 0.25).toArray().join(":");
    expect(newPositions.has(expectedTop)).toBe(true);
    expect([...orientedEdgeCounts(result).values()].every(directions => directions.length === 2 && directions[0] === -directions[1]!)).toBe(true);
    const selected = new Set(face.triangles);
    const untouched = new Set(source.indices.filter((_, index) => !selected.has(Math.floor(index / 3))));
    const oldUvAtPosition = new Set([...untouched].map(i =>
      JSON.stringify([source.positions.slice(3 * i, 3 * i + 3), source.uv!.slice(2 * i, 2 * i + 2)])));
    const newUvAtPosition = new Set(Array.from({ length: result.positions.length / 3 }, (_, i) =>
      JSON.stringify([result.positions.slice(3 * i, 3 * i + 3), result.uv!.slice(2 * i, 2 * i + 2)])));
    expect([...oldUvAtPosition].every(item => newUvAtPosition.has(item))).toBe(true);
  });

  it("rejects invalid depth, open shell, ambiguous quantization and bad face", () => {
    const source = cube();
    const faceId = buildMeshTopology(source)!.faces[0]!.id;
    expect(extrudeEditableFace(source, faceId, 0)).toBe(source);
    for (const distance of [-1, 1e-7, NaN, Infinity, 1e40]) expect(() => extrudeEditableFace(source, faceId, distance)).toThrow();
    expect(() => extrudeEditableFace(source, 999, 0.25)).toThrow(/грань/i);
    expect(() => extrudeEditableFace({ ...source, indices: source.indices.slice(3) }, faceId, 0.25)).toThrow(/замкнутой|ориентированной/);
    const reversed = structuredClone(source);
    reversed.indices.splice(0, 3, source.indices[0]!, source.indices[2]!, source.indices[1]!);
    expect(() => extrudeEditableFace(reversed, faceId, 0.25)).toThrow(/ориентированной/);
    const nonManifold = structuredClone(source);
    nonManifold.indices.push(...source.indices.slice(0, 3));
    expect(() => extrudeEditableFace(nonManifold, faceId, 0.25)).toThrow(/manifold/);
    const ambiguous = structuredClone(source);
    ambiguous.positions[3] = ambiguous.positions[0]! + 1e-7;
    expect(() => extrudeEditableFace(ambiguous, faceId, 0.25)).toThrow();
  });
});

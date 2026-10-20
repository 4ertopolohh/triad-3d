import { describe, expect, it } from "vitest";
import { BoxGeometry, Matrix4, SphereGeometry, TorusGeometry } from "three";
import { compute, makeInputs, manifoldModule } from "../../src/geometry/csg/core";
import { fromThree, operandFromThree, prepareCsgRequest, validateMesh } from "../../src/geometry/csg";
import type { MeshData } from "../../src/geometry/csg";

async function volume(mesh: MeshData) {
  const api = await manifoldModule();
  const input = new api.Mesh({ numProp: 3, vertProperties: mesh.positions.slice(), triVerts: mesh.indices.slice() });
  input.merge();
  const solid = new api.Manifold(input);
  try { return solid.volume(); } finally { solid.delete(); }
}

describe("production CSG geometry", () => {
  it("cuts the torus body and is repeatable", async () => {
    const [torus, cutter] = makeInputs("subtract", "low");
    const before = await volume(torus);
    const first = await compute("subtract", torus, cutter);
    const again = await compute("subtract", torus, cutter);
    expect(first.empty).toBe(false);
    expect(await volume(first.output)).toBeLessThan(before - 0.01);
    expect(first.faceOrigins).toContain(2);
    expect(first.output.positions).toEqual(again.output.positions);
    expect(first.output.indices).toEqual(again.output.indices);
  });

  it("unions and intersects overlapping solids with expected volumes", async () => {
    const [a, b] = makeInputs("union", "low");
    const va = await volume(a), vb = await volume(b);
    const union = await compute("union", a, b);
    const intersection = await compute("intersect", a, b);
    const vu = await volume(union.output), vi = await volume(intersection.output);
    expect(vi).toBeGreaterThan(0.1);
    expect(vi).toBeLessThan(Math.min(va, vb));
    expect(vu).toBeGreaterThan(Math.max(va, vb));
    expect(vu).toBeCloseTo(va + vb - vi, 2);
  });

  it("applies cutter world transform into target local space without mutating inputs", async () => {
    const targetGeometry = new BoxGeometry(2, 2, 2);
    const cutterGeometry = new SphereGeometry(0.6, 16, 12);
    const target = operandFromThree(targetGeometry, Array.from(new Matrix4().makeTranslation(5, 0, 0).elements));
    const cutter = operandFromThree(cutterGeometry, Array.from(new Matrix4().makeTranslation(5.8, 0, 0).elements));
    const original = cutter.mesh.positions.slice();
    const prepared = prepareCsgRequest({ jobId: "transformed", operation: "subtract", target, cutter });
    const result = await compute(prepared.operation, prepared.first, prepared.second);
    expect(await volume(result.output)).toBeLessThan(await volume(target.mesh) - 0.05);
    expect(cutter.mesh.positions).toEqual(original);
    expect(prepared.warnings.map((warning) => warning.code)).toContain("UV_DROPPED");
    expect(prepared.warnings.map((warning) => warning.code)).toContain("NORMALS_RECOMPUTED");
    expect(target.attributes?.materialGroups).toBe(true);
    expect(prepared.warnings.map((warning) => warning.code)).toContain("MATERIALS_DROPPED");
    expect(result.faceOrigins.length).toBe(result.output.indices.length / 3);
    expect(result.output).toEqual({ positions: result.output.positions, indices: result.output.indices });
    targetGeometry.dispose(); cutterGeometry.dispose();
  });

  it("rejects invalid transforms, indices, coordinates, and oversized buffers", () => {
    const [a, b] = makeInputs("union", "low");
    const base = { jobId: "bad", operation: "union" as const, target: { mesh: a }, cutter: { mesh: b } };
    expect(() => prepareCsgRequest({ ...base, cutter: { mesh: b, worldMatrix: Array(16).fill(0) } })).toThrowError(/GEOMETRY_DEGENERATE/);
    expect(() => prepareCsgRequest({ ...base, cutter: { mesh: b, worldMatrix: Array(16).fill(Infinity) } })).toThrowError(/FILE_INVALID/);
    const invalid = { positions: a.positions.slice(), indices: a.indices.slice() };
    invalid.indices[0] = invalid.positions.length;
    expect(() => validateMesh(invalid)).toThrowError(/FILE_INVALID/);
    invalid.indices[0] = a.indices[0]!; invalid.positions[0] = Infinity;
    expect(() => validateMesh(invalid)).toThrowError(/FILE_INVALID/);
    expect(() => validateMesh({ positions: new Float32Array(17_000_000), indices: new Uint32Array([0, 1, 2]) })).toThrowError(/RESOURCE_TOO_LARGE/);
  });

  it("reverses winding for a reflected cutter transform", async () => {
    const targetGeometry = new BoxGeometry(2, 2, 2);
    const cutterGeometry = new BoxGeometry(1, 1, 1);
    const target = operandFromThree(targetGeometry);
    const cutter = operandFromThree(cutterGeometry, Array.from(new Matrix4().makeScale(-1, 1, 1).elements));
    const originalIndices = cutter.mesh.indices.slice();
    const prepared = prepareCsgRequest({ jobId: "mirror", operation: "subtract", target, cutter });
    expect(prepared.second.indices[1]).toBe(originalIndices[2]);
    const result = await compute("subtract", prepared.first, prepared.second);
    expect(result.empty).toBe(false);
    expect(await volume(result.output)).toBeLessThan(await volume(target.mesh));
    expect(cutter.mesh.indices).toEqual(originalIndices);
    targetGeometry.dispose(); cutterGeometry.dispose();
  });

  it("computes a non-indexed closed mesh and leaves failed inputs intact", async () => {
    const indexed = new TorusGeometry(1.4, 0.48, 12, 24);
    const nonIndexed = indexed.toNonIndexed();
    const source = fromThree(nonIndexed);
    const [, cutter] = makeInputs("subtract", "low");
    const result = await compute("subtract", source, cutter);
    expect(result.empty).toBe(false);
    const bad = { positions: source.positions.slice(), indices: source.indices.slice() };
    bad.indices[1] = bad.indices[0]!;
    const snapshot = bad.positions.slice();
    await expect(compute("subtract", bad, cutter)).rejects.toMatchObject({ code: "GEOMETRY_DEGENERATE" });
    expect(bad.positions).toEqual(snapshot);
    indexed.dispose(); nonIndexed.dispose();
  });
});

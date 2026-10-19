import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, TorusGeometry } from "three";
import { compute, CsgError, fromThree, makeInputs, manifoldModule, validateMesh } from "../../src/spikes/csg/core";

describe("Manifold CSG spike", () => {
  it("initializes WASM and performs all operations without mutating inputs", async () => {
    const api = await manifoldModule();
    expect(api.Manifold).toBeDefined();
    for (const operation of ["subtract", "union", "intersect"] as const) {
      const [a, b] = makeInputs(operation, "low");
      const aCopy = a.positions.slice(), bCopy = b.positions.slice();
      const result = await compute(operation, a, b);
      expect(result.status).toBe("NoError");
      expect(result.outputTriangles).toBeGreaterThan(0);
      validateMesh(result.output);
      expect(a.positions).toEqual(aCopy);
      expect(b.positions).toEqual(bCopy);
      if (operation === "subtract") expect(result.outputTriangles).toBeGreaterThan(a.indices.length / 3);
    }
  });

  it("handles indexed and non-indexed seam vertices", async () => {
    const indexed = new TorusGeometry(1, 0.3, 12, 24);
    const flat = indexed.toNonIndexed();
    expect(fromThree(indexed).indices.length).toBe(fromThree(flat).indices.length);
    indexed.dispose(); flat.dispose();
  });

  it("rejects invalid coordinates, degenerate triangles and open surfaces", async () => {
    const [a, b] = makeInputs("union", "low");
    const invalid = { positions: a.positions.slice(), indices: a.indices.slice() };
    invalid.positions[0] = Number.NaN;
    expect(() => validateMesh(invalid)).toThrow(CsgError);
    const degenerate = { positions: a.positions.slice(), indices: a.indices.slice() };
    degenerate.indices[1] = degenerate.indices[0]!;
    expect(() => validateMesh(degenerate)).toThrow(CsgError);
    await expect(compute("subtract", a, degenerate)).rejects.toMatchObject({ code: "GEOMETRY_DEGENERATE" });
    const open = new BufferGeometry();
    open.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    await expect(compute("union", fromThree(open), b)).rejects.toMatchObject({ code: "GEOMETRY_NON_MANIFOLD" });
  });

  it("returns an explicit empty intersection for separated solids", async () => {
    const [a, b] = makeInputs("intersect", "low");
    for (let i = 0; i < b.positions.length; i += 3) b.positions[i]! += 100;
    const result = await compute("intersect", a, b);
    expect(result.empty).toBe(true);
    expect(result.outputTriangles).toBe(0);
  });
});

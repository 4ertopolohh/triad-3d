import { describe, expect, it } from "vitest";
import { arrayResultBytes, evaluateArray, parseArrayParameters } from "../../src/geometry/modifiers/array";
import type { ArrayParameters } from "../../src/geometry/modifiers/types";

const mesh = { positions: new Float32Array([1, 0, 0, 2, 0, 0, 1, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
describe("regular arrays", () => {
  it.each(["x", "y", "z"] as const)("translates linearly along %s without mutating the source", async axis => {
    const params: ArrayParameters = { mode: "linear", count: 3, axis, step: 2, offset: [0, 0, 0] };
    const before = mesh.positions.slice();
    const result = await evaluateArray(mesh, params);
    expect(result.positions).toHaveLength(27);
    expect(result.indices).toEqual(new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    expect(result.positions[9 + { x: 0, y: 1, z: 2 }[axis]]).toBe(before[{ x: 0, y: 1, z: 2 }[axis]]! + 2);
    expect(mesh.positions).toEqual(before);
    expect(await evaluateArray(mesh, params)).toEqual(result);
  });
  it.each(["x", "y", "z"] as const)("rotates around %s with pivot, offset and negative angle", async axis => {
    const params: ArrayParameters = { mode: "radial", count: 4, axis, angleStepDegrees: -90, pivot: [1, 0, 0], offset: [0, 0, 1] };
    const result = await evaluateArray(mesh, params);
    expect(result.positions).toHaveLength(36);
    expect(result.indices[9]).toBe(9);
    expect(result.positions.slice(0, 3)).toEqual(mesh.positions.slice(0, 3));
    expect(result.positions[11]).toBeCloseTo(1);
  });
  it("accepts identity, rejects invalid and oversized requests before allocation", async () => {
    const identity: ArrayParameters = { mode: "linear", count: 1, axis: "x", step: 0, offset: [0, 0, 0] };
    expect((await evaluateArray(mesh, identity)).positions).toEqual(mesh.positions);
    expect(() => parseArrayParameters({ ...identity, count: 2 })).toThrow();
    expect(() => parseArrayParameters({ ...identity, count: 1.5 })).toThrow();
    expect(() => parseArrayParameters({ ...identity, offset: [0, Infinity, 0] })).toThrow();
    expect(() => parseArrayParameters({ ...identity, extra: 1 })).toThrow();
    expect(() => arrayResultBytes(mesh, 1e8)).toThrow();
  });
  it("honours an abort signal", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(evaluateArray(mesh, { mode: "linear", count: 3, axis: "x", step: 1, offset: [0, 0, 0] }, abort.signal)).rejects.toMatchObject({ code: "JOB_CANCELLED" });
    const large = { positions: new Float32Array(300003), indices: new Uint32Array([0, 1, 2]) };
    const active = new AbortController();
    const pending = evaluateArray(large, { mode: "linear", count: 2, axis: "x", step: 1, offset: [0, 0, 0] }, active.signal);
    active.abort();
    await expect(pending).rejects.toMatchObject({ code: "JOB_CANCELLED" });
  });
});

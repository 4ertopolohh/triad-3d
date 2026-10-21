import { describe, expect, it } from "vitest";
import { evaluateDeform, parseBendParameters, parseTaperParameters, parseTwistParameters } from "../../src/geometry/modifiers";
import { toThree, type MeshData } from "../../src/geometry/csg";

const triangle = (): MeshData => ({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]), indices: new Uint32Array([0, 1, 2]) });
const bend = { axis: "x" as const, direction: "y" as const, angleDegrees: 90, pivot: [0, 0, 0] as const };
const twist = { axis: "z" as const, angleDegrees: 90, pivot: [0, 0, 0] as const };
const taper = { axis: "z" as const, startScale: 1, endScale: 2, pivot: [0, 0, 0] as const };

describe("deform", () => {
  it("strictly parses all parameter kinds", () => {
    expect(parseBendParameters(bend)).toEqual(bend);
    expect(parseTwistParameters(twist)).toEqual(twist);
    expect(parseTaperParameters(taper)).toEqual(taper);
    for (const invalid of [{ ...bend, direction: "x" }, { ...bend, extra: 1 }, { ...twist, angleDegrees: Infinity }, { ...taper, endScale: 0 }, { ...taper, pivot: [0, 0, NaN] }, { ...taper, startScale: 1e7 }]) {
      const parse = "direction" in invalid ? parseBendParameters : "angleDegrees" in invalid ? parseTwistParameters : parseTaperParameters;
      expect(() => parse(invalid)).toThrow();
    }
  });
  it("bends continuously from the anchored start and reverses with angle", async () => {
    const mesh = triangle(), before = mesh.positions.slice();
    const positive = await evaluateDeform(mesh, "bend", bend);
    const negative = await evaluateDeform(mesh, "bend", { ...bend, angleDegrees: -90 });
    expect(positive.positions[0]).toBe(0);
    expect(positive.positions[1]).toBe(0);
    expect(positive.positions[3]).toBeCloseTo(2 / Math.PI, 5);
    expect(positive.positions[4]).toBeCloseTo(2 / Math.PI, 5);
    expect(negative.positions[4]).toBeCloseTo(-2 / Math.PI, 5);
    expect(mesh.positions).toEqual(before);
    expect(positive.indices).toEqual(mesh.indices);
    expect(positive.indices).not.toBe(mesh.indices);
    expect((await evaluateDeform(mesh, "bend", bend)).positions).toEqual(positive.positions);
    expect((await evaluateDeform(mesh, "bend", { ...bend, angleDegrees: 0 })).positions).toEqual(mesh.positions);
  });
  it("twists around z and x with unchanged longitudinal coordinates", async () => {
    const mesh = triangle();
    const z = await evaluateDeform(mesh, "twist", twist);
    expect(z.positions[6]).toBeCloseTo(-1, 5);
    expect(z.positions[7]).toBeCloseTo(0, 5);
    expect(z.positions[8]).toBe(1);
    const alongX: MeshData = { positions: new Float32Array([0, 0, 0, 1, 1, 0, 1, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
    const x = await evaluateDeform(alongX, "twist", { axis: "x", angleDegrees: 90, pivot: [0, 0, 0] });
    expect(x.positions[3]).toBe(1);
    expect(x.positions[4]).toBeCloseTo(0, 5);
    expect(x.positions[5]).toBeCloseTo(1, 5);
    const reverse = await evaluateDeform(alongX, "twist", { axis: "x", angleDegrees: -90, pivot: [0, 0, 0] });
    expect(reverse.positions[5]).toBeCloseTo(-1, 5);
    expect((await evaluateDeform(mesh, "twist", { ...twist, angleDegrees: 0 })).positions).toEqual(mesh.positions);
  });
  it("tapers transverse dimensions and keeps normals finite", async () => {
    const mesh = triangle();
    const result = await evaluateDeform(mesh, "taper", taper);
    expect(result.positions[7]).toBe(2);
    expect(result.positions[8]).toBe(1);
    expect((await evaluateDeform(mesh, "taper", { ...taper, startScale: 1, endScale: 1 })).positions).toEqual(mesh.positions);
    const geometry = toThree(result);
    expect(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
    geometry.dispose();
  });
  it("rejects degenerate output, zero span, bad indices and Float32 overflow", async () => {
    const top: MeshData = { positions: new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]), indices: new Uint32Array([1, 2, 3]) };
    await expect(evaluateDeform(top, "taper", { ...taper, endScale: 1e-6 })).rejects.toMatchObject({ code: "GEOMETRY_DEGENERATE" });
    await expect(evaluateDeform(triangle(), "twist", { axis: "y", angleDegrees: 90, pivot: [0, 0, 0] })).resolves.toBeDefined();
    const flat: MeshData = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
    await expect(evaluateDeform(flat, "twist", { axis: "y", angleDegrees: 90, pivot: [0, 0, 0] })).rejects.toMatchObject({ code: "GEOMETRY_DEGENERATE" });
    await expect(evaluateDeform({ ...triangle(), indices: new Uint32Array([0, 1, 9]) }, "twist", twist)).rejects.toMatchObject({ code: "FILE_INVALID" });
    const huge: MeshData = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1e33, 1]), indices: new Uint32Array([0, 1, 2]) };
    await expect(evaluateDeform(huge, "taper", { ...taper, endScale: 1e6 })).rejects.toMatchObject({ code: "INVALID_MODIFIER" });
  });
  it("yields during large work and cancels without a result", async () => {
    const source = triangle();
    const positions = new Float32Array(300006);
    positions.set(source.positions);
    for (let i = 9; i < positions.length; i += 3) { positions[i] = i / 3; positions[i + 1] = 1; positions[i + 2] = 1; }
    const controller = new AbortController();
    const pending = evaluateDeform({ positions, indices: source.indices }, "bend", bend, controller.signal);
    setTimeout(() => controller.abort(), 0);
    await expect(pending).rejects.toMatchObject({ code: "JOB_CANCELLED" });
  });
});

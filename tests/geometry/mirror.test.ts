import { describe, expect, it, vi } from "vitest";
import { createProject } from "../../src/domain/create-project";
import { validateProject } from "../../src/domain/validate-project";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { CsgError, type CsgRequest, type CsgResult } from "../../src/geometry/csg";
import { compute } from "../../src/geometry/csg/core";
import { ModifierEvaluator } from "../../src/geometry/modifiers";
import { evaluateMirror, mirrorMasks, parseMirrorParameters } from "../../src/geometry/modifiers/mirror";
import type { Modifier, Project } from "../../src/domain/types";

const triangle = { positions: new Float32Array([1, 0, 0, 2, 0, 0, 1, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
const params = { axes: "x" as const, pivot: [0, 0, 0] as const, mergeSeam: false };

function fixture(): Project {
  let next = 0;
  const project = createProject(() => `id-${++next}`);
  const root = project.nodes[0]!;
  for (const id of ["a", "b"]) { root.children.push(id); project.nodes.push(createPrimitiveNode("cube", root.id, id)); }
  return project;
}
function add(project: Project, id: string, kind: Modifier["kind"], parameters: Modifier["parameters"]): Modifier {
  const node = project.nodes.find(n => n.id === "a")!;
  const modifier: Modifier = { id, nodeId: "a", kind, order: node.modifierIds.length, enabled: true, version: 0, parameters: structuredClone(parameters) };
  node.modifierIds.push(id); project.modifiers.push(modifier); return modifier;
}

describe("Mirror geometry", () => {
  it.each(["x", "y", "z", "xy", "xz", "yz", "xyz"] as const)("enumerates %s deterministically", async axes => {
    const before = triangle.positions.slice(), indices = triangle.indices.slice();
    const result = await evaluateMirror(triangle, { axes, pivot: [0.5, 0.25, 0], mergeSeam: false });
    const copies = 2 ** axes.length;
    expect(result.mesh.positions.length).toBe(triangle.positions.length * copies);
    expect(result.mesh.indices.length).toBe(triangle.indices.length * copies);
    expect(result.mesh.indices.slice(0, 3)).toEqual(indices);
    expect(result.mesh.positions.slice(0, 3)).toEqual(before.slice(0, 3));
    for (const [copy, mask] of mirrorMasks(axes).entries()) {
      for (let component = 0; component < 3; component++) {
        const pivot = [0.5, 0.25, 0][component]!;
        const expected = mask & (1 << component) ? 2 * pivot - before[component]! : before[component]!;
        expect(result.mesh.positions[copy * before.length + component]).toBe(expected);
      }
      const offset = copy * before.length / 3;
      const odd = ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1)) % 2;
      expect(result.mesh.indices.slice(copy * 3, copy * 3 + 3)).toEqual(new Uint32Array(odd ? [offset, offset + 2, offset + 1] : [offset, offset + 1, offset + 2]));
    }
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "MIRROR_UNMERGED" }));
    expect(triangle.positions).toEqual(before); expect(triangle.indices).toEqual(indices);
    expect(await evaluateMirror(triangle, { axes, pivot: [0.5, 0.25, 0], mergeSeam: false })).toEqual(result);
  });
  it("uses a pivot and flips winding for odd reflections only", async () => {
    const one = await evaluateMirror(triangle, { ...params, pivot: [0.5, 0, 0] });
    expect(one.mesh.positions.slice(9, 12)).toEqual(new Float32Array([0, 0, 0]));
    expect(one.mesh.indices.slice(3)).toEqual(new Uint32Array([3, 5, 4]));
    const two = await evaluateMirror(triangle, { axes: "xy", pivot: [0, 0, 0], mergeSeam: false });
    expect(mirrorMasks("xy")).toEqual([0, 1, 2, 3]);
    expect(two.mesh.indices.slice(9, 12)).toEqual(new Uint32Array([9, 10, 11]));
  });
  it("rejects malformed parameters, overflow, budget and cancellation", async () => {
    for (const invalid of [{ ...params, axes: "yx" }, { ...params, axes: "xx" }, { ...params, pivot: [0, 0] }, { ...params, pivot: [0, Infinity, 0] }, { ...params, mergeSeam: 1 }, { ...params, extra: 1 }, { pivot: [0, 0, 0], mergeSeam: false }])
      expect(() => parseMirrorParameters(invalid)).toThrow();
    await expect(evaluateMirror(triangle, { ...params, pivot: [3e38, 0, 0] })).rejects.toMatchObject({ code: "INVALID_MODIFIER" });
    const large = { positions: new Float32Array(9_000_000), indices: new Uint32Array([0, 1, 2]) };
    large.positions.set(triangle.positions);
    await expect(evaluateMirror(large, params)).rejects.toMatchObject({ code: "RESOURCE_TOO_LARGE" });
    const pre = new AbortController(); pre.abort();
    await expect(evaluateMirror(triangle, params, pre.signal)).rejects.toMatchObject({ code: "JOB_CANCELLED" });
    const active = new AbortController();
    const many = { positions: new Float32Array(300_003), indices: new Uint32Array([0, 1, 2]) };
    many.positions.set(triangle.positions);
    const pending = evaluateMirror(many, params, active.signal); active.abort();
    await expect(pending).rejects.toMatchObject({ code: "JOB_CANCELLED" });
  });
  it("uses CSG union and rejects invalid solids", async () => {
    const p = fixture(); const evaluator = new ModifierEvaluator();
    const source = await evaluator.evaluate(p, "a"); evaluator.dispose();
    if (!source.ok) throw new Error("fixture");
    const run = vi.fn(async (request: CsgRequest): Promise<CsgResult> => ({ jobId: request.jobId, coordinateSpace: "target-local", output: request.target.mesh, empty: false, faceOrigins: new Uint8Array(request.target.mesh.indices.length / 3), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] }));
    await evaluateMirror(source.mesh, { ...params, mergeSeam: true }, undefined, { runner: { run }, jobId: () => "union" });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ operation: "union" }), undefined);
    const bad = vi.fn().mockRejectedValue(new CsgError("GEOMETRY_NON_MANIFOLD", "open mesh"));
    await expect(evaluateMirror(triangle, { ...params, mergeSeam: true }, undefined, { runner: { run: bad }, jobId: () => "bad" })).rejects.toMatchObject({ code: "GEOMETRY_NON_MANIFOLD" });
  });
  it("unions a closed cube with its reflection through the existing Manifold core", async () => {
    const p = fixture(); const evaluator = new ModifierEvaluator();
    const source = await evaluator.evaluate(p, "a"); evaluator.dispose();
    if (!source.ok) throw new Error("fixture");
    const run = async (request: CsgRequest): Promise<CsgResult> => {
      const result = await compute("union", request.target.mesh, request.cutter.mesh);
      return { jobId: request.jobId, coordinateSpace: "target-local", output: result.output, empty: result.empty, faceOrigins: result.faceOrigins, stats: { inputTriangles: result.inputTriangles, outputTriangles: result.outputTriangles, computeMs: result.computeMs }, warnings: [] };
    };
    const merged = await evaluateMirror(source.mesh, { axes: "x", pivot: [0.25, 0, 0], mergeSeam: true }, undefined, { runner: { run }, jobId: () => "real" });
    expect(merged.mesh.indices.length).toBeGreaterThan(0);
    await expect(evaluateMirror(triangle, { ...params, mergeSeam: true }, undefined, { runner: { run }, jobId: () => "open" })).rejects.toMatchObject({ code: "GEOMETRY_NON_MANIFOLD" });
  });
});

describe("Mirror evaluator and document", () => {
  it("validates disabled Mirror and round-trips schema v1", () => {
    const p = fixture(); const m = add(p, "mirror", "mirror", params);
    expect(validateProject(p)).toEqual([]);
    const serialized = serializeProjectDocument(p);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(deserializeProjectDocument(serialized.value)).toMatchObject({ ok: true, value: { modifiers: [expect.objectContaining({ kind: "mirror" })] } });
    m.enabled = false; m.parameters.axes = "yx";
    expect(validateProject(p)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "modifiers.mirror.parameters" })]));
    expect(serializeProjectDocument(p).ok).toBe(false);
  });
  it("applies order, disabled state, cache reuse and parameter invalidation", async () => {
    const p = fixture(); const evaluator = new ModifierEvaluator();
    const array = add(p, "array", "array", { mode: "linear", count: 2, axis: "x", step: 3, offset: [0, 0, 0] });
    const mirror = add(p, "mirror", "mirror", params);
    expect(parseMirrorParameters(mirror.parameters)).toEqual(params);
    const first = await evaluator.evaluate(p, "a");
    expect(first.ok, JSON.stringify(first.ok ? {} : first.error)).toBe(true);
    expect(first.ok && first.appliedModifierIds).toEqual(["array", "mirror"]);
    const cached = await evaluator.evaluate(p, "a"); expect(cached).toEqual(first);
    if (!first.ok) return;
    mirror.parameters.pivot = [2, 0, 0];
    const changed = await evaluator.evaluate(p, "a");
    expect(changed.ok && changed.mesh.positions).not.toEqual(first.mesh.positions);
    p.nodes.find(n => n.id === "a")!.modifierIds.reverse(); mirror.order = 0; array.order = 1;
    const reordered = await evaluator.evaluate(p, "a");
    expect(reordered.ok && reordered.appliedModifierIds).toEqual(["mirror", "array"]);
    mirror.enabled = false;
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ ok: true, appliedModifierIds: ["array"] });
    evaluator.dispose();
  });
  it("round-trips Mirror through the native archive", async () => {
    const p = fixture(); add(p, "mirror", "mirror", { axes: "xyz", pivot: [1, 2, 3], mergeSeam: true });
    const saved = await createNativeProjectArchive(p, new AssetBytes(), "0.1.0");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const loaded = await openNativeProjectArchive(saved.value);
    expect(loaded.ok && loaded.value.project).toEqual(p);
  });
  it("reflects a Boolean result and changes CSG input when the stack is reordered", async () => {
    const p = fixture();
    const boolean = add(p, "boolean", "boolean", { operation: "subtract", cutterNodeId: "b" });
    const mirror = add(p, "mirror", "mirror", params);
    const requests: CsgRequest[] = [];
    const run = vi.fn(async (request: CsgRequest): Promise<CsgResult> => {
      requests.push(request);
      const output = { positions: request.target.mesh.positions.slice(), indices: request.target.mesh.indices.slice() };
      output.positions[0] = output.positions[0]! + 0.125;
      return { jobId: request.jobId, coordinateSpace: "target-local", output, empty: false, faceOrigins: new Uint8Array(output.indices.length / 3), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] };
    });
    const evaluator = new ModifierEvaluator({ csg: { run, cancel: vi.fn() } });
    const afterBoolean = await evaluator.evaluate(p, "a");
    expect(afterBoolean.ok && afterBoolean.appliedModifierIds).toEqual(["boolean", "mirror"]);
    expect(requests[0]!.target.mesh.indices.length).toBeGreaterThan(0);
    p.nodes.find(n => n.id === "a")!.modifierIds.reverse(); boolean.order = 1; mirror.order = 0;
    const beforeBoolean = await evaluator.evaluate(p, "a");
    expect(beforeBoolean.ok && beforeBoolean.appliedModifierIds).toEqual(["mirror", "boolean"]);
    expect(requests[1]!.target.mesh.indices.length).toBe(requests[0]!.target.mesh.indices.length * 2);
    expect(afterBoolean.ok && beforeBoolean.ok && beforeBoolean.mesh.positions).not.toEqual(afterBoolean.ok && afterBoolean.mesh.positions);
    evaluator.dispose();
  });
});

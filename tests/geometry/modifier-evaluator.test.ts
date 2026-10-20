import { describe, expect, it, vi } from "vitest";
import type { Project, Modifier } from "../../src/domain/types";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { ModifierEvaluator } from "../../src/geometry/modifiers";
import { CsgError, type CsgRequest, type CsgResult } from "../../src/geometry/csg";

function fixture(): Project {
  const p = createProject(() => `id-${Math.random()}`);
  const root = p.nodes[0]!;
  for (const id of ["a", "b", "c", "d"]) { p.nodes.push(createPrimitiveNode("cube", root.id, id)); root.children.push(id); }
  return p;
}
function add(p: Project, nodeId: string, id: string, cutterNodeId: string, operation: "subtract" | "union" | "intersect" = "subtract") {
  const node = p.nodes.find(n => n.id === nodeId)!;
  const m: Modifier = { id, nodeId, kind: "boolean", order: node.modifierIds.length, enabled: true, version: 0, parameters: { cutterNodeId, operation } };
  node.modifierIds.push(id); p.modifiers.push(m); return m;
}
function fake() {
  const calls: CsgRequest[] = [];
  const run = vi.fn(async (request: CsgRequest): Promise<CsgResult> => {
    calls.push(request);
    const output = { positions: request.target.mesh.positions.slice(), indices: request.target.mesh.indices.slice() };
    output.positions[0] = (output.positions[0] ?? 0) + 0.1;
    return { jobId: request.jobId, coordinateSpace: "target-local", output, empty: false, faceOrigins: new Uint8Array(output.indices.length / 3), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] };
  });
  return { run, cancel: vi.fn(), calls };
}

describe("ModifierEvaluator", () => {
  it("evaluates Array after Boolean and Boolean after Array in global order", async () => {
    const p = fixture(), csg = fake(), evaluator = new ModifierEvaluator({ csg });
    const boolean = add(p, "a", "bool", "b");
    const array: Modifier = { id: "array", nodeId: "a", kind: "array", order: 1, enabled: true, version: 0, parameters: { mode: "linear", count: 3, axis: "x", step: 2, offset: [0, 0, 0] } };
    p.modifiers.push(array); p.nodes.find(n => n.id === "a")!.modifierIds.push(array.id);
    const first = await evaluator.evaluate(p, "a");
    expect(first.ok && first.appliedModifierIds).toEqual(["bool", "array"]);
    if (!first.ok) return;
    expect(first.mesh.indices.length).toBe(csg.calls[0]!.target.mesh.indices.length * 3);
    p.nodes.find(n => n.id === "a")!.modifierIds.reverse(); boolean.order = 1; array.order = 0;
    const second = await evaluator.evaluate(p, "a");
    expect(second.ok && second.appliedModifierIds).toEqual(["array", "bool"]);
    expect(csg.calls[1]!.target.mesh.indices.length).toBe(csg.calls[0]!.target.mesh.indices.length * 3);
    array.enabled = false;
    const disabled = await evaluator.evaluate(p, "a");
    expect(disabled.ok && disabled.appliedModifierIds).toEqual(["bool"]);
    array.enabled = true; array.parameters.step = 3; array.version++;
    await evaluator.evaluate(p, "a");
    expect(csg.calls).toHaveLength(4);
  });
  it("returns source geometry, leaves Project untouched and protects cached buffers", async () => {
    const p = fixture(), before = JSON.stringify(p), csg = fake(), evaluator = new ModifierEvaluator({ csg });
    const first = await evaluator.evaluate(p, "a");
    expect(first.ok).toBe(true);
    if (first.ok) first.mesh.positions[0] = 500;
    const second = await evaluator.evaluate(p, "a");
    expect(second.ok && second.mesh.positions[0]).not.toBe(500);
    expect(csg.calls).toHaveLength(0); expect(JSON.stringify(p)).toBe(before);
    evaluator.dispose(); expect(evaluator.cacheSizeBytes).toBe(0);
  });
  it("applies two stages in order, resolves parent transforms, and reuses cache", async () => {
    const p = fixture(), csg = fake();
    add(p, "a", "m1", "b"); add(p, "a", "m2", "c", "union");
    p.nodes.find(n => n.id === "a")!.transform.position = [1, 0, 0];
    p.nodes.find(n => n.id === "b")!.transform.position = [2, 0, 0];
    const evaluator = new ModifierEvaluator({ csg });
    const first = await evaluator.evaluate(p, "a");
    expect(first.ok && first.appliedModifierIds).toEqual(["m1", "m2"]);
    expect(csg.calls.map(x => x.operation)).toEqual(["subtract", "union"]);
    expect(csg.calls[1]!.target.mesh.positions[0]).toBeCloseTo(csg.calls[0]!.target.mesh.positions[0]! + 0.1);
    expect(csg.calls[0]!.target.worldMatrix![12]).toBe(1);
    expect(csg.calls[0]!.cutter.worldMatrix![12]).toBe(2);
    await evaluator.evaluate(p, "a"); expect(csg.calls).toHaveLength(2);
    p.modifiers[1]!.parameters.operation = "intersect";
    await evaluator.evaluate(p, "a"); expect(csg.calls).toHaveLength(3);
    expect(csg.calls[2]!.operation).toBe("intersect");
  });
  it("invalidates dependent stages but preserves independent stages", async () => {
    const p = fixture(), csg = fake(), evaluator = new ModifierEvaluator({ csg });
    add(p, "a", "ma", "b"); add(p, "d", "md", "c");
    await evaluator.evaluate(p, "a"); await evaluator.evaluate(p, "d");
    expect(csg.calls).toHaveLength(2);
    p.nodes.find(n => n.id === "b")!.transform.position = [3, 0, 0];
    await evaluator.evaluate(p, "a"); await evaluator.evaluate(p, "d");
    expect(csg.calls).toHaveLength(3);
    const b = p.nodes.find(n => n.id === "b")!;
    if (b.kind === "mesh" && b.meshSource.kind === "primitive") b.meshSource.parameters.size = 2;
    await evaluator.evaluate(p, "a"); expect(csg.calls).toHaveLength(4);
  });
  it("handles toggle and reorder without treating disabled modifiers as applied", async () => {
    const p = fixture(), csg = fake(), evaluator = new ModifierEvaluator({ csg });
    const one = add(p, "a", "one", "b"), two = add(p, "a", "two", "c", "union");
    await evaluator.evaluate(p, "a");
    one.enabled = false;
    const toggled = await evaluator.evaluate(p, "a");
    expect(toggled.ok && toggled.appliedModifierIds).toEqual(["two"]);
    expect(csg.calls).toHaveLength(3);
    one.enabled = true;
    await evaluator.evaluate(p, "a"); expect(csg.calls).toHaveLength(3);
    p.nodes.find(n => n.id === "a")!.modifierIds = ["two", "one"];
    two.order = 0; one.order = 1;
    const reordered = await evaluator.evaluate(p, "a");
    expect(reordered.ok && reordered.appliedModifierIds).toEqual(["two", "one"]);
    expect(csg.calls).toHaveLength(5);
  });
  it("reports missing, self and indirect cycles, bad parameters and unsupported kinds", async () => {
    const p = fixture(), evaluator = new ModifierEvaluator({ csg: fake() });
    const m = add(p, "a", "ma", "missing");
    expect((await evaluator.evaluate(p, "a")).ok).toBe(false);
    expect((await evaluator.evaluate(p, "a"))).toMatchObject({ error: { code: "INVALID_REFERENCE" } });
    m.parameters.cutterNodeId = "a";
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ error: { code: "DEPENDENCY_CYCLE" } });
    m.parameters.cutterNodeId = "b"; add(p, "b", "mb", "a");
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ error: { code: "DEPENDENCY_CYCLE" } });
    p.nodes.find(n => n.id === "b")!.modifierIds = []; p.modifiers.pop();
    m.parameters = { operation: "wrong", cutterNodeId: "b" };
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ error: { code: "INVALID_MODIFIER" } });
    m.kind = "mirror";
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ error: { code: "UNSUPPORTED_MODIFIER" } });
  });
  it("keeps a fallback on worker failure and recovers on retry", async () => {
    const p = fixture(), csg = fake(), evaluator = new ModifierEvaluator({ csg });
    add(p, "a", "m", "b");
    csg.run.mockRejectedValueOnce(new CsgError("GEOMETRY_NON_MANIFOLD", "open surface"));
    const failed = await evaluator.evaluate(p, "a");
    expect(failed).toMatchObject({ ok: false, error: { code: "GEOMETRY_NON_MANIFOLD" }, fallback: true, appliedModifierIds: [] });
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ ok: true });
  });
  it("cancels an in-flight job, rejects late output, then accepts another job", async () => {
    const p = fixture(), controller = new AbortController(), csg = fake();
    add(p, "a", "m", "b");
    let complete!: (value: CsgResult) => void;
    csg.run.mockImplementationOnce((request: CsgRequest) => new Promise<CsgResult>(resolve => { complete = resolve; csg.calls.push(request); }));
    const evaluator = new ModifierEvaluator({ csg });
    const pending = evaluator.evaluate(p, "a", controller.signal);
    await vi.waitFor(() => expect(csg.calls).toHaveLength(1));
    controller.abort();
    complete({ jobId: "late", coordinateSpace: "target-local", output: csg.calls[0]!.target.mesh, empty: false, faceOrigins: new Uint8Array(), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] });
    expect(await pending).toMatchObject({ ok: false, error: { code: "JOB_CANCELLED" }, fallback: false });
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ ok: true });
  });
  it("composes different parent transforms", async () => {
    const p = fixture(), csg = fake();
    add(p, "a", "m", "b");
    const root = p.nodes[0]!;
    const group = { ...structuredClone(root), id: "group", parentId: root.id, children: ["b"], transform: { ...root.transform, position: [5, 0, 0] as const } };
    p.nodes.push(group); root.children.push(group.id);
    p.nodes.find(n => n.id === "b")!.parentId = group.id;
    p.nodes.find(n => n.id === "b")!.transform.position = [2, 0, 0];
    await new ModifierEvaluator({ csg }).evaluate(p, "a");
    expect(csg.calls[0]!.cutter.worldMatrix![12]).toBe(7);
  });
  it("uses only local asset resolver and its content fingerprint", async () => {
    const p = fixture(), csg = fake();
    const a = p.nodes.find(n => n.id === "a")!;
    if (a.kind !== "mesh") throw new Error("fixture");
    a.meshSource = { kind: "asset", assetId: "asset" };
    p.assets.push({ id: "asset", hash: "hash", mediaType: "model/gltf-binary", path: "assets/a.glb", colorSpace: "none" });
    let fingerprint = "v1";
    const resolver = vi.fn(async () => ({ mesh: { positions: new Float32Array([-1,-1,0, 1,-1,0, 0,1,0]), indices: new Uint32Array([0,1,2]) }, fingerprint }));
    const evaluator = new ModifierEvaluator({ csg, assetResolver: resolver });
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ ok: true });
    fingerprint = "v2";
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ ok: true });
    expect(resolver).toHaveBeenCalledTimes(2);
    await expect(new ModifierEvaluator({ csg }).evaluate(p, "a")).resolves.toMatchObject({ error: { code: "ASSET_DECODE_FAILED" } });
  });
  it("accepts empty intersection and bounded cache eviction", async () => {
    const p = fixture(), csg = fake(); add(p, "a", "m", "b", "intersect");
    csg.run.mockResolvedValueOnce({ jobId: "empty", coordinateSpace: "target-local", output: { positions: new Float32Array(), indices: new Uint32Array() }, empty: true, faceOrigins: new Uint8Array(), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] });
    const evaluator = new ModifierEvaluator({ csg, byteBudget: 1000 });
    expect(await evaluator.evaluate(p, "a")).toMatchObject({ ok: true, empty: true });
    expect(evaluator.cacheSizeBytes).toBeLessThanOrEqual(1000);
    evaluator.clearCache(); expect(evaluator.cacheSizeBytes).toBe(0);
  });
  it("rejects a changed Project after an asynchronous worker completes", async () => {
    const p = fixture(), csg = fake(); add(p, "a", "m", "b");
    let complete!: (value: CsgResult) => void;
    csg.run.mockImplementationOnce((request: CsgRequest) => new Promise<CsgResult>(resolve => { complete = resolve; csg.calls.push(request); }));
    const evaluator = new ModifierEvaluator({ csg });
    const pending = evaluator.evaluate(p, "a");
    await vi.waitFor(() => expect(csg.calls).toHaveLength(1));
    p.nodes.find(n => n.id === "b")!.transform.position = [1, 0, 0];
    complete({ jobId: "late", coordinateSpace: "target-local", output: csg.calls[0]!.target.mesh, empty: false, faceOrigins: new Uint8Array(), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] });
    expect(await pending).toMatchObject({ ok: false, error: { code: "STALE_PROJECT" }, fallback: false });
  });
});

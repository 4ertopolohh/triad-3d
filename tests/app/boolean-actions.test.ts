import { describe, expect, it, vi } from "vitest";
import { applyBooleanChange } from "../../src/app/boolean-actions";
import { createEditorStore } from "../../src/app/editor-store";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { ModifierEvaluator } from "../../src/geometry/modifiers";
import { CsgError, type CsgRequest, type CsgResult } from "../../src/geometry/csg";

function fixture() {
  const project = createProject(() => crypto.randomUUID());
  const root = project.nodes[0]!;
  for (const id of ["target", "cutter", "third"]) { project.nodes.push(createPrimitiveNode("cube", root.id, id)); root.children.push(id); }
  return createEditorStore(project);
}
function runner(run?: (request: CsgRequest) => Promise<CsgResult>) {
  const success = async (request: CsgRequest): Promise<CsgResult> => ({ jobId: request.jobId, coordinateSpace: "target-local", output: { positions: request.target.mesh.positions.slice(), indices: request.target.mesh.indices.slice() }, empty: false, faceOrigins: new Uint8Array(request.target.mesh.indices.length / 3), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] });
  const csg = { run: vi.fn(run ?? success), cancel: vi.fn() };
  return { csg, factory: () => new ModifierEvaluator({ csg }) };
}
const add = (operation: "subtract" | "union" | "intersect" = "subtract", hideCutter = false) => ({ type: "add" as const, targetId: "target", cutterId: "cutter", operation, hideCutter });
const state = (store: ReturnType<typeof fixture>) => ({ project: store.getSnapshot().document.project, revision: store.getSnapshot().document.revision, dirty: store.getSnapshot().document.dirty, history: store.getSnapshot().history });

describe("Boolean user actions", () => {
  it.each(["subtract", "union", "intersect"] as const)("validates %s before one commit, then undo/redo", async operation => {
    const store = fixture(), { csg, factory } = runner();
    const result = await applyBooleanChange(store, add(operation, true), factory);
    expect(result).toMatchObject({ ok: true, committed: true });
    expect(csg.run).toHaveBeenCalledOnce();
    expect(store.getSnapshot().document.project.modifiers[0]?.parameters).toEqual({ operation, cutterNodeId: "cutter" });
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "cutter")?.visible).toBe(false);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.undo(1).ok).toBe(true);
    expect(store.getSnapshot().document.project.modifiers).toHaveLength(0);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "cutter")?.visible).toBe(true);
    expect(store.redo(2).ok).toBe(true);
  });

  it("rejects invalid candidate before CSG and preserves history", async () => {
    const store = fixture(), before = state(store), { csg, factory } = runner();
    const result = await applyBooleanChange(store, { ...add(), cutterId: "target" }, factory);
    expect(result.ok).toBe(false);
    expect(csg.run).not.toHaveBeenCalled();
    expect(state(store)).toEqual(before);
  });

  it("rejects CSG failure and permits a later valid operation", async () => {
    const store = fixture(), before = state(store);
    const failing = runner(async () => { throw new CsgError("WORKER_FAILED", "Worker stopped"); });
    expect((await applyBooleanChange(store, add(), failing.factory)).ok).toBe(false);
    expect(state(store)).toEqual(before);
    expect((await applyBooleanChange(store, add(), runner().factory)).ok).toBe(true);
  });

  it("cancels pending work and ignores its late response", async () => {
    const store = fixture(), before = state(store);
    let resolve!: (value: CsgResult) => void;
    const gate = new Promise<CsgResult>(done => { resolve = done; });
    const { csg, factory } = runner(() => gate);
    const pending = applyBooleanChange(store, add(), factory);
    for (let i = 0; i < 20 && !csg.run.mock.calls.length; i++) await new Promise(done => setTimeout(done, 0));
    expect(store.jobs.cancelJob()).toBe(true);
    expect((await pending).status).toBe("cancelled");
    expect(state(store)).toEqual(before);
    const request = csg.run.mock.calls[0]![0];
    resolve({ jobId: request.jobId, coordinateSpace: "target-local", output: { positions: request.target.mesh.positions.slice(), indices: request.target.mesh.indices.slice() }, empty: false, faceOrigins: new Uint8Array(request.target.mesh.indices.length / 3), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] });
    await Promise.resolve();
    expect(state(store)).toEqual(before);
  });

  it("updates, toggles, reorders and removes through commands", async () => {
    const store = fixture(), factory = runner().factory;
    expect((await applyBooleanChange(store, add(), factory)).ok).toBe(true);
    expect((await applyBooleanChange(store, { ...add("union"), cutterId: "third" }, factory)).ok).toBe(true);
    const ids = store.getSnapshot().document.project.nodes.find(node => node.id === "target")!.modifierIds;
    expect((await applyBooleanChange(store, { type: "move", targetId: "target", modifierId: ids[1]!, toIndex: 0 }, factory)).ok).toBe(true);
    expect((await applyBooleanChange(store, { type: "update", targetId: "target", modifierId: ids[0]!, cutterId: "third", operation: "intersect" }, factory)).ok).toBe(true);
    expect((await applyBooleanChange(store, { type: "enable", targetId: "target", modifierId: ids[0]!, enabled: false }, factory)).ok).toBe(true);
    expect((await applyBooleanChange(store, { type: "remove", targetId: "target", modifierId: ids[0]! }, factory)).ok).toBe(true);
    expect(store.getSnapshot().document.project.modifiers).toHaveLength(1);
  });
});

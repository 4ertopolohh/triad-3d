import { describe, expect, it, vi } from "vitest";
import { createEditorStore } from "../../src/app/editor-store";
import { createJobController, type JobComputeResult, type JobInput, type JobSpec } from "../../src/app/job-controller";
import type { ProjectCommand } from "../../src/domain/command-bus";
import { createNestedMeshProject } from "../fixtures/projects";
import { AssetBytes } from "../../src/assets/asset-bytes";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const rename = (name: string): ProjectCommand => ({ commandId: `rename-${name}`, type: "RENAME_NODE", targetIds: ["mesh-node"], payload: { nodeId: "mesh-node", name } });
const spec = <T>(id: string, compute: JobSpec<T>["compute"], commands?: JobSpec<T>["commands"]): JobSpec<T> =>
  ({ id, name: "Проверка геометрии", cancellable: true, validate: () => null, compute, ...(commands ? { commands } : {}) });
const snapshot = (store: ReturnType<typeof createEditorStore>) => ({
  project: store.getSnapshot().document.project, revision: store.getSnapshot().document.revision,
  dirty: store.getSnapshot().document.dirty, history: store.getSnapshot().history,
  derived: store.getSnapshot().derived,
});

describe("transactional heavy jobs", () => {
  it("moves through validation, computation and one atomic undoable commit", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const gate = deferred<JobComputeResult<string>>();
    const statuses: string[] = [];
    const publications: number[] = [];
    store.subscribe(() => { statuses.push(store.getSnapshot().job.status); publications.push(store.getSnapshot().derived.generation); });
    const pending = store.jobs.run(spec("one", () => gate.promise, name => [rename(name), rename(`${name} final`)]));
    await Promise.resolve();
    expect(store.getSnapshot().job.status).toBe("running");
    gate.resolve({ ok: true, value: "Result" });
    expect(await pending).toMatchObject({ ok: true, committed: true });
    expect(statuses).toEqual(["validating", "running", "applying", "applying", "succeeded"]);
    expect(publications.filter(value => value === 1)).toHaveLength(2);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")?.name).toBe("Result final");
    expect(store.undo(1).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")?.name).toBe("Куб");
  });

  it("fails validation without computing or touching document state", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = snapshot(store);
    const compute = vi.fn(async () => ({ ok: true as const, value: "unused" }));
    const result = await store.jobs.run({ ...spec("invalid", compute), validate: () => ({ code: "VALIDATION_FAILED", message: "Недопустимая операция." }) });
    expect(result).toMatchObject({ ok: false, status: "validation_failed", error: { code: "VALIDATION_FAILED" } });
    expect(compute).not.toHaveBeenCalled();
    expect(snapshot(store)).toEqual(before);
  });

  it("rejects concurrent calls before starting a second computation", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const gate = deferred<JobComputeResult<void>>();
    const first = store.jobs.run(spec("first", () => gate.promise));
    const secondCompute = vi.fn(async () => ({ ok: true as const, value: undefined }));
    expect(await store.jobs.run(spec("second", secondCompute))).toMatchObject({ ok: false, error: { code: "JOB_BUSY" } });
    expect(secondCompute).not.toHaveBeenCalled();
    gate.resolve({ ok: true, value: undefined });
    expect((await first).ok).toBe(true);
  });

  it("aborts, ignores late success and progress, unlocks, and starts another job", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = snapshot(store);
    const gate = deferred<JobComputeResult<string>>();
    let report!: (progress: number) => void;
    let signal!: AbortSignal;
    const pending = store.jobs.run(spec("cancel", (_input, currentSignal, progress) => {
      signal = currentSignal; report = progress; return gate.promise;
    }, name => [rename(name)]));
    await Promise.resolve();
    report(0.3); report(-1); report(Number.NaN); report(2);
    expect(store.getSnapshot().job.progress).toBe(0.3);
    expect(store.jobs.cancelJob()).toBe(true);
    expect(store.jobs.cancelJob()).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(await pending).toMatchObject({ status: "cancelled", error: { code: "JOB_CANCELLED" } });
    gate.resolve({ ok: true, value: "Late" });
    report(0.9);
    await Promise.resolve();
    expect(snapshot(store)).toEqual(before);
    expect(store.getSnapshot().job.progress).toBeNull();
    expect(await store.jobs.run(spec("next", async () => ({ ok: true, value: undefined })))).toMatchObject({ ok: true, committed: false });
    expect(snapshot(store)).toEqual(before);
  });

  it("preserves structured worker errors and permits recovery", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = snapshot(store);
    const failed = await store.jobs.run(spec("worker", async () => { throw Object.assign(new Error("Worker crashed"), { code: "WORKER_FAILED" }); }, () => [rename("Wrong")]));
    expect(failed).toMatchObject({ ok: false, status: "failed", error: { code: "WORKER_FAILED", message: "Worker crashed" } });
    expect(snapshot(store)).toEqual(before);
    expect(await store.jobs.run(spec("recovery", async () => ({ ok: true, value: "Recovered" }), name => [rename(name)]))).toMatchObject({ ok: true });
  });

  it("blocks all public document and context mutations while running", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const gate = deferred<JobComputeResult<void>>();
    const captured = store.captureDocument();
    const pending = store.jobs.run(spec("guard", () => gate.promise));
    await Promise.resolve();
    const before = snapshot(store);
    expect(store.executeCommand(rename("No"), 0)).toMatchObject({ ok: false, code: "JOB_BUSY" });
    expect(store.executeTransaction([rename("No")], 0)).toMatchObject({ ok: false, code: "JOB_BUSY" });
    expect(store.undo(0)).toMatchObject({ ok: false, code: "JOB_BUSY" });
    expect(store.redo(0)).toMatchObject({ ok: false, code: "JOB_BUSY" });
    expect(store.cancelGesture("gesture", 0)).toMatchObject({ ok: false, code: "JOB_BUSY" });
    expect(store.addMeshAsset({ commandId: "asset", type: "ADD_MESH_ASSET", targetIds: ["a", "b", "c"], payload: { parentId: "a", node: null as never, asset: null } }, new Uint8Array(), 0, captured.identity)).toMatchObject({ ok: false, code: "JOB_BUSY" });
    expect(store.replaceProject({ project: createNestedMeshProject(), assets: new AssetBytes() }, captured.identity)).toBe(false);
    expect(store.confirmSaved(captured.revision, captured.identity)).toBe(false);
    store.setSelection(["mesh-node"]); store.setTool({ mode: "scene" });
    expect(store.getSnapshot().selection.ids).toEqual([]);
    expect(store.getSnapshot().tool.mode).toBe("model");
    expect(snapshot(store)).toEqual(before);
    gate.resolve({ ok: true, value: undefined });
    await pending;
  });

  it("rejects invalid commands without a partial commit", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = snapshot(store);
    const result = await store.jobs.run(spec("bad-commit", async () => ({ ok: true, value: undefined }), () => [rename("Partial"), { commandId: "wrong", type: "RENAME_NODE", payload: { nodeId: "missing", name: "Wrong" }, targetIds: ["missing"] }]));
    expect(result).toMatchObject({ ok: false, status: "failed", error: { code: "COMMIT_FAILED" } });
    expect(snapshot(store)).toEqual(before);
  });

  it("does not claim a commit or create history for a semantic no-op", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = snapshot(store);
    const result = await store.jobs.run(spec("noop", async () => ({ ok: true, value: "Куб" }), name => [rename(name)]));
    expect(result).toMatchObject({ ok: true, committed: false });
    expect(snapshot(store)).toEqual(before);
  });

  it("treats a structured compute failure as failure and a compute cancellation as cancelled", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = snapshot(store);
    expect(await store.jobs.run(spec("diagnostic", async () => ({ ok: false, error: { code: "GEOMETRY_NON_MANIFOLD", message: "Сетка не замкнута." } })))).toMatchObject({ status: "failed", error: { code: "GEOMETRY_NON_MANIFOLD" } });
    expect(await store.jobs.run(spec("compute-cancel", async () => ({ ok: false, error: { code: "JOB_CANCELLED", message: "Вычислитель остановлен." } })))).toMatchObject({ status: "cancelled", error: { code: "JOB_CANCELLED" } });
    expect(snapshot(store)).toEqual(before);
  });

  it("refuses stale identity, epoch and revision at commit", async () => {
    const project = createNestedMeshProject();
    const context = { project, revision: 0, projectId: project.id, identity: {}, epoch: {} };
    const commit = vi.fn();
    let current = true;
    const controller = createJobController({ capture: () => context as unknown as JobInput & { identity: object; epoch: object },
      isCurrent: () => current, publish: () => {}, commit });
    const gate = deferred<JobComputeResult<string>>();
    const pending = controller.run(spec("stale", () => gate.promise, name => [rename(name)]));
    await Promise.resolve();
    current = false;
    gate.resolve({ ok: true, value: "Stale" });
    expect(await pending).toMatchObject({ ok: false, error: { code: "STALE_PROJECT" } });
    expect(commit).not.toHaveBeenCalled();
  });

  it("disposes the owner safely and ignores a late result", async () => {
    const store = createEditorStore(createNestedMeshProject());
    const gate = deferred<JobComputeResult<string>>();
    const pending = store.jobs.run(spec("dispose", () => gate.promise, name => [rename(name)]));
    await Promise.resolve();
    store.jobs.dispose(); store.jobs.dispose();
    gate.resolve({ ok: true, value: "Too late" });
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(store.getSnapshot().document.revision).toBe(0);
    expect(await store.jobs.run(spec("after", async () => ({ ok: true, value: undefined })))).toMatchObject({ error: { code: "JOB_DISPOSED" } });
  });
});

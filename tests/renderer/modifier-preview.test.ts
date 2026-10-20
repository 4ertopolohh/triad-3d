import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { createEditorStore } from "../../src/app/editor-store";
import { ModifierEvaluator } from "../../src/geometry/modifiers";
import { CsgError, type CsgRequest, type CsgResult } from "../../src/geometry/csg";
import { ModifierPreview } from "../../src/renderer/modifier-preview";
import { SceneSync } from "../../src/renderer/scene-sync";
import { createNestedMeshProject } from "../fixtures/projects";

function fixture() {
  const project = createNestedMeshProject();
  const root = project.nodes[0]!;
  const cutter = structuredClone(project.nodes.find(node => node.id === "mesh-node")!);
  cutter.id = "cutter"; cutter.name = "Резак"; cutter.parentId = root.id; cutter.transform.position = [3, 0, 0];
  project.nodes.push(cutter); root.children.push(cutter.id);
  const target = project.nodes.find(node => node.id === "mesh-node")!;
  target.modifierIds.push("boolean-1");
  project.modifiers.push({ id: "boolean-1", nodeId: target.id, kind: "boolean", order: 0, version: 0,
    enabled: true, parameters: { operation: "subtract", cutterNodeId: cutter.id } });
  return project;
}
function result(request: CsgRequest, empty = false): CsgResult {
  const output = empty ? { positions: new Float32Array(), indices: new Uint32Array() }
    : { positions: request.target.mesh.positions.slice(), indices: request.target.mesh.indices.slice() };
  if (!empty) output.positions[0]! += 0.15;
  return { jobId: request.jobId, coordinateSpace: "target-local", output, empty,
    faceOrigins: new Uint8Array(output.indices.length / 3), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] };
}

describe("production modifier preview", () => {
  it.each(["subtract", "union", "intersect"] as const)("renders %s on the stable target and restores source on toggle", async operation => {
    const project = fixture(); project.modifiers[0]!.parameters.operation = operation;
    const original = JSON.stringify(project);
    const store = createEditorStore(project);
    const scene = new SceneSync(() => {});
    const runner = { run: vi.fn(async (request: CsgRequest) => result(request)), cancel: vi.fn() };
    const preview = new ModifierPreview(store, scene, new ModifierEvaluator({ csg: runner }));
    scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch());
    const wrapper = scene.objects.get("mesh-node")!.object;
    const source = scene.objects.get("mesh-node")!.content as T.Mesh;
    const dispose = vi.spyOn(source.geometry, "dispose");
    preview.sync();
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(scene.objects.get("mesh-node")!.content).not.toBe(source));
    expect(dispose).toHaveBeenCalledOnce();
    expect(scene.objects.get("mesh-node")!.object).toBe(wrapper);
    expect(scene.surfaces.nearest(new T.Ray(new T.Vector3(0, 0, 4), new T.Vector3(0, 0, -1)))?.nodeId).toBe("mesh-node");
    expect(JSON.stringify(store.getSnapshot().document.project)).toBe(original);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    const rev = store.getSnapshot().document.revision;
    expect(store.executeCommand({ commandId: "off", type: "SET_MODIFIER_ENABLED", targetIds: ["boolean-1"], payload: { modifierId: "boolean-1", enabled: false } }, rev).ok).toBe(true);
    scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch()); preview.sync();
    expect(scene.objects.get("mesh-node")!.object).toBe(wrapper);
    expect(scene.objects.get("mesh-node")!.content).toBeInstanceOf(T.Mesh);
    expect(runner.run).toHaveBeenCalledOnce();
    const baseAfterToggle = scene.objects.get("mesh-node")!.content;
    expect(store.undo(store.getSnapshot().document.revision).ok).toBe(true);
    scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch()); preview.sync();
    await vi.waitFor(() => expect(scene.objects.get("mesh-node")!.content).not.toBe(baseAfterToggle));
    expect(store.redo(store.getSnapshot().document.revision).ok).toBe(true);
    scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch()); preview.sync();
    expect(scene.objects.get("mesh-node")!.content).toBeInstanceOf(T.Mesh);
    preview.dispose(); scene.dispose();
  });
  it("shows a valid empty result without surface and with a diagnostic", async () => {
    const store = createEditorStore(fixture());
    const statuses: string[][] = [];
    const scene = new SceneSync(status => statuses.push(status.diagnostics));
    const runner = { run: vi.fn(async (request: CsgRequest) => result(request, true)), cancel: vi.fn() };
    const preview = new ModifierPreview(store, scene, new ModifierEvaluator({ csg: runner }));
    scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch()); preview.sync();
    await vi.waitFor(() => expect(statuses.at(-1)?.join(" ")).toContain("Результат Boolean пуст"));
    expect(scene.objects.get("mesh-node")!.content).toBeUndefined();
    preview.dispose(); scene.dispose();
  });
  it("recomputes after cutter and target-parent transforms", async () => {
    const store = createEditorStore(fixture()), scene = new SceneSync(() => {});
    const runner = { run: vi.fn(async (request: CsgRequest) => result(request)), cancel: vi.fn() };
    const preview = new ModifierPreview(store, scene, new ModifierEvaluator({ csg: runner }));
    const update = (nodeId: string, x: number) => {
      const node = store.getSnapshot().document.project.nodes.find(item => item.id === nodeId)!;
      expect(store.executeCommand({ commandId: `move-${nodeId}-${x}`, type: "SET_NODE_TRANSFORM", targetIds: [nodeId],
        payload: { nodeId, transform: { ...node.transform, position: [x, 0, 0] } } }, store.getSnapshot().document.revision).ok).toBe(true);
      scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch()); preview.sync();
    };
    scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch()); preview.sync();
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.getSnapshot().job.status).toBe("succeeded"));
    update("cutter", 4);
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(2));
    expect(runner.run.mock.calls[1]![0].cutter.worldMatrix![12]).toBe(4);
    await vi.waitFor(() => expect(store.getSnapshot().job.status).toBe("succeeded"));
    update("nested-group", 2);
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(3));
    expect(runner.run.mock.calls[2]![0].target.worldMatrix![12]).toBe(2);
    preview.dispose(); scene.dispose();
  });
  it("ignores a cancelled late Worker result and leaves document and history unchanged", async () => {
    const project = fixture(), original = JSON.stringify(project);
    const store = createEditorStore(project), scene = new SceneSync(() => {});
    let finish!: (value: CsgResult) => void;
    let request!: CsgRequest;
    const runner = { run: vi.fn((value: CsgRequest) => { request = value; return new Promise<CsgResult>(resolve => { finish = resolve; }); }), cancel: vi.fn() };
    const preview = new ModifierPreview(store, scene, new ModifierEvaluator({ csg: runner }));
    scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch());
    const source = scene.objects.get("mesh-node")!.content;
    preview.sync();
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledOnce());
    expect(store.jobs.cancelJob()).toBe(true);
    await vi.waitFor(() => expect(store.getSnapshot().job.status).toBe("cancelled"));
    finish(result(request));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(scene.objects.get("mesh-node")!.content).toBe(source);
    expect(JSON.stringify(store.getSnapshot().document.project)).toBe(original);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(store.getSnapshot().document.dirty).toBe(false);
    preview.dispose(); scene.dispose();
  });
  it("labels evaluator fallback after Worker failure", async () => {
    const store = createEditorStore(fixture()), statuses: string[][] = [];
    const scene = new SceneSync(status => statuses.push(status.diagnostics));
    const runner = { run: vi.fn(async () => { throw new CsgError("WORKER_FAILED", "worker unavailable"); }), cancel: vi.fn() };
    const preview = new ModifierPreview(store, scene, new ModifierEvaluator({ csg: runner }));
    scene.sync(store.getSnapshot().document.project, store.readAssetBytes, store.getProjectEpoch()); preview.sync();
    await vi.waitFor(() => expect(statuses.at(-1)?.join(" ")).toContain("Fallback"));
    expect(statuses.at(-1)?.join(" ")).toContain("WORKER_FAILED");
    preview.dispose(); scene.dispose();
  });
});

import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { createEditorStore } from "../../src/app/editor-store";
import { displayTransform, eulerDegrees, mixedValue, parseNumber, prepareFlagCommands, prepareTransformCommands, sessionCurrent, updatedPrimitiveSource, validateTransform } from "../../src/ui/inspector-logic";
import type { Project, Transform } from "../../src/domain/types";

function project(): Project {
  const result = createProject((() => { let index = 0; return () => `inspector-${++index}`; })());
  const a = createPrimitiveNode("cube", result.model.rootNodeId, "a");
  const b = createPrimitiveNode("sphere", result.model.rootNodeId, "b");
  result.nodes.push(a, b);
  result.nodes[0]!.children.push("a", "b");
  return result;
}
function edit(store: ReturnType<typeof createEditorStore>, field: "position" | "rotation" | "scale", axis: 0 | 1 | 2, value: number) {
  const state = store.getSnapshot();
  const prepared = prepareTransformCommands(state, { field, axis, value });
  if (!prepared.ok) return prepared;
  return store.executeTransaction(prepared.value, state.document.revision);
}

describe("Inspector transform operations", () => {
  it("edits one local component and replays reset", () => {
    const store = createEditorStore(project());
    store.setSelection(["a"], "a"); store.setTool({ space: "local" });
    expect(edit(store, "position", 0, 4).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "a")?.transform.position).toEqual([4, 0, 0]);
    const state = store.getSnapshot();
    const reset = prepareTransformCommands(state, { field: "position", reset: true });
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(store.executeTransaction(reset.value, state.document.revision).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "a")?.transform.position).toEqual([0, 0, 0]);
    expect(store.undo(2).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "a")?.transform.position).toEqual([4, 0, 0]);
    expect(store.redo(3).ok).toBe(true);
  });

  it("converts world edits through a transformed parent", () => {
    const source = project();
    const parent = source.nodes.find(node => node.id === source.model.rootNodeId)!;
    parent.transform.position = [3, 0, 0];
    parent.transform.rotationQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray() as Transform["rotationQuat"];
    const store = createEditorStore(source);
    store.setSelection(["a"], "a"); store.setTool({ space: "world" });
    expect(edit(store, "position", 0, 5).ok).toBe(true);
    const current = store.getSnapshot().document.project;
    const node = current.nodes.find(item => item.id === "a")!;
    expect(node.transform.position[1]).toBeCloseTo(-2);
    const displayed = displayTransform(current, node, "world");
    expect(displayed.ok && displayed.value.position[0]).toBeCloseTo(5);
  });

  it("keeps normalized Euler rotation and equivalent quaternion display", () => {
    const store = createEditorStore(project());
    store.setSelection(["a"], "a"); store.setTool({ space: "local" });
    expect(edit(store, "rotation", 2, 90).ok).toBe(true);
    const rotation = store.getSnapshot().document.project.nodes.find(node => node.id === "a")!.transform.rotationQuat;
    expect(Math.hypot(...rotation)).toBeCloseTo(1);
    expect(eulerDegrees({ position: [0, 0, 0], scale: [1, 1, 1], rotationQuat: rotation })[2]).toBeCloseTo(90);
    expect(eulerDegrees({ position: [0, 0, 0], scale: [1, 1, 1], rotationQuat: rotation.map(value => -value) as unknown as Transform["rotationQuat"] })[2]).toBeCloseTo(90);
  });

  it("rejects invalid numbers, scale and a sheared world matrix", () => {
    for (const text of ["", "NaN", "Infinity", "abc"]) expect(parseNumber(text).ok).toBe(false);
    expect(validateTransform({ position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [0, 1, 1] })).toBe(false);
    const source = project();
    const root = source.nodes[0]!;
    root.transform.scale = [2, 1, 1];
    root.transform.rotationQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4).toArray() as Transform["rotationQuat"];
    const a = source.nodes.find(node => node.id === "a")!;
    a.transform.rotationQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4).toArray() as Transform["rotationQuat"];
    const store = createEditorStore(source);
    store.setSelection(["a"], "a");
    expect(displayTransform(store.getSnapshot().document.project, store.getSnapshot().document.project.nodes.find(node => node.id === "a")!, "world").ok).toBe(false);
    expect(edit(store, "scale", 0, 0).ok).toBe(false);
    expect(store.getSnapshot().document.revision).toBe(0);
  });

  it("shows mixed values and commits a batch as one undo step", () => {
    const source = project();
    source.nodes.find(node => node.id === "b")!.transform.position = [2, 7, 0];
    const store = createEditorStore(source);
    store.setSelection(["a", "b"], "a"); store.setTool({ space: "local" });
    expect(mixedValue([0, 2])).toBeNull();
    expect(mixedValue([0, 0])).toBe(0);
    expect(edit(store, "position", 0, 5).ok).toBe(true);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "b")?.transform.position).toEqual([5, 7, 0]);
    expect(store.undo(1).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "b")?.transform.position).toEqual([2, 7, 0]);
    expect(store.redo(2).ok).toBe(true);
  });

  it("removes a cancelled preview from document and history", () => {
    const store = createEditorStore(project());
    store.setSelection(["a"], "a"); store.setTool({ space: "local" });
    const first = prepareTransformCommands(store.getSnapshot(), { field: "position", axis: 0, value: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(store.executeTransaction(first.value, 0, undefined, "numeric-gesture").ok).toBe(true);
    const second = prepareTransformCommands(store.getSnapshot(), { field: "position", axis: 0, value: 3 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(store.executeTransaction(second.value, 1, undefined, "numeric-gesture").ok).toBe(true);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.cancelGesture("numeric-gesture", 2).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "a")?.transform.position).toEqual([0, 0, 0]);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(store.getSnapshot().history.canRedo).toBe(false);
    expect(store.getSnapshot().document.dirty).toBe(false);
  });

  it("refuses locked, hidden, root and ancestor-descendant world batches", () => {
    const source = project();
    source.nodes.find(node => node.id === "b")!.locked = true;
    const store = createEditorStore(source);
    store.setSelection(["a", "b"], "a"); store.setTool({ space: "local" });
    expect(edit(store, "position", 0, 2).ok).toBe(false);
    expect(store.getSnapshot().document.revision).toBe(0);
    expect(prepareFlagCommands(store.getSnapshot(), "locked", false).ok).toBe(true);
    source.nodes.find(node => node.id === "b")!.locked = false;
    source.nodes.find(node => node.id === "b")!.visible = false;
    const hidden = createEditorStore(source); hidden.setSelection(["b"], "b");
    expect(prepareTransformCommands(hidden.getSnapshot(), { field: "position", axis: 0, value: 1 }).ok).toBe(false);
    expect(prepareFlagCommands(hidden.getSnapshot(), "visible", true).ok).toBe(true);
    hidden.setSelection([source.model.rootNodeId], source.model.rootNodeId);
    expect(prepareTransformCommands(hidden.getSnapshot(), { field: "position", axis: 0, value: 1 }).ok).toBe(false);
    const hierarchy = project();
    hierarchy.nodes.find(node => node.id === "b")!.parentId = "a";
    hierarchy.nodes.find(node => node.id === "a")!.children.push("b");
    hierarchy.nodes[0]!.children = ["a"];
    const nested = createEditorStore(hierarchy); nested.setSelection(["a", "b"], "a");
    expect(prepareTransformCommands(nested.getSnapshot(), { field: "position", axis: 0, value: 1 }).ok).toBe(false);
  });

  it("does not commit a prepared operation after project replacement", () => {
    const store = createEditorStore(project());
    store.setSelection(["a"], "a");
    const prepared = prepareTransformCommands(store.getSnapshot(), { field: "position", axis: 0, value: 3 });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const captured = store.captureDocument();
    const session = { revision: store.getSnapshot().document.revision, epoch: store.getProjectEpoch(), ids: "a", mode: "model", space: "world", field: "position-0", touched: true };
    expect(sessionCurrent(store.getSnapshot(), store.getProjectEpoch(), session)).toBe(true);
    expect(store.replaceProject({ project: project(), assets: captured.assets }, captured.identity)).toBe(true);
    expect(sessionCurrent(store.getSnapshot(), store.getProjectEpoch(), session)).toBe(false);
    expect(store.getSnapshot().selection.ids).toEqual([]);
  });

  it("uses one canonical cube representation and validates primitive edits", () => {
    const source = { kind: "primitive" as const, primitive: "cube" as const, parameters: { size: 2, width: 3 } };
    expect(updatedPrimitiveSource(source, "height", 4)).toEqual({ ok: true,
      value: { kind: "primitive", primitive: "cube", parameters: { width: 3, height: 4, depth: 2 } } });
    expect(updatedPrimitiveSource(source, "height", 0).ok).toBe(false);
    expect(updatedPrimitiveSource(source, "size", 5)).toEqual({ ok: true,
      value: { kind: "primitive", primitive: "cube", parameters: { size: 5 } } });
  });
});

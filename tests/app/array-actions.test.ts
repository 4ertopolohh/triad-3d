import { describe, expect, it } from "vitest";
import { applyArrayChange } from "../../src/app/array-actions";
import { createEditorStore } from "../../src/app/editor-store";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import type { ArrayParameters } from "../../src/geometry/modifiers/types";

const parameters: ArrayParameters = { mode: "linear", count: 3, axis: "x", step: 1, offset: [0, 0, 0] };
function fixture() {
  const project = createProject(() => crypto.randomUUID());
  const root = project.nodes[0]!;
  const node = createPrimitiveNode("cube", root.id, "target");
  project.nodes.push(node); root.children.push(node.id);
  return createEditorStore(project);
}
describe("Array user actions", () => {
  it("adds, edits, moves, toggles and removes with undo/redo", async () => {
    const store = fixture();
    expect(await applyArrayChange(store, { type: "add", targetId: "target", parameters })).toMatchObject({ ok: true, committed: true });
    expect(await applyArrayChange(store, { type: "add", targetId: "target", parameters: { ...parameters, axis: "y" } })).toMatchObject({ ok: true });
    const ids = store.getSnapshot().document.project.nodes.find(n => n.id === "target")!.modifierIds;
    expect(await applyArrayChange(store, { type: "move", targetId: "target", modifierId: ids[1]!, toIndex: 0 })).toMatchObject({ ok: true });
    expect(await applyArrayChange(store, { type: "update", targetId: "target", modifierId: ids[0]!, parameters: { ...parameters, count: 2 } })).toMatchObject({ ok: true });
    const before = store.getSnapshot().history.entries.length;
    expect(await applyArrayChange(store, { type: "update", targetId: "target", modifierId: ids[0]!, parameters: { ...parameters, count: 2 } })).toMatchObject({ ok: true, committed: false });
    expect(await applyArrayChange(store, { type: "update", targetId: "target", modifierId: ids[0]!, parameters: { offset: [0, 0, 0], step: 1, axis: "x", count: 2, mode: "linear" } })).toMatchObject({ ok: true, committed: false });
    expect(store.getSnapshot().history.entries).toHaveLength(before);
    expect(await applyArrayChange(store, { type: "enable", targetId: "target", modifierId: ids[0]!, enabled: false })).toMatchObject({ ok: true });
    expect(await applyArrayChange(store, { type: "remove", targetId: "target", modifierId: ids[0]! })).toMatchObject({ ok: true });
    const revision = store.getSnapshot().document.revision;
    expect(store.undo(revision).ok).toBe(true);
    expect(store.redo(revision + 1).ok).toBe(true);
  });
  it("rejects invalid and locked changes without modifying history", async () => {
    const store = fixture();
    const invalid = { ...parameters, count: 0 } as ArrayParameters;
    expect((await applyArrayChange(store, { type: "add", targetId: "target", parameters: invalid })).ok).toBe(false);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    const snapshot = store.getSnapshot();
    store.executeCommand({ commandId: crypto.randomUUID(), type: "SET_NODE_FLAGS", targetIds: ["target"], payload: { nodeId: "target", locked: true } }, snapshot.document.revision);
    expect((await applyArrayChange(store, { type: "add", targetId: "target", parameters })).ok).toBe(false);
  });
});

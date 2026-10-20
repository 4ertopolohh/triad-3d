import { describe, expect, it } from "vitest";
import { applyProjectPatch, createCommandBus, type ProjectCommand } from "../../src/domain/command-bus";
import { validateProject } from "../../src/domain/validate-project";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain";
import { createEditorStore } from "../../src/app/editor-store";
import { createNestedMeshProject } from "../fixtures/projects";

function fixture() {
  const project = createNestedMeshProject();
  const target = project.nodes.find(node => node.id === "mesh-node")!;
  const root = project.nodes.find(node => node.id === "nested-group")!;
  for (const id of ["cutter", "third"]) {
    project.nodes.push({ ...structuredClone(target), id, name: id, modifierIds: [] });
    root.children.push(id);
  }
  return project;
}
const add = (modifierId: string, nodeId = "mesh-node", cutterNodeId = "cutter"): ProjectCommand => ({
  commandId: `add-${modifierId}`, type: "ADD_BOOLEAN_MODIFIER", targetIds: [nodeId, modifierId, cutterNodeId],
  payload: { nodeId, modifierId, cutterNodeId, operation: "subtract" },
});
const update = (modifierId: string, cutterNodeId: string): ProjectCommand => ({
  commandId: `update-${modifierId}`, type: "UPDATE_BOOLEAN_MODIFIER", targetIds: [modifierId, cutterNodeId],
  payload: { modifierId, cutterNodeId, operation: "union" },
});
const enabled = (modifierId: string, value: boolean): ProjectCommand => ({
  commandId: `enabled-${modifierId}`, type: "SET_MODIFIER_ENABLED", targetIds: [modifierId], payload: { modifierId, enabled: value },
});
const move = (modifierId: string, toIndex: number): ProjectCommand => ({
  commandId: `move-${modifierId}`, type: "MOVE_MODIFIER", targetIds: [modifierId], payload: { modifierId, toIndex },
});
const remove = (modifierId: string): ProjectCommand => ({
  commandId: `remove-${modifierId}`, type: "REMOVE_MODIFIER", targetIds: [modifierId], payload: { modifierId },
});

describe("transactional Boolean commands", () => {
  it.each(["subtract", "union", "intersect"] as const)("creates %s operation", operation => {
    const bus = createCommandBus(fixture());
    const command = add("boolean");
    if (command.type !== "ADD_BOOLEAN_MODIFIER") throw new Error("Invalid test command");
    command.payload.operation = operation;
    const result = bus.executeCommand(command, 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.modifiers[0]).toMatchObject({ id: "boolean", kind: "boolean", enabled: true, version: 0, parameters: { operation, cutterNodeId: "cutter" } });
  });

  it("adds, updates, toggles, reorders and removes with reversible patches", () => {
    const bus = createCommandBus(fixture());
    const commands = [add("a"), add("b"), update("a", "third"), enabled("a", false), move("b", 0), remove("a")];
    for (const command of commands) {
      const before = bus.getSnapshot();
      const result = bus.executeCommand(command, bus.getRevision());
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      expect(validateProject(result.project)).toEqual([]);
      expect(applyProjectPatch(before, result.patch)).toEqual(result.project);
      expect(applyProjectPatch(result.project, result.undoPatch)).toEqual(before);
    }
    const project = bus.getSnapshot();
    expect(project.modifiers).toMatchObject([{ id: "b", order: 0, version: 1 }]);
    expect(project.nodes.find(node => node.id === "mesh-node")?.modifierIds).toEqual(["b"]);
    const saved = serializeProjectDocument(project);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(deserializeProjectDocument(saved.value)).toEqual({ ok: true, value: project });
  });

  it("rejects cycles, bad payloads and cutter deletion without changing the document", () => {
    const bus = createCommandBus(fixture());
    expect(bus.executeCommand(add("a"), 0).ok).toBe(true);
    const before = bus.getSnapshot();
    const bad = [
      add("cycle", "cutter", "mesh-node"),
      add("a"),
      add("self", "mesh-node", "mesh-node"),
      { ...add("bad"), payload: { nodeId: "mesh-node", modifierId: "bad", cutterNodeId: "cutter", operation: "xor" } } as unknown as ProjectCommand,
      move("a", 1),
      { commandId: "delete", type: "DELETE_NODE", targetIds: ["cutter"], payload: { nodeId: "cutter" } } as ProjectCommand,
    ];
    for (const command of bad) {
      expect(bus.executeCommand(command, 1).ok).toBe(false);
      expect(bus.getSnapshot()).toEqual(before);
      expect(bus.getRevision()).toBe(1);
    }
    expect(bus.executeCommand(enabled("a", false), 1).ok).toBe(true);
    expect(bus.executeCommand(add("cycle", "cutter", "mesh-node"), 2).ok).toBe(false);
  });

  it("commits one revision and history step; failed transactions and no-ops remain clean", () => {
    const store = createEditorStore(fixture());
    const initial = store.getSnapshot().document.project;
    expect(store.executeTransaction([add("a"), add("b")], 0).ok).toBe(true);
    expect(store.getSnapshot().document.revision).toBe(1);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.getSnapshot().derived.generation).toBe(1);
    const after = structuredClone(store.getSnapshot().document.project);
    expect(store.executeCommand(enabled("a", true), 1)).toMatchObject({ ok: true, changed: false });
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.executeTransaction([update("a", "third"), add("cycle", "cutter", "mesh-node")], 1).ok).toBe(false);
    expect(store.getSnapshot().document.project).toEqual(after);
    expect(store.getSnapshot().document.revision).toBe(1);
    expect(store.undo(1).ok).toBe(true);
    expect(store.getSnapshot().document.project).toEqual(initial);
    expect(store.getSnapshot().document.dirty).toBe(false);
    expect(store.redo(2).ok).toBe(true);
    expect(store.getSnapshot().document.project).toEqual(after);
  });

  it("replays removal of multiple modifiers and permits a locked cutter", () => {
    const project = fixture();
    project.nodes.find(node => node.id === "cutter")!.locked = true;
    const bus = createCommandBus(project);
    const added = bus.executeTransaction([add("a"), add("b"), add("c")], 0);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const result = bus.executeTransaction([remove("a"), remove("c")], 1);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(applyProjectPatch(added.project, result.patch)).toEqual(result.project);
    expect(applyProjectPatch(result.project, result.undoPatch)).toEqual(added.project);
  });

  it("rejects an indirect dependency cycle and a locked target", () => {
    const bus = createCommandBus(fixture());
    expect(bus.executeTransaction([add("a", "mesh-node", "cutter"), add("b", "cutter", "third")], 0).ok).toBe(true);
    const before = bus.getSnapshot();
    expect(bus.executeCommand(add("c", "third", "mesh-node"), 1)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(bus.getSnapshot()).toEqual(before);
    const locked = fixture();
    locked.nodes.find(node => node.id === "mesh-node")!.locked = true;
    expect(createCommandBus(locked).executeCommand(add("a"), 0)).toMatchObject({ ok: false, code: "NODE_LOCKED" });
  });
});

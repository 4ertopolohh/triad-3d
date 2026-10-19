import { describe, expect, it } from "vitest";
import { applyProjectPatch, createCommandBus } from "../../src/domain";
import type { GroupNode, ProjectCommand } from "../../src/domain";
import { validateProject } from "../../src/domain/validate-project";
import { createNestedMeshProject } from "../fixtures/projects";

const rename = (name: string, nodeId = "mesh-node", commandId = "rename"): ProjectCommand =>
  ({ commandId, type: "RENAME_NODE", targetIds: [nodeId], payload: { nodeId, name } });
const flags = (nodeId: string, values: { visible?: boolean; locked?: boolean }, commandId = "flags"): ProjectCommand =>
  ({ commandId, type: "SET_NODE_FLAGS", targetIds: [nodeId], payload: { nodeId, ...values } });
const transform = (position: readonly [number, number, number]): ProjectCommand =>
  ({ commandId: "transform", type: "SET_NODE_TRANSFORM", targetIds: ["mesh-node"], payload: {
    nodeId: "mesh-node", transform: { position, rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
  } });
function add(id: string, parentId = "nested-group"): ProjectCommand {
  const node: GroupNode = { id, kind: "group", name: "Деталь", parentId, children: [],
    transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
    visible: true, locked: false, materialSlots: [], modifierIds: [] };
  return { commandId: `add-${id}`, type: "ADD_NODE", targetIds: [parentId, id], payload: { parentId, node } };
}

describe("command bus", () => {
  it("adds a leaf and keeps both hierarchy links and revisions consistent", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const before = bus.getSnapshot();
    const result = bus.executeCommand(add("new-leaf"), 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.revision).toBe(1);
    expect(result.project.model.revision).toBe(1);
    expect(result.project.nodes.find((node) => node.id === "new-leaf")?.parentId).toBe("nested-group");
    expect(result.project.nodes.find((node) => node.id === "nested-group")?.children).toContain("new-leaf");
    expect(validateProject(result.project)).toEqual([]);
    expect(applyProjectPatch(before, result.patch)).toEqual(result.project);
    expect(applyProjectPatch(result.project, result.undoPatch)).toEqual(before);
  });

  it("renames and transforms only the target and accepts a multi-command transaction once", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const before = bus.getSnapshot();
    const result = bus.executeTransaction([rename("Новая деталь"), transform([3, 2, 1])], 0, "batch-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBe("batch-1");
    expect(result.revision).toBe(1);
    expect(result.project.model.revision).toBe(before.model.revision + 1);
    expect(result.project.nodes.find((node) => node.id === "mesh-node")?.name).toBe("Новая деталь");
    expect(result.project.nodes.find((node) => node.id === "mesh-node")?.transform.position).toEqual([3, 2, 1]);
    expect(result.project.nodes.find((node) => node.id === "nested-group")).toEqual(before.nodes.find((node) => node.id === "nested-group"));
    expect(applyProjectPatch(before, result.patch)).toEqual(result.project);
    expect(applyProjectPatch(result.project, result.undoPatch)).toEqual(before);
  });

  it("changes flags partially and can unlock or reveal its own node", () => {
    const bus = createCommandBus(createNestedMeshProject());
    expect(bus.executeCommand(flags("mesh-node", { locked: true }), 0).ok).toBe(true);
    expect(bus.executeCommand(rename("Forbidden"), 1)).toMatchObject({ ok: false, code: "NODE_LOCKED" });
    expect(bus.executeCommand(flags("mesh-node", { locked: false }), 1).ok).toBe(true);
    expect(bus.executeCommand(flags("mesh-node", { visible: false }), 2).ok).toBe(true);
    expect(bus.executeCommand(rename("Forbidden"), 3)).toMatchObject({ ok: false, code: "NODE_HIDDEN" });
    expect(bus.executeCommand(flags("mesh-node", { visible: true }), 3).ok).toBe(true);
    expect(bus.getSnapshot().nodes.find((node) => node.id === "mesh-node")).toMatchObject({ visible: true, locked: false });
  });

  it("requires recovery actions when a node is locked or hidden", () => {
    const bus = createCommandBus(createNestedMeshProject());
    expect(bus.executeCommand(flags("mesh-node", { locked: true }), 0).ok).toBe(true);
    expect(bus.executeCommand(flags("mesh-node", { visible: false }), 1)).toMatchObject({ ok: false, code: "NODE_LOCKED" });
    expect(bus.executeCommand(flags("mesh-node", { locked: false }), 1).ok).toBe(true);
    expect(bus.executeCommand(flags("mesh-node", { visible: false }), 2).ok).toBe(true);
    expect(bus.executeCommand(flags("mesh-node", { locked: true }), 3)).toMatchObject({ ok: false, code: "NODE_HIDDEN" });
  });

  it("rejects invalid references in a new leaf after final validation", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const before = bus.getSnapshot();
    const command = add("bad-ref");
    if (command.type === "ADD_NODE") command.payload.node.materialSlots.push({ name: "Missing", materialId: "absent" });
    expect(bus.executeCommand(command, 0)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(bus.getSnapshot()).toEqual(before);
    expect(bus.getRevision()).toBe(0);
  });

  it.each([
    ["missing target", rename("A", "absent"), "INVALID_REFERENCE"],
    ["duplicate ID", add("mesh-node"), "INVALID_COMMAND"],
    ["missing parent", add("new", "absent"), "INVALID_REFERENCE"],
    ["empty name", rename("   "), "INVALID_COMMAND"],
    ["NaN", transform([Number.NaN, 0, 0]), "INVALID_COMMAND"],
    ["Infinity", transform([Infinity, 0, 0]), "INVALID_COMMAND"],
    ["target mismatch", { ...rename("A"), targetIds: ["nested-group"] }, "INVALID_COMMAND"],
    ["invalid transform shape", { ...transform([1, 2, 3]), payload: { nodeId: "mesh-node", transform: { position: [1, 2], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] } } }, "INVALID_COMMAND"],
  ] as const)("rejects %s without mutation", (_label, command, code) => {
    const bus = createCommandBus(createNestedMeshProject());
    const before = bus.getSnapshot();
    expect(bus.executeCommand(command as ProjectCommand, 0)).toMatchObject({ ok: false, code });
    expect(bus.getSnapshot()).toEqual(before);
    expect(bus.getRevision()).toBe(0);
  });

  it("rejects locked and hidden ancestors, including attempts to change descendant flags", () => {
    for (const ancestorFlag of [{ locked: true }, { visible: false }]) {
      const bus = createCommandBus(createNestedMeshProject());
      expect(bus.executeCommand(flags("nested-group", ancestorFlag), 0).ok).toBe(true);
      const before = bus.getSnapshot();
      const code = "locked" in ancestorFlag ? "NODE_LOCKED" : "NODE_HIDDEN";
      expect(bus.executeCommand(rename("No"), 1)).toMatchObject({ ok: false, code });
      expect(bus.executeCommand(flags("mesh-node", { locked: false, visible: true }), 1)).toMatchObject({ ok: false, code });
      expect(bus.getSnapshot()).toEqual(before);
      expect(bus.getRevision()).toBe(1);
    }
  });

  it("rolls back a failing second command and allows the next valid operation", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const before = bus.getSnapshot();
    expect(bus.executeTransaction([add("new-leaf"), rename("No", "missing")], 0)).toMatchObject({ ok: false, code: "INVALID_REFERENCE" });
    expect(bus.getSnapshot()).toEqual(before);
    expect(bus.getRevision()).toBe(0);
    expect(bus.executeCommand(rename("Да"), 0).ok).toBe(true);
  });

  it("captures the final state when a transaction adds and then edits one node", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const before = bus.getSnapshot();
    const result = bus.executeTransaction([add("new-leaf"), rename("Итог", "new-leaf")], 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(applyProjectPatch(before, result.patch)).toEqual(result.project);
    expect(applyProjectPatch(result.project, result.undoPatch)).toEqual(before);
    expect(() => applyProjectPatch(result.project, result.patch)).toThrow();
  });

  it("rejects stale revisions and leaves semantic no-ops without a revision or patch", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const before = bus.getSnapshot();
    const noOp = bus.executeCommand(rename("Куб"), 0);
    expect(noOp).toMatchObject({ ok: true, changed: false, revision: 0, patch: { changes: [] } });
    expect(bus.executeCommand(rename("New"), 1)).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(bus.getSnapshot()).toEqual(before);
  });

  it("treats a transaction with no net document change as a no-op", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const result = bus.executeTransaction([rename("Temporary", "mesh-node", "first"), rename("Куб", "mesh-node", "second")], 0);
    expect(result).toMatchObject({ ok: true, changed: false, revision: 0, patch: { changes: [] } });
    expect(bus.getRevision()).toBe(0);
    expect(bus.getSnapshot().model.revision).toBe(0);
  });

  it("does not leak input, snapshot, command payload or result references", () => {
    const input = createNestedMeshProject();
    const bus = createCommandBus(input);
    const old = bus.getSnapshot();
    input.nodes[0]?.children.push("injected");
    old.nodes[0]?.children.push("injected");
    const command = add("new-leaf");
    const result = bus.executeCommand(command, 0);
    if (command.type === "ADD_NODE") command.payload.node.name = "Tampered";
    if (result.ok) result.project.nodes[0]?.children.push("tampered");
    expect(bus.getSnapshot().nodes.find((node) => node.id === "new-leaf")?.name).toBe("Деталь");
    expect(validateProject(bus.getSnapshot())).toEqual([]);
    expect(old.nodes.find((node) => node.id === "new-leaf")).toBeUndefined();
  });
});

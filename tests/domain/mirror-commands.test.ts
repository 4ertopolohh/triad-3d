import { describe, expect, it } from "vitest";
import { createCommandBus, type ProjectCommand } from "../../src/domain/command-bus";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import type { MirrorParameters } from "../../src/geometry/modifiers/types";

const parameters: MirrorParameters = { axes: "x", pivot: [0, 0, 0], mergeSeam: false };
function fixture() {
  const project = createProject(() => crypto.randomUUID());
  const root = project.nodes[0]!;
  for (const id of ["a", "b"]) { const node = createPrimitiveNode("cube", root.id, id); project.nodes.push(node); root.children.push(id); }
  return createCommandBus(project);
}
const add = (nodeId = "a", modifierId = "mirror", params = parameters): ProjectCommand =>
  ({ commandId: crypto.randomUUID(), type: "ADD_MIRROR_MODIFIER", targetIds: [nodeId, modifierId], payload: { nodeId, modifierId, parameters: params } });
const update = (params: MirrorParameters, modifierId = "mirror"): ProjectCommand =>
  ({ commandId: crypto.randomUUID(), type: "UPDATE_MIRROR_MODIFIER", targetIds: [modifierId], payload: { modifierId, parameters: params } });

describe("Mirror commands", () => {
  it("adds and updates with reversible patches, versions and semantic no-op", () => {
    const bus = fixture();
    const added = bus.executeCommand(add(), 0);
    expect(added.ok && added.changed).toBe(true);
    if (!added.ok) return;
    const next = { axes: "xyz", pivot: [1, 2, 3], mergeSeam: true } as const;
    const edited = bus.executeCommand(update(next), added.revision);
    expect(edited.ok && edited.changed).toBe(true);
    if (!edited.ok) return;
    expect(edited.project.modifiers[0]).toMatchObject({ kind: "mirror", version: 1, parameters: next });
    const noOp = bus.executeCommand(update({ mergeSeam: true, pivot: [1, 2, 3], axes: "xyz" }), edited.revision);
    expect(noOp).toMatchObject({ ok: true, changed: false, revision: edited.revision });
    const undone = bus.applyHistoryPatch(edited.undoPatch, edited.revision);
    expect(undone.ok && undone.project.modifiers[0]?.parameters).toEqual(parameters);
    if (!undone.ok) return;
    const redone = bus.applyHistoryPatch(edited.patch, undone.revision);
    expect(redone.ok && redone.project.modifiers[0]?.parameters).toEqual(next);
  });
  it("rejects bad parameters, duplicate IDs, wrong type and locked targets", () => {
    const bus = fixture();
    for (const params of [{ ...parameters, axes: "yx" }, { ...parameters, pivot: [Infinity, 0, 0] }, { ...parameters, extra: 1 }])
      expect(bus.executeCommand(add("a", "invalid", params as MirrorParameters), bus.getRevision()).ok).toBe(false);
    expect(bus.getRevision()).toBe(0);
    expect(bus.executeCommand(add(), 0).ok).toBe(true);
    expect(bus.executeCommand(add("b", "mirror"), bus.getRevision()).ok).toBe(false);
    const flag = bus.executeCommand({ commandId: crypto.randomUUID(), type: "SET_NODE_FLAGS", targetIds: ["b"], payload: { nodeId: "b", locked: true } }, bus.getRevision());
    expect(flag.ok).toBe(true);
    expect(bus.executeCommand(add("b", "second"), bus.getRevision())).toMatchObject({ ok: false, code: "NODE_LOCKED" });
    expect(bus.executeCommand(update(parameters, "missing"), bus.getRevision()).ok).toBe(false);
    expect(bus.executeCommand({ commandId: crypto.randomUUID(), type: "ADD_ARRAY_MODIFIER", targetIds: ["a", "array"],
      payload: { nodeId: "a", modifierId: "array", parameters: { mode: "linear", count: 2, axis: "x", step: 1, offset: [0, 0, 0] } } }, bus.getRevision()).ok).toBe(true);
    expect(bus.executeCommand(update(parameters, "array"), bus.getRevision())).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
  });
  it("rejects hidden targets", () => {
    const bus = fixture();
    expect(bus.executeCommand({ commandId: crypto.randomUUID(), type: "SET_NODE_FLAGS", targetIds: ["a"],
      payload: { nodeId: "a", visible: false } }, 0).ok).toBe(true);
    expect(bus.executeCommand(add(), bus.getRevision())).toMatchObject({ ok: false, code: "NODE_HIDDEN" });
  });
});

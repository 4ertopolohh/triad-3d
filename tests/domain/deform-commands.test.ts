import { describe, expect, it } from "vitest";
import { createCommandBus, type ProjectCommand } from "../../src/domain/command-bus";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import type { BendParameters, TwistParameters, TaperParameters, BevelParameters } from "../../src/geometry/modifiers/types";

const bend = { axis: "y", direction: "x", angleDegrees: 30, pivot: [0, 0, 0] } as const;
const twist = { axis: "y", angleDegrees: 45, pivot: [0, 0, 0] } as const;
const taper = { axis: "y", startScale: 1, endScale: 0.8, pivot: [0, 0, 0] } as const;
const bevel = { width: 0.1 } as const;
function fixture() {
  const project = createProject(() => crypto.randomUUID());
  const root = project.nodes[0]!;
  for (const id of ["a", "b"]) { const node = createPrimitiveNode("cube", root.id, id); project.nodes.push(node); root.children.push(id); }
  return createCommandBus(project);
}
const add = (kind: "bend" | "twist" | "taper" | "bevel", id: string, nodeId = "a"): ProjectCommand => {
  const common = { commandId: crypto.randomUUID(), type: "ADD_DEFORM_MODIFIER" as const, targetIds: [nodeId, id] as [string, string] };
  if (kind === "bend") return { ...common, payload: { nodeId, modifierId: id, kind, parameters: bend } };
  if (kind === "twist") return { ...common, payload: { nodeId, modifierId: id, kind, parameters: twist } };
  if (kind === "taper") return { ...common, payload: { nodeId, modifierId: id, kind, parameters: taper } };
  return { ...common, payload: { nodeId, modifierId: id, kind, parameters: bevel } };
};
const update = (id: string, parameters: BendParameters | TwistParameters | TaperParameters | BevelParameters): ProjectCommand =>
  ({ commandId: crypto.randomUUID(), type: "UPDATE_DEFORM_MODIFIER", targetIds: [id], payload: { modifierId: id, parameters } });

describe("deformation commands", () => {
  it("adds Bevel, treats implicit 30° as a no-op, and replays its update", () => {
    const bus = fixture();
    expect(bus.executeCommand(add("bevel", "bevel1"), 0)).toMatchObject({ ok: true, changed: true });
    const revision = bus.getRevision();
    expect(bus.executeCommand(update("bevel1", { width: 0.1, angleDegrees: 30 }), revision)).toMatchObject({ ok: true, changed: false });
    expect(bus.getRevision()).toBe(revision);
    const changed = bus.executeCommand(update("bevel1", { width: 0.2, angleDegrees: 45 }), revision);
    expect(changed).toMatchObject({ ok: true, changed: true });
    if (!changed.ok) return;
    expect(changed.project.modifiers[0]).toMatchObject({ kind: "bevel", nodeId: "a", version: 1, parameters: { width: 0.2, angleDegrees: 45 } });
    expect(bus.applyHistoryPatch(changed.undoPatch, bus.getRevision())).toMatchObject({ ok: true });
    expect(bus.getSnapshot().modifiers[0]?.parameters).toEqual(bevel);
    expect(bus.executeCommand(update("bevel1", bend), bus.getRevision()).ok).toBe(false);
    expect(bus.executeCommand(add("bevel", "bevel1"), bus.getRevision()).ok).toBe(false);
  });
  it("rejects invalid Bevel parameters without changing the document", () => {
    const bus = fixture();
    const before = bus.getSnapshot();
    for (const parameters of [{ width: -1 }, { width: Infinity }, { width: 0.1, angleDegrees: 181 }, { width: "0.1" }]) {
      const command = { ...add("bevel", "bad"), payload: { nodeId: "a", modifierId: "bad", kind: "bevel", parameters } } as ProjectCommand;
      expect(bus.executeCommand(command, bus.getRevision()).ok).toBe(false);
    }
    expect(bus.getSnapshot()).toEqual(before);
  });
  it("adds every kind, updates without changing ID, orders and replays patches", () => {
    const bus = fixture();
    for (const [kind, id] of [["bend", "bend1"], ["twist", "twist1"], ["taper", "taper1"]] as const)
      expect(bus.executeCommand(add(kind, id), bus.getRevision())).toMatchObject({ ok: true, changed: true });
    expect(bus.getSnapshot().nodes.find(node => node.id === "a")?.modifierIds).toEqual(["bend1", "twist1", "taper1"]);
    expect(bus.getSnapshot().modifiers.map(item => item.order)).toEqual([0, 1, 2]);
    const changed = bus.executeCommand(update("bend1", { ...bend, angleDegrees: 60 }), bus.getRevision());
    expect(changed).toMatchObject({ ok: true, changed: true });
    if (!changed.ok) return;
    expect(changed.project.modifiers.find(item => item.id === "bend1")).toMatchObject({ version: 1, parameters: { angleDegrees: 60 } });
    expect(bus.executeCommand(update("bend1", { ...bend, angleDegrees: 60 }), bus.getRevision())).toMatchObject({ ok: true, changed: false });
    const undo = bus.applyHistoryPatch(changed.undoPatch, bus.getRevision());
    expect(undo.ok && undo.project.modifiers.find(item => item.id === "bend1")?.parameters.angleDegrees).toBe(30);
    if (undo.ok) expect(bus.applyHistoryPatch(changed.patch, undo.revision)).toMatchObject({ ok: true });
    expect(bus.executeCommand({ commandId: "move", type: "MOVE_MODIFIER", targetIds: ["bend1"], payload: { modifierId: "bend1", toIndex: 2 } }, bus.getRevision())).toMatchObject({ ok: true });
    expect(bus.getSnapshot().nodes.find(node => node.id === "a")?.modifierIds).toEqual(["twist1", "taper1", "bend1"]);
  });
  it("rejects invalid shape, values, references, duplicate ID and inaccessible targets", () => {
    const bus = fixture();
    const malformed = { ...add("bend", "bad"), payload: { nodeId: "a", modifierId: "bad", kind: "bend", parameters: twist } } as ProjectCommand;
    expect(bus.executeCommand(malformed, 0).ok).toBe(false);
    expect(bus.executeCommand({ commandId: "wrong-targets", type: "ADD_DEFORM_MODIFIER", targetIds: ["wrong", "bad"], payload: { nodeId: "a", modifierId: "bad", kind: "bend", parameters: bend } }, 0).ok).toBe(false);
    expect(bus.executeCommand({ ...add("bend", "bad"), payload: { nodeId: "a", modifierId: "bad", kind: "bend", parameters: { ...bend, angleDegrees: Infinity } } } as ProjectCommand, 0).ok).toBe(false);
    expect(bus.executeCommand(add("bend", "bad", "missing"), 0).ok).toBe(false);
    expect(bus.executeCommand(add("bend", "bend1"), 0).ok).toBe(true);
    expect(bus.executeCommand(add("twist", "bend1"), bus.getRevision()).ok).toBe(false);
    expect(bus.executeCommand(update("bend1", twist), bus.getRevision()).ok).toBe(false);
    expect(bus.executeCommand(update("missing", bend), bus.getRevision()).ok).toBe(false);
    for (const [nodeId, field] of [["a", "locked"], ["b", "visible"]] as const) {
      expect(bus.executeCommand({ commandId: crypto.randomUUID(), type: "SET_NODE_FLAGS", targetIds: [nodeId], payload: { nodeId, [field]: field === "locked" } }, bus.getRevision()).ok).toBe(true);
    }
    expect(bus.executeCommand(update("bend1", { ...bend, angleDegrees: 90 }), bus.getRevision())).toMatchObject({ ok: false, code: "NODE_LOCKED" });
    expect(bus.executeCommand(add("taper", "new", "b"), bus.getRevision())).toMatchObject({ ok: false, code: "NODE_HIDDEN" });
  });
});


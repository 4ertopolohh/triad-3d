import { describe, expect, it } from "vitest";
import { applyProjectPatch, createCommandBus } from "../../src/domain/command-bus";
import type { GroupNode } from "../../src/domain/types";
import { createNestedMeshProject } from "../fixtures/projects";

const blank = (id: string, parentId: string): GroupNode => ({ id, kind: "group", name: id, parentId, children: [], transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] }, visible: true, locked: false, materialSlots: [], modifierIds: [] });
const move = (nodeId: string, parentId: string, index: number) => ({ commandId: `move-${nodeId}-${index}`, type: "MOVE_NODE" as const, targetIds: [nodeId, parentId] as [string, string], payload: { nodeId, parentId, index } });
describe("hierarchy commands", () => {
  it("groups, ungroups and replays delta patches", () => {
    const initial = createNestedMeshProject(); const bus = createCommandBus(initial);
    const group = blank("created", "nested-group");
    const grouped = bus.executeCommand({ commandId: "group", type: "GROUP_NODES", targetIds: ["mesh-node", group.id], payload: { nodeIds: ["mesh-node"], group } }, 0);
    expect(grouped.ok).toBe(true); if (!grouped.ok) return;
    expect(grouped.project.nodes.find(node => node.id === "mesh-node")?.parentId).toBe(group.id);
    expect(applyProjectPatch(initial, grouped.patch)).toEqual(grouped.project);
    expect(applyProjectPatch(grouped.project, grouped.undoPatch)).toEqual(initial);
    const ungrouped = bus.executeCommand({ commandId: "ungroup", type: "UNGROUP_NODE", targetIds: [group.id], payload: { nodeId: group.id } }, 1);
    expect(ungrouped.ok).toBe(true); if (!ungrouped.ok) return;
    expect(ungrouped.project.nodes.some(node => node.id === group.id)).toBe(false);
    expect(applyProjectPatch(grouped.project, ungrouped.patch)).toEqual(ungrouped.project);
    expect(applyProjectPatch(ungrouped.project, ungrouped.undoPatch)).toEqual(grouped.project);
  });
  it("preserves world coordinates, rejects cycles and shear without mutation", () => {
    const initial = createNestedMeshProject(); const root = initial.nodes[0]!;
    root.children.push("other"); initial.nodes.push(blank("other", root.id));
    initial.nodes.find(node => node.id === "nested-group")!.transform = { position: [2, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] };
    initial.nodes.find(node => node.id === "mesh-node")!.transform = { position: [1, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] };
    const bus = createCommandBus(initial);
    const result = bus.executeCommand(move("mesh-node", "other", 0), 0);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.project.nodes.find(node => node.id === "mesh-node")?.transform.position).toEqual([3, 0, 0]);
    expect(bus.executeCommand(move("other", "other", 0), 1).ok).toBe(false);
    expect(bus.executeCommand(move(root.id, "other", 0), 1).ok).toBe(false);
    const before = bus.getSnapshot();
    const shear = structuredClone(before);
    shear.nodes.find(node => node.id === "nested-group")!.transform.scale = [2, 1, 1];
    shear.nodes.find(node => node.id === "nested-group")!.transform.rotationQuat = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
    const shearBus = createCommandBus(shear);
    const failed = shearBus.executeCommand(move("mesh-node", "nested-group", 0), 0);
    expect(failed.ok).toBe(false);
    expect(shearBus.getSnapshot()).toEqual(shear);
    expect(bus.getSnapshot()).toEqual(before);
  });
  it("reorders and deletes reversibly while protecting dependent tracks", () => {
    const initial = createNestedMeshProject(); const group = initial.nodes.find(node => node.id === "nested-group")!;
    group.children.push("second"); initial.nodes.push(blank("second", group.id));
    const bus = createCommandBus(initial);
    const reordered = bus.executeCommand(move("second", group.id, 0), 0);
    expect(reordered.ok).toBe(true); if (!reordered.ok) return;
    expect(reordered.project.nodes.find(node => node.id === group.id)?.children).toEqual(["second", "mesh-node"]);
    const deleted = bus.executeCommand({ commandId: "delete", type: "DELETE_NODE", targetIds: ["second"], payload: { nodeId: "second" } }, 1);
    expect(deleted.ok).toBe(true); if (!deleted.ok) return;
    expect(applyProjectPatch(reordered.project, deleted.patch)).toEqual(deleted.project);
    expect(applyProjectPatch(deleted.project, deleted.undoPatch)).toEqual(reordered.project);
    const dependent = createNestedMeshProject(); dependent.tracks.push({ id: "track", nodeId: "mesh-node", property: "transform.position", keyframeIds: [] });
    expect(createCommandBus(dependent).executeCommand({ commandId: "delete", type: "DELETE_NODE", targetIds: ["mesh-node"], payload: { nodeId: "mesh-node" } }, 0).ok).toBe(false);
  });
});

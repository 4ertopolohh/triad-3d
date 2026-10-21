import { describe, expect, it } from "vitest";
import { createCommandBus, applyProjectPatch } from "../../src/domain/command-bus";
import { createEditorStore } from "../../src/app/editor-store";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import type { Material } from "../../src/domain/types";
import { createNestedMeshProject } from "../fixtures/projects";

const material = (id = "mat-1"): Material => ({ id, name: "Материал", baseColor: [0.25, 0.5, 1], metalness: 0.4,
  roughness: 0.3, emissive: [0, 0, 0], opacity: 1, transmission: 0, ior: 1.5, clearcoat: 0.2, envIntensity: 1, textureAssetIds: [] });
const add = (value: Material) => ({ commandId: `add-${value.id}`, type: "ADD_MATERIAL" as const, targetIds: [value.id] as [string], payload: { material: value } });
const slot = (nodeId: string, materialId: string | null, commandId = "slot") => ({ commandId, type: "SET_MATERIAL_SLOT" as const,
  targetIds: (materialId ? [nodeId, materialId] : [nodeId]) as [string] | [string, string], payload: { nodeId, slotName: "Основной", materialId } });

describe("material commands", () => {
  it("creates, shares, updates, serializes and reverses material changes", () => {
    const project = createNestedMeshProject();
    const second = structuredClone(project.nodes.find(node => node.id === "mesh-node")!);
    second.id = "mesh-2"; project.nodes.push(second); project.nodes.find(node => node.id === "nested-group")!.children.push(second.id);
    const store = createEditorStore(project);
    const commands = [add(material()), slot("mesh-node", "mat-1", "slot-1"), slot("mesh-2", "mat-1", "slot-2")];
    const created = store.executeTransaction(commands, 0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.project.nodes.filter(node => node.materialSlots[0]?.materialId === "mat-1")).toHaveLength(2);
    const updated = { ...material(), roughness: 0.9 };
    expect(store.executeCommand({ commandId: "update", type: "UPDATE_MATERIAL", targetIds: ["mat-1"], payload: { material: updated } }, 1)).toMatchObject({ ok: true, changed: true });
    expect(store.getSnapshot().document.project.materials[0]?.roughness).toBe(0.9);
    expect(store.executeCommand({ commandId: "same", type: "UPDATE_MATERIAL", targetIds: ["mat-1"], payload: { material: updated } }, 2)).toMatchObject({ ok: true, changed: false });
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    expect(store.executeCommand({ commandId: "remove", type: "REMOVE_MATERIAL", targetIds: ["mat-1"], payload: { materialId: "mat-1" } }, 2)).toMatchObject({ ok: false, code: "INVALID_REFERENCE" });
    const saved = serializeProjectDocument(store.captureDocument().project);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(deserializeProjectDocument(saved.value)).toMatchObject({ ok: true, value: store.captureDocument().project });
    expect(store.undo(2)).toMatchObject({ ok: true });
    expect(store.getSnapshot().document.project.materials[0]?.roughness).toBe(0.3);
    expect(store.redo(3)).toMatchObject({ ok: true });
    expect(store.getSnapshot().document.project.materials[0]?.roughness).toBe(0.9);
    expect(applyProjectPatch(project, created.patch)).toEqual(created.project);
  });

  it("rejects malformed values, duplicates, locked nodes and partial transactions", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const bad = { ...material(), roughness: Infinity };
    expect(bus.executeCommand(add(bad), 0)).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(bus.executeCommand(add({ ...material(), transmission: 0.5, opacity: 0.5 }), 0).ok).toBe(false);
    expect(bus.executeCommand(add({ ...material(), ior: 3 }), 0).ok).toBe(false);
    expect(bus.executeCommand(add({ ...material(), baseColor: [0, 1] as unknown as Material["baseColor"] }), 0).ok).toBe(false);
    expect(bus.executeCommand(add(material("mesh-node")), 0)).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(bus.executeCommand(slot("mesh-node", "missing"), 0)).toMatchObject({ ok: false, code: "INVALID_REFERENCE" });
    const before = bus.getSnapshot();
    expect(bus.executeTransaction([add(material()), slot("mesh-node", "missing")], 0).ok).toBe(false);
    expect(bus.getSnapshot()).toEqual(before);
    expect(bus.executeCommand(add(material()), 0)).toMatchObject({ ok: true });
    expect(bus.executeCommand(add(material()), 1)).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(bus.executeCommand({ commandId: "lock", type: "SET_NODE_FLAGS", targetIds: ["nested-group"], payload: { nodeId: "nested-group", locked: true } }, 1).ok).toBe(true);
    expect(bus.executeCommand(slot("mesh-node", "mat-1"), 2)).toMatchObject({ ok: false, code: "NODE_LOCKED" });
    expect(bus.executeCommand(slot("mesh-node", "mat-1"), 1)).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(bus.executeCommand({ commandId: "unlock", type: "SET_NODE_FLAGS", targetIds: ["nested-group"], payload: { nodeId: "nested-group", locked: false, visible: false } }, 2).ok).toBe(true);
    expect(bus.executeCommand(slot("mesh-node", "mat-1"), 3)).toMatchObject({ ok: false, code: "NODE_HIDDEN" });
  });

  it("unassigns then removes an unused material in one reversible transaction", () => {
    const bus = createCommandBus(createNestedMeshProject());
    const created = bus.executeTransaction([add(material()), slot("mesh-node", "mat-1")], 0);
    expect(created.ok).toBe(true);
    const removed = bus.executeTransaction([slot("mesh-node", null, "clear"),
      { commandId: "remove", type: "REMOVE_MATERIAL", targetIds: ["mat-1"], payload: { materialId: "mat-1" } }], 1);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(bus.applyHistoryPatch(removed.undoPatch, 2)).toMatchObject({ ok: true });
    expect(bus.getSnapshot().nodes.find(node => node.id === "mesh-node")?.materialSlots[0]?.materialId).toBe("mat-1");
  });
  it("replays replacement of an unused material at the same catalog index", () => {
    const bus = createCommandBus(createNestedMeshProject());
    expect(bus.executeCommand(add(material("old")), 0).ok).toBe(true);
    const before = bus.getSnapshot();
    const result = bus.executeTransaction([
      { commandId: "remove-old", type: "REMOVE_MATERIAL", targetIds: ["old"], payload: { materialId: "old" } },
      add(material("new")),
    ], 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(applyProjectPatch(before, result.patch)).toEqual(result.project);
    expect(bus.applyHistoryPatch(result.undoPatch, 2)).toMatchObject({ ok: true, project: before });
  });
  it("round-trips shared material references through the native archive", async () => {
    const project = createNestedMeshProject();
    const mesh = project.nodes.find(node => node.id === "mesh-node")!;
    const copy = structuredClone(mesh); copy.id = "mesh-2"; project.nodes.push(copy);
    project.nodes.find(node => node.id === "nested-group")!.children.push(copy.id);
    const bus = createCommandBus(project);
    const result = bus.executeTransaction([add(material()), slot(mesh.id, "mat-1", "slot-a"), slot(copy.id, "mat-1", "slot-b")], 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const archive = await createNativeProjectArchive(result.project, new AssetBytes(), "0.1.0");
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const reopened = await openNativeProjectArchive(archive.value);
    expect(reopened.ok && reopened.value.project).toEqual(result.project);
  });
});

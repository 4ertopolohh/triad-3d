import { describe, expect, it } from "vitest";
import { createEditorStore } from "../../src/app/editor-store";
import { captureMaterialEdit, editMaterial } from "../../src/app/material-edit";
import { materialPresets } from "../../src/materials/presets";
import { linearToHex, parseHexColor } from "../../src/materials/color";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { SceneSync } from "../../src/renderer/scene-sync";
import * as T from "three";
import { createNestedMeshProject } from "../fixtures/projects";

function setup() {
  const project = createNestedMeshProject();
  const first = project.nodes.find(node => node.id === "mesh-node")!;
  const second = structuredClone(first);
  second.id = "second-mesh";
  project.nodes.push(second);
  project.nodes.find(node => node.id === "nested-group")!.children.push(second.id);
  const preset = materialPresets[0]!;
  project.materials.push({ ...structuredClone(preset.material), id: "shared-material", textureAssetIds: [] });
  if (first.kind !== "mesh" || second.kind !== "mesh") throw new Error("fixture");
  first.materialSlots = [{ name: "Основной", materialId: "shared-material" }];
  second.materialSlots = [{ name: "Основной", materialId: "shared-material" }];
  const store = createEditorStore(project);
  store.setSelection([first.id], first.id);
  return store;
}

describe("material editing", () => {
  it("clones on unique edit, preserves other fields and links, and supports undo/redo and serialization", async () => {
    const store = setup();
    const context = captureMaterialEdit(store)!;
    expect(editMaterial(store, context, "roughness", .123456789).ok).toBe(true);
    const state = store.getSnapshot();
    const firstId = state.document.project.nodes.find(node => node.id === "mesh-node")!.materialSlots[0]!.materialId;
    expect(firstId).not.toBe("shared-material");
    expect(state.document.project.nodes.find(node => node.id === "second-mesh")!.materialSlots[0]!.materialId).toBe("shared-material");
    expect(state.document.project.materials.find(item => item.id === firstId)).toMatchObject({ roughness: .123456789, metalness: 1, textureAssetIds: [] });
    expect(state.document.project.materials.find(item => item.id === "shared-material")?.roughness).toBe(.07);
    expect(state.history.entries).toHaveLength(1);
    const saved = serializeProjectDocument(store.captureDocument().project);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(deserializeProjectDocument(saved.value)).toMatchObject({ ok: true, value: store.captureDocument().project });
    const archive = await createNativeProjectArchive(store.captureDocument().project, new AssetBytes(), "0.1.0");
    expect(archive.ok).toBe(true);
    if (archive.ok) {
      const reopened = await openNativeProjectArchive(archive.value);
      expect(reopened.ok).toBe(true);
      if (reopened.ok) expect(reopened.value.project).toEqual(store.captureDocument().project);
    }
    expect(store.undo(state.document.revision).ok).toBe(true);
    expect(store.getSnapshot().document.project.materials).toHaveLength(1);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")!.materialSlots[0]!.materialId).toBe("shared-material");
    expect(store.redo(store.getSnapshot().document.revision).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")!.materialSlots[0]!.materialId).toBe(firstId);
  });

  it("updates all references only in explicit shared mode and rejects hidden users", () => {
    const store = setup();
    const context = captureMaterialEdit(store, "shared")!;
    expect(editMaterial(store, context, "metalness", .4).ok).toBe(true);
    expect(store.getSnapshot().document.project.materials).toHaveLength(1);
    expect(store.getSnapshot().document.project.materials[0]?.metalness).toBe(.4);
    const revision = store.getSnapshot().document.revision;
    expect(store.executeCommand({ commandId: "hide", type: "SET_NODE_FLAGS", targetIds: ["second-mesh"], payload: { nodeId: "second-mesh", visible: false } }, revision).ok).toBe(true);
    const before = store.getSnapshot();
    const denied = editMaterial(store, captureMaterialEdit(store, "shared")!, "roughness", .2);
    expect(denied.ok).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    expect(editMaterial(store, captureMaterialEdit(store)!, "roughness", .2).ok).toBe(true);
  });

  it("updates SceneSync material without replacing mesh geometry", () => {
    const store = setup();
    const sync = new SceneSync(() => {});
    sync.sync(store.getSnapshot().document.project, () => undefined);
    const first = sync.objects.get("mesh-node")!.content as T.Mesh;
    const second = sync.objects.get("second-mesh")!.content as T.Mesh;
    const geometry = first.geometry;
    expect(editMaterial(store, captureMaterialEdit(store)!, "roughness", .21).ok).toBe(true);
    sync.sync(store.getSnapshot().document.project, () => undefined);
    expect(sync.objects.get("mesh-node")!.content).toBe(first);
    expect(first.geometry).toBe(geometry);
    expect((first.material as T.MeshPhysicalMaterial).roughness).toBe(.21);
    expect((second.material as T.MeshPhysicalMaterial).roughness).toBe(.07);
    store.setSelection(["second-mesh"], "second-mesh");
    expect(editMaterial(store, captureMaterialEdit(store, "shared")!, "metalness", .4).ok).toBe(true);
    sync.sync(store.getSnapshot().document.project, () => undefined);
    expect((second.material as T.MeshPhysicalMaterial).metalness).toBe(.4);
    sync.dispose();
  });

  it("rejects invalid values, transmission conflicts and stale context without mutations", () => {
    const store = setup();
    const context = captureMaterialEdit(store)!;
    const before = store.getSnapshot();
    expect(editMaterial(store, context, "ior", Number.NaN).ok).toBe(false);
    expect(editMaterial(store, context, "envIntensity", Infinity).ok).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    expect(editMaterial(store, context, "transmission", .6).ok).toBe(true);
    const updated = captureMaterialEdit(store)!;
    const material = store.getSnapshot().document.project.materials.find(item => item.id === updated.materialId)!;
    expect(material.transmission).toBe(.6);
    expect(material.opacity).toBe(1);
    const unchanged = store.getSnapshot();
    expect(editMaterial(store, updated, "opacity", .5).ok).toBe(false);
    expect(store.getSnapshot()).toBe(unchanged);
    expect(editMaterial(store, context, "roughness", .2).ok).toBe(false);
    store.setSelection(["second-mesh"], "second-mesh");
    expect(editMaterial(store, updated, "roughness", .2).ok).toBe(false);
  });

  it("groups a unique slider gesture into one undo and cancels it", () => {
    const store = setup();
    const context = captureMaterialEdit(store)!;
    const group = "gesture";
    const first = editMaterial(store, context, "roughness", .2, group);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    context.revision = first.revision;
    context.materialId = store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")!.materialSlots[0]!.materialId;
    expect(editMaterial(store, context, "roughness", .3, group).ok).toBe(true);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.cancelGesture(group, store.getSnapshot().document.revision).ok).toBe(true);
    expect(store.getSnapshot().document.project.materials).toHaveLength(1);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(store.getSnapshot().document.dirty).toBe(false);
  });

  it("keeps no-ops out of history and converts colors without changing the document", () => {
    const store = setup();
    const context = captureMaterialEdit(store)!;
    expect(editMaterial(store, context, "roughness", .07)).toMatchObject({ ok: true, changed: false });
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(store.getSnapshot().document.dirty).toBe(false);
    expect(linearToHex(parseHexColor("#808080")!)).toBe("#808080");
    expect(linearToHex([2, 0, 0])).toBeNull();
    expect(parseHexColor("#bad")).toBeNull();
  });

  it("rejects scene mode, locked parent, active job and replaced project", async () => {
    const store = setup();
    const context = captureMaterialEdit(store)!;
    store.setTool({ mode: "scene" });
    expect(editMaterial(store, context, "roughness", .2).ok).toBe(false);
    store.setTool({ mode: "model" });
    expect(store.executeCommand({ commandId: "lock-parent", type: "SET_NODE_FLAGS", targetIds: ["nested-group"], payload: { nodeId: "nested-group", locked: true } }, 0).ok).toBe(true);
    expect(editMaterial(store, captureMaterialEdit(store)!, "roughness", .2).ok).toBe(false);
    expect(store.executeCommand({ commandId: "unlock-parent", type: "SET_NODE_FLAGS", targetIds: ["nested-group"], payload: { nodeId: "nested-group", locked: false } }, 1).ok).toBe(true);
    let release!: () => void;
    const pending = store.jobs.run({ id: "busy", name: "Проверка", cancellable: true, validate: () => null,
      compute: () => new Promise<{ ok: true; value: string }>(resolve => { release = () => resolve({ ok: true, value: "done" }); }) });
    await Promise.resolve();
    expect(editMaterial(store, captureMaterialEdit(store)!, "roughness", .2).ok).toBe(false);
    release();
    await pending;
    const old = captureMaterialEdit(store)!;
    const captured = store.captureDocument();
    expect(store.replaceProject({ project: createNestedMeshProject(), assets: captured.assets }, captured.identity)).toBe(true);
    expect(editMaterial(store, old, "roughness", .2).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { createEditorStore } from "../../src/app/editor-store";
import { applyMaterialPreset, applyMaterialPresetToNode, materialNodeReason, materialTargetReason } from "../../src/app/material-actions";
import { beginMaterialDrag, endMaterialDrag, materialDragActive, MATERIAL_PRESET_MIME, resolveMaterialDrop } from "../../src/app/material-drag";
import { categories, filterPresets, hexToLinear, materialPresets, matchesPreset } from "../../src/materials/presets";
import { validateMaterial } from "../../src/domain/validate-material";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";
import { createNestedMeshProject } from "../fixtures/projects";

describe("material presets", () => {
  it("has unique valid definitions in every category and filters them", () => {
    expect(new Set(materialPresets.map(item => item.id)).size).toBe(materialPresets.length);
    for (const category of categories) expect(filterPresets("", category.id).length).toBeGreaterThan(0);
    for (const preset of materialPresets) expect(validateMaterial({ ...preset.material, id: preset.id })).toEqual([]);
    expect(filterPresets("ХРОМ", "all").map(item => item.id)).toEqual(["polished-chrome"]);
    expect(filterPresets("хром", "glass")).toEqual([]);
    expect(hexToLinear("#808080")[0]).toBeCloseTo(.21586, 4);
  });

  it("assigns atomically, reuses materials and supports undo, redo and round-trip", () => {
    const store = createEditorStore(createNestedMeshProject());
    store.setSelection(["mesh-node"], "mesh-node");
    const chrome = materialPresets[0]!;
    expect(applyMaterialPreset(store, chrome, 0, "mesh-node").ok).toBe(true);
    let state = store.getSnapshot();
    expect(state.history.entries).toHaveLength(1);
    expect(state.document.project.materials).toHaveLength(1);
    expect(matchesPreset(state.document.project.materials[0]!, chrome)).toBe(true);
    expect(applyMaterialPreset(store, chrome, 1, "mesh-node").ok).toBe(true);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.undo(1).ok).toBe(true);
    expect(store.getSnapshot().document.project.materials).toHaveLength(0);
    expect(store.redo(2).ok).toBe(true);
    state = store.getSnapshot();
    const saved = serializeProjectDocument(store.captureDocument().project);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(deserializeProjectDocument(saved.value)).toMatchObject({ ok: true, value: store.captureDocument().project });
    expect(state.document.project.nodes.find(item => item.id === "mesh-node")?.materialSlots[0]?.materialId).toBe(state.document.project.materials[0]?.id);
  });

  it("rejects hidden and stale targets without changing history", () => {
    const store = createEditorStore(createNestedMeshProject());
    store.setSelection(["mesh-node"], "mesh-node");
    expect(applyMaterialPreset(store, materialPresets[0]!, 1, "mesh-node").ok).toBe(false);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(store.executeCommand({ commandId: "hide", type: "SET_NODE_FLAGS", targetIds: ["nested-group"], payload: { nodeId: "nested-group", visible: false } }, 0).ok).toBe(true);
    expect(materialTargetReason(store)).toMatch(/скрыт/);
    expect(applyMaterialPreset(store, materialPresets[0]!, 1, "mesh-node").ok).toBe(false);
    expect(store.getSnapshot().document.project.materials).toHaveLength(0);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
  });

  it("drops on an unselected mesh, reuses a material, and supports undo/redo", () => {
    const project = createNestedMeshProject();
    const second = structuredClone(project.nodes.find(node => node.id === "mesh-node")!);
    second.id = "second-mesh";
    second.parentId = "nested-group";
    project.nodes.push(second);
    project.nodes.find(node => node.id === "nested-group")!.children.push(second.id);
    const store = createEditorStore(project);
    store.setSelection(["mesh-node"], "mesh-node");
    const preset = materialPresets[0]!;
    expect(applyMaterialPresetToNode(store, preset, 0, second.id, store.getProjectEpoch()).ok).toBe(true);
    expect(store.getSnapshot().selection.activeId).toBe("mesh-node");
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")?.materialSlots).toEqual([]);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(applyMaterialPresetToNode(store, preset, 1, "mesh-node", store.getProjectEpoch()).ok).toBe(true);
    expect(store.getSnapshot().document.project.materials).toHaveLength(1);
    expect(applyMaterialPresetToNode(store, preset, 2, second.id, store.getProjectEpoch()).message).toMatch(/уже назначен/);
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    expect(store.undo(2).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")?.materialSlots).toEqual([]);
    expect(store.redo(3).ok).toBe(true);
  });

  it("rejects invalid, locked, hidden and GLB targets without partial commit", () => {
    const project = createNestedMeshProject();
    const store = createEditorStore(project);
    const preset = materialPresets[0]!;
    const attempt = (id: string) => applyMaterialPresetToNode(store, preset, store.getSnapshot().document.revision, id, store.getProjectEpoch());
    expect(attempt("missing").ok).toBe(false);
    expect(attempt("nested-group").ok).toBe(false);
    expect(materialNodeReason(store, "mesh-node")).toBeNull();
    expect(store.executeCommand({ commandId: "lock", type: "SET_NODE_FLAGS", targetIds: ["nested-group"], payload: { nodeId: "nested-group", locked: true } }, 0).ok).toBe(true);
    expect(attempt("mesh-node").message).toMatch(/заблокирован/);
    expect(store.executeCommand({ commandId: "unlock-hide", type: "SET_NODE_FLAGS", targetIds: ["nested-group"], payload: { nodeId: "nested-group", locked: false, visible: false } }, 1).ok).toBe(true);
    expect(attempt("mesh-node").message).toMatch(/скрыт/);
    expect(store.getSnapshot().document.project.materials).toHaveLength(0);
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    const glb = createNestedMeshProject();
    const mesh = glb.nodes.find(node => node.id === "mesh-node");
    if (mesh?.kind !== "mesh") throw new Error("Fixture mesh missing");
    mesh.meshSource = { kind: "asset", assetId: "glb-1" };
    glb.assets.push({ id: "glb-1", hash: "f".repeat(64), path: `assets/${"f".repeat(64)}.glb`, mediaType: "model/gltf-binary", colorSpace: "none" });
    const glbStore = createEditorStore(glb);
    expect(applyMaterialPresetToNode(glbStore, preset, 0, "mesh-node", glbStore.getProjectEpoch()).message).toMatch(/GLB/);
    expect(glbStore.getSnapshot().document.project.materials).toHaveLength(0);
  });

  it("rejects stale revision, replaced project and foreign drag payload", () => {
    const store = createEditorStore(createNestedMeshProject());
    const epoch = store.getProjectEpoch();
    const preset = materialPresets[0]!;
    expect(beginMaterialDrag(store, preset.id)).toBe(true);
    expect(materialDragActive(store, [MATERIAL_PRESET_MIME])).toBe(true);
    expect(resolveMaterialDrop(store, [MATERIAL_PRESET_MIME], "unknown")).toBeNull();
    expect(resolveMaterialDrop(store, ["text/plain"], preset.id)).toBeNull();
    expect(resolveMaterialDrop(store, [MATERIAL_PRESET_MIME], preset.id)?.revision).toBe(0);
    expect(store.executeCommand({ commandId: "rename", type: "RENAME_NODE", targetIds: ["mesh-node"], payload: { nodeId: "mesh-node", name: "Переименован" } }, 0).ok).toBe(true);
    expect(materialDragActive(store, [MATERIAL_PRESET_MIME])).toBe(false);
    expect(applyMaterialPresetToNode(store, preset, 0, "mesh-node", epoch).ok).toBe(false);
    endMaterialDrag();
    expect(resolveMaterialDrop(store, [MATERIAL_PRESET_MIME], preset.id)).toBeNull();
    const captured = store.captureDocument();
    expect(store.replaceProject({ project: createNestedMeshProject(), assets: captured.assets }, captured.identity)).toBe(true);
    expect(applyMaterialPresetToNode(store, preset, 0, "mesh-node", epoch).ok).toBe(false);
    expect(store.getSnapshot().document.project.materials).toHaveLength(0);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
  });
});

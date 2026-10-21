import { describe, expect, it } from "vitest";
import { createEditorStore } from "../../src/app/editor-store";
import { applyMaterialPreset, materialTargetReason } from "../../src/app/material-actions";
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
});

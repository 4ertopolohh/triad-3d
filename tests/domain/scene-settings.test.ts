import { describe, expect, it } from "vitest";
import { createProject } from "../../src/domain/create-project";
import { createEditorStore } from "../../src/app/editor-store";
import { sceneSettings, type SceneSettings } from "../../src/domain/scene-settings";
import { deserializeProjectDocument, serializeProjectDocument } from "../../src/domain/project-serialization";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { AssetBytes } from "../../src/assets/asset-bytes";

describe("scene settings transactions", () => {
  it("migrates a 1.6 scene without changing its appearance defaults and rejects new fields in the old schema", async () => {
    const old = { ...createProject(), schemaVersion: "1.6.0" };
    old.scene.lights.push({ id: "legacy-dark-light", kind: "directional", color: [1, 1, 1], intensity: 0, position: [0, 0, 0], target: [0, 0, 0] });
    const migrated = deserializeProjectDocument(JSON.stringify(old));
    expect(migrated).toMatchObject({ ok: true, value: { schemaVersion: "1.12.0", scene: old.scene } });
    expect(deserializeProjectDocument(JSON.stringify({ ...old, scene: { ...old.scene, renderSettings: { exposure: 2, toneMapping: "aces" } } })).ok).toBe(false);
    if (!migrated.ok) return;
    const project = migrated.value;
    project.scene.renderSettings = { exposure: .75, toneMapping: "neutral" };
    project.scene.background.environmentRotation = Math.PI / 2;
    const archive = await createNativeProjectArchive(project, new AssetBytes(), "0.1.0");
    expect(archive.ok).toBe(true);
    if (archive.ok) { const loaded = await openNativeProjectArchive(archive.value); expect(loaded.ok && loaded.value.project).toEqual(project); }
  });
  it("saves lighting and exposure, undo restores the complete scene, redo preserves the model", () => {
    const project = createProject();
    const store = createEditorStore(project);
    const settings = sceneSettings(structuredClone(project.scene));
    settings.lights.push({ id: "key-light", kind: "directional", color: [1, .8, .6], intensity: 3, position: [4, 6, 2], target: [0, 0, 0] });
    settings.renderSettings = { exposure: 2, toneMapping: "neutral" };
    settings.background.environmentRotation = Math.PI;
    settings.background.environmentIntensity = 2;
    const result = store.executeCommand({ commandId: "lighting", type: "SET_SCENE_SETTINGS", targetIds: [project.scene.id], payload: { sceneId: project.scene.id, settings } }, 0);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(store.getSnapshot().document.project.nodes).toEqual(project.nodes);
    const saved = serializeProjectDocument(store.captureDocument().project);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(deserializeProjectDocument(saved.value)).toMatchObject({ ok: true, value: { scene: { ...project.scene, ...settings } } });
    expect(store.undo(1)).toMatchObject({ ok: true });
    expect(store.getSnapshot().document.project.scene).toEqual(project.scene);
    expect(store.redo(2)).toMatchObject({ ok: true });
    expect(store.getSnapshot().document.project.scene.renderSettings?.exposure).toBe(2);
    expect(store.executeCommand({ commandId: "same", type: "SET_SCENE_SETTINGS", targetIds: [project.scene.id], payload: { sceneId: project.scene.id, settings } }, 3)).toMatchObject({ ok: true, changed: false });
  });
  it("rejects invalid settings and missing environment without changing document or history", () => {
    const store = createEditorStore(createProject());
    const before = store.captureDocument();
    const base = sceneSettings(before.project.scene);
    const invalid: SceneSettings[] = [
      { ...base, camera: { ...base.camera, far: .01 } },
      { ...base, camera: { ...base.camera, fovDegrees: 1e-320 } },
      { ...base, camera: { ...base.camera, position: [1e308, 0, 0], target: [-1e308, 0, 0] } },
      { ...base, background: { ...base.background, environmentAssetId: "missing" } },
      { ...base, background: { ...base.background, environmentIntensity: -1 } },
      { ...base, renderSettings: { exposure: NaN, toneMapping: "aces" } },
      { ...base, lights: [{ ...base.lights[0]!, intensity: -1 }] },
      { ...base, lights: [{ ...base.lights[0]!, id: before.project.id }] },
    ];
    for (const settings of invalid) expect(store.executeCommand({ commandId: crypto.randomUUID(), type: "SET_SCENE_SETTINGS", targetIds: [before.project.scene.id], payload: { sceneId: before.project.scene.id, settings } }, 0).ok).toBe(false);
    expect(store.captureDocument()).toEqual(before);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
  });
});

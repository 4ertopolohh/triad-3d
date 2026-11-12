import { expect, it } from "vitest";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { createEditorStore } from "../../src/app/editor-store";
import { captureMaterialEdit, editMaterialSurface } from "../../src/app/material-edit";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";

it("commits relief through history and schema, rejecting invalid strengths without mutation", () => {
  const store = createEditorStore(createMaterialAnimationProject()); store.setSelection(["mesh-node"],"mesh-node");
  const before = store.getSnapshot();
  expect(editMaterialSurface(store,captureMaterialEdit(store)!,{textureStrengths:{normal:Infinity}}).ok).toBe(false);
  expect(store.getSnapshot()).toBe(before);
  const surface = { proceduralMaps: { height: { kind: "stone" as const,seed:7,scale:4,intensity:.5,resolution:128 as const,strength:.2 } },textureStrengths:{normal:2,bump:.3} };
  expect(editMaterialSurface(store,captureMaterialEdit(store)!,surface).ok).toBe(true);
  const saved = serializeProjectDocument(store.captureDocument().project); expect(saved.ok).toBe(true);
  if (saved.ok) { const restored = deserializeProjectDocument(saved.value); expect(restored.ok).toBe(true); if (restored.ok) expect(restored.value.materials[0]).toMatchObject(surface); }
  expect(store.undo(1).ok).toBe(true); expect(store.getSnapshot().document.project.materials[0]!.proceduralMaps).toBeUndefined();
  expect(store.redo(2).ok).toBe(true); expect(store.getSnapshot().document.project.materials[0]).toMatchObject(surface);
});

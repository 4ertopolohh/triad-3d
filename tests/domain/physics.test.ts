import { expect, it } from "vitest";
import { createEditorStore } from "../../src/app/editor-store";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { deserializeProjectDocument, serializeProjectDocument } from "../../src/domain/project-serialization";
import { physicsConflicts, type PhysicsActor } from "../../src/domain/physics-config";
const actor: PhysicsActor = { nodeId: "mesh-node", enabled: true, body: "dynamic", collider: "sphere", size: [1, 1, 1], mass: 2, restitution: .8, friction: .5 };
it("stores physics configuration atomically with native roundtrip and Undo/Redo", () => {
  const store = createEditorStore(createMaterialAnimationProject()), before = store.captureDocument().project;
  expect(store.executeCommand({ commandId: "physics", type: "SET_PHYSICS", targetIds: [before.id], payload: { projectId: before.id, actors: [actor] } }, 0).ok).toBe(true);
  const saved = serializeProjectDocument(store.captureDocument().project); expect(saved.ok).toBe(true);
  if (saved.ok) expect(deserializeProjectDocument(saved.value)).toMatchObject({ ok: true, value: { schemaVersion: "1.12.0", physics: [actor] } });
  expect(store.undo(1).ok).toBe(true); expect(store.captureDocument().project).toEqual(before);
  expect(store.redo(2).ok).toBe(true); expect(store.captureDocument().project.physics).toEqual([actor]);
});
it("rejects group bodies and missing references without history or document changes", () => {
  const store = createEditorStore(createMaterialAnimationProject()), before = store.captureDocument().project;
  for (const nodeId of [before.model.rootNodeId, "missing"]) {
    expect(store.executeCommand({ commandId: nodeId, type: "SET_PHYSICS", targetIds: [before.id], payload: { projectId: before.id, actors: [{ ...actor, nodeId }] } }, 0).ok).toBe(false);
    expect(store.captureDocument().project).toEqual(before);
  }
});

it("diagnoses overridden movement and collider-changing rules",()=>{
  const rule={id:"magnet",nodeId:"mesh-node",name:"Магнит",enabled:true,priority:0,blend:"additive" as const,weight:1,releaseSeconds:.25,event:"proximity" as const,condition:{kind:"always" as const},action:{kind:"magnet" as const,radius:3,strength:1,frequency:1}};
  expect(physicsConflicts([actor],[rule],[])[0]).toContain("будет перекрыто");
  expect(physicsConflicts([{...actor,body:"kinematic"}],[rule],[])).toEqual([]);
  expect(physicsConflicts([actor],[{...rule,action:{...rule.action,kind:"pulse"}}],[])[0]).toContain("пересоздаёт");
});

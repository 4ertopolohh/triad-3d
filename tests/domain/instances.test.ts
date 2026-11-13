import { expect, it } from "vitest";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { createEditorStore } from "../../src/app/editor-store";
import type { ProjectCommand } from "../../src/domain/command-bus";
import { snapshotMatches } from "../../src/domain/model-snapshots";
import { deserializeProjectDocument, serializeProjectDocument } from "../../src/domain/project-serialization";
import { materialPresets } from "../../src/materials/presets";

const identity={position:[0,0,0] as const,rotationQuat:[0,0,0,1] as const,scale:[1,1,1] as const};
const fixture=()=>{const p=createProject(),node=createPrimitiveNode("cube",p.model.rootNodeId,"mesh");p.nodes.push(node);p.nodes[0]!.children.push(node.id);return p;};
it("shares one snapshot among 20 instances, freezes edits until explicit Sync and restores snapshots with Undo",()=>{
  const store=createEditorStore(fixture());
  const execute=(command:ProjectCommand)=>{const result=store.executeCommand(command,store.getSnapshot().document.revision);expect(result.ok,result.ok?"":result.message).toBe(true);};
  for(let i=0;i<20;i++)execute({commandId:`add-${i}`,type:"ADD_INSTANCE",targetIds:[`instance-${i}`],payload:{id:`instance-${i}`,transform:identity}});
  const initial=store.captureDocument().project;expect(initial.modelSnapshots).toHaveLength(1);expect(initial.model.revision).toBe(0);
  expect(new Set(initial.scene.instances.map(i=>i.snapshotId)).size).toBe(1);
  execute({commandId:"move",type:"SET_NODE_TRANSFORM",targetIds:["mesh"],payload:{nodeId:"mesh",transform:{...identity,position:[3,0,0]}}});
  const stale=store.captureDocument().project;expect(snapshotMatches(stale,stale.modelSnapshots![0]!)).toBe(false);expect(stale.modelSnapshots![0]!.nodes.find(n=>n.id==="mesh")!.transform.position).toEqual([0,0,0]);
  execute({commandId:"sync",type:"SYNC_INSTANCES",targetIds:["instance-0"],payload:{ids:["instance-0"]}});
  const synced=store.captureDocument().project;expect(synced.modelSnapshots).toHaveLength(2);expect(synced.model.revision).toBe(1);expect(synced.scene.instances[0]!.snapshotId).not.toBe(synced.scene.instances[1]!.snapshotId);
  expect(store.undo(store.getSnapshot().document.revision).ok).toBe(true);expect(store.captureDocument().project).toEqual(stale);
  expect(store.redo(store.getSnapshot().document.revision).ok).toBe(true);expect(store.captureDocument().project).toEqual(synced);
  const saved=serializeProjectDocument(synced);expect(saved.ok).toBe(true);if(saved.ok)expect(deserializeProjectDocument(saved.value)).toMatchObject({ok:true,value:synced});
});
it("keeps explicit material overrides independent and rejects missing animation clips atomically",()=>{
  const store=createEditorStore(fixture());for(const id of ["one","two"])expect(store.executeCommand({commandId:id,type:"ADD_INSTANCE",targetIds:[id],payload:{id,transform:identity}},store.getSnapshot().document.revision).ok).toBe(true);
  const material={...structuredClone(materialPresets[0]!.material),id:"override"};
  expect(store.executeCommand({commandId:"override",type:"SET_INSTANCE",targetIds:["one"],payload:{id:"one",transform:identity,visible:true,materialOverride:material}},2).ok).toBe(true);
  const before=store.captureDocument();expect(before.project.scene.instances[1]!.materialOverride).toBeUndefined();
  expect(store.executeCommand({commandId:"invalid",type:"SET_INSTANCE",targetIds:["one"],payload:{id:"one",transform:identity,visible:true,animationOverride:{clipId:"missing",speed:1}}},before.revision).ok).toBe(false);
  expect(store.captureDocument().project).toEqual(before.project);
});
it("migrates legacy instances to a shared frozen snapshot",()=>{
  const old=fixture();old.schemaVersion="1.9.0";old.scene.instances=[{id:"old-instance",modelId:old.model.id,transform:identity,visible:true}];
  const loaded=deserializeProjectDocument(JSON.stringify(old));expect(loaded.ok).toBe(true);
  if(loaded.ok){expect(loaded.value.schemaVersion).toBe("1.11.0");expect(loaded.value.modelSnapshots).toHaveLength(1);expect(loaded.value.scene.instances[0]!.snapshotId).toBe(loaded.value.modelSnapshots![0]!.id);}
});

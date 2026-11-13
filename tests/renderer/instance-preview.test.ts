import { expect, it, vi } from "vitest";
import { Mesh } from "three";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { createEditorStore } from "../../src/app/editor-store";
import { SceneSync } from "../../src/renderer/scene-sync";
import { InstancePreview } from "../../src/renderer/instance-preview";
import { rememberModel } from "../../src/domain/model-snapshots";

it("shares GPU geometry across twenty frozen instances, animates overrides and disposes once",()=>{
  const project=createMaterialAnimationProject(),store=createEditorStore(project);
  for(let i=0;i<20;i++)expect(store.executeCommand({commandId:`add${i}`,type:"ADD_INSTANCE",targetIds:[`i${i}`],payload:{id:`i${i}`,transform:{position:[i,0,0],rotationQuat:[0,0,0,1],scale:[1,1,1]}}},i).ok).toBe(true);
  for(let i=1;i<20;i++){const instance=store.captureDocument().project.scene.instances[i]!;expect(store.executeCommand({commandId:`color${i}`,type:"SET_INSTANCE",targetIds:[instance.id],payload:{id:instance.id,transform:instance.transform,visible:true,materialOverride:{...structuredClone(project.materials[0]!),baseColor:[i/20,.2,.3]}}},store.getSnapshot().document.revision).ok).toBe(true);}
  const graph=new SceneSync(()=>{});graph.sync(store.getSnapshot().document.project,()=>undefined,store.getProjectEpoch());
  const preview=new InstancePreview(store,graph,()=>{});preview.sync();
  const meshes:Mesh[]=[];preview.layer.traverse(o=>{if(o instanceof Mesh)meshes.push(o);});
  expect(meshes).toHaveLength(20);expect(new Set(meshes.map(m=>m.geometry)).size).toBe(1);expect(new Set(meshes.map(m=>m.material)).size).toBe(20);
  store.setTool({mode:"scene"});preview.visibility();expect(graph.objects.get(project.model.rootNodeId)!.object.visible).toBe(false);
  preview.setAnimation({clipId:"clip-1",time:1});expect(meshes[0]!.parent!.position.y).toBe(.5);
  preview.setAnimation(null);expect(meshes[0]!.parent!.position.y).toBe(0);
  const dispose=vi.spyOn(meshes[0]!.geometry,"dispose");preview.dispose();expect(dispose).toHaveBeenCalledOnce();graph.dispose();
});
it("projects an override on a snapshot whose meshes originally had no materials",()=>{
  const project=createMaterialAnimationProject(),material=structuredClone(project.materials[0]!);project.materials=[];project.nodes.find(n=>n.id==="mesh-node")!.materialSlots=[];
  const snapshot=rememberModel(project,"snapshot");material.textureMappings={baseColor:{mode:"planar",axis:"x",tiling:[2,2],offset:[.2,.3]}};project.materials.push(material);
  project.scene.instances=[{id:"instance",modelId:project.model.id,snapshotId:snapshot.id,visible:true,transform:project.nodes[0]!.transform,materialOverride:material}];
  const store=createEditorStore(project),graph=new SceneSync(()=>{}),preview=new InstancePreview(store,graph,()=>{});preview.sync();let mesh:Mesh|undefined;preview.layer.traverse(o=>{if(o instanceof Mesh)mesh=o;});
  const uv=mesh!.geometry.getAttribute("uv");expect(Math.min(...uv.array)).toBeLessThan(0);preview.dispose();graph.dispose();
});
it("uses unwrapped playback time for independent looping speeds and clamped scrub time",()=>{
  const project=createMaterialAnimationProject();project.animations[0]!.loop=true;const snapshot=rememberModel(project,"snapshot");
  project.scene.instances=[.5,2].map((speed,i)=>({id:`i${i}`,modelId:project.model.id,snapshotId:snapshot.id,visible:true,transform:project.nodes[0]!.transform,animationOverride:{clipId:"clip-1",speed}}));
  const store=createEditorStore(project),graph=new SceneSync(()=>{}),preview=new InstancePreview(store,graph,()=>{});preview.sync();const meshes:Mesh[]=[];preview.layer.traverse(o=>{if(o instanceof Mesh)meshes.push(o);});
  preview.setAnimation({clipId:"clip-1",time:.5,absoluteTime:2.5,wrap:true});expect(meshes.map(m=>m.parent!.position.y)).toEqual([.625,.5]);
  preview.setAnimation({clipId:"clip-1",time:1.5});expect(meshes.map(m=>m.parent!.position.y)).toEqual([.375,1]);preview.dispose();graph.dispose();
});

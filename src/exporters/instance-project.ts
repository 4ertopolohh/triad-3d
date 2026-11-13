import type { Project, Transform } from "../domain/types";
import { snapshotProject } from "../domain/model-snapshots";
export interface InstancePlayback { clips:Record<string,string>; defaultClip:string|null; speed:number; inherited:boolean }
const identity:Transform={position:[0,0,0],rotationQuat:[0,0,0,1],scale:[1,1,1]};
/** Detached export graph. Native snapshots and editable model remain untouched. */
export function expandInstances(input:Project):{project:Project;playback:InstancePlayback[];nodeIds:Record<string,string[]>}{
  const nodeIds:Record<string,string[]>=Object.create(null);
  if(!input.scene.instances.length)return {project:input,playback:[],nodeIds};
  const project=structuredClone(input),playback:InstancePlayback[]=[];
  project.nodes=[{id:"export-root",kind:"group",name:"Сцена",parentId:null,children:[],transform:identity,visible:true,locked:false,materialSlots:[],modifierIds:[]}];
  project.model.rootNodeId="export-root";project.modifiers=[];project.materials=[];project.animations=[];project.tracks=[];project.keyframes=[];
  delete project.modelSnapshots;project.scene.instances=[];
  input.scene.instances.forEach((instance,index)=>{
    const snapshot=input.modelSnapshots?.find(s=>s.id===instance.snapshotId);if(!snapshot)throw new Error("Снимок экземпляра отсутствует.");
    const view=structuredClone(snapshotProject(input,snapshot)),prefix=`instance-${index}:`,id=(value:string)=>prefix+value,root=id("placement");
    project.nodes[0]!.children.push(root);
    project.nodes.push({id:root,kind:"group",name:`Экземпляр ${index+1}`,parentId:"export-root",children:[id(view.model.rootNodeId)],transform:structuredClone(instance.transform),visible:instance.visible,locked:false,materialSlots:[],modifierIds:[]});
    // Prefix all namespaces; placement has a reserved ID independent of authored identifiers.
    const map=(value:string)=>id(`entity:${value}`);
    for(const node of view.nodes)(nodeIds[node.id]??=[]).push(map(node.id));
    project.nodes.at(-1)!.children=[map(view.model.rootNodeId)];
    for(const node of view.nodes){node.id=map(node.id);node.parentId=node.parentId?map(node.parentId):root;node.children=node.children.map(map);node.modifierIds=node.modifierIds.map(map);node.materialSlots=node.materialSlots.map(s=>({...s,materialId:map(s.materialId)}));if(instance.materialOverride&&node.kind==="mesh")node.materialSlots=(node.materialSlots.length?node.materialSlots:[{name:"Материал",materialId:""}]).map(s=>({...s,materialId:id("override")}));project.nodes.push(node);}
    for(const modifier of view.modifiers){modifier.id=map(modifier.id);modifier.nodeId=map(modifier.nodeId);if(typeof modifier.parameters.cutterNodeId==="string")modifier.parameters.cutterNodeId=map(modifier.parameters.cutterNodeId);project.modifiers.push(modifier);}
    project.materials.push(...view.materials.map(m=>({...m,id:map(m.id)})));if(instance.materialOverride)project.materials.push({...structuredClone(instance.materialOverride),id:id("override")});
    const clips:Record<string,string>=Object.create(null);
    for(const clip of view.animations){clips[clip.id]=map(clip.id);clip.id=map(clip.id);clip.name=`Экземпляр ${index+1}: ${clip.name}`;clip.trackIds=clip.trackIds.map(map);project.animations.push(clip);}
    project.tracks.push(...view.tracks.map(t=>({...t,id:map(t.id),nodeId:map(t.nodeId),keyframeIds:t.keyframeIds.map(map)})));
    project.keyframes.push(...view.keyframes.map(k=>({...k,id:map(k.id)})));
    const selected=instance.animationOverride?instance.animationOverride.clipId:snapshot.animations[0]?.id;
    playback.push({clips,defaultClip:selected?clips[selected]??null:null,speed:instance.animationOverride?.speed??1,inherited:!instance.animationOverride});
  });
  return {project,playback,nodeIds};
}

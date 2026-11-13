import type { Instance, Project, Transform } from "./types";
import { pruneModelSnapshots, rememberModel } from "./model-snapshots";
import { validateMaterial } from "./validate-material";

export type InstanceCommand =
  | {commandId:string;type:"ADD_INSTANCE";targetIds:[string];payload:{id:string;transform:Transform}}
  | {commandId:string;type:"SYNC_INSTANCES";targetIds:string[];payload:{ids:string[]}}
  | {commandId:string;type:"SET_INSTANCE";targetIds:[string];payload:Omit<Instance,"modelId"|"snapshotId">}
  | {commandId:string;type:"REMOVE_INSTANCE";targetIds:[string];payload:{id:string}};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string"&&v.length>0;
const vector=(v:unknown,n:number)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
const transform=(v:unknown)=>record(v)&&Object.keys(v).every(k=>["position","rotationQuat","scale"].includes(k))&&vector(v.position,3)&&vector(v.rotationQuat,4)&&vector(v.scale,3);
export function isInstanceCommand(value:{type?:unknown}):boolean{return ["ADD_INSTANCE","SYNC_INSTANCES","SET_INSTANCE","REMOVE_INSTANCE"].includes(String(value.type));}
export function validInstanceCommand(value:unknown):value is InstanceCommand{
  if(!record(value)||!id(value.commandId)||!record(value.payload)||!Array.isArray(value.targetIds)||!Object.keys(value).every(k=>["commandId","type","targetIds","payload"].includes(k)))return false;
  const p=value.payload;
  if(value.type==="SYNC_INSTANCES")return Object.keys(p).every(k=>k==="ids")&&Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=128&&p.ids.every(id)&&new Set(p.ids).size===p.ids.length&&JSON.stringify(p.ids)===JSON.stringify(value.targetIds);
  if(!id(p.id)||JSON.stringify(value.targetIds)!==JSON.stringify([p.id]))return false;
  if(value.type==="REMOVE_INSTANCE")return Object.keys(p).every(k=>k==="id");
  if(value.type==="ADD_INSTANCE")return Object.keys(p).every(k=>["id","transform"].includes(k))&&transform(p.transform);
  if(value.type!=="SET_INSTANCE"||!Object.keys(p).every(k=>["id","transform","visible","materialOverride","animationOverride"].includes(k))||!transform(p.transform)||typeof p.visible!=="boolean")return false;
  if(p.materialOverride!==undefined&&validateMaterial(p.materialOverride).length)return false;
  const animation=p.animationOverride;
  return animation===undefined||record(animation)&&Object.keys(animation).every(k=>["clipId","speed"].includes(k))&&(animation.clipId===null||id(animation.clipId))&&typeof animation.speed==="number"&&Number.isFinite(animation.speed)&&animation.speed>=0&&animation.speed<=4;
}
/** Called only against an isolated command-bus candidate; source data is never supplied by UI. */
export function applyInstanceCommand(project:Project,command:InstanceCommand):string|null{
  const instances=project.scene.instances;
  if(command.type==="ADD_INSTANCE"){
    if(instances.length>=128)return "Достигнут лимит 128 экземпляров.";
    const snapshot=rememberModel(project,`${command.commandId}:snapshot`);
    instances.push({...structuredClone(command.payload),modelId:project.model.id,visible:true,snapshotId:snapshot.id});
  }else if(command.type==="SYNC_INSTANCES"){
    if(command.payload.ids.some(id=>!instances.some(i=>i.id===id)))return "Экземпляр для синхронизации не найден.";
    const snapshot=rememberModel(project,`${command.commandId}:snapshot`);
    for(const instance of instances.filter(i=>command.payload.ids.includes(i.id))){
      if(instance.animationOverride?.clipId&&!snapshot.animations.some(c=>c.id===instance.animationOverride!.clipId))return "Сначала сбросьте override удалённого клипа.";
      instance.snapshotId=snapshot.id;
    }
  }else{
    const index=instances.findIndex(i=>i.id===command.payload.id);if(index<0)return "Экземпляр не найден.";
    if(command.type==="REMOVE_INSTANCE")instances.splice(index,1);
    else instances[index]={modelId:project.model.id,...(instances[index]!.snapshotId?{snapshotId:instances[index]!.snapshotId}:{}),...structuredClone(command.payload)};
  }
  pruneModelSnapshots(project);
  return (project.modelSnapshots?.length??0)>32?"Достигнут лимит 32 снимков модели; синхронизируйте или удалите старые экземпляры.":null;
}

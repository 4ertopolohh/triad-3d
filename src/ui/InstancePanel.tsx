import { useState } from "react";
import type { EditorState, EditorStore } from "../app/editor-store";
import type { Instance, ModelSnapshot, Project } from "../domain/types";
import type { InstanceCommand } from "../domain/instance-commands";
import { snapshotMatches, snapshotChanges } from "../domain/model-snapshots";
import { CommitNumber } from "./CommitNumber";
import { Euler, Quaternion } from "three";
import { linearToHex, parseHexColor } from "../materials/color";

export function InstancePanel({store,state,blocked}:{store:EditorStore;state:EditorState;blocked:boolean}){
  const [error,setError]=useState("");
  const [preview,setPreview]=useState<{id:string;revision:number;epoch:object;details:string[]}|null>(null);
  const project=state.document.project,revision=state.document.revision,epoch=store.getProjectEpoch();
  const execute=(command:InstanceCommand)=>{if(blocked||epoch!==store.getProjectEpoch()){setError("Проект изменился.");return;}const result=store.executeCommand(command,revision);setError(result.ok?"":result.message);};
  const update=(instance:Instance,change:Partial<Omit<Instance,"materialOverride"|"animationOverride">>&{materialOverride?:Instance["materialOverride"];animationOverride?:Instance["animationOverride"]})=>{const next=structuredClone(instance);Object.assign(next,change);if(!next.materialOverride)delete next.materialOverride;if(!next.animationOverride)delete next.animationOverride;const {modelId,snapshotId,...payload}=next;void modelId;void snapshotId;execute({commandId:crypto.randomUUID(),type:"SET_INSTANCE",targetIds:[instance.id],payload});};
  return <section><h3>Экземпляры модели</h3><p>Общая геометрия снимка. Изменения модели применяются только после просмотра и Sync.</p>
    <button disabled={blocked} onClick={()=>{const id=crypto.randomUUID();execute({commandId:crypto.randomUUID(),type:"ADD_INSTANCE",targetIds:[id],payload:{id,transform:{position:[project.scene.instances.length*2.5,0,0],rotationQuat:[0,0,0,1],scale:[1,1,1]}}});}}>Добавить экземпляр модели</button>
    {project.scene.instances.map((readonlyInstance,index)=>{const instance=readonlyInstance as Instance,snapshot=project.modelSnapshots?.find(s=>s.id===instance.snapshotId),stale=snapshot&&!snapshotMatches(project as Project,snapshot as ModelSnapshot);return <fieldset key={instance.id} disabled={blocked}><legend>Экземпляр {index+1} · снимок r{snapshot?.revision??"?"}</legend>
      <p>{stale?"Модель изменилась — доступен Sync":"Снимок актуален"}</p>
      <label><input type="checkbox" checked={instance.visible} onChange={e=>update(instance,{visible:e.target.checked})}/>Показывать экземпляр {index+1}</label>
      {(["position","scale"] as const).map(field=><div key={field}>{([0,1,2] as const).map(axis=><label key={axis}>{field==="position"?"Положение":"Масштаб"} {"XYZ"[axis]}<CommitNumber aria-label={`${field} ${index+1} ${"XYZ"[axis]}`} value={instance.transform[field][axis]} onCommit={value=>{const vector=[...instance.transform[field]] as [number,number,number];vector[axis]=value;update(instance,{transform:{...instance.transform,[field]:vector}});}}/></label>)}</div>)}
      {([0,1,2] as const).map(axis=>{const rotation=new Euler().setFromQuaternion(new Quaternion(...instance.transform.rotationQuat));return <label key={axis}>Вращение {"XYZ"[axis]}, °<CommitNumber aria-label={`Вращение экземпляра ${index+1} ${"XYZ"[axis]}`} value={[rotation.x,rotation.y,rotation.z][axis]!*180/Math.PI} onCommit={value=>{const angles=[rotation.x,rotation.y,rotation.z];angles[axis]=value*Math.PI/180;const q=new Quaternion().setFromEuler(new Euler(angles[0],angles[1],angles[2]));update(instance,{transform:{...instance.transform,rotationQuat:[q.x,q.y,q.z,q.w]}});}}/></label>;})}
      <label>Материал экземпляра<select aria-label={`Материал экземпляра ${index+1}`} value={instance.materialOverride?.id??""} onChange={e=>{const material=project.materials.find(m=>m.id===e.target.value);update(instance,{materialOverride:material?structuredClone(material) as Instance["materialOverride"]:undefined});}}><option value="">Наследовать снимок</option>{project.materials.map(material=><option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
      {instance.materialOverride&&<label>Цвет override<input type="color" aria-label={`Цвет экземпляра ${index+1}`} value={linearToHex(instance.materialOverride.baseColor)??"#ffffff"} onChange={event=>{const color=parseHexColor(event.target.value);if(color)update(instance,{materialOverride:{...instance.materialOverride!,baseColor:color}});}}/></label>}
      <label>Анимация экземпляра<select aria-label={`Анимация экземпляра ${index+1}`} value={instance.animationOverride?(instance.animationOverride.clipId??"paused"):"inherit"} onChange={e=>update(instance,{animationOverride:e.target.value==="inherit"?undefined:{clipId:e.target.value==="paused"?null:e.target.value,speed:instance.animationOverride?.speed??1}})}><option value="inherit">Наследовать снимок</option><option value="paused">Без анимации</option>{snapshot?.animations.map(clip=><option key={clip.id} value={clip.id}>{clip.name}</option>)}</select></label>
      {instance.animationOverride&&<label>Скорость override<CommitNumber aria-label={`Скорость экземпляра ${index+1}`} value={instance.animationOverride.speed} onCommit={speed=>update(instance,{animationOverride:{...instance.animationOverride!,speed}})}/></label>}
      <button disabled={!stale} onClick={()=>setPreview({id:instance.id,revision,epoch,details:[...snapshotChanges(project as Project,snapshot as ModelSnapshot),"Будут заменены геометрия, трансформации деталей, материалы и таймлайн снимка. Положение экземпляра и явные overrides сохраняются."]})}>Просмотреть Sync {index+1}</button>
      <button onClick={()=>execute({commandId:crypto.randomUUID(),type:"REMOVE_INSTANCE",targetIds:[instance.id],payload:{id:instance.id}})}>Удалить экземпляр {index+1}</button>
    </fieldset>;})}
    {preview&&<div role="region" aria-label="Предпросмотр синхронизации"><h4>Обновление снимка экземпляра</h4>{preview.details.map(detail=><p key={detail}>{detail}</p>)}<button disabled={blocked||preview.revision!==revision||preview.epoch!==epoch} onClick={()=>{execute({commandId:crypto.randomUUID(),type:"SYNC_INSTANCES",targetIds:[preview.id],payload:{ids:[preview.id]}});setPreview(null);}}>Применить Sync</button><button onClick={()=>setPreview(null)}>Отмена Sync</button></div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

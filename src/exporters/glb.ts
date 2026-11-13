import * as T from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { RuntimeBundle } from "./export-types";
import type { Material } from "../domain/types";
import { createPhysicalMaterial } from "../renderer/pbr-material";
import { evaluateClip } from "../animation/timeline";
import { bakePng } from "../materials/procedural/bake";
import { inspectStaticGlb } from "../importers/gltf/import-glb";
import { evaluateRuntimePose } from "./runtime-pose";

export async function exportGlb(bundle:RuntimeBundle,readAsset:(id:string)=>Uint8Array|undefined,signal?:AbortSignal):Promise<{blob:Blob;diagnostics:string[]}>{
  const project=bundle.project,scene=new T.Scene(),objects=new Map<string,T.Object3D>();
  const resources=new Set<T.BufferGeometry|T.Material|T.Texture>(),bitmaps=new Set<ImageBitmap>();
  const diagnostics=["GLB сохраняет геометрию, PBR и clip-анимации. React props, runtime-взаимодействия, редакторские данные и логика циклов не переносятся."];
  if(project.interactions?.length)diagnostics.push(`Не перенесено правил взаимодействия: ${project.interactions.length}. Для них используйте TSX/ZIP.`);
  if(project.scene.instances.length)throw new Error("Сначала подготовьте поддерживаемую геометрию экземпляров.");
  if(project.scene.background.environmentAssetId)diagnostics.push("HDRI окружение и его интенсивность не входят в glTF; настройте окружение в целевом viewer.");
  diagnostics.push("Камера, фон, tone mapping и свет сцены не включены: GLB экспортирует модель.");
  const check=()=>signal?.throwIfAborted();
  async function texture(blob:Blob,color:boolean){
    check();const bitmap=await createImageBitmap(blob,{imageOrientation:"flipY",colorSpaceConversion:"none",premultiplyAlpha:"none"});bitmaps.add(bitmap);check();
    const result=new T.Texture(bitmap);result.flipY=false;result.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;result.needsUpdate=true;resources.add(result);return result;
  }
  async function material(value:Material|undefined,hasUv:boolean){
    const result=createPhysicalMaterial(value);resources.add(result);if(!value)return result;
    for(const channel of ["baseColor","normal","roughness","metalness","emissive"] as const){
      const assetId=value.textureSlots?.[channel];if(!assetId)continue;
      if(!hasUv||channel==="baseColor"&&value.textureMappings?.baseColor?.mode==="triplanar"){diagnostics.push(`${value.name}: карта ${channel} пропущена — нет переносимой UV-проекции.`);continue;}
      const asset=project.assets.find(a=>a.id===assetId),bytes=readAsset(assetId);if(!asset||!bytes)throw new Error(`Нет ресурса карты ${channel}.`);
      if(!["image/png","image/jpeg","image/webp"].includes(asset.mediaType))throw new Error("Карта должна быть растровым изображением.");
      const map=await texture(new Blob([bytes.slice().buffer],{type:asset.mediaType}),channel==="baseColor"||channel==="emissive");
      if(channel==="baseColor"&&value.textureMappings?.baseColor&&value.textureMappings.baseColor.mode!=="uv")map.wrapS=map.wrapT=T.RepeatWrapping;
      if(channel==="baseColor")result.map=map;else if(channel==="normal"){result.normalMap=map;result.normalScale.setScalar(value.textureStrengths?.normal??1);}else if(channel==="roughness")result.roughnessMap=map;else if(channel==="metalness")result.metalnessMap=map;else result.emissiveMap=map;
    }
    if(value.proceduralMaps?.roughness&&!value.textureSlots?.roughness&&value.proceduralMaps.roughness.intensity){
      if(hasUv){result.roughnessMap=await texture(await bakePng(value.proceduralMaps.roughness,value.roughness),false);result.roughness=1;diagnostics.push(`${value.name}: процедурная шероховатость запечена в PNG.`);}
      else diagnostics.push(`${value.name}: процедурная шероховатость пропущена без UV.`);
    }
    if(value.textureSlots?.bump||value.proceduralMaps?.height)diagnostics.push(`${value.name}: bump/height пропущен; переносимого normal bake пока нет.`);
    if(value.envIntensity!==1)diagnostics.push(`${value.name}: envIntensity не переносится как свойство glTF материала.`);
    return result;
  }
  try{
    for(const node of project.nodes){
      check();const object=new T.Group();object.name=node.name;object.position.fromArray(node.transform.position);object.quaternion.fromArray(node.transform.rotationQuat).normalize();object.scale.fromArray(node.transform.scale);object.visible=node.visible;objects.set(node.id,object);
      if(node.kind!=="mesh")continue;
      const data=Object.hasOwn(bundle.geometries,node.id)?bundle.geometries[node.id]:undefined;
      if(data){
        const geometry=new T.BufferGeometry();resources.add(geometry);geometry.setAttribute("position",new T.Float32BufferAttribute(data.positions,3));if(data.indices)geometry.setIndex(data.indices);
        if(data.normals)geometry.setAttribute("normal",new T.Float32BufferAttribute(data.normals,3));else geometry.computeVertexNormals();
        if(data.uv)geometry.setAttribute("uv",new T.Float32BufferAttribute(data.uv,2));if(data.colors)geometry.setAttribute("color",new T.Float32BufferAttribute(data.colors,3));data.groups.forEach(g=>geometry.addGroup(g.start,g.count,g.materialIndex));
        const list:T.MeshPhysicalMaterial[]=[];for(const [i,slot] of node.materialSlots.entries())list.push(await material(project.materials.find(m=>m.id===slot.materialId),!!data.uv&&!data.missingUvSlots?.includes(i)));
        if(!list.length)list.push(await material(undefined,!!data.uv));list.forEach(m=>{m.vertexColors=!!data.colors;});object.add(new T.Mesh(geometry,list.length>1&&geometry.groups.length?list:list[0]));
      }else if(node.meshSource.kind==="asset"){
        const bytes=readAsset(node.meshSource.assetId);if(!bytes)throw new Error("GLB-ресурс отсутствует.");const inspected=inspectStaticGlb(bytes);if(!inspected.ok)throw new Error(inspected.error.message);
        const manager=new T.LoadingManager();manager.setURLModifier(url=>{if(!url.startsWith("blob:"))throw new Error("Внешние URI запрещены.");return url;});
        const loaded=await new GLTFLoader(manager).parseAsync(bytes.slice().buffer,"");object.add(loaded.scene);
        loaded.scene.traverse(o=>{if(o instanceof T.Mesh){resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){resources.add(m);for(const value of Object.values(m))if(value instanceof T.Texture)resources.add(value);}}});
        if(node.materialSlots.length){const meshes:T.Mesh[]=[];loaded.scene.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});for(const mesh of meshes){const override=await material(project.materials.find(m=>m.id===node.materialSlots[0]!.materialId),!!mesh.geometry.getAttribute("uv"));override.vertexColors=!!mesh.geometry.getAttribute("color");mesh.material=override;}}
      }
    }
    for(const node of project.nodes)(node.parentId?objects.get(node.parentId)!:scene).add(objects.get(node.id)!);
    const clips:T.AnimationClip[]=[];
    const instances=bundle.instancePlayback;
    const chosen=instances?.flatMap(instance=>{const clip=project.animations.find(c=>c.id===instance.defaultClip);return clip?[{instance,clip}]:[];})??[];
    const sceneDuration=Math.max(0,...chosen.filter(c=>c.instance.speed>0).map(c=>c.clip.durationSeconds/c.instance.speed));
    const exportClips=instances?.length?(sceneDuration>0?[{id:"instance-scene",name:"Экземпляры сцены",durationSeconds:sceneDuration,fps:30,trackIds:chosen.flatMap(c=>c.clip.trackIds)}]:[]):project.animations;
    if(instances?.length){
      diagnostics.push("Overrides экземпляров запечены в один клип: первая последовательность каждого выбранного клипа, без повторения loop-диапазонов; более короткие клипы удерживают конечную позу.");
      for(const [id,transform]of evaluateRuntimePose(bundle,undefined,0,false)){const object=objects.get(id);if(object){object.position.fromArray(transform.position);object.quaternion.fromArray(transform.rotationQuat).normalize();object.scale.fromArray(transform.scale);}}
    }
    const visible=(id:string):boolean=>{let node=project.nodes.find(n=>n.id===id);while(node){if(!node.visible)return false;node=project.nodes.find(n=>n.id===node!.parentId);}return true;};
    if(project.nodes.some(n=>!n.visible))diagnostics.push("Скрытые узлы и их дорожки не включены в GLB.");
    for(const clip of exportClips){
      const tracks=project.tracks.filter(t=>clip.trackIds.includes(t.id)&&!t.muted),solo=tracks.some(t=>t.solo),active=tracks.filter(t=>(instances?.length?chosen.some(c=>c.clip.trackIds.includes(t.id)&&(!project.tracks.some(other=>c.clip.trackIds.includes(other.id)&&other.solo&&!other.muted)||t.solo)):!solo||t.solo)&&visible(t.nodeId));
      if(!active.length)continue;
      const count=Math.ceil(clip.durationSeconds*(clip.fps??30));if(count*active.length>100000)throw new Error("Анимация превышает бюджет GLB bake: 100000 значений дорожек.");
      const seconds=new Set<number>([0,clip.durationSeconds]);for(let i=1;i<count;i++)seconds.add(i/(clip.fps??30));
      for(const track of active)for(const key of project.keyframes.filter(k=>track.keyframeIds.includes(k.id))){const speed=instances?.length?chosen.find(c=>c.clip.trackIds.includes(track.id))?.instance.speed??1:1;if(speed>0)seconds.add(key.timeSeconds/speed);}
      // Evaluate authored double times before Float32 encoding; on collision the later pose wins.
      const samples=new Map<number,number>();for(const time of [...seconds].sort((a,b)=>a-b))samples.set(Math.fround(time),time);
      if(samples.size<seconds.size)diagnostics.push(`${clip.name}: совпадающие Float32-времена объединены с сохранением более поздней позы.`);
      const times=[...samples.keys()],values=new Map(active.map(t=>[t.id,[] as number[]]));
      if(times.length*active.length>200000)throw new Error("Слишком много ключей для GLB bake.");
      for(const time of times){check();const pose=instances?.length?evaluateRuntimePose(bundle,undefined,samples.get(time)!,false):evaluateClip(project,clip.id,samples.get(time)!,false);for(const track of active){const transform=pose.get(track.nodeId);if(transform)values.get(track.id)!.push(...transform[track.property.slice(10) as "position"|"scale"|"rotationQuat"]);}}
      const output:T.KeyframeTrack[]=[];
      for(const track of active){const object=objects.get(track.nodeId),v=values.get(track.id)!;if(!object||!v.length)continue;const property=track.property==="transform.rotationQuat"?"quaternion":track.property.slice(10);const keys=project.keyframes.filter(k=>track.keyframeIds.includes(k.id)).sort((a,b)=>a.timeSeconds-b.timeSeconds);const interpolation=keys.slice(0,-1).every(k=>k.interpolation==="step")?T.InterpolateDiscrete:T.InterpolateLinear;output.push(property==="quaternion"?new T.QuaternionKeyframeTrack(`${object.uuid}.${property}`,times,v,interpolation):new T.VectorKeyframeTrack(`${object.uuid}.${property}`,times,v,interpolation));}
      if(output.length)clips.push(new T.AnimationClip(clip.name,clip.durationSeconds,output));
    }
    if(clips.length)diagnostics.push("Анимация запечена по FPS клипа с исходными ключами. Bezier/смешанные step-переходы аппроксимированы; loop markers и mute/solo зафиксированы при экспорте.");
    check();scene.updateMatrixWorld(true);const output=await new GLTFExporter().parseAsync(scene,{binary:true,trs:true,onlyVisible:true,animations:clips});check();
    if(!(output instanceof ArrayBuffer))throw new Error("Экспортёр не вернул GLB.");return {blob:new Blob([output],{type:"model/gltf-binary"}),diagnostics:[...new Set(diagnostics)]};
  }finally{for(const resource of resources)resource.dispose();for(const bitmap of bitmaps)bitmap.close();}
}

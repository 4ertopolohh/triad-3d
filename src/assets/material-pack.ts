import { createProject } from "../domain/create-project";
import type { Project } from "../domain/types";
import type { ProjectCommand } from "../domain/command-bus";
import { AssetBytes } from "./asset-bytes";
import { createNativeProjectArchive, openNativeProjectArchive, type LoadedProject } from "./native-project-archive";
import { prepareImageAsset, browserImageDecoder } from "./prepare-image-asset";

const image=(media:string)=>["image/png","image/jpeg","image/webp","image/vnd.radiance","image/x-exr"].includes(media);
/** Versioned native-container library profile; no nested ZIP, history or geometry. */
export async function createMaterialPack(project:Project,read:(id:string)=>Uint8Array|undefined,license=""):Promise<Blob>{
  if(license.length>16384)throw new Error("Лицензия превышает 16384 символа.");
  const pack=createProject();pack.name=`Библиотека: ${project.name}`;pack.materials=structuredClone(project.materials);
  pack.assets=project.assets.filter(a=>image(a.mediaType)).map(a=>({...a,...(!a.license&&license.trim()?{license:license.trim()}:{})}));
  const bytes=new AssetBytes();for(const asset of pack.assets){const data=read(asset.id);if(!data)throw new Error(`Байты ${asset.path} отсутствуют.`);bytes.set(asset.id,data);}
  if(!pack.materials.length&&!pack.assets.length)throw new Error("В проекте нет материалов или изображений для пакета.");
  const result=await createNativeProjectArchive(pack,bytes,"0.1.0");if(!result.ok)throw new Error(result.error.message);return result.value;
}
export async function openMaterialPack(input:Blob,decoder=browserImageDecoder):Promise<LoadedProject>{
  const result=await openNativeProjectArchive(input);if(!result.ok)throw new Error(result.error.message);
  const p=result.value.project;
  if(p.nodes.length!==1||p.nodes[0]!.kind!=="group"||p.nodes[0]!.children.length||p.modifiers.length||p.animations.length||p.tracks.length||p.keyframes.length||p.scene.instances.length||p.modelSnapshots?.length||p.assets.some(a=>!image(a.mediaType)))throw new Error("Это не библиотечный пакет: геометрия, анимация и исполняемые/модельные ресурсы запрещены.");
  if(!p.materials.length&&!p.assets.length)throw new Error("Библиотечный пакет пуст.");
  for(const [index,asset] of p.assets.entries()){
    const bytes=result.value.assets.get(asset.id);if(!bytes)throw new Error("Байты ресурса пакета отсутствуют.");
    const prepared=await prepareImageAsset(new File([bytes.slice().buffer],asset.path,{type:asset.mediaType}),decoder);
    if(!prepared.ok)throw new Error(`${asset.path}: ${prepared.error.message}`);
    p.assets[index]={...prepared.value.asset,id:asset.id,...(asset.license?{license:asset.license}:{})};
  }
  return result.value;
}
export function prepareMaterialPack(pack:LoadedProject,target:Project,nextId:()=>string=()=>crypto.randomUUID()):{commands:ProjectCommand[];bytes:Map<string,Uint8Array>;diagnostics:string[]}{
  const knownAssets=[...target.assets];
  const commands:ProjectCommand[]=[],bytes=new Map<string,Uint8Array>(),ids=new Map<string,string>(),diagnostics:string[]=["Ресурсы проверены декодером; пути JPEG нормализованы в .jpg, цветовое пространство метаданных — по типу ресурса. Цветовое пространство PBR-карт определяется каналом."];
  for(const asset of pack.project.assets){
    if(asset.license)diagnostics.push(`${asset.path}: лицензия — ${asset.license}`);
    const existing=knownAssets.find(a=>a.hash===asset.hash&&a.mediaType===asset.mediaType);
    if(existing){ids.set(asset.id,existing.id);if(existing.license!==asset.license)diagnostics.push(`${asset.path}: совпадающий ресурс уже есть; его существующая лицензия сохраняется без перезаписи.`);continue;}
    const id=nextId(),copy={...asset,id},data=pack.assets.get(asset.id);if(!data)throw new Error("Байты пакета отсутствуют.");ids.set(asset.id,id);bytes.set(id,data);
    commands.push({commandId:nextId(),type:"ADD_ASSET",targetIds:[id],payload:{asset:copy}});knownAssets.push(copy);
  }
  for(const original of pack.project.materials){
    const material=structuredClone(original);material.id=nextId();
    const remap=(id:string)=>{const mapped=ids.get(id);if(!mapped)throw new Error("Ссылка материала вне пакета.");return mapped;};
    material.textureAssetIds=material.textureAssetIds.map(remap);
    if(material.textureSlots)material.textureSlots=Object.fromEntries(Object.entries(material.textureSlots).map(([key,id])=>[key,remap(id)]));
    if(target.materials.some(m=>m.name===material.name)){diagnostics.push(`${material.name}: добавляется отдельный материал с новым ID.`);material.name=`${material.name} (пакет)`;}
    commands.push({commandId:nextId(),type:"ADD_MATERIAL",targetIds:[material.id],payload:{material}});
  }
  return {commands,bytes,diagnostics};
}

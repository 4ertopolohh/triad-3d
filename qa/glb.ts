import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createProject } from "../src/domain/create-project";
import { createPrimitiveNode } from "../src/geometry/primitives";
import { materialPresets } from "../src/materials/presets";
import { prepareExport } from "../src/exporters/package";
import { exportGlb } from "../src/exporters/glb";

const output=document.querySelector<HTMLPreElement>("#result")!;
document.querySelector<HTMLButtonElement>("#run")!.onclick=async()=>{
  output.textContent="Проверка…";
  try{
    const canvas=new OffscreenCanvas(8,8),ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#ff0000";ctx.fillRect(0,0,8,4);ctx.fillStyle="#0000ff";ctx.fillRect(0,4,8,4);
    const bytes=new Uint8Array(await (await canvas.convertToBlob({type:"image/png"})).arrayBuffer());
    const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");
    const project=createProject(),node=createPrimitiveNode("cube",project.model.rootNodeId,"cube");
    project.nodes.push(node);project.nodes[0]!.children.push(node.id);project.assets.push({id:"texture",hash,path:`assets/${hash}.png`,mediaType:"image/png",colorSpace:"srgb"});
    const material={...structuredClone(materialPresets[0]!.material),id:"material",textureSlots:{baseColor:"texture"},textureMappings:{baseColor:{mode:"box" as const,tiling:[2,2] as [number,number],offset:[.25,.25] as [number,number]}}};
    project.materials.push(material);node.materialSlots=[{name:"Основной",materialId:material.id}];
    const prepared=await prepareExport(project,()=>bytes,"max"),result=await exportGlb(prepared.bundle,()=>bytes);
    const loaded=await new GLTFLoader().parseAsync(await result.blob.arrayBuffer(),"");
    let map:T.Texture|undefined;loaded.scene.traverse(o=>{if(o instanceof T.Mesh)map=(o.material as T.MeshStandardMaterial).map??undefined;});
    if(!map||map.wrapS!==T.RepeatWrapping||map.wrapT!==T.RepeatWrapping)throw new Error("Repeat sampler не сохранился.");
    const image=map.image as ImageBitmap;const pixels=new OffscreenCanvas(image.width,image.height),c=pixels.getContext("2d")!;c.drawImage(image,0,0);
    const top=[...c.getImageData(0,0,1,1).data],bottom=[...c.getImageData(0,image.height-1,1,1).data];
    if(top[2]!==255||bottom[0]!==255)throw new Error(`Ориентация bitmap изменилась: ${top} / ${bottom}`);
    output.textContent=JSON.stringify({status:"PASS",sampler:"REPEAT / REPEAT",top,bottom,bytes:result.blob.size,diagnostics:result.diagnostics},null,2);
    loaded.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const v of Object.values(m))if(v instanceof T.Texture){(v.image as ImageBitmap)?.close?.();v.dispose();}m.dispose();}}});
  }catch(error){output.textContent=`FAIL: ${String(error)}`;}
};

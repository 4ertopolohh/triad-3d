import { createRoot } from "react-dom/client";
import { createProject } from "../src/domain/create-project";
import { createPrimitiveNode } from "../src/geometry/primitives";
import { materialPresets } from "../src/materials/presets";
import { prepareExport } from "../src/exporters/package";
import { optimizeGeometryInWorker, optimizeTextureInWorker } from "../src/exporters/optimization-client";
import { TriadRuntime } from "../src/exporters/runtime";
import { unpackGeometries } from "../src/exporters/packed-geometry";
const output=document.querySelector<HTMLPreElement>("#result")!,button=document.querySelector<HTMLButtonElement>("#run")!,root=createRoot(document.querySelector("#view")!);
let urls:string[]=[];
button.onclick=async()=>{button.disabled=true;output.textContent="Проверка…";root.render(null);urls.forEach(URL.revokeObjectURL);urls=[];
  try{
    const canvas=new OffscreenCanvas(512,512),ctx=canvas.getContext("2d")!,data=ctx.createImageData(512,512);
    for(let y=0;y<512;y++)for(let x=0;x<512;x++){const i=(y*512+x)*4;data.data[i]=x/2;data.data[i+1]=y/2;data.data[i+2]=(Math.sin(x*.07)*Math.cos(y*.04)+1)*127;data.data[i+3]=255;}ctx.putImageData(data,0,0);
    const bytes=new Uint8Array(await(await canvas.convertToBlob({type:"image/png"})).arrayBuffer()),hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");
    const project=createProject(),node=createPrimitiveNode("sphere",project.model.rootNodeId,"sphere");if(node.meshSource.kind!=="primitive")throw new Error("fixture");node.meshSource.parameters={radius:1,widthSegments:64,heightSegments:32};project.nodes.push(node);project.nodes[0]!.children.push(node.id);
    project.assets.push({id:"texture",hash,path:`assets/${hash}.png`,mediaType:"image/png",colorSpace:"srgb"});const material={...structuredClone(materialPresets[3]!.material),id:"material",baseColor:[1,1,1] as const,textureSlots:{baseColor:"texture"},textureAssetIds:["texture"]};project.materials.push(material);node.materialSlots=[{name:"Основной",materialId:material.id}];
    const before=JSON.stringify(project),prepared=await prepareExport(project,()=>bytes,"max",undefined,undefined,[],(g,s)=>optimizeGeometryInWorker(g,{ratio:.5,error:.01},s),optimizeTextureInWorker);
    const asset=prepared.bundle.project.assets[0]!,optimized=prepared.files.get(`public/${asset.path}`)!;
    const decoded=await unpackGeometries(JSON.parse(new TextDecoder().decode(prepared.files.get("src/geometry.json"))));
    if(JSON.stringify(decoded)!==JSON.stringify(prepared.bundle.geometries))throw new Error("Meshopt roundtrip изменил геометрию.");
    if(JSON.stringify(project)!==before||prepared.triangles>=3968||optimized.length>=bytes.length)throw new Error("Не подтверждено сокращение или исходник изменён.");
    urls=[URL.createObjectURL(new Blob([bytes],{type:"image/png"})),URL.createObjectURL(new Blob([optimized.slice().buffer],{type:asset.mediaType}))];
    root.render(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}><div>Исходник<TriadRuntime data={prepared.referenceBundle!} assetUrls={{texture:urls[0]!}} height={360} playing={false}/></div><div>Оптимизировано<TriadRuntime data={{...prepared.bundle,geometries:decoded}} assetUrls={{texture:urls[1]!}} height={360} playing={false}/></div></div>);
    output.textContent=JSON.stringify({status:"PASS",trianglesBefore:3968,trianglesAfter:prepared.triangles,textureBytesBefore:bytes.length,textureBytesAfter:optimized.length,diagnostics:prepared.diagnostics},null,2);
  }catch(error){output.textContent=`FAIL: ${String(error)}`;}finally{button.disabled=false;}
};

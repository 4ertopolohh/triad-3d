import { createMaterialPack, openMaterialPack } from "./material-pack";
import type { Project } from "../domain/types";
self.onmessage=async(event:MessageEvent<{kind:"open";file:Blob}|{kind:"save";project:Project;assets:[string,Uint8Array][];license:string}>)=>{
  try{
    if(event.data.kind==="open"){const loaded=await openMaterialPack(event.data.file);self.postMessage({ok:true,value:{project:loaded.project,assets:loaded.assets.ids().map(id=>[id,loaded.assets.get(id)!])}});}
    else{const data=event.data,assets=new Map(data.assets);self.postMessage({ok:true,value:await createMaterialPack(data.project,id=>assets.get(id),data.license)});}
  }catch(error){self.postMessage({ok:false,message:error instanceof Error?error.message:String(error)});}
};

import { exportGlb } from "./glb";
import type { RuntimeBundle } from "./export-types";
self.onmessage=async(event:MessageEvent<{bundle:RuntimeBundle;assets:[string,Uint8Array][]}>)=>{
  try{const assets=new Map(event.data.assets);self.postMessage({ok:true,value:await exportGlb(event.data.bundle,id=>assets.get(id))});}
  catch(error){self.postMessage({ok:false,message:error instanceof Error?error.message:String(error)});}
};

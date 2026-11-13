import { optimizeTexture } from "./optimize-texture";
import type { Asset } from "../domain/types";
self.onmessage=async(event:MessageEvent<{asset:Asset;bytes:Uint8Array}>)=>{
  try{self.postMessage({ok:true,value:await optimizeTexture(event.data.asset,event.data.bytes)});}
  catch(error){self.postMessage({ok:false,message:error instanceof Error?error.message:String(error)});}
};

import { optimizeGeometry, type GeometryOptimization } from "./optimize-geometry";
import type { ExportGeometry } from "./export-types";
self.onmessage=async(event:MessageEvent<{geometry:ExportGeometry;options:GeometryOptimization}>)=>{
  try{self.postMessage({ok:true,value:await optimizeGeometry(event.data.geometry,event.data.options)});}
  catch(error){self.postMessage({ok:false,message:error instanceof Error?error.message:String(error)});}
};

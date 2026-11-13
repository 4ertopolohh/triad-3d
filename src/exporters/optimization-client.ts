import type { ExportGeometry } from "./export-types";
import type { GeometryOptimization, GeometryOptimizationResult } from "./optimize-geometry";
import type { Asset } from "../domain/types";
import type { TextureOptimizationResult } from "./optimize-texture";
export function optimizeGeometryInWorker(geometry:ExportGeometry,options:GeometryOptimization,signal?:AbortSignal):Promise<GeometryOptimizationResult>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./optimize-geometry.worker.ts",import.meta.url),{type:"module"});
    const cleanup=()=>{worker.terminate();signal?.removeEventListener("abort",cancel);};
    const cancel=()=>{cleanup();reject(new Error("Оптимизация отменена."));};
    signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted){cancel();return;}
    worker.onmessage=(event:MessageEvent<{ok:true;value:GeometryOptimizationResult}|{ok:false;message:string}>)=>{cleanup();if(event.data.ok)resolve(event.data.value);else reject(new Error(event.data.message));};
    worker.onerror=()=>{cleanup();reject(new Error("Ошибка потока оптимизации."));};
    try{worker.postMessage({geometry,options});}catch(error){cleanup();reject(error);}
  });
}
export function optimizeTextureInWorker(asset:Asset,bytes:Uint8Array,signal?:AbortSignal):Promise<TextureOptimizationResult>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./optimize-texture.worker.ts",import.meta.url),{type:"module"});
    const cleanup=()=>{worker.terminate();signal?.removeEventListener("abort",cancel);};
    const cancel=()=>{cleanup();reject(new Error("Оптимизация отменена."));};
    signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted){cancel();return;}
    worker.onmessage=(event:MessageEvent<{ok:true;value:TextureOptimizationResult}|{ok:false;message:string}>)=>{cleanup();if(event.data.ok)resolve(event.data.value);else reject(new Error(event.data.message));};
    worker.onerror=()=>{cleanup();reject(new Error("Ошибка потока оптимизации текстуры."));};
    try{worker.postMessage({asset,bytes});}catch(error){cleanup();reject(error);}
  });
}

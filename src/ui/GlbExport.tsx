import { useState } from "react";
import type { EditorStore } from "../app/editor-store";
import type { PreparedExport } from "../exporters/package";

export function GlbExport({store,prepared,disabled}:{store:EditorStore;prepared:PreparedExport;disabled:boolean}){
  const [result,setResult]=useState<{blob:Blob;diagnostics:string[]}|null>(null),[error,setError]=useState("");
  async function prepare(){
    setResult(null);setError("");let output:typeof result=null;
    const outcome=await store.jobs.run({id:crypto.randomUUID(),name:"Экспорт GLB",cancellable:true,validate:()=>null,compute:async(_input,signal)=>{
      try{
        output=await new Promise<NonNullable<typeof result>>((resolve,reject)=>{
          const worker=new Worker(new URL("../exporters/glb.worker.ts",import.meta.url),{type:"module"});
          const cleanup=()=>{worker.terminate();signal.removeEventListener("abort",abort);};
          const abort=()=>{cleanup();reject(new Error("Экспорт отменён."));};signal.addEventListener("abort",abort,{once:true});if(signal.aborted){abort();return;}
          worker.onerror=()=>{cleanup();reject(new Error("Ошибка потока GLB."));};
          worker.onmessage=(event:MessageEvent<{ok:true;value:NonNullable<typeof result>}|{ok:false;message:string}>)=>{cleanup();if(event.data.ok)resolve(event.data.value);else reject(new Error(event.data.message));};
          const assets=prepared.bundle.project.assets.map(asset=>[asset.id,prepared.files.get(`public/${asset.path}`)]).filter((entry):entry is [string,Uint8Array]=>entry[1] instanceof Uint8Array);
          try{worker.postMessage({bundle:prepared.bundle,assets});}catch(error){cleanup();reject(error);}
        });return {ok:true,value:true};
      }catch(error){return {ok:false,error:{code:signal.aborted?"JOB_CANCELLED":"COMPUTE_FAILED",message:String(error)}};}
    }});
    if(outcome.ok)setResult(output);else setError(outcome.error.message);
  }
  return <details><summary>GLB и отчёт о потерях</summary><p>Геометрия, PBR и clip-анимации. Не переносит React/runtime-взаимодействия, HDRI и редакторскую структуру. Bump и шейдерные проекции могут быть пропущены — проверьте отчёт.</p><button disabled={disabled} onClick={()=>void prepare()}>Подготовить GLB</button>{result&&<><ul>{result.diagnostics.map(d=><li key={d}>{d}</li>)}</ul><button disabled={disabled} onClick={()=>{const url=URL.createObjectURL(result.blob),link=document.createElement("a");link.href=url;link.download="triad-model.glb";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Скачать GLB</button></>}{error&&<p role="alert">{error}</p>}</details>;
}

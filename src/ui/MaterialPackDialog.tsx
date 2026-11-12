import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import { prepareMaterialPack } from "../assets/material-pack";
import { AssetBytes } from "../assets/asset-bytes";
import type { Project } from "../domain/types";

export function MaterialPackDialog({store,onClose}:{store:EditorStore;onClose:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[license,setLicense]=useState("");
  const [prepared,setPrepared]=useState<ReturnType<typeof prepareMaterialPack>|null>(null);
  const captured=useRef<ReturnType<EditorStore["captureDocument"]>|null>(null),generation=useRef(0),abort=useRef(new AbortController());
  const worker=useRef<Worker|null>(null);
  useEffect(()=>{abort.current=new AbortController();return ()=>{generation.current++;abort.current.abort();worker.current?.terminate();};},[]);
  function compute<T>(message:unknown):Promise<T>{return new Promise((resolve,reject)=>{
    const job=new Worker(new URL("../assets/material-pack.worker.ts",import.meta.url),{type:"module"});worker.current=job;
    const signal=abort.current.signal;const cleanup=()=>{job.terminate();if(worker.current===job)worker.current=null;signal.removeEventListener("abort",cancel);};
    const cancel=()=>{cleanup();reject(new Error("Обработка пакета отменена."));};signal.addEventListener("abort",cancel,{once:true});if(signal.aborted){cancel();return;}
    job.onmessage=(event:MessageEvent<{ok:true;value:T}|{ok:false;message:string}>)=>{cleanup();if(event.data.ok)resolve(event.data.value);else reject(new Error(event.data.message));};
    job.onerror=()=>{cleanup();reject(new Error("Ошибка потока пакета."));};try{job.postMessage(message);}catch(error){cleanup();reject(error);}
  });}
  async function open(file:File){
    const token=++generation.current;setPrepared(null);setBusy(true);setError("");captured.current=store.captureDocument();
    const capture=captured.current;
    try{const pack=await compute<{project:Project;assets:[string,Uint8Array][]}>({kind:"open",file});if(token===generation.current)setPrepared(prepareMaterialPack({project:pack.project,assets:new AssetBytes(pack.assets)},capture.project));}
    catch(error){if(token===generation.current)setError(String(error));}finally{if(token===generation.current)setBusy(false);}
  }
  async function save(){
    const token=++generation.current;setBusy(true);setError("");const capture=store.captureDocument();
    try{const blob=await compute<Blob>({kind:"save",project:capture.project,assets:capture.assets.ids().map(id=>[id,capture.assets.get(id)!]),license});if(token!==generation.current)return;const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="triad-materials.triadpack";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(error){if(token===generation.current)setError(String(error));}finally{if(token===generation.current)setBusy(false);}
  }
  async function apply(){const capture=captured.current;if(!prepared||!capture)return;setBusy(true);const result=await store.addLibraryPack(prepared.commands,prepared.bytes,capture.revision,capture.identity,abort.current.signal);if(result.ok)onClose();else{setError(result.message);setBusy(false);}}
  return <div className="job-backdrop"><section className="job-dialog export-dialog" role="dialog" aria-modal="true" aria-label="Пакеты материалов">
    <h2>Пакеты материалов и ресурсов</h2><p>Версионируемый .triadpack: материалы, PNG/JPEG/WebP/HDR/EXR и их лицензии. Геометрия и история не включаются. Совпадающие ресурсы переиспользуются; материалы получают новые ID.</p>
    <label>Лицензия для ресурсов без сведений<textarea aria-label="Лицензия пакета" disabled={busy} value={license} maxLength={16384} onChange={e=>setLicense(e.target.value)} /></label><button disabled={busy} onClick={()=>void save()}>Скачать пакет библиотеки</button>
    <input aria-label="Открыть пакет материалов" type="file" accept=".triadpack" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void open(file);}} />
    {busy&&<p role="status">Обработка пакета…</p>}
    {prepared&&<><p>Новых ресурсов: {prepared.bytes.size}; материалов: {prepared.commands.filter(c=>c.type==="ADD_MATERIAL").length}.</p>{prepared.diagnostics.map((d,i)=><p key={i}>{d}</p>)}<button disabled={busy||!prepared.commands.length} onClick={()=>void apply()}>Добавить пакет одной операцией</button></>}
    {error&&<p role="alert">{error}</p>}<button onClick={()=>{generation.current++;abort.current.abort();worker.current?.terminate();onClose();}}>{busy?"Отменить и закрыть":"Закрыть"}</button>
  </section></div>;
}

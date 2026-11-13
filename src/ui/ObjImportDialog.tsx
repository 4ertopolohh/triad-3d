import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import type { ObjImport } from "../importers/obj/parse-obj";
import { OBJ_LIMITS } from "../importers/obj/limits";

export function ObjImportDialog({store,onClose}:{store:EditorStore;onClose:()=>void}){
  const [result,setResult]=useState<ObjImport|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const active=useRef(true),jobId=useRef<string|null>(null);
  const captured=useRef({epoch:store.getProjectEpoch(),revision:store.getSnapshot().document.revision});
  useEffect(()=>{active.current=true;return()=>{active.current=false;if(store.getSnapshot().job.id===jobId.current)store.jobs.cancelJob();};},[store]);
  async function analyze(file:File){
    setResult(null);setError("");setBusy(true);let prepared:ObjImport|undefined;
    captured.current={epoch:store.getProjectEpoch(),revision:store.getSnapshot().document.revision};
    const id=crypto.randomUUID();jobId.current=id;
    const outcome=await store.jobs.run({id,name:"Анализ OBJ",cancellable:true,validate:()=>file.size>OBJ_LIMITS.bytes?{code:"VALIDATION_FAILED",message:"OBJ превышает 16 МиБ."}:null,compute:async(input,signal)=>{
      try{
        const text=await file.text();signal.throwIfAborted();
        prepared=await new Promise<ObjImport>((resolve,reject)=>{
          const worker=new Worker(new URL("../importers/obj/obj.worker.ts",import.meta.url),{type:"module"});
          const cleanup=()=>{worker.terminate();signal.removeEventListener("abort",abort);};
          const abort=()=>{cleanup();reject(new Error("Анализ OBJ отменён."));};signal.addEventListener("abort",abort,{once:true});
          worker.onmessage=(event:MessageEvent<{ok:true;value:ObjImport}|{ok:false;message:string}>)=>{cleanup();if(event.data.ok)resolve(event.data.value);else reject(new Error(event.data.message));};
          worker.onerror=()=>{cleanup();reject(new Error("Ошибка потока OBJ."));};
          if(signal.aborted){abort();return;}
          try{worker.postMessage({text,parentId:input.project.model.rootNodeId,name:file.name.replace(/\.obj$/i,"")});}catch(e){cleanup();reject(e);}
        });signal.throwIfAborted();return {ok:true,value:true};
      }catch(e){return {ok:false,error:{code:signal.aborted?"JOB_CANCELLED":"COMPUTE_FAILED",message:e instanceof Error?e.message:String(e)}};}
    }});
    if(!active.current)return;jobId.current=null;setBusy(false);
    if(outcome.ok&&prepared)setResult(prepared);else if(!outcome.ok)setError(outcome.error.message);
  }
  function apply(){
    if(!result)return;
    if(store.getProjectEpoch()!==captured.current.epoch||store.getSnapshot().document.revision!==captured.current.revision){setError("Проект изменился. Повторите анализ OBJ.");return;}
    const outcome=store.executeTransaction(result.nodes.map(node=>({commandId:crypto.randomUUID(),type:"ADD_NODE",targetIds:[node.parentId!,node.id],payload:{parentId:node.parentId!,node}})),captured.current.revision,crypto.randomUUID());
    if(outcome.ok)onClose();else setError(outcome.message);
  }
  return <div className="job-backdrop"><section className="job-dialog export-dialog" role="dialog" aria-modal="true" aria-label="Импорт OBJ">
    <h2>Импорт OBJ</h2><p>Локальная геометрия и UV: треугольники, выпуклые плоские четырёхугольники, группы. До 16 МиБ / 100 000 треугольников. MTL, текстуры, анимации и единицы измерения не переносятся. Нормали пересчитываются; сглаживание и разрывы vn учитываются. Внешние файлы не открываются.</p>
    <table aria-label="Совместимость OBJ"><thead><tr><th>Данные</th><th>Результат импорта</th></tr></thead><tbody>
      <tr><td>Треугольники, выпуклые плоские quad</td><td>Геометрия; положительные и отрицательные индексы</td></tr>
      <tr><td>N-gon, вогнутые/неплоские quad, freeform</td><td>Отказ: предварительно триангулируйте</td></tr>
      <tr><td>UV</td><td>2D-координаты; неполная UV-группа импортируется без UV</td></tr>
      <tr><td>Нормали и сглаживание</td><td>Пересчёт с разрывами vn/s; UV-швы могут стать жёсткими</td></tr>
      <tr><td>Объекты и группы</td><td>Отдельные mesh под Model, без вложенной иерархии</td></tr>
      <tr><td>MTL, текстуры, RGB вершин, линии, точки</td><td>Пропуск с отчётом; внешние пути не открываются</td></tr>
      <tr><td>PBR, анимация, единицы</td><td>Не переносятся; исходные координаты без изменения</td></tr>
    </tbody></table>
    <input type="file" aria-label="Файл OBJ" accept=".obj,text/plain" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void analyze(file);}}/>
    {result&&<><p>Объектов: {result.nodes.length}; треугольников: {result.triangles}. Проверьте ограничения перед добавлением.</p><ul>{result.diagnostics.map(d=><li key={d}>{d}</li>)}</ul><button disabled={busy} onClick={apply}>Добавить геометрию OBJ</button></>}
    {error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={onClose}>Закрыть</button>
  </section></div>;
}

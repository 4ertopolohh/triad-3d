import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import { sourceCommands } from "../importers/source/source-commands";
import type { SourceImport } from "../importers/source/parse-source";

export function SourceImportDialog({store,onClose}:{store:EditorStore;onClose:()=>void}){
  const [source,setSource]=useState("");const [result,setResult]=useState<SourceImport|null>(null);
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const [reading,setReading]=useState(false);const readGeneration=useRef(0);
  const worker=useRef<Worker|null>(null);const captured=useRef({epoch:store.getProjectEpoch(),revision:store.getSnapshot().document.revision});
  useEffect(()=>()=>{readGeneration.current++;worker.current?.terminate();},[]);
  function cancel(){worker.current?.terminate();worker.current=null;setBusy(false);}
  function analyze(){
    cancel();setError("");setResult(null);
    const state=store.getSnapshot();captured.current={epoch:store.getProjectEpoch(),revision:state.document.revision};
    const job=new Worker(new URL("../importers/source/source.worker.ts",import.meta.url),{type:"module"});worker.current=job;setBusy(true);
    job.onmessage=(event:MessageEvent<{ok:true;value:SourceImport}|{ok:false;message:string}>)=>{if(worker.current!==job)return;cancel();if(event.data.ok)setResult(event.data.value);else setError(event.data.message);};
    job.onerror=()=>{if(worker.current===job){cancel();setError("Не удалось разобрать исходник. Текущий проект не изменён.");}};
    job.postMessage({source,parentId:state.document.project.model.rootNodeId});
  }
  function apply(){
    if(!result)return;
    if(store.getProjectEpoch()!==captured.current.epoch||store.getSnapshot().document.revision!==captured.current.revision){setError("Проект изменился. Повторите анализ.");return;}
    const commands=sourceCommands(result);
    const outcome=store.executeTransaction(commands,captured.current.revision,crypto.randomUUID());
    if(outcome.ok)onClose();else setError(outcome.message);
  }
  return <div className="job-backdrop"><section className="job-dialog export-dialog" role="dialog" aria-modal="true" aria-label="Статический импорт исходника">
    <h2>Импорт TSX / JSX / HTML</h2><p>Статические mesh/group, геометрии и PBR-материалы. HTML — только JSX-совместимые фрагменты. Код и импорты не исполняются; исходник не сохраняется. Максимум 256 КиБ.</p>
    <input aria-label="Файл исходника" type="file" accept=".tsx,.jsx,.html,.htm" disabled={busy||reading} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;const generation=++readGeneration.current;setResult(null);setError("");if(file.size>256*1024){setError("Файл превышает 256 КиБ.");return;}setReading(true);try{const text=await file.text();if(generation===readGeneration.current)setSource(text);}catch{if(generation===readGeneration.current)setError("Не удалось прочитать файл.");}finally{if(generation===readGeneration.current)setReading(false);}}} />
    <textarea aria-label="Исходный код" value={source} disabled={busy||reading} maxLength={262144} rows={8} onChange={e=>{readGeneration.current++;setSource(e.target.value);setResult(null);}} />
    <button disabled={busy||reading||!source.trim()} onClick={analyze}>Проанализировать без исполнения</button>
    {busy&&<><p role="status">Разбор в отдельном потоке…</p><button onClick={cancel}>Отменить анализ</button></>}
    {result&&<><p>Объектов: {result.nodes.length}. Материалов: {result.materials.length}. Проверьте пропуски перед применением.</p><ul className="source-diagnostics">{result.diagnostics.map((item,i)=><li key={i}>{item.kind==="supported"?"Поддержано":item.kind==="warning"?"Предупреждение":"Пропущено"} · {item.line}:{item.column}–{item.endLine}:{item.endColumn} · {item.type}: {item.message}</li>)}</ul><button disabled={!result.nodes.length||busy} onClick={apply}>Добавить поддержанные объекты</button></>}
    {error&&<p role="alert">{error}</p>}<button onClick={()=>{cancel();onClose();}}>Закрыть</button>
  </section></div>;
}

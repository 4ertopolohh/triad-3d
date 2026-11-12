import { singleFileExport } from "../exporters/single-file";
import { GlbExport } from "./GlbExport";
import { useEffect, useMemo, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import type { Project } from "../domain/types";
import { useEditorStore } from "../app/use-editor-store";
import { isJobActive } from "../app/job-controller";
import { prepareExport, createExportZip, type PreparedExport } from "../exporters/package";
import { TriadRuntime } from "../exporters/runtime";
import { CommitNumber } from "./CommitNumber";
import type { ExportParameter, RuntimeBundle, ExportProfile } from "../exporters/export-types";

export function ExportDialog({ store, onClose }: { store: EditorStore; onClose: () => void }) {
  const state = useEditorStore(store);
  const busy = isJobActive(state.job.status);
  const [profile, setProfile] = useState<ExportProfile>("balanced");
  const [result, setResult] = useState<{ prepared: PreparedExport; blob: Blob; revision: number } | null>(null);
  const [parameters,setParameters] = useState<ExportParameter[]>([]);
  const [error, setError] = useState("");
  async function prepare() {
    setResult(null); setError("");
    let output: { prepared: PreparedExport; blob: Blob; revision: number } | null = null;
    const outcome = await store.jobs.run({ id: crypto.randomUUID(), name: "Подготовка TSX/ZIP", cancellable: true, validate: () => null,
      compute: async (input, signal, progress) => {
        try {
          const prepared = await prepareExport(structuredClone(input.project) as Project,store.readAssetBytes,profile,signal,p => progress(p*.8),parameters);
          const blob = await createExportZip(prepared,signal); signal.throwIfAborted();
          output = { prepared,blob,revision: input.revision }; progress(1);
          return { ok: true, value: true };
        } catch (error) { return { ok: false, error: { code: signal.aborted ? "JOB_CANCELLED" : "COMPUTE_FAILED", message: error instanceof Error ? error.message : String(error) } }; }
      },
    });
    if (outcome.ok) setResult(output); else setError(outcome.error.message);
  }
  return <div className="job-backdrop"><section className="job-dialog export-dialog" role="dialog" aria-modal="true" aria-label="Экспорт TSX и ZIP">
    <h2>Экспорт TSX и ZIP</h2>
    <label>Профиль<select aria-label="Профиль экспорта" value={profile} disabled={busy} onChange={e => { setProfile(e.target.value as ExportProfile); setResult(null); }}><option value="max">Max — разрешение до 2×</option><option value="balanced">Balanced — до 1,5×</option><option value="lite">Lite — 1× без сглаживания</option></select></label>
    <p>React-компонент, исходники runtime, ресурсы и готовый Vite-проект. Геометрия модификаторов фиксируется при экспорте. Профили меняют качество растра; исходная модель сохраняется.</p>
    <p>Props: размер, масштаб, цвет, скорость, клип, воспроизведение и время. Инструкции подключения входят в ZIP.</p>
    <details><summary>Параметры объектов</summary><p>Выбранные props доступны в React-компоненте. Масштаб умножает исходный; цвет заменяет основной цвет материала.</p>
      {state.document.project.nodes.filter(n => n.kind === "mesh").map((node,index) => <div key={node.id}><strong>{node.name}</strong>{(["scale","color"] as const).map(property => {
        const selected = parameters.find(p => p.nodeId === node.id && p.property === property);
        const update = (change: Partial<ExportParameter>) => { setParameters(old => old.map(p => p === selected ? {...p,...change} : p)); setResult(null); };
        return <div key={property}><label><input type="checkbox" checked={!!selected} disabled={busy} onChange={e => { setParameters(old => e.target.checked ? [...old,{name:`object${index+1}${property === "scale" ? "Scale" : "Color"}`,nodeId:node.id,property,defaultValue:property === "scale" ? 1 : "#ffffff"}] : old.filter(p => p !== selected)); setResult(null); }} />{property === "scale" ? "Масштаб" : "Цвет"}</label>{selected && <><label>Имя prop<input aria-label={`Имя ${node.name} ${property}`} value={selected.name} disabled={busy} onChange={e => update({name:e.target.value})} /></label>{property === "scale" ? <CommitNumber aria-label={`Масштаб ${node.name}`} value={Number(selected.defaultValue)} disabled={busy} onCommit={value => update({defaultValue:value})} /> : <input aria-label={`Цвет ${node.name}`} type="color" value={String(selected.defaultValue)} disabled={busy} onChange={e => update({defaultValue:e.target.value})} />}</>}</div>;
      })}</div>)}
    </details>
    <button disabled={busy} onClick={() => void prepare()}>Подготовить пакет</button>
    {result && <><ExportPreview prepared={result.prepared} parameters={parameters} /><SingleFile prepared={result.prepared} /><p role="status">Файлов: {result.prepared.files.size}; треугольников без GLB: {result.prepared.triangles}; ZIP: {(result.blob.size/1024/1024).toFixed(2)} MiB.</p>{result.prepared.diagnostics.map((d,i) => <p key={i}>{d}</p>)}<button disabled={result.revision !== state.document.revision} onClick={() => {
      const url = URL.createObjectURL(result.blob); const link = document.createElement("a"); link.href = url; link.download = "triad-model.zip"; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    }}>Скачать ZIP</button></>}
    {result && <GlbExport key={result.revision+profile} store={store} prepared={result.prepared} disabled={busy||result.revision!==state.document.revision} />}
    {error && <p role="alert">{error}</p>}
    {busy ? <button onClick={() => store.jobs.cancelJob()}>Отменить экспорт</button> : <button onClick={onClose}>Закрыть</button>}
  </section></div>;
}


function ExportPreview({prepared,parameters}: {prepared:PreparedExport; parameters:ExportParameter[]}) {
  const [open,setOpen] = useState(false);
  const [urls,setUrls] = useState<Record<string,string> | null>(null);
  const [time,setTime] = useState(0);
  const reference = useMemo<RuntimeBundle>(() => ({...prepared.bundle,profile:"max"}),[prepared]);
  const overrides = useMemo(() => {
    const values: Record<string,{scale?:number; color?:string}> = Object.create(null);
    for (const p of parameters) { const value = values[p.nodeId] ??= {}; if (p.property === "scale") value.scale = Number(p.defaultValue); else value.color = String(p.defaultValue); }
    return values;
  },[parameters]);
  useEffect(() => {
    const next: Record<string,string> = Object.create(null);
    for (const asset of prepared.bundle.project.assets) { const bytes = prepared.files.get(`public/${asset.path}`); if (bytes) next[asset.id] = URL.createObjectURL(new Blob([bytes.slice().buffer],{type:asset.mediaType})); }
    setUrls(next);
    return () => Object.values(next).forEach(url => URL.revokeObjectURL(url));
  },[prepared]);
  return <details onToggle={e => setOpen(e.currentTarget.open)}><summary>Сравнить Max и выбранный профиль</summary><p>Одна подготовленная геометрия, материалы и камера; одинаковое время анимации. Это сравнение профилей экспорта.</p>
    <label>Время<input aria-label="Время сравнения экспорта" type="range" min="0" max={prepared.bundle.project.animations[0]?.durationSeconds ?? 1} step=".01" value={time} onChange={e => setTime(Number(e.target.value))} /></label>
    {open && urls && <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:8}}><div>Max<TriadRuntime data={reference} assetUrls={urls} height={240} playing={false} time={time} nodeOverrides={overrides} /></div><div>{prepared.bundle.profile}<TriadRuntime data={prepared.bundle} assetUrls={urls} height={240} playing={false} time={time} nodeOverrides={overrides} /></div></div>}
  </details>;
}

function SingleFile({prepared}: {prepared:PreparedExport}) {
  const output = useMemo(() => singleFileExport(prepared.bundle),[prepared]);
  const [message,setMessage] = useState("");
  return <details><summary>Один TSX-фрагмент</summary>{output.code ? <><p>Сохраните как TriadModel.tsx. Зависимости: React 19.3.1, Three.js 0.186.1. Статический Max-preview; props width, height, scale, color. Выбранные объектные props входят только в полный ZIP-компонент.</p><textarea aria-label="Копируемый TSX" readOnly value={output.code} style={{width:"100%",height:160}} /><button onClick={() => {void navigator.clipboard.writeText(output.code).then(()=>setMessage("Код скопирован.")).catch(()=>setMessage("Выделите код и скопируйте вручную."));}}>Копировать TSX</button></> : <p>{output.reason}</p>}{message && <p role="status">{message}</p>}</details>;
}

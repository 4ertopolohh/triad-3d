import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import { ThreeRendererAdapter, type BackendMode, type RendererStatus } from "./adapter";
import type { SceneStatus } from "./scene-sync";

export function Viewport({ store, mode }: { store: EditorStore; mode: "model" | "scene" }) {
  const host = useRef<HTMLDivElement>(null);
  const [backendMode, setBackendMode] = useState<BackendMode>("auto");
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<RendererStatus>({ phase: "initializing", backend: "не определён", message: "Инициализация 3D…" });
  const [scene, setScene] = useState<SceneStatus>({ loading: 0, diagnostics: [], errors: 0, empty: true });
  useEffect(() => {
    if (!host.current) return;
    const adapter = new ThreeRendererAdapter(setStatus, setScene);
    let generation = -1;
    const sync = () => {
      const state = store.getSnapshot();
      if (generation === state.derived.generation) return;
      generation = state.derived.generation;
      adapter.sync(state.document.project, store.readAssetBytes, store.getProjectEpoch());
    };
    void adapter.initialize(host.current, backendMode); sync();
    const unsubscribe = store.subscribe(sync);
    return () => { unsubscribe(); void adapter.dispose().catch(() => { /* Detached renderer cannot publish UI errors. */ }); };
  }, [store, backendMode, attempt]);
  return <section className="renderer-viewport" aria-label="3D-предпросмотр модели">
    <div className="renderer-toolbar">
      <label>Графика <select aria-label="Режим графики" value={backendMode} onChange={event => setBackendMode(event.target.value as BackendMode)}>
        <option value="auto">Auto / WebGPU</option><option value="webgl2">WebGL2</option>
      </select></label><span>Backend: {status.backend}</span>
      <button type="button" onClick={() => setAttempt(n => n + 1)}>Повторить запуск</button>
    </div>
    <div className="renderer-host" ref={host} />
    <div className="renderer-status" role={status.phase === "error" || status.phase === "lost" ? "alert" : "status"}>
      <span>{status.message}{scene.loading > 0 ? " · Загрузка GLB…" : scene.errors > 0 ? " · Ошибка геометрии или ресурса" : status.phase === "ready" && scene.empty ? " · Модель пуста — импортируйте GLB" : ""}</span>
      {mode === "scene" && <span>Предпросмотр основной модели, не экземпляр сцены.</span>}
      {scene.diagnostics.map(text => <span key={text}>{text}</span>)}
    </div>
  </section>;
}

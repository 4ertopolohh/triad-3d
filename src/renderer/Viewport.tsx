import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import { useEditorStore } from "../app/use-editor-store";
import { ThreeRendererAdapter, type BackendMode, type RendererStatus } from "./adapter";
import type { SceneStatus } from "./scene-sync";
import { ViewportInteractions, editable } from "./viewport-interactions";

export function Viewport({ store, mode, blocked }: { store: EditorStore; mode: "model" | "scene"; blocked: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const interactions = useRef<ViewportInteractions | null>(null);
  const state = useEditorStore(store);
  const [snap, setSnap] = useState(false);
  const blockedRef = useRef(blocked);
  const snapRef = useRef(snap);
  blockedRef.current = blocked;
  snapRef.current = snap;
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [backendMode, setBackendMode] = useState<BackendMode>("auto");
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<RendererStatus>({ phase: "initializing", backend: "не определён", message: "Инициализация 3D…" });
  const [scene, setScene] = useState<SceneStatus>({ loading: 0, diagnostics: [], errors: 0, empty: true });
  useEffect(() => {
    if (!host.current) return;
    const adapter = new ThreeRendererAdapter(next => {
      setStatus(next);
      if (next.phase === "lost" || next.phase === "error") {
        interactions.current?.dispose(); interactions.current = null;
      }
    }, setScene);
    let generation = -1;
    const sync = () => {
      const state = store.getSnapshot();
      if (generation === state.derived.generation) return;
      generation = state.derived.generation;
      adapter.sync(state.document.project, store.readAssetBytes, store.getProjectEpoch());
    };
    let disposed = false;
    void adapter.initialize(host.current, backendMode).then(() => {
      const canvas = adapter.canvas;
      if (disposed || !canvas) return;
      const controller = new ViewportInteractions(adapter.graph, canvas, store, setInteractionError, blockedRef.current);
      controller.setSnap(snapRef.current);
      interactions.current = controller;
      adapter.setFrameHook(() => controller.frame());
    });
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => { disposed = true; unsubscribe(); interactions.current?.dispose(); interactions.current = null;
      adapter.setFrameHook(undefined); void adapter.dispose().catch(() => { /* Detached renderer cannot publish UI errors. */ }); };
  }, [store, backendMode, attempt]);
  useEffect(() => interactions.current?.setBlocked(blocked), [blocked]);
  useEffect(() => interactions.current?.setSnap(snap), [snap]);
  const canTransform = editable(state, state.selection.activeId, blocked);
  return <section className="renderer-viewport" aria-label="3D-предпросмотр модели">
    <div className="renderer-toolbar">
      <div className="viewport-tools" role="group" aria-label="Инструменты 3D">
        {([ ["select", "Выбор (Esc)"], ["move", "Переместить (G)"], ["rotate", "Вращать (R)"], ["scale", "Масштабировать (S)"] ] as const).map(([tool, label]) =>
          <button key={tool} type="button" title={label} aria-label={label} aria-pressed={state.tool.active === tool}
            disabled={tool !== "select" && !canTransform} onClick={() => store.setTool({ active: tool })}>{label.split(" (")[0]}</button>)}
      </div>
      <div className="viewport-tools" role="group" aria-label="Пространство координат">
        <button type="button" aria-pressed={state.tool.space === "local"} disabled={mode !== "model" || blocked} onClick={() => store.setTool({ space: "local" })}>Локально</button>
        <button type="button" aria-pressed={state.tool.space === "world"} disabled={mode !== "model" || blocked} onClick={() => store.setTool({ space: "world" })}>Мировое</button>
      </div>
      <button type="button" aria-pressed={snap} disabled={mode !== "model" || blocked} title="Перенос: 0,5 · Вращение: 15° · Масштаб: 0,1"
        onClick={() => setSnap(value => !value)}>Привязка {snap ? "вкл" : "выкл"}</button>
      <button type="button" title="Показать выбранный объект или всю модель (F)" onClick={() => interactions.current?.fit()}>Показать объект</button>
      <button type="button" title="Вернуть исходный вид проекта" onClick={() => interactions.current?.reset()}>Сбросить вид</button>
      <label>Графика <select aria-label="Режим графики" value={backendMode} onChange={event => setBackendMode(event.target.value as BackendMode)}>
        <option value="auto">Auto / WebGPU</option><option value="webgl2">WebGL2</option>
      </select></label><span>Backend: {status.backend}</span>
      <button type="button" onClick={() => setAttempt(n => n + 1)}>Повторить запуск</button>
    </div>
    <div className="renderer-host" ref={host} />
    <div className="renderer-status" role={status.phase === "error" || status.phase === "lost" ? "alert" : "status"}>
      <span>{status.message}{scene.loading > 0 ? " · Загрузка GLB…" : scene.errors > 0 ? " · Ошибка геометрии или ресурса" : status.phase === "ready" && scene.empty ? " · Модель пуста — импортируйте GLB" : ""}</span>
      {state.tool.active !== "select" && !canTransform && <span>Нет доступного для трансформации объекта.</span>}
      {interactionError && <span role="alert">{interactionError}</span>}
      {mode === "scene" && <span>Предпросмотр основной модели, не экземпляр сцены.</span>}
      {scene.diagnostics.map(text => <span key={text}>{text}</span>)}
    </div>
  </section>;
}

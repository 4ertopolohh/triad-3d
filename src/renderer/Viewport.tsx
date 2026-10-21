import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import { useEditorStore } from "../app/use-editor-store";
import { ThreeRendererAdapter, type BackendMode, type RendererStatus } from "./adapter";
import type { SceneStatus } from "./scene-sync";
import { ViewportInteractions, editable, brushUnavailable } from "./viewport-interactions";
import { brushParameters, type BrushSymmetry } from "../geometry/displace-brush";
import { ModifierPreview } from "./modifier-preview";

export function Viewport({ store, mode, blocked }: { store: EditorStore; mode: "model" | "scene"; blocked: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const interactions = useRef<ViewportInteractions | null>(null);
  const state = useEditorStore(store);
  const [snap, setSnap] = useState(false);
  const [radiusText, setRadiusText] = useState("0.35");
  const [strengthText, setStrengthText] = useState("0.06");
  const [symmetry, setSymmetry] = useState<BrushSymmetry>("off");
  const brushRadius = Number(radiusText), brushStrength = Number(strengthText);
  const validBrush = radiusText.trim() !== "" && strengthText.trim() !== "" && brushParameters(brushRadius, brushStrength);
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
    const preview = new ModifierPreview(store, adapter.graph);
    let generation = -1;
    const sync = () => {
      const state = store.getSnapshot();
      if (generation === state.derived.generation) return;
      generation = state.derived.generation;
      adapter.sync(state.document.project, store.readAssetBytes, store.getProjectEpoch());
      preview.sync();
    };
    let disposed = false;
    void adapter.initialize(host.current, backendMode).then(() => {
      const canvas = adapter.canvas;
      if (disposed || !canvas) return;
      const controller = new ViewportInteractions(adapter.graph, canvas, store, setInteractionError, blockedRef.current);
      controller.setSnap(snapRef.current);
      interactions.current = controller;
      controller.setBrush(validBrush ? brushRadius : NaN, brushStrength, symmetry);
      adapter.setFrameHook(() => controller.frame());
    });
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => { disposed = true; unsubscribe(); preview.dispose(); interactions.current?.dispose(); interactions.current = null;
      adapter.setFrameHook(undefined); void adapter.dispose().catch(() => { /* Detached renderer cannot publish UI errors. */ }); };
  }, [store, backendMode, attempt]);
  useEffect(() => interactions.current?.setBlocked(blocked), [blocked]);
  useEffect(() => interactions.current?.setSnap(snap), [snap]);
  useEffect(() => { interactions.current?.setBrush(validBrush ? brushRadius : NaN, brushStrength, symmetry); }, [validBrush, brushRadius, brushStrength, symmetry]);
  const canTransform = editable(state, state.selection.activeId, blocked);
  const subMode = state.meshEdit.mode !== "object";
  const activeNode = state.document.project.nodes.find(node => node.id === state.selection.activeId);
  const brushReason = brushUnavailable(state, blocked);
  return <section className="renderer-viewport" aria-label="3D-предпросмотр модели">
    <div className="renderer-toolbar">
      <div className="viewport-tools" role="group" aria-label="Режим выбора">
        <button type="button" aria-pressed={!subMode} onClick={() => store.exitMeshEditMode()}>Объект</button>
        {([ ["vertex", "Вершины"], ["edge", "Рёбра"], ["face", "Грани"] ] as const).map(([editMode, label]) => <button key={editMode} type="button" aria-pressed={state.meshEdit.mode === editMode}
          disabled={mode !== "model" || blocked || state.selection.ids.length !== 1 || activeNode?.kind !== "mesh" || activeNode.meshSource.kind !== "editable"}
          title={activeNode?.kind !== "mesh" || activeNode.meshSource.kind !== "editable" ? "Выберите редактируемую сетку." : blocked ? "Дождитесь завершения операции." : undefined}
          onClick={() => { const message = store.enterMeshEditMode(editMode, state.document.revision, store.getProjectEpoch()); setInteractionError(message); }}>{label}</button>)}
      </div>
      <div className="viewport-tools" role="group" aria-label="Инструменты 3D">
        {([ ["select", "Выбор (Esc)"], ["move", "Переместить (G)"], ["rotate", "Вращать (R)"], ["scale", "Масштабировать (S)"] ] as const).map(([tool, label]) =>
          <button key={tool} type="button" title={label} aria-label={label} aria-pressed={state.tool.active === tool}
            disabled={subMode || tool !== "select" && !canTransform} onClick={() => store.setTool({ active: tool })}>{label.split(" (")[0]}</button>)}
      </div>
      <div className="viewport-tools" role="group" aria-label="Кисть рельефа">
        <button type="button" aria-pressed={state.tool.active === "displace"} disabled={!!brushReason || !validBrush}
          title={brushReason ?? "Смещение вершин вдоль нормалей"} onClick={() => store.setTool({ active: "displace" })}>Кисть: рельеф</button>
        {state.tool.active === "displace" && <span className="brush-settings">
          <label>Радиус <input type="number" min="0.01" max="10" step="0.01" value={radiusText} onChange={event => setRadiusText(event.target.value)} /></label>
          <label>Сила <input type="number" min="-0.5" max="0.5" step="0.01" value={strengthText} onChange={event => setStrengthText(event.target.value)} /></label>
          <label>Симметрия <select value={symmetry} onChange={event => setSymmetry(event.target.value as BrushSymmetry)}
            title="Плоскость проходит через локальное начало координат объекта">
            <option value="off">Выключена</option><option value="x">X · плоскость YZ</option>
            <option value="y">Y · плоскость XZ</option><option value="z">Z · плоскость XY</option>
          </select></label>
          <span title="Плоскость проходит через локальное начало координат объекта">Через локальное начало объекта.</span>
          <span>Положительная сила — выступ, отрицательная — углубление.</span>
          {!validBrush && <span role="alert">Радиус: 0,01–10; сила: −0,5…0,5.</span>}
        </span>}
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
      {state.tool.active === "displace" && brushReason && <span>{brushReason}</span>}
      {!subMode && state.tool.active !== "select" && state.tool.active !== "displace" && !canTransform && <span>Нет доступного для трансформации объекта.</span>}
      {subMode && <span>Выбор элементов: Shift — добавить, Ctrl — переключить, Esc — очистить или выйти.</span>}
      {interactionError && <span role="alert">{interactionError}</span>}
      {mode === "scene" && <span>Предпросмотр основной модели, не экземпляр сцены.</span>}
      {scene.diagnostics.map(text => <span key={text}>{text}</span>)}
    </div>
  </section>;
}

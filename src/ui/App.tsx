import { Viewport } from "../renderer/Viewport";
import { createProject } from "../domain";
import { createEditorStore, selectCanRedo, selectCanUndo, selectDirty, selectProject } from "../app/editor-store";
import { useEditorStore } from "../app/use-editor-store";
import { lazy, Suspense, useCallback } from "react";
import { useEffect, useRef, useState } from "react";
import { AssetBytes } from "../assets/asset-bytes";
import { createNativeProjectArchive, openNativeProjectArchive } from "../assets/native-project-archive";
import { commitGlb, prepareGlb, type PreparedGlb } from "../importers/gltf/import-glb";
import packageInfo from "../../package.json";
import { createPrimitiveNode, primitiveDefinitions, validatePrimitiveSource, type PrimitiveKind, type PrimitiveSource } from "../geometry/primitives";
import type { DeepReadonly } from "../app/editor-store";
import { ObjectTree } from "./ObjectTree";

const RendererSpike = import.meta.env.DEV
  ? lazy(() => import("../spikes/renderer/RendererSpike"))
  : null;
const CsgSpike = import.meta.env.DEV
  ? lazy(() => import("../spikes/csg/CsgSpike"))
  : null;

const editorStore = createEditorStore(createProject());
const DOCK_MIN = 220;
const STAGE_MIN = 320;
const HANDLE_WIDTH = 8;
type Notice = { kind: "info" | "success" | "error"; text: string };

function clampDocks(width: number, left: number, right: number, changed?: "left" | "right"): [number, number] {
  const available = Math.max(DOCK_MIN * 2, width - STAGE_MIN - HANDLE_WIDTH * 2);
  if (changed === "left") {
    const fixedRight = Math.min(Math.max(right, DOCK_MIN), available - DOCK_MIN);
    return [Math.min(Math.max(left, DOCK_MIN), available - fixedRight), fixedRight];
  }
  const fixedLeft = Math.min(Math.max(left, DOCK_MIN), available - DOCK_MIN);
  return [fixedLeft, Math.min(Math.max(right, DOCK_MIN), available - fixedLeft)];
}

export function App() {
  if (CsgSpike && new URLSearchParams(window.location.search).get("spike") === "csg") {
    return <Suspense fallback={<p>Загрузка CSG…</p>}><CsgSpike /></Suspense>;
  }
  if (RendererSpike && new URLSearchParams(window.location.search).get("spike") === "renderer") {
    return <Suspense fallback={<p>Загрузка прототипа рендеринга…</p>}><RendererSpike /></Suspense>;
  }
  return <EditorShell />;
}

function EditorShell() {
  const state = useEditorStore(editorStore);
  const fileInput = useRef<HTMLInputElement>(null);
  const glbInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const fileLock = useRef(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileStatus, setFileStatus] = useState<Notice | null>(null);
  const [pendingGlb, setPendingGlb] = useState<{ prepared: PreparedGlb; revision: number; identity: object } | null>(null);
  const [dockWidths, setDockWidths] = useState<[number, number]>([280, 280]);
  const [dragging, setDragging] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  const project = selectProject(state);
  const dirty = selectDirty(state);
  const canUndo = selectCanUndo(state);
  const canRedo = selectCanRedo(state);
  const blocked = fileBusy || !!pendingGlb || state.job.status === "validating" || state.job.status === "running" || state.job.status === "applying";
  const notice = (kind: Notice["kind"], text: string) => setFileStatus({ kind, text });
  const stopDrag = useCallback(() => { dragCleanup.current?.(); dragCleanup.current = null; setDragging(false); }, []);
  useEffect(() => () => { dragCleanup.current?.(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorStore.getSnapshot().document.dirty) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setDockWidths(([left, right]) => clampDocks(element.clientWidth, left, right)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function setDock(side: "left" | "right", value: number) {
    const width = workspace.current?.clientWidth ?? window.innerWidth;
    setDockWidths(([left, right]) => clampDocks(width, side === "left" ? value : left, side === "right" ? value : right, side));
  }
  function startDrag(event: React.PointerEvent<HTMLDivElement>, side: "left" | "right") {
    if (event.button !== 0 || dragCleanup.current) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = dockWidths[side === "left" ? 0 : 1];
    const oldUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    const move = (next: PointerEvent) => setDock(side, startWidth + (next.clientX - startX) * (side === "left" ? 1 : -1));
    const cleanup = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stopDrag);
      handle.removeEventListener("pointercancel", stopDrag);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      document.body.style.userSelect = oldUserSelect;
    };
    dragCleanup.current = cleanup;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
  }
  function travel(direction: "undo" | "redo") {
    if (blocked) return;
    const current = editorStore.getSnapshot();
    const result = editorStore[direction](current.document.revision);
    if (!result.ok) notice("error", result.message);
    else notice("success", direction === "undo" ? "Изменение отменено." : "Изменение повторено.");
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (target instanceof Element && (target.closest("input, textarea, [contenteditable]") || (target as HTMLElement).isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === "s" && !event.shiftKey) { event.preventDefault(); void saveProject(); return; }
      if (blocked) return;
      const direction = key === "y" && !event.shiftKey || key === "z" && event.shiftKey ? "redo" : key === "z" && !event.shiftKey ? "undo" : null;
      if (!direction) return;
      const current = editorStore.getSnapshot();
      if (direction === "undo" ? !current.history.canUndo : !current.history.canRedo) return;
      event.preventDefault();
      travel(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  useEffect(() => {
    if (!pendingGlb) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        setPendingGlb(null);
        notice("info", "Импорт отменён.");
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [pendingGlb]);
  function newProject() {
    if (blocked || fileLock.current) return;
    const current = editorStore.captureDocument();
    if (editorStore.getSnapshot().document.dirty && !window.confirm("В проекте есть несохранённые изменения. Создать новый проект и потерять их?")) return;
    if (!editorStore.replaceProject({ project: createProject(), assets: new AssetBytes() }, current.identity)) {
      notice("error", "Проект изменился. Повторите создание нового проекта.");
      return;
    }
    setPendingGlb(null);
    notice("success", "Новый проект создан.");
  }
  async function saveProject() {
    if (blocked || fileLock.current) return;
    fileLock.current = true;
    setFileBusy(true);
    notice("info", "Подготовка архива…");
    const captured = editorStore.captureDocument();
    const filename = `${captured.project.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80) || "project"}.triad3d`;
    const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
    try {
      // The picker needs the original click activation; acquire the handle before asynchronous hashing.
      const handle = picker ? await picker({ suggestedName: filename, types: [{ description: "Проект TRIAD-3D", accept: { "application/x-triad3d": [".triad3d"] } }] }) : null;
      const result = await createNativeProjectArchive(captured.project, captured.assets, packageInfo.version);
      if (!result.ok) { notice("error", result.error.message); return; }
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(result.value);
        await writable.close();
        notice("success", editorStore.confirmSaved(captured.revision, captured.identity) ? "Проект сохранён." : "Файл записан; после подготовки проекта были новые изменения.");
      } else {
        const url = URL.createObjectURL(result.value);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        notice("info", "Загрузка файла запущена. Проверьте его сохранение в браузере.");
      }
    } catch (error) {
      notice(error instanceof DOMException && error.name === "AbortError" ? "info" : "error", error instanceof DOMException && error.name === "AbortError" ? "Сохранение отменено." : "Не удалось сохранить проект.");
    } finally { fileLock.current = false; setFileBusy(false); }
  }

  async function openProject(file: File) {
    if (blocked || fileLock.current) return;
    if (editorStore.getSnapshot().document.dirty && !window.confirm("В проекте есть несохранённые изменения. Открыть другой проект и потерять их?")) return;
    const expected = editorStore.captureDocument().identity;
    fileLock.current = true;
    setFileBusy(true);
    notice("info", "Проверка архива…");
    try {
      const result = await openNativeProjectArchive(file);
      if (!result.ok) { notice("error", result.error.message); return; }
      if (!editorStore.replaceProject(result.value, expected)) { notice("error", "Проект изменился во время открытия файла. Повторите операцию."); return; }
      notice("success", "Проект открыт.");
    } catch { notice("error", "Не удалось открыть проект."); }
    finally { fileLock.current = false; setFileBusy(false); }
  }
  async function importGlb(file: File) {
    if (blocked || fileLock.current) return;
    const captured = editorStore.captureDocument();
    setPendingGlb(null);
    fileLock.current = true;
    setFileBusy(true);
    notice("info", "Проверка GLB…");
    try {
      const result = await prepareGlb(file);
      if (!result.ok) { notice("error", result.error.message); return; }
      setPendingGlb({ prepared: result.value, revision: captured.revision, identity: captured.identity });
      notice("info", "GLB проверен. Подтвердите добавление в текущую модель.");
    } catch { notice("error", "Не удалось проверить GLB."); }
    finally { fileLock.current = false; setFileBusy(false); }
  }
  function confirmGlb() {
    if (!pendingGlb) return;
    const result = commitGlb(editorStore, pendingGlb.prepared, pendingGlb.revision, pendingGlb.identity);
    setPendingGlb(null);
    notice(result.ok ? "success" : "error", result.ok ? "GLB добавлен в модель. Сохраните проект, чтобы записать ресурс в .triad3d." : result.message);
  }
  const root = project.nodes.find(node => node.id === project.model.rootNodeId);
  const canEditModel = !blocked && state.tool.mode === "model" && !!root?.visible && !root?.locked;
  const selected = project.nodes.find(node => node.id === state.selection.activeId);
  let selectedUnavailable = "";
  if (selected) {
    let ancestor: typeof selected | undefined = selected;
    while (ancestor) {
      if (ancestor.locked) { selectedUnavailable = "Объект или его родитель заблокирован."; break; }
      if (!ancestor.visible) { selectedUnavailable = "Объект или его родитель скрыт."; break; }
      ancestor = ancestor.parentId ? project.nodes.find(node => node.id === ancestor?.parentId) : undefined;
    }
  }
  function addPrimitive(kind: PrimitiveKind) {
    if (!canEditModel) return;
    const node = createPrimitiveNode(kind, project.model.rootNodeId, crypto.randomUUID());
    const result = editorStore.executeCommand({ commandId: crypto.randomUUID(), type: "ADD_NODE", targetIds: [project.model.rootNodeId, node.id], payload: { parentId: project.model.rootNodeId, node } }, state.document.revision);
    if (!result.ok) notice("error", result.message);
    else { editorStore.setSelection([node.id], node.id); notice("success", `${node.name} добавлен в модель.`); }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">◇</span><strong>TRIAD-3D</strong><span className="project-title" title={project.name}>{project.name}</span><span className={`dirty-indicator ${dirty ? "is-dirty" : ""}`} title={dirty ? "Есть несохранённые изменения" : "Нет несохранённых изменений"}>{dirty ? "● Не сохранено" : "Сохранено"}</span></div>
        <div className="mode-switch" role="group" aria-label="Режим редактора">
          <button type="button" aria-pressed={state.tool.mode === "model"} onClick={() => editorStore.setTool({ mode: "model" })}>Модель</button>
          <button type="button" aria-pressed={state.tool.mode === "scene"} onClick={() => editorStore.setTool({ mode: "scene" })}>Сцена</button>
        </div>
        <div className="file-actions">
          <button type="button" disabled={blocked} onClick={newProject}>Новый проект</button>
          <button type="button" disabled={!canUndo || blocked} onClick={() => travel("undo")}>Отменить</button>
          <button type="button" disabled={!canRedo || blocked} onClick={() => travel("redo")}>Повторить</button>
          <button type="button" disabled={blocked} onClick={saveProject}>Сохранить проект</button>
          <button type="button" disabled={blocked} onClick={() => fileInput.current?.click()}>Открыть проект</button>
          <button type="button" disabled={blocked} onClick={() => glbInput.current?.click()}>Импорт GLB</button>
          <button type="button" disabled title="Экспорт TSX/ZIP появится на отдельном этапе">Экспорт</button>
          <input ref={fileInput} className="file-input" type="file" accept=".triad3d" aria-label="Выбрать файл проекта TRIAD-3D" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openProject(file); }} />
          <input ref={glbInput} className="file-input" type="file" accept=".glb,model/gltf-binary" aria-label="Выбрать файл GLB" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importGlb(file); }} />
        </div>
      </header>
      {fileStatus && <div className={`file-status status-${fileStatus.kind}`} role={fileStatus.kind === "error" ? "alert" : "status"} aria-live={fileStatus.kind === "error" ? "assertive" : "polite"}><span>{fileStatus.text}</span><button type="button" aria-label="Закрыть сообщение" onClick={() => setFileStatus(null)}>×</button></div>}
      {pendingGlb && <div className="import-confirm" role="group" aria-label="Подтверждение импорта GLB">
        <span>«{pendingGlb.prepared.name}»: {pendingGlb.prepared.triangles} треугольников. Внутренние PBR-материалы сохраняются в GLB, но пока не редактируются отдельно. Анимации и сложные сцены не поддерживаются.</span>
        <button type="button" onClick={confirmGlb}>Добавить в модель</button>
        <button type="button" onClick={() => { setPendingGlb(null); notice("info", "Импорт отменён."); }}>Отмена</button>
      </div>}
      <div className={`workspace-grid ${dragging ? "is-resizing" : ""}`} ref={workspace} style={{ gridTemplateColumns: `${dockWidths[0]}px ${HANDLE_WIDTH}px minmax(0, 1fr) ${HANDLE_WIDTH}px ${dockWidths[1]}px` }}>
        <aside className="dock left-dock" aria-label="Структура проекта">
          <div className="panel-heading"><h2>{state.view.leftTab === "structure" ? "Структура" : "Библиотека"}</h2></div>
          <div className="dock-tabs" role="group" aria-label="Левая панель"><button type="button" aria-pressed={state.view.leftTab === "structure"} onClick={() => editorStore.setView({ leftTab: "structure" })}>Структура</button><button type="button" aria-pressed={state.view.leftTab === "assets"} onClick={() => editorStore.setView({ leftTab: "assets" })}>Библиотека</button></div>
          {state.view.leftTab === "structure" ?
          <div className="panel-content">
            <ObjectTree store={editorStore} project={project} selection={state.selection} blocked={blocked} mode={state.tool.mode} notice={notice} />
          </div> : <div className="panel-content"><p className="eyebrow">Геометрические примитивы</p><div className="primitive-library">{(Object.keys(primitiveDefinitions) as PrimitiveKind[]).map(kind => <button type="button" key={kind} disabled={!canEditModel} title={!canEditModel ? blocked ? "Дождитесь завершения операции." : state.tool.mode === "scene" ? "Переключитесь в режим «Модель»." : "Корень модели скрыт или заблокирован." : `Добавить: ${primitiveDefinitions[kind].label}`} onClick={() => addPrimitive(kind)}>{primitiveDefinitions[kind].label}</button>)}</div><p className="panel-hint">Выберите фигуру, чтобы добавить её в модель. Импортированный GLB сохраняется в проекте.</p></div>}
        </aside>
        <div className="dock-resizer" role="separator" tabIndex={0} aria-label="Изменить ширину левой панели" aria-orientation="vertical" aria-valuemin={DOCK_MIN} aria-valuenow={dockWidths[0]} aria-valuemax={Math.max(DOCK_MIN, (workspace.current?.clientWidth ?? 960) - STAGE_MIN - HANDLE_WIDTH * 2 - dockWidths[1])} onPointerDown={(event) => startDrag(event, "left")} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setDock("left", dockWidths[0] + (event.key === "ArrowRight" ? 16 : -16)); } }} />
        <main className="stage" aria-label="Рабочая область">
          <div className="stage-topline"><span>РАБОЧАЯ ОБЛАСТЬ · {state.tool.mode === "model" ? "МОДЕЛЬ" : "СЦЕНА"}</span><span>Проект только в памяти вкладки</span></div>
          <Viewport store={editorStore} mode={state.tool.mode} blocked={blocked} />
        </main>
        <div className="dock-resizer" role="separator" tabIndex={0} aria-label="Изменить ширину правой панели" aria-orientation="vertical" aria-valuemin={DOCK_MIN} aria-valuenow={dockWidths[1]} aria-valuemax={Math.max(DOCK_MIN, (workspace.current?.clientWidth ?? 960) - STAGE_MIN - HANDLE_WIDTH * 2 - dockWidths[0])} onPointerDown={(event) => startDrag(event, "right")} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setDock("right", dockWidths[1] + (event.key === "ArrowLeft" ? 16 : -16)); } }} />
        <aside className="dock right-dock" aria-label="Инспектор">
          <div className="panel-heading"><h2>Инспектор</h2><span>—</span></div>
          <div className="panel-content"><p className="eyebrow">{state.tool.mode === "scene" ? "Окружение" : "Свойства"}</p>{selected?.kind === "mesh" && selected.meshSource.kind === "primitive" ? <PrimitiveEditor key={`${selected.id}:${JSON.stringify(selected.meshSource)}`} source={selected.meshSource} disabled={!canEditModel || !!selectedUnavailable} reason={blocked ? "Дождитесь завершения операции." : state.tool.mode === "scene" ? "Переключитесь в режим «Модель»." : selectedUnavailable} onApply={source => { const result = editorStore.executeCommand({ commandId: crypto.randomUUID(), type: "SET_PRIMITIVE_PARAMETERS", targetIds: [selected.id], payload: { nodeId: selected.id, source } }, editorStore.getSnapshot().document.revision); if (!result.ok) notice("error", result.message); else if (result.changed) notice("success", "Параметры обновлены."); }} /> : <p className="panel-hint">{state.selection.activeId ? "Параметры выбранного объекта пока недоступны." : "Выберите примитив в структуре или viewport."}</p>}<div className="info-block"><span>Схема документа</span><strong>{project.schemaVersion}</strong></div><div className="info-block"><span>Узлов модели</span><strong>{project.nodes.length}</strong></div></div>
        </aside>
      </div>
      <section className={`timeline ${state.view.timelineExpanded ? "" : "is-collapsed"}`} aria-label="Область анимации"><div className="panel-heading"><h2>Таймлайн</h2><button type="button" aria-expanded={state.view.timelineExpanded} aria-controls="timeline-body" onClick={() => editorStore.setView({ timelineExpanded: !state.view.timelineExpanded })}>{state.view.timelineExpanded ? "Свернуть таймлайн" : "Развернуть таймлайн"}</button></div><div id="timeline-body" className="timeline-body" hidden={!state.view.timelineExpanded}>Дорожки анимации пока недоступны</div></section>
      <div className="narrow-screen" role="note"><strong>TRIAD-3D предназначен для настольного браузера</strong><p>Увеличьте ширину окна или откройте редактор на ПК. Текущий проект остаётся в памяти этой вкладки.</p></div>
    </div>
  );
}

function PrimitiveEditor({ source, disabled, reason, onApply }: { source: DeepReadonly<PrimitiveSource>; disabled: boolean; reason: string; onApply: (source: PrimitiveSource) => void }) {
  const specs = primitiveDefinitions[source.primitive].parameters;
  const keys = source.primitive === "cube" && Object.keys(source.parameters).length === 1 && Object.hasOwn(source.parameters, "size")
    ? ["size"] : Object.keys(specs).filter(key => key !== "size");
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(key => [key, String(source.parameters[key] ?? specs[key]!.defaultValue)])));
  const [error, setError] = useState("");
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parameters: Record<string, number> = { ...source.parameters };
    for (const key of keys) {
      if (!draft[key]?.trim()) { setError(`Введите значение «${specs[key]!.label}».`); return; }
      parameters[key] = Number(draft[key]);
    }
    const next: PrimitiveSource = { kind: "primitive", primitive: source.primitive, parameters };
    const issue = validatePrimitiveSource(next);
    if (issue) { setError(issue); return; }
    setError("");
    onApply(next);
  }
  return <form className="primitive-editor" onSubmit={submit}>
    <h3>{primitiveDefinitions[source.primitive].label}</h3>
    {keys.map(key => <label key={key}>{specs[key]!.label}<input type="number" step={specs[key]!.integer ? 1 : "any"} min={specs[key]!.min === Number.MIN_VALUE ? "0" : specs[key]!.min} max={specs[key]!.max} value={draft[key] ?? ""} disabled={disabled} onChange={event => { setDraft(previous => ({ ...previous, [key]: event.target.value })); setError(""); }} /></label>)}
    <button type="submit" disabled={disabled}>Применить параметры</button>
    {reason && <p className="panel-hint">{reason}</p>}
    {error && <p className="primitive-error" role="alert">{error}</p>}
  </form>;
}

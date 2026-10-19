import { createProject } from "../domain";
import { createEditorStore, selectDirty, selectProject, selectRevision } from "../app/editor-store";
import { useEditorStore } from "../app/use-editor-store";
import { lazy, Suspense } from "react";
import { useRef, useState } from "react";
import { createNativeProjectArchive, openNativeProjectArchive } from "../assets/native-project-archive";
import packageInfo from "../../package.json";

const RendererSpike = import.meta.env.DEV
  ? lazy(() => import("../spikes/renderer/RendererSpike"))
  : null;
const CsgSpike = import.meta.env.DEV
  ? lazy(() => import("../spikes/csg/CsgSpike"))
  : null;

const editorStore = createEditorStore(createProject());

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
  const [fileBusy, setFileBusy] = useState(false);
  const [fileStatus, setFileStatus] = useState("");
  const project = selectProject(state);
  const revision = selectRevision(state);
  const dirty = selectDirty(state);
  async function saveProject() {
    if (fileBusy) return;
    setFileBusy(true);
    setFileStatus("Подготовка архива…");
    const captured = editorStore.captureDocument();
    const filename = `${captured.project.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80) || "project"}.triad3d`;
    const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
    try {
      // The picker needs the original click activation; acquire the handle before asynchronous hashing.
      const handle = picker ? await picker({ suggestedName: filename, types: [{ description: "Проект TRIAD-3D", accept: { "application/x-triad3d": [".triad3d"] } }] }) : null;
      const result = await createNativeProjectArchive(captured.project, captured.assets, packageInfo.version);
      if (!result.ok) { setFileStatus(result.error.message); return; }
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(result.value);
        await writable.close();
        setFileStatus(editorStore.confirmSaved(captured.revision, captured.identity) ? "Проект сохранён." : "Файл записан; после подготовки проекта были новые изменения.");
      } else {
        const url = URL.createObjectURL(result.value);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setFileStatus("Загрузка файла запущена. Проверьте его сохранение в браузере.");
      }
    } catch (error) {
      setFileStatus(error instanceof DOMException && error.name === "AbortError" ? "Сохранение отменено." : "Не удалось сохранить проект.");
    } finally { setFileBusy(false); }
  }

  async function openProject(file: File) {
    if (fileBusy) return;
    if (editorStore.getSnapshot().document.dirty && !window.confirm("В проекте есть несохранённые изменения. Открыть другой проект и потерять их?")) return;
    const expected = editorStore.captureDocument().identity;
    setFileBusy(true);
    setFileStatus("Проверка архива…");
    try {
      const result = await openNativeProjectArchive(file);
      if (!result.ok) { setFileStatus(result.error.message); return; }
      if (!editorStore.replaceProject(result.value, expected)) { setFileStatus("Проект изменился во время открытия файла. Повторите операцию."); return; }
      setFileStatus("Проект открыт.");
    } catch { setFileStatus("Не удалось открыть проект."); }
    finally { setFileBusy(false); }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">◇</span><strong>TRIAD-3D</strong><span className="brand-subtitle">Основа редактора</span></div>
        <div className="file-actions">
          <span className="topbar-note">Проект находится только в памяти текущей вкладки</span>
          <button type="button" disabled={fileBusy} onClick={saveProject}>Сохранить проект</button>
          <button type="button" disabled={fileBusy} onClick={() => fileInput.current?.click()}>Открыть проект</button>
          <input ref={fileInput} className="file-input" type="file" accept=".triad3d" aria-label="Выбрать файл проекта TRIAD-3D" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openProject(file); }} />
        </div>
      </header>
      {fileStatus && <div className="file-status" role="status" aria-live="polite">{fileStatus}</div>}
      <div className="workspace-grid">
        <aside className="dock left-dock" aria-label="Структура проекта">
          <div className="panel-heading"><h2>Структура</h2><span>01</span></div>
          <div className="panel-content">
            <p className="eyebrow">Текущий проект</p>
            <div className="project-name">{project.name}</div>
            <div className="tree-row"><span aria-hidden="true">▦</span> Модель <small>корень</small></div>
            <div className="tree-row"><span aria-hidden="true">◫</span> Сцена</div>
            <p className="panel-hint">Дерево объектов и инструменты редактирования появятся в следующих задачах.</p>
          </div>
        </aside>
        <main className="stage" aria-label="Рабочая область">
          <div className="stage-topline"><span>РАБОЧАЯ ОБЛАСТЬ</span><span>Основа · TASK-008</span></div>
          <div className="stage-center"><div className="stage-symbol" aria-hidden="true">◇</div><h1>Пространство для вашей модели</h1><p>Основа приложения готова. Просмотр и редактирование 3D будут добавлены в следующих этапах.</p><span className="status-pill">{dirty ? "Есть несохранённые изменения" : `Проект в памяти · ревизия ${revision}`}</span></div>
          <div className="stage-footer">3D-просмотр пока недоступен</div>
        </main>
        <aside className="dock right-dock" aria-label="Инспектор">
          <div className="panel-heading"><h2>Инспектор</h2><span>—</span></div>
          <div className="panel-content"><p className="eyebrow">Свойства</p><p className="panel-hint">Выберите объект после появления инструментов моделирования.</p><div className="info-block"><span>Схема документа</span><strong>{project.schemaVersion}</strong></div><div className="info-block"><span>Узлов модели</span><strong>{project.nodes.length}</strong></div></div>
        </aside>
      </div>
      <section className="timeline" aria-label="Область анимации"><div className="panel-heading"><h2>Таймлайн</h2><span>Подготовлено для TASK-039</span></div><div className="timeline-body">Дорожки анимации пока недоступны</div></section>
    </div>
  );
}

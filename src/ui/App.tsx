import { createProject, validateProject } from "../domain";
import { lazy, Suspense } from "react";

const RendererSpike = import.meta.env.DEV
  ? lazy(() => import("../spikes/renderer/RendererSpike"))
  : null;
const CsgSpike = import.meta.env.DEV
  ? lazy(() => import("../spikes/csg/CsgSpike"))
  : null;

const project = createProject();
const issues = validateProject(project);

export function App() {
  if (CsgSpike && new URLSearchParams(window.location.search).get("spike") === "csg") {
    return <Suspense fallback={<p>Загрузка CSG…</p>}><CsgSpike /></Suspense>;
  }
  if (RendererSpike && new URLSearchParams(window.location.search).get("spike") === "renderer") {
    return <Suspense fallback={<p>Загрузка прототипа рендеринга…</p>}><RendererSpike /></Suspense>;
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">◇</span><strong>TRIAD-3D</strong><span className="brand-subtitle">Основа редактора</span></div>
        <span className="topbar-note">Проект находится только в памяти текущей вкладки</span>
      </header>
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
          <div className="stage-topline"><span>РАБОЧАЯ ОБЛАСТЬ</span><span>Основа · TASK-006</span></div>
          <div className="stage-center"><div className="stage-symbol" aria-hidden="true">◇</div><h1>Пространство для вашей модели</h1><p>Основа приложения готова. Просмотр и редактирование 3D будут добавлены в следующих этапах.</p><span className="status-pill">{issues.length === 0 ? "Структура проекта проверена" : "Ошибка структуры проекта"}</span></div>
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

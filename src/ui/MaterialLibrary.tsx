import { useEffect, useState } from "react";
import type { EditorStore, EditorState } from "../app/editor-store";
import { applyMaterialPreset, materialTargetReason } from "../app/material-actions";
import { beginMaterialDrag, endMaterialDrag, MATERIAL_PRESET_MIME } from "../app/material-drag";
import { categories, filterPresets, matchesPreset, type MaterialCategory } from "../materials/presets";
import { getMaterialPreviews, type PreviewResult } from "../renderer/material-preview";

export function MaterialLibrary({ store, state, blocked, notice }: { store: EditorStore; state: EditorState; blocked: boolean; notice: (kind: "info" | "success" | "error", text: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MaterialCategory | "all">("all");
  const [previews, setPreviews] = useState<PreviewResult | null>(null);
  useEffect(() => { let active = true; void getMaterialPreviews().then(result => { if (active) setPreviews(result); }); return () => { active = false; }; }, []);
  useEffect(() => () => endMaterialDrag(), []);
  const reason = blocked ? "Дождитесь завершения текущей операции." : materialTargetReason(store);
  const projectEpoch = store.getProjectEpoch();
  const selected = state.document.project.nodes.find(node => node.id === state.selection.activeId);
  const currentId = selected?.materialSlots[0]?.materialId;
  const current = currentId && state.document.project.materials.find(item => item.id === currentId);
  const results = filterPresets(query, category);
  return <div className="material-library">
    <label className="material-search">Поиск материала<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название или свойство" /></label>
    <label className="material-category">Категория<select value={category} onChange={event => setCategory(event.target.value as MaterialCategory | "all")}><option value="all">Все</option>{categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    {(query || category !== "all") && <button type="button" className="material-reset" onClick={() => { setQuery(""); setCategory("all"); }}>Сбросить фильтр</button>}
    <p className="panel-hint" role="status">{reason ?? "Перетащите пресет на Mesh или назначьте его выделенному объекту кнопкой."}</p>
    {previews?.warning && <p className="material-warning" role="status">{previews.warning}</p>}
    {!results.length && <p role="status">Материалы не найдены.</p>}
    <div className="material-cards">{results.map(preset => {
      const applied = !!current && matchesPreset(current, preset);
      const image = previews?.images.get(preset.id);
      return <div className={`material-card ${applied ? "is-applied" : ""}`} key={preset.id}
        draggable={!blocked && state.tool.mode === "model"} title="Перетащите на Mesh в 3D-виде"
        onDragStart={event => {
          if (!beginMaterialDrag(store, preset.id)) { event.preventDefault(); notice("error", "Материал сейчас нельзя перетащить."); return; }
          event.dataTransfer.setData(MATERIAL_PRESET_MIME, preset.id);
          event.dataTransfer.effectAllowed = "copy";
          event.currentTarget.classList.add("is-dragging");
        }} onDragEnd={event => { event.currentTarget.classList.remove("is-dragging"); endMaterialDrag(); }}>
        <div className="material-preview">{image ? <img src={image} alt={`3D-превью: ${preset.name}`} /> : <span>{previews ? "3D-превью недоступно" : "Загрузка 3D-превью…"}</span>}</div>
        <div className="material-card-body"><strong>{preset.name}</strong>{applied && <span className="material-applied">Назначен</span>}<p>{preset.description}</p>
          <details><summary>О материале</summary><p>Металличность: {preset.material.metalness}; шероховатость: {preset.material.roughness}; прозрачность: {preset.material.transmission}; IOR: {preset.material.ior}.</p></details>
          <button type="button" disabled={!!reason || applied} title={reason ?? (applied ? "Уже назначен" : "")} aria-label={`Назначить материал ${preset.name}`} onClick={() => {
            const result = applyMaterialPreset(store, preset, state.document.revision, state.selection.activeId ?? "", projectEpoch);
            notice(result.ok ? "success" : "error", result.message);
          }}>{applied ? "Назначен" : "Назначить"}</button>
        </div>
      </div>;
    })}</div>
  </div>;
}

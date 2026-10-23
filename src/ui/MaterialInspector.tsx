import { useEffect, useRef, useState } from "react";
import type { EditorState, EditorStore } from "../app/editor-store";
import { captureMaterialEdit, editMaterial, editBaseColorTexture, editBaseColorProjection, editProceduralRoughness, materialUsage, type MaterialEditContext, type MaterialEditMode, type MaterialField } from "../app/material-edit";
import type { BaseColorProjection, ProceduralRoughnessConfig } from "../domain/types";
import { materialNodeReason } from "../app/material-actions";
import { isJobActive } from "../app/job-controller";
import { materialPresets } from "../materials/presets";
import { linearToHex, parseHexColor } from "../materials/color";

const format = (value: number) => String(Number(value.toPrecision(12)));
const scalarFields = [
  { key: "metalness", label: "Металличность", min: 0, max: 1, step: .001 },
  { key: "roughness", label: "Шероховатость", min: 0, max: 1, step: .001 },
  { key: "opacity", label: "Непрозрачность", min: 0, max: 1, step: .001 },
  { key: "transmission", label: "Пропускание света", min: 0, max: 1, step: .001 },
  { key: "ior", label: "Преломление (IOR)", min: 1, max: 2.333, step: .001 },
  { key: "clearcoat", label: "Лаковое покрытие", min: 0, max: 1, step: .001 },
  { key: "envIntensity", label: "Интенсивность окружения", min: 0, max: 5, step: .01 },
] as const;

export function MaterialInspector({ store, state }: { store: EditorStore; state: EditorState }) {
  const [mode, setMode] = useState<MaterialEditMode>("unique");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const session = useRef<{ context: MaterialEditContext; groupId: string; changed: boolean; field: string } | null>(null);
  const skipBlur = useRef(false);
  const proceduralContext = useRef<MaterialEditContext | null>(null);
  const epoch = store.getProjectEpoch();
  const selection = state.selection.ids.join("\0");
  useEffect(() => { setMode("unique"); setEditing(null); setError(""); session.current = null; }, [epoch, selection, state.tool.mode]);

  const node = state.selection.ids.length === 1 ? state.document.project.nodes.find(item => item.id === state.selection.activeId) : null;
  const slot = node?.kind === "mesh" && node.materialSlots.length === 1 ? node.materialSlots[0] : null;
  const material = state.document.project.materials.find(item => item.id === slot?.materialId);
  const users = material ? materialUsage(store, material.id) : [];
  const sharedBlock = mode === "shared" ? users.map(user => materialNodeReason(store, user.nodeId)).find(Boolean) : null;
  const reason = !node ? state.selection.ids.length > 1 ? "Несколько объектов: массовое редактирование материалов пока недоступно." : "Выберите Mesh с материалом."
    : node.kind !== "mesh" ? "У группы нет редактируемого материала."
    : node.meshSource.kind === "asset" ? "Внутренние материалы GLB доступны только для просмотра до поддержки отдельных слотов."
    : !slot ? "Назначьте материал из библиотеки слева."
    : !material ? "Назначенный материал не найден."
    : isJobActive(state.job.status) ? "Дождитесь завершения операции."
    : state.tool.mode !== "model" ? "В режиме «Сцена» свойства модели доступны только для просмотра."
    : materialNodeReason(store, node.id) || sharedBlock || "";
  const preset = materialPresets.find(item => item.name === material?.name);
  const canEdit = !!material && !reason;
  const rasterAssets = state.document.project.assets.filter(asset => ["image/png", "image/jpeg", "image/webp"].includes(asset.mediaType));
  const selectedTexture = material?.textureSlots?.baseColor;
  const selectedAsset = state.document.project.assets.find(asset => asset.id === selectedTexture);
  const missingUv = node?.kind === "mesh" && node.meshSource.kind === "editable" && !node.meshSource.uv;
  const projection: BaseColorProjection = material?.textureMappings?.baseColor ?? { mode: "uv" };
  const procedural = material?.proceduralMaps?.roughness;
  function setProcedural(config?: ProceduralRoughnessConfig, captured?: MaterialEditContext | null) {
    if (!canEdit) return;
    const context = captured === undefined ? captureMaterialEdit(store, mode) : captured;
    if (!context) { setError("Выбор изменился. Повторите действие."); return; }
    const result = editProceduralRoughness(store, context, config);
    setError(result.ok ? "" : result.message);
  }
  function proceduralNumber(field: "seed" | "scale" | "intensity" | "directionRadians", label: string) {
    if (!procedural) return null;
    const value = field === "directionRadians" ? procedural.kind === "scratches" ? procedural.directionRadians : 0 : procedural[field];
    const key = `procedural-${field}`;
    return <label key={key}>{label}<input type="text" inputMode="decimal" aria-label={label} value={editing === key ? draft : format(value)} disabled={!canEdit}
      onFocus={() => { proceduralContext.current = captureMaterialEdit(store, mode); setEditing(key); setDraft(format(value)); setError(""); }}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => { if (shouldSkipBlur() || editing !== key) return; const raw = draft.trim(); const number = Number(raw); if (raw && Number.isFinite(number)) {
        if (field === "directionRadians" && procedural.kind === "scratches") setProcedural({ ...procedural, directionRadians: number }, proceduralContext.current);
        else if (field !== "directionRadians") setProcedural({ ...procedural, [field]: number }, proceduralContext.current);
      } else setError("Введите конечное число."); proceduralContext.current = null; setEditing(null); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") (event.target as HTMLInputElement).blur(); if (event.key === "Escape") { event.preventDefault(); escapeInput(event.target as HTMLInputElement); } }} /></label>;
  }
  function setProjection(value: BaseColorProjection) {
    if (!canEdit) return;
    const context = captureMaterialEdit(store, mode);
    if (!context) { setError("Выбор изменился. Повторите действие."); return; }
    const result = editBaseColorProjection(store, context, value);
    setError(result.ok ? "" : result.message);
  }
  function projectionNumber(label: string, value: number, change: (number: number) => BaseColorProjection) {
    return <label key={label}>{label}<input type="text" inputMode="decimal" aria-label={label} value={editing === label ? draft : format(value)} disabled={!canEdit} onFocus={() => { setEditing(label); setDraft(format(value)); setError(""); }} onChange={event => setDraft(event.target.value)} onBlur={() => { if (shouldSkipBlur() || editing !== label) return; const raw = draft.trim(); const number = Number(raw); if (raw && Number.isFinite(number)) setProjection(change(number)); else setError("Введите конечное число."); setEditing(null); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") (event.target as HTMLInputElement).blur(); if (event.key === "Escape") { event.preventDefault(); escapeInput(event.target as HTMLInputElement); } }} /></label>;
  }
  function setTexture(assetId?: string) {
    if (!canEdit) return;
    const context = captureMaterialEdit(store, mode);
    if (!context) { setError("Выбор изменился. Повторите действие."); return; }
    const result = editBaseColorTexture(store, context, assetId);
    setError(result.ok ? "" : result.message);
  }

  function start(field: string) {
    const context = captureMaterialEdit(store, mode);
    session.current = context ? { context, groupId: crypto.randomUUID(), changed: false, field } : null;
    setError("");
  }
  function apply(field: MaterialField, value: number | readonly number[], grouped = false) {
    if (!canEdit) return;
    if (!session.current || session.current.field !== field) start(field);
    const active = session.current;
    if (!active) return;
    const result = editMaterial(store, active.context, field, value, grouped ? active.groupId : undefined);
    if (!result.ok) { setError(result.message); return; }
    if (result.changed) {
      active.changed = true;
      active.context.revision = result.revision;
      const updated = store.getSnapshot().document.project.nodes.find(item => item.id === active.context.nodeId);
      if (updated?.kind === "mesh") active.context.materialId = updated.materialSlots[0]?.materialId ?? active.context.materialId;
    }
    setError("");
    if (!grouped) session.current = null;
  }
  function finish() { session.current = null; setEditing(null); }
  function escapeInput(target: HTMLInputElement) { skipBlur.current = true; finish(); target.blur(); }
  function shouldSkipBlur() { if (!skipBlur.current) return false; skipBlur.current = false; return true; }
  function cancel() {
    const active = session.current;
    if (active?.changed) {
      const current = store.getSnapshot();
      const result = store.cancelGesture(active.groupId, current.document.revision);
      if (!result.ok) setError(result.message);
    }
    finish();
  }
  function commitNumber(field: MaterialField) {
    const raw = draft.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) { setError("Введите конечное число."); finish(); return; }
    apply(field, value);
    finish();
  }
  function reset(field: MaterialField) {
    if (!preset) return;
    start(field);
    apply(field, preset.material[field]);
  }
  function colorRow(field: "baseColor" | "emissive", label: string) {
    if (!material) return null;
    const color = material[field];
    const hex = linearToHex(color);
    const colorKey = `${field}-hex`;
    return <div className="material-field" key={field}>
      <div className="inspector-group-heading"><strong>{label}</strong><button type="button" disabled={!canEdit || !preset} title={preset ? `Значение пресета «${preset.name}»` : "Пресет по имени не определён"} onClick={() => reset(field)}>Сбросить</button></div>
      <div className="material-color-line"><input type="color" aria-label={`${label}: палитра sRGB`} value={hex ?? "#ffffff"} disabled={!canEdit} onChange={event => { const parsed = parseHexColor(event.target.value); if (parsed) apply(field, parsed); }} />
        <label>HEX sRGB<input type="text" aria-label={`${label}: HEX sRGB`} value={editing === colorKey ? draft : hex ?? ""} placeholder={hex ? undefined : "HDR"} disabled={!canEdit} onFocus={() => { start(field); setEditing(colorKey); setDraft(hex ?? ""); }} onChange={event => setDraft(event.target.value)} onBlur={() => { if (shouldSkipBlur() || editing !== colorKey) return; const parsed = parseHexColor(draft); if (parsed) apply(field, parsed); else if (draft !== (hex ?? "")) setError("HEX должен содержать # и шесть цифр."); finish(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") (event.target as HTMLInputElement).blur(); if (event.key === "Escape") { event.preventDefault(); escapeInput(event.target as HTMLInputElement); } }} /></label></div>
      {!hex && <p className="panel-hint">Цвет содержит HDR-компоненты. Палитра sRGB не показывает их точно; используйте числовые поля.</p>}
      <div className="inspector-vector">{(["R", "G", "B"] as const).map((channel, index) => {
        const key = `${field}-${index}`;
        return <label key={key}>{channel} · linear<input type="text" inputMode="decimal" aria-label={`${label} ${channel} Linear-sRGB`} value={editing === key ? draft : format(color[index]!)} disabled={!canEdit} onFocus={() => { start(field); setEditing(key); setDraft(format(color[index]!)); }} onChange={event => setDraft(event.target.value)} onBlur={() => { if (shouldSkipBlur()) return; if (editing === key) { const raw = draft.trim(); const value = Number(raw); if (raw && Number.isFinite(value)) apply(field, color.map((entry, i) => i === index ? value : entry)); else setError("Введите конечное число."); finish(); } }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") (event.target as HTMLInputElement).blur(); if (event.key === "Escape") { event.preventDefault(); escapeInput(event.target as HTMLInputElement); } }} /></label>;
      })}</div>
    </div>;
  }
  function scalarRow(spec: typeof scalarFields[number]) {
    if (!material) return null;
    const field = spec.key;
    const value = material[field];
    return <div className="material-field" key={field}>
      <div className="inspector-group-heading"><strong>{spec.label}</strong><button type="button" disabled={!canEdit || !preset} title={preset ? `Значение пресета «${preset.name}»` : "Пресет по имени не определён"} onClick={() => reset(field)}>Сбросить</button></div>
      <div className="material-scalar-line"><input type="range" aria-label={`${spec.label}: слайдер`} min={spec.min} max={spec.max} step={spec.step} value={Math.min(spec.max, value)} disabled={!canEdit} onPointerDown={() => start(field)} onChange={event => apply(field, Number(event.target.value), true)} onPointerUp={finish} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); cancel(); } else if (!session.current) start(field); }} onKeyUp={finish} />
        <label><span className="sr-only">{spec.label}: точное значение</span><input type="text" inputMode="decimal" aria-label={`${spec.label}: точное значение`} value={editing === field ? draft : format(value)} disabled={!canEdit} onFocus={() => { start(field); setEditing(field); setDraft(format(value)); }} onChange={event => setDraft(event.target.value)} onBlur={() => { if (shouldSkipBlur()) return; if (editing === field) commitNumber(field); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") (event.target as HTMLInputElement).blur(); if (event.key === "Escape") { event.preventDefault(); escapeInput(event.target as HTMLInputElement); } }} /></label></div>
    </div>;
  }
  return <section className="material-inspector" aria-label="Материал"><h4>Материал</h4>
    {material && <strong>{material.name}</strong>}
    {users.length > 1 && <><p className="panel-hint">Материал используется несколькими объектами ({users.length} слотов).</p><fieldset className="material-mode"><legend>Редактировать</legend><label><input type="radio" checked={mode === "unique"} onChange={() => { setMode("unique"); finish(); }} /> Только выбранный объект</label><label><input type="radio" checked={mode === "shared"} onChange={() => { setMode("shared"); finish(); }} /> Все объекты с этим материалом</label></fieldset></>}
    {reason && <p className="panel-hint">{reason}</p>}
    {material && <>
      <div className="material-fields"><h4>Основные</h4>{colorRow("baseColor", "Базовый цвет")}{scalarFields.slice(0, 3).map(scalarRow)}</div>
      <div className="material-fields"><h4>Текстуры</h4><label>Основной цвет
        <select aria-label="Текстура основного цвета" value={selectedTexture ?? ""} disabled={!canEdit} title={reason || undefined} onChange={event => setTexture(event.target.value || undefined)}>
          <option value="">Не назначено</option>
          {rasterAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.path} · {asset.id}</option>)}
          {selectedTexture && !selectedAsset && <option value={selectedTexture}>Недоступный ресурс · {selectedTexture}</option>}
        </select></label>
        {selectedAsset && <p className="panel-hint">{selectedAsset.path} · {selectedAsset.id}</p>}
        <button type="button" disabled={!canEdit || !selectedTexture} title={reason || undefined} onClick={() => setTexture()}>Снять текстуру</button>
        <label>Проекция текстуры<select aria-label="Проекция текстуры" value={projection.mode} disabled={!canEdit} onChange={event => setProjection(event.target.value === "planar" ? { mode: "planar", axis: "z", tiling: [1, 1], offset: [0, 0] } : event.target.value === "box" ? { mode: "box", tiling: [1, 1], offset: [0, 0] } : event.target.value === "triplanar" ? { mode: "triplanar", tiling: [1, 1], offset: [0, 0] } : { mode: "uv" })}><option value="uv">UV</option><option value="planar">Плоскость</option><option value="box">Коробка (Box)</option><option value="triplanar">Трипланарная (Triplanar)</option></select></label>
        {projection.mode !== "uv" && <>{projection.mode === "planar" && <label>Ось проекции<select aria-label="Ось проекции" value={projection.axis} disabled={!canEdit} onChange={event => setProjection({ ...projection, axis: event.target.value as "x" | "y" | "z" })}><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>}
          <div className="inspector-vector">{projectionNumber("Повторение U", projection.tiling[0], number => ({ ...projection, tiling: [number, projection.tiling[1]] }))}{projectionNumber("Повторение V", projection.tiling[1], number => ({ ...projection, tiling: [projection.tiling[0], number] }))}{projectionNumber("Смещение U", projection.offset[0], number => ({ ...projection, offset: [number, projection.offset[1]] }))}{projectionNumber("Смещение V", projection.offset[1], number => ({ ...projection, offset: [projection.offset[0], number] }))}</div></>}
        {missingUv && selectedTexture && projection.mode === "uv" && <p className="material-warning">У геометрии нет UV; текстура не отображается. Выберите «Плоскость», «Коробка (Box)» или «Трипланарная (Triplanar)» для проекции.</p>}
        {selectedTexture && !store.readAssetBytes(selectedTexture) && <p className="material-warning">Байты текстуры недоступны в памяти.</p>}
        <div className="material-field"><h4>Процедурная шероховатость</h4>
          <label>Режим<select aria-label="Режим процедурной шероховатости" value={procedural?.kind ?? "none"} disabled={!canEdit} onChange={event => {
            const kind = event.target.value;
            setProcedural(kind === "none" ? undefined : kind === "scratches" ? { kind: "scratches", seed: 1, scale: 4, intensity: .5, resolution: 256, directionRadians: 0 } : { kind: "grain", seed: 1, scale: 4, intensity: .5, resolution: 256 });
          }}><option value="none">Нет</option><option value="grain">Зерно</option><option value="scratches">Царапины</option></select></label>
          {procedural && <><div className="inspector-vector">{proceduralNumber("seed", "Seed")}{proceduralNumber("scale", "Масштаб")}{proceduralNumber("intensity", "Интенсивность")}{procedural.kind === "scratches" && proceduralNumber("directionRadians", "Направление царапин (радианы)")}</div>
            <label>Разрешение карты<select aria-label="Разрешение карты" value={procedural.resolution} disabled={!canEdit} onChange={event => setProcedural({ ...procedural, resolution: Number(event.target.value) as 128 | 256 | 512 })}><option value="128">128</option><option value="256">256</option><option value="512">512</option></select></label></>}
          <p className="panel-hint">Визуальная шероховатость; геометрия не изменяется.</p>
          {procedural && missingUv && projection.mode === "uv" && <p className="material-warning">У геометрии нет UV; процедурная шероховатость не отображается.</p>}
          {procedural && projection.mode === "triplanar" && missingUv && <p className="material-warning">Трипланарная проекция основного цвета не создаёт UV для шероховатости.</p>}
        </div>
      </div>
      <details className="material-advanced"><summary>Дополнительно</summary><div className="material-fields">{colorRow("emissive", "Свечение")}{scalarFields.slice(3).map(scalarRow)}</div></details>
      {material.transmission > 0 && <p className="panel-hint">При пропускании света непрозрачность всегда 1. Включение пропускания устанавливает её автоматически.</p>}
      {material.textureAssetIds.length > 0 && <p className="material-warning">У сохранённых legacy-ссылок на текстуры канал не определён.</p>}
      {!preset && <p className="panel-hint">Пресет по имени не определён; сброс отдельных свойств недоступен.</p>}
      {preset && <p className="panel-hint">Сброс использует одноимённый встроенный пресет как ориентир, без подтверждения происхождения материала.</p>}
    </>}
    {error && <p className="primitive-error" role="alert">{error}</p>}
  </section>;
}

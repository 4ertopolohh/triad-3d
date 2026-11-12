import { useRef, useState } from "react";
import type { EditorState, EditorStore } from "../app/editor-store";
import { sceneSettings, sceneSettingsError, type SceneSettings } from "../domain/scene-settings";
import type { Light } from "../domain/types";
import { linearToHex, parseHexColor as hexToLinear } from "../materials/color";

/** A draft is bound to its source revision: blur can never overwrite a newer document. */
function NumericField({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Number(value.toPrecision(8))));
  const [error, setError] = useState(false);
  const commit = useRef<((value: number) => void) | null>(null);
  return <label>{label}<input type="number" step="any" aria-label={label} disabled={disabled} value={draft}
    onFocus={() => { commit.current = onChange; }}
    onChange={event => { setDraft(event.target.value); setError(false); }}
    onBlur={() => { const apply = commit.current; commit.current = null; const n = Number(draft); if (!draft.trim() || !Number.isFinite(n)) { setError(true); return; } if (n !== value) apply?.(n); }}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { commit.current = null; setDraft(String(value)); setError(false); event.currentTarget.blur(); } }} aria-invalid={error} />{error && <small role="alert">Введите конечное число.</small>}</label>;
}

export function SceneInspector({ store, state, blocked }: { store: EditorStore; state: EditorState; blocked: boolean }) {
  const [error, setError] = useState("");
  const scene = state.document.project.scene;
  const revision = state.document.revision, epoch = store.getProjectEpoch();
  function edit(update: (settings: SceneSettings) => void) {
    if (blocked || store.getProjectEpoch() !== epoch || store.getSnapshot().document.revision !== revision || store.getSnapshot().tool.mode !== "scene") { setError("Сцена изменилась. Повторите ввод."); return; }
    const settings = sceneSettings(structuredClone(store.captureDocument().project.scene)); update(settings);
    const invalid = sceneSettingsError(settings);
    if (invalid) { setError(invalid); return; }
    const result = store.executeCommand({ commandId: crypto.randomUUID(), type: "SET_SCENE_SETTINGS", targetIds: [scene.id], payload: { sceneId: scene.id, settings } }, revision);
    setError(result.ok ? "" : result.issues?.[0]?.message ?? result.message);
  }
  const numeric = (label: string, value: number, change: (settings: SceneSettings, value: number) => void) => <NumericField key={`${state.document.project.id}:${revision}:${label}:${value}`} label={label} value={value} disabled={blocked} onChange={v => edit(s => change(s, v))} />;
  const rendering = scene.renderSettings ?? { exposure: 1.25, toneMapping: "aces" as const };
  return <div className="scene-inspector">
    {error && <p className="material-warning" role="alert">{error}</p>}
    <h3>Окружение и фон</h3>
    <label>Цвет фона<input type="color" aria-label="Цвет фона" disabled={blocked} value={linearToHex(scene.background.color) ?? "#ffffff"} onChange={event => { const color = hexToLinear(event.target.value); if (color) edit(s => { s.background.color = color; }); }} /></label>
    {numeric("Яркость фона", scene.background.intensity, (s, v) => { s.background.intensity = v; })}
    <label>HDRI<select aria-label="HDRI сцены" disabled={blocked} value={scene.background.environmentAssetId ?? ""} onChange={event => edit(s => { if (event.target.value) s.background.environmentAssetId = event.target.value; else delete s.background.environmentAssetId; })}>
      <option value="">Без HDRI</option>{state.document.project.assets.filter(a => ["image/vnd.radiance", "image/x-exr"].includes(a.mediaType)).map(a => <option key={a.id} value={a.id}>{a.path.split("/").at(-1)?.slice(0, 20)} · {a.mediaType === "image/x-exr" ? "EXR" : "HDR"}</option>)}
    </select></label>
    <p className="panel-hint">Загрузите HDR/EXR в библиотеке ресурсов. Окружение влияет на освещение и отражения, фон задаётся отдельно.</p>
    {numeric("Сила окружения", scene.background.environmentIntensity ?? 1, (s, v) => { s.background.environmentIntensity = v; })}
    {numeric("Поворот окружения, °", (scene.background.environmentRotation ?? 0) * 180 / Math.PI, (s, v) => { s.background.environmentRotation = v * Math.PI / 180; })}
    {numeric("Экспозиция", rendering.exposure, (s, v) => { s.renderSettings = { ...rendering, exposure: v }; })}
    <label>Тональное отображение<select aria-label="Тональное отображение" disabled={blocked} value={rendering.toneMapping} onChange={event => edit(s => { s.renderSettings = { ...rendering, toneMapping: event.target.value as typeof rendering.toneMapping }; })}><option value="aces">Кино · ACES</option><option value="neutral">Нейтральное</option><option value="none">Без преобразования</option></select></label>
    <h3>Источники света</h3>
    <div className="inspector-actions">{([ ["directional", "Направленный"], ["point", "Точечный"], ["spot", "Прожектор"], ["ambient", "Рассеянный"] ] as const).map(([kind, label]) => <button type="button" key={kind} disabled={blocked} onClick={() => edit(s => { s.lights.push({ id: crypto.randomUUID(), kind, color: [1, 1, 1], intensity: kind === "ambient" ? .5 : 3, position: [4, 5, 3], target: [0, 0, 0] }); })}>+ {label}</button>)}</div>
    {scene.lights.map((light, i) => <fieldset key={light.id} disabled={blocked}><legend>{i + 1}. {({ ambient: "Рассеянный", directional: "Направленный", point: "Точечный", spot: "Прожектор" })[light.kind]}</legend>
      <label>Цвет<input type="color" aria-label={`Цвет света ${i + 1}`} value={linearToHex(light.color) ?? "#ffffff"} onChange={event => { const color = hexToLinear(event.target.value); if (color) edit(s => { s.lights[i]!.color = color; }); }} /></label>
      {numeric(`Интенсивность света ${i + 1}`, light.intensity, (s, v) => { s.lights[i]!.intensity = v; })}
      {light.kind !== "ambient" && (["position", ...(light.kind === "point" ? [] : ["target"])] as ("position" | "target")[]).map(field => <div className="inspector-vector" key={field}>{([0, 1, 2] as const).map(axis => numeric(`${field === "position" ? "Положение" : "Цель"} ${"XYZ"[axis]} · свет ${i + 1}`, light[field][axis], (s, v) => { const next = [...s.lights[i]![field]] as [number, number, number]; next[axis] = v; (s.lights[i] as Light)[field] = next; }))}</div>)}
      <button type="button" onClick={() => edit(s => { s.lights.splice(i, 1); })}>Удалить свет</button>
    </fieldset>)}
    <details><summary>Камера сцены</summary>
      {numeric("Угол обзора, °", scene.camera.fovDegrees, (s, v) => { s.camera.fovDegrees = v; })}
      {numeric("Ближняя плоскость", scene.camera.near, (s, v) => { s.camera.near = v; })}
      {numeric("Дальняя плоскость", scene.camera.far, (s, v) => { s.camera.far = v; })}
      {(["position", "target"] as const).map(field => <div className="inspector-vector" key={field}>{([0, 1, 2] as const).map(axis => numeric(`${field === "position" ? "Камера" : "Цель камеры"} ${"XYZ"[axis]}`, scene.camera[field][axis], (s, v) => { const next = [...s.camera[field]] as [number, number, number]; next[axis] = v; s.camera[field] = next; }))}</div>)}
    </details>
  </div>;
}

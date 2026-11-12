import { bakePng } from "../materials/procedural/bake";
import { CommitNumber } from "./CommitNumber";
import { useState } from "react";
import type { EditorStore } from "../app/editor-store";
import { captureMaterialEdit, editMaterialSurface, type MaterialEditMode } from "../app/material-edit";
import type { Material } from "../domain/types";

export function SurfaceMaterialEditor({ store, mode, disabled, slotName }: { store: EditorStore; mode: MaterialEditMode; disabled: boolean; slotName: string }) {
  const [error, setError] = useState("");
  const context = captureMaterialEdit(store, mode,slotName);
  const source = store.getSnapshot().document.project.materials.find(m => m.id === context?.materialId);
  if (!source || !context) return null;
  const update = (fn: (value: Material) => void) => {
    const value = structuredClone(source) as Material; fn(value);
    const result = editMaterialSurface(store, context, { ...(value.textureSlots ? { textureSlots: value.textureSlots } : {}), ...(value.textureStrengths ? { textureStrengths: value.textureStrengths } : {}), ...(value.proceduralMaps ? { proceduralMaps: value.proceduralMaps } : {}) });
    setError(result.ok ? "" : result.message);
  };
  const assets = store.getSnapshot().document.project.assets.filter(a => ["image/png", "image/jpeg", "image/webp"].includes(a.mediaType));
  return <details className="material-advanced"><summary>Карты поверхности и рельеф</summary><fieldset disabled={disabled}>
    {([ ["normal", "Нормали"], ["bump", "Высота"], ["roughness", "Шероховатость"], ["metalness", "Металличность"], ["emissive", "Свечение"] ] as const).map(([channel, label]) => <label key={channel}>{label}<select aria-label={`Карта: ${label}`} value={source.textureSlots?.[channel] ?? ""} onChange={e => update(m => { m.textureSlots ??= {}; if (e.target.value) m.textureSlots[channel] = e.target.value; else delete m.textureSlots[channel]; })}><option value="">Без карты</option>{assets.map(a => <option key={a.id} value={a.id}>{a.path.split("/").at(-1)?.slice(0, 18)}</option>)}</select></label>)}
    {(["normal", "bump"] as const).map(channel => <label key={channel}>Сила {channel}<CommitNumber aria-label={`Сила ${channel}`} min="0" max="10" step="0.05" value={source.textureStrengths?.[channel] ?? 1} onCommit={value => update(m => { m.textureStrengths = { ...m.textureStrengths, [channel]: value }; })} /></label>)}
    <label><input type="checkbox" checked={!!source.proceduralMaps?.height} onChange={e => update(m => { m.proceduralMaps ??= {}; if (e.target.checked) m.proceduralMaps.height = { kind: "stone", seed: 1, scale: 4, intensity: .5, resolution: 256, strength: .1 }; else delete m.proceduralMaps.height; })} />Рельеф камня</label>
    {source.proceduralMaps?.height && (["seed", "scale", "intensity", "strength"] as const).map(field => <label key={field}>{({ seed: "Seed рельефа", scale: "Масштаб рельефа", intensity: "Интенсивность рельефа", strength: "Глубина рельефа" })[field]}<CommitNumber step={field === "seed" ? 1 : .05} value={source.proceduralMaps!.height![field]} onCommit={value => update(m => { m.proceduralMaps!.height![field] = value; })} /></label>)}
    <p className="panel-hint">Это визуальный рельеф: геометрия не меняется. Нужны UV. Normal имеет приоритет над bump; загруженная карта высоты — над процедурной. Карты roughness используют зелёный канал, metalness — синий.</p>
    {(["roughness","height"] as const).map(channel => source.proceduralMaps?.[channel] && <button key={channel} onClick={() => {
      const config = source.proceduralMaps![channel]!;
      void bakePng(config,source.roughness).then(blob => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href=url;link.download=`triad-${config.kind}-${channel}.png`;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);setError(""); }).catch(error => setError(error instanceof Error ? error.message : "Ошибка PNG"));
    }}>Запечь {channel === "roughness" ? "шероховатость" : "высоту"} в PNG</button>)}
    {(source.proceduralMaps?.roughness || source.proceduralMaps?.height) && <p className="panel-hint">PNG содержит линейные данные. Для запечённой шероховатости установите параметр roughness = 1; для высоты сохраните глубину bump. Процедура в проекте остаётся редактируемой.</p>}
    {error && <p role="alert">{error}</p>}
  </fieldset></details>;
}

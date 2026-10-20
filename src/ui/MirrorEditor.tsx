import { useRef, useState } from "react";
import { applyMirrorChange, type MirrorChange } from "../app/mirror-actions";
import type { DeepReadonly, EditorStore } from "../app/editor-store";
import type { Modifier } from "../domain/types";
import { parseMirrorParameters } from "../geometry/modifiers/mirror";
import type { MirrorParameters } from "../geometry/modifiers/types";

const defaults: MirrorParameters = { axes: "x", pivot: [0, 0, 0], mergeSeam: false };
const axes: MirrorParameters["axes"][] = ["x", "y", "z", "xy", "xz", "yz", "xyz"];

export function MirrorAdd({ store, targetId, disabled, reason }: { store: EditorStore; targetId: string; disabled: boolean; reason: string }) {
  const [message, setMessage] = useState("");
  async function add() {
    setMessage("");
    const result = await applyMirrorChange(store, { type: "add", targetId, parameters: defaults });
    setMessage(result.ok ? result.committed ? "Зеркалирование добавлено." : "Изменений нет." : `${result.error.code}: ${result.error.message}`);
  }
  return <section className="boolean-editor" aria-label="Зеркалирование"><h4>Зеркалирование</h4>
    {reason && <p className="primitive-error" role="alert">{reason}</p>}
    <button type="button" disabled={disabled || !!reason} onClick={() => void add()}>Добавить зеркалирование</button>
    {message && <p className={message === "Зеркалирование добавлено." || message === "Изменений нет." ? "panel-hint" : "primitive-error"} role="status">{message}</p>}
  </section>;
}

export function MirrorItem({ store, targetId, modifier, index, length, disabled, reason }: { store: EditorStore; targetId: string; modifier: DeepReadonly<Modifier>; index: number; length: number; disabled: boolean; reason: string }) {
  const [message, setMessage] = useState("");
  const editing = useRef<{ revision: number; epoch: object; selection: string; version: number } | null>(null);
  let params: MirrorParameters;
  try { params = parseMirrorParameters(modifier.parameters); }
  catch { return <p className="primitive-error" role="alert">{index + 1}. Параметры Mirror повреждены.</p>; }
  async function run(change: MirrorChange) {
    setMessage("");
    const result = await applyMirrorChange(store, change);
    setMessage(result.ok ? result.committed ? "Зеркалирование изменено." : "Изменений нет." : `${result.error.code}: ${result.error.message}`);
  }
  function update(parameters: MirrorParameters) { void run({ type: "update", targetId, modifierId: modifier.id, parameters }); }
  return <div className="boolean-stack-item">
    <strong>{index + 1}. Зеркалирование</strong>
    <label className="boolean-check"><input type="checkbox" checked={modifier.enabled} disabled={disabled || !!reason} onChange={event => void run({ type: "enable", targetId, modifierId: modifier.id, enabled: event.target.checked })} />Включён</label>
    <label>Плоскости отражения<select value={params.axes} disabled={disabled || !!reason} onChange={event => update({ ...params, axes: event.target.value as MirrorParameters["axes"] })}>{axes.map(axis => <option key={axis} value={axis}>{axis.toUpperCase()}</option>)}</select></label>
    <p className="panel-hint">Отражение выполняется относительно локальных плоскостей выбранного объекта.</p>
    <div><span>Pivot</span><div className="boolean-stack-actions">{(["X", "Y", "Z"] as const).map((axis, component) => <label key={axis}>{axis}<input key={`${modifier.version}-${axis}`} type="number" defaultValue={params.pivot[component]} disabled={disabled || !!reason}
      onFocus={() => { const current = store.getSnapshot(); editing.current = { revision: current.document.revision, epoch: store.getProjectEpoch(), selection: current.selection.ids.join("\u0000"), version: modifier.version }; }}
      onBlur={event => {
        const session = editing.current; editing.current = null;
        const current = store.getSnapshot();
        if (!session) return;
        if (disabled || store.getProjectEpoch() !== session.epoch || current.document.revision !== session.revision
          || current.selection.ids.join("\u0000") !== session.selection || current.tool.mode !== "model"
          || current.document.project.modifiers.find(item => item.id === modifier.id)?.version !== session.version) {
          event.currentTarget.value = String(params.pivot[component]); setMessage("Данные изменились. Повторите ввод."); return;
        }
        const value = event.currentTarget.valueAsNumber;
        if (!Number.isFinite(value)) { event.currentTarget.value = String(params.pivot[component]); setMessage("Введите конечное число."); return; }
        if (value !== params.pivot[component]) update({ ...params, pivot: params.pivot.map((item, at) => at === component ? value : item) as [number, number, number] });
      }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { event.currentTarget.value = String(params.pivot[component]); editing.current = null; event.currentTarget.blur(); } }} /></label>)}</div></div>
    <label className="boolean-check"><input type="checkbox" checked={params.mergeSeam} disabled={disabled || !!reason} onChange={event => update({ ...params, mergeSeam: event.target.checked })} />Объединять объёмы через CSG</label>
    <p className="panel-hint">Доступно для корректных замкнутых тел. Операция не обрезает исходную геометрию по плоскости и не гарантирует автоматическую сшивку шва.</p>
    <div className="boolean-stack-actions"><button type="button" disabled={disabled || !!reason || index === 0} onClick={() => void run({ type: "move", targetId, modifierId: modifier.id, toIndex: index - 1 })}>↑ Выше</button><button type="button" disabled={disabled || !!reason || index === length - 1} onClick={() => void run({ type: "move", targetId, modifierId: modifier.id, toIndex: index + 1 })}>↓ Ниже</button><button type="button" disabled={disabled || !!reason} onClick={() => void run({ type: "remove", targetId, modifierId: modifier.id })}>Удалить</button></div>
    {message && <p className={message === "Зеркалирование изменено." || message === "Изменений нет." ? "panel-hint" : "primitive-error"} role="status">{message}</p>}
  </div>;
}

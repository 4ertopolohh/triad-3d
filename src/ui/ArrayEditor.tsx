import { useState } from "react";
import { applyArrayChange, type ArrayChange } from "../app/array-actions";
import type { DeepReadonly, EditorStore } from "../app/editor-store";
import type { ArrayParameters } from "../geometry/modifiers/types";
import type { Modifier } from "../domain/types";
import { parseArrayParameters } from "../geometry/modifiers/array";

const defaults = (mode: ArrayParameters["mode"]): ArrayParameters => mode === "linear"
  ? { mode, count: 3, axis: "x", step: 1, offset: [0, 0, 0] }
  : { mode, count: 4, axis: "z", angleStepDegrees: 90, pivot: [0, 0, 0], offset: [0, 0, 0] };

export function ArrayAdd({ store, targetId, disabled, reason }: { store: EditorStore; targetId: string; disabled: boolean; reason: string }) {
  const [message, setMessage] = useState("");
  async function add(mode: ArrayParameters["mode"]) {
    const result = await applyArrayChange(store, { type: "add", targetId, parameters: defaults(mode) });
    setMessage(result.ok ? "Массив добавлен." : `${result.error.code}: ${result.error.message}`);
  }
  return <section className="boolean-editor" aria-label="Массив"><h4>Массив</h4>
    <p className="panel-hint">Копии вычисляются из геометрии предыдущего этапа.</p>
    {reason && <p className="primitive-error" role="alert">{reason}</p>}
    <div className="boolean-stack-actions"><button type="button" disabled={disabled || !!reason} onClick={() => void add("linear")}>Добавить линейный массив</button><button type="button" disabled={disabled || !!reason} onClick={() => void add("radial")}>Добавить радиальный массив</button></div>
    {message && <p className={message === "Массив добавлен." ? "panel-hint" : "primitive-error"} role="status">{message}</p>}
  </section>;
}

export function ArrayItem({ store, targetId, modifier, index, length, disabled, reason }: { store: EditorStore; targetId: string; modifier: DeepReadonly<Modifier>; index: number; length: number; disabled: boolean; reason: string }) {
  const [message, setMessage] = useState("");
  let params: ArrayParameters;
  try { params = parseArrayParameters(modifier.parameters); }
  catch { return <p className="primitive-error" role="alert">{index + 1}. Параметры массива повреждены.</p>; }
  async function run(change: ArrayChange) {
    const result = await applyArrayChange(store, change);
    setMessage(result.ok ? result.committed ? "Массив изменён." : "Изменений нет." : `${result.error.code}: ${result.error.message}`);
  }
  function update(next: ArrayParameters) { void run({ type: "update", targetId, modifierId: modifier.id, parameters: next }); }
  function numeric(label: string, value: number, apply: (value: number) => void) {
    return <label>{label}<input key={`${modifier.version}-${label}`} type="number" defaultValue={value} disabled={disabled || !!reason} onBlur={event => {
      const number = event.currentTarget.valueAsNumber;
      if (!Number.isFinite(number)) { setMessage("Введите конечное число."); event.currentTarget.value = String(value); return; }
      if (number !== value) apply(number);
    }} /></label>;
  }
  function vector(label: string, value: readonly number[], field: "offset" | "pivot") {
    return <div><span>{label}</span><div className="boolean-stack-actions">{(["X", "Y", "Z"] as const).map((axis, component) =>
      <span key={axis}>{numeric(axis, value[component]!, number => update({ ...params, [field]: value.map((item, at) => at === component ? number : item) as [number, number, number] } as ArrayParameters))}</span>)}</div></div>;
  }
  return <div className="boolean-stack-item">
    <strong>{index + 1}. Массив · {params.mode === "linear" ? "линейный" : "радиальный"}</strong>
    <label className="boolean-check"><input type="checkbox" checked={modifier.enabled} disabled={disabled || !!reason} onChange={event => void run({ type: "enable", targetId, modifierId: modifier.id, enabled: event.target.checked })} />Включён</label>
    <label>Тип<select value={params.mode} disabled={disabled || !!reason} onChange={event => update(defaults(event.target.value as ArrayParameters["mode"]))}><option value="linear">Линейный</option><option value="radial">Радиальный</option></select></label>
    {numeric("Копий", params.count, count => update({ ...params, count }))}
    <label>Ось<select value={params.axis} disabled={disabled || !!reason} onChange={event => update({ ...params, axis: event.target.value as ArrayParameters["axis"] })}><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
    {params.mode === "linear" ? numeric("Шаг", params.step, step => update({ ...params, step })) : numeric("Угол, °", params.angleStepDegrees, angleStepDegrees => update({ ...params, angleStepDegrees }))}
    {vector("Смещение", params.offset, "offset")}
    {params.mode === "radial" && vector("Pivot", params.pivot, "pivot")}
    <div className="boolean-stack-actions"><button type="button" disabled={disabled || !!reason || index === 0} onClick={() => void run({ type: "move", targetId, modifierId: modifier.id, toIndex: index - 1 })}>↑ Выше</button><button type="button" disabled={disabled || !!reason || index === length - 1} onClick={() => void run({ type: "move", targetId, modifierId: modifier.id, toIndex: index + 1 })}>↓ Ниже</button><button type="button" disabled={disabled || !!reason} onClick={() => void run({ type: "remove", targetId, modifierId: modifier.id })}>Удалить</button></div>
    {message && <p className={message.startsWith("Массив изменён") || message === "Изменений нет." ? "panel-hint" : "primitive-error"} role="status">{message}</p>}
  </div>;
}

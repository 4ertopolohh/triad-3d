import { useEffect, useRef, useState } from "react";
import { applyDeformChange, type DeformChange, type DeformKind } from "../app/deform-actions";
import type { DeepReadonly, EditorStore } from "../app/editor-store";
import type { Modifier } from "../domain/types";
import { parseBendParameters, parseTaperParameters, parseTwistParameters } from "../geometry/modifiers/deform";
import type { BendParameters, DeformAxis, TaperParameters, TwistParameters } from "../geometry/modifiers/types";
import { parseNumber } from "./inspector-logic";

type Parameters = BendParameters | TwistParameters | TaperParameters;
type Draft = { axis: DeformAxis; direction: DeformAxis; angleDegrees: string; startScale: string; endScale: string; pivot: [string, string, string] };
type Session = { epoch: object; revision: number; selection: string; modifierVersion?: number };
const labels = { bend: "Изгиб", twist: "Скручивание", taper: "Сужение / расширение" } as const;
const axes: DeformAxis[] = ["x", "y", "z"];
const defaults: Record<DeformKind, Parameters> = {
  bend: { axis: "y", direction: "x", angleDegrees: 30, pivot: [0, 0, 0] },
  twist: { axis: "y", angleDegrees: 45, pivot: [0, 0, 0] },
  taper: { axis: "y", startScale: 1, endScale: 0.8, pivot: [0, 0, 0] },
};
function makeDraft(kind: DeformKind, parameters: Parameters): Draft {
  return { axis: parameters.axis, direction: kind === "bend" && "direction" in parameters ? parameters.direction : "x",
    angleDegrees: "angleDegrees" in parameters ? String(parameters.angleDegrees) : "0",
    startScale: "startScale" in parameters ? String(parameters.startScale) : "1",
    endScale: "endScale" in parameters ? String(parameters.endScale) : "0.8",
    pivot: parameters.pivot.map(String) as [string, string, string] };
}
function parseDraft(kind: "bend", draft: Draft): BendParameters;
function parseDraft(kind: "twist", draft: Draft): TwistParameters;
function parseDraft(kind: "taper", draft: Draft): TaperParameters;
function parseDraft(kind: DeformKind, draft: Draft): Parameters;
function parseDraft(kind: DeformKind, draft: Draft): Parameters {
  const numeric = (text: string) => { const result = parseNumber(text); if (!result.ok) throw new Error(result.message); return result.value; };
  const pivot = draft.pivot.map(numeric) as [number, number, number];
  if (kind === "bend") return parseBendParameters({ axis: draft.axis, direction: draft.direction, angleDegrees: numeric(draft.angleDegrees), pivot });
  if (kind === "twist") return parseTwistParameters({ axis: draft.axis, angleDegrees: numeric(draft.angleDegrees), pivot });
  return parseTaperParameters({ axis: draft.axis, startScale: numeric(draft.startScale), endScale: numeric(draft.endScale), pivot });
}
function capture(store: EditorStore, version?: number): Session {
  const state = store.getSnapshot();
  return { epoch: store.getProjectEpoch(), revision: state.document.revision, selection: state.selection.ids.join("\u0000"), ...(version === undefined ? {} : { modifierVersion: version }) };
}
function fresh(store: EditorStore, session: Session, modifierId?: string): boolean {
  const state = store.getSnapshot();
  return store.getProjectEpoch() === session.epoch && state.document.revision === session.revision
    && state.selection.ids.join("\u0000") === session.selection && state.tool.mode === "model" && state.meshEdit.mode === "object"
    && (modifierId === undefined || state.document.project.modifiers.find(item => item.id === modifierId)?.version === session.modifierVersion);
}

function Fields({ kind, draft, setDraft, disabled }: { kind: DeformKind; draft: Draft; setDraft: (value: Draft) => void; disabled: boolean }) {
  const number = (label: string, key: "angleDegrees" | "startScale" | "endScale") =>
    <label>{label}<input type="text" inputMode="decimal" value={draft[key]} disabled={disabled} onChange={event => setDraft({ ...draft, [key]: event.target.value })} onKeyDown={event => event.stopPropagation()} /></label>;
  return <>
    <label>Ось<select value={draft.axis} disabled={disabled} onChange={event => setDraft({ ...draft, axis: event.target.value as DeformAxis })}>{axes.map(axis => <option key={axis} value={axis}>{axis.toUpperCase()}</option>)}</select></label>
    {kind === "bend" && <label>Направление изгиба<select value={draft.direction} disabled={disabled} onChange={event => setDraft({ ...draft, direction: event.target.value as DeformAxis })}>{axes.map(axis => <option key={axis} value={axis}>{axis.toUpperCase()}</option>)}</select></label>}
    {kind !== "taper" ? number("Угол, °", "angleDegrees") : <>{number("Начальный масштаб", "startScale")}{number("Конечный масштаб", "endScale")}</>}
    <span>Pivot</span><div className="boolean-stack-actions">{(["X", "Y", "Z"] as const).map((axis, index) => <label key={axis}>{axis}<input type="text" inputMode="decimal" value={draft.pivot[index]} disabled={disabled}
      onChange={event => setDraft({ ...draft, pivot: draft.pivot.map((value, at) => at === index ? event.target.value : value) as [string, string, string] })}
      onKeyDown={event => event.stopPropagation()} /></label>)}</div>
  </>;
}

export function DeformAdd({ store, targetId, disabled, reason }: { store: EditorStore; targetId: string; disabled: boolean; reason: string }) {
  const [kind, setKind] = useState<DeformKind>("bend");
  const [draft, setDraft] = useState(() => makeDraft("bend", defaults.bend));
  const [message, setMessage] = useState("");
  const session = useRef<Session | null>(null);
  function change(value: Draft) { session.current ??= capture(store); setDraft(value); setMessage(""); }
  function reset(nextKind: DeformKind) { setKind(nextKind); setDraft(makeDraft(nextKind, defaults[nextKind])); session.current = null; setMessage(""); }
  async function add() {
    if (session.current && !fresh(store, session.current)) { setMessage("Данные изменились. Повторите ввод."); return; }
    let change: DeformChange;
    try {
      if (kind === "bend") change = { type: "add", targetId, kind, parameters: parseDraft(kind, draft) };
      else if (kind === "twist") change = { type: "add", targetId, kind, parameters: parseDraft(kind, draft) };
      else change = { type: "add", targetId, kind, parameters: parseDraft(kind, draft) };
    } catch (error) { setMessage(error instanceof Error ? error.message : "Недопустимые параметры."); return; }
    const result = await applyDeformChange(store, change);
    setMessage(result.ok ? result.committed ? "Деформация добавлена." : "Изменений нет." : `${result.error.code}: ${result.error.message}`);
    session.current = null;
  }
  return <section className="boolean-editor" aria-label="Деформации"><h4>Деформации</h4>
    <label>Операция<select value={kind} disabled={disabled || !!reason} onChange={event => reset(event.target.value as DeformKind)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <div onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void add(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(makeDraft(kind, defaults[kind])); session.current = null; setMessage(""); } }}>
      <Fields kind={kind} draft={draft} setDraft={change} disabled={disabled || !!reason} />
    </div>
    <button type="button" disabled={disabled || !!reason} title={reason || undefined} onClick={() => void add()}>Добавить деформацию</button>
    {reason && <p className="panel-hint">{reason}</p>}{message && <p className="primitive-error" role="status">{message}</p>}
    <p className="panel-hint">Деформация пересчитывает нормали. Исходные UV, авторские нормали и группы материалов в MeshData результата не сохраняются.</p>
  </section>;
}

export function DeformItem({ store, targetId, modifier, index, length, disabled, reason }: { store: EditorStore; targetId: string; modifier: DeepReadonly<Modifier>; index: number; length: number; disabled: boolean; reason: string }) {
  const kind = modifier.kind;
  if (kind !== "bend" && kind !== "twist" && kind !== "taper") return null;
  return <DeformItemForm key={`${modifier.id}:${modifier.version}`} store={store} targetId={targetId} modifier={modifier} kind={kind} index={index} length={length} disabled={disabled} reason={reason} />;
}
function DeformItemForm({ store, targetId, modifier, kind, index, length, disabled, reason }: { store: EditorStore; targetId: string; modifier: DeepReadonly<Modifier>; kind: DeformKind; index: number; length: number; disabled: boolean; reason: string }) {
  const [message, setMessage] = useState("");
  const session = useRef<Session | null>(null);
  const renderedEpoch = useRef(store.getProjectEpoch());
  const parameters = (() => { try { return kind === "bend" ? parseBendParameters(modifier.parameters) : kind === "twist" ? parseTwistParameters(modifier.parameters) : parseTaperParameters(modifier.parameters); } catch { return null; } })();
  const [draft, setDraft] = useState(() => makeDraft(kind, parameters ?? defaults[kind]));
  useEffect(() => { session.current = null; }, [modifier.id, modifier.version]);
  if (!parameters) return <p className="primitive-error" role="alert">{index + 1}. Параметры деформации повреждены.</p>;
  function change(value: Draft) { session.current ??= capture(store, modifier.version); setDraft(value); setMessage(""); }
  async function run(action: DeformChange) {
    const current = store.getSnapshot();
    if (store.getProjectEpoch() !== renderedEpoch.current || current.document.project.modifiers.find(item => item.id === modifier.id)?.version !== modifier.version
      || current.selection.ids.length !== 1 || current.selection.activeId !== targetId) { setMessage("Данные изменились. Повторите действие."); return; }
    setMessage("");
    const result = await applyDeformChange(store, action);
    setMessage(result.ok ? result.committed ? "Деформация изменена." : "Изменений нет." : `${result.error.code}: ${result.error.message}`);
  }
  function update() {
    if (session.current && !fresh(store, session.current, modifier.id)) { setMessage("Данные изменились. Повторите ввод."); return; }
    try { void run({ type: "update", targetId, modifierId: modifier.id, parameters: parseDraft(kind, draft) }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Недопустимые параметры."); }
  }
  return <div className="boolean-stack-item">
    <strong>{index + 1}. {labels[kind]}</strong>
    <label className="boolean-check"><input type="checkbox" checked={modifier.enabled} disabled={disabled || !!reason} title={reason || undefined} onChange={event => void run({ type: "enable", targetId, modifierId: modifier.id, enabled: event.target.checked })} />Включён</label>
    <div onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); update(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(makeDraft(kind, parameters)); session.current = null; setMessage(""); } }}>
      <Fields kind={kind} draft={draft} setDraft={change} disabled={disabled || !!reason} />
    </div>
    <button type="button" disabled={disabled || !!reason} title={reason || undefined} onClick={update}>Применить параметры</button>
    <div className="boolean-stack-actions"><button type="button" disabled={disabled || !!reason || index === 0} title={reason || undefined} onClick={() => void run({ type: "move", targetId, modifierId: modifier.id, toIndex: index - 1 })}>↑ Выше</button><button type="button" disabled={disabled || !!reason || index === length - 1} title={reason || undefined} onClick={() => void run({ type: "move", targetId, modifierId: modifier.id, toIndex: index + 1 })}>↓ Ниже</button><button type="button" disabled={disabled || !!reason} title={reason || undefined} onClick={() => void run({ type: "remove", targetId, modifierId: modifier.id })}>Удалить</button></div>
    {message && <p className="primitive-error" role="status">{message}</p>}
  </div>;
}

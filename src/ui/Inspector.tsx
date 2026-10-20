import { useEffect, useRef, useState } from "react";
import type { DeepReadonly, EditorState, EditorStore } from "../app/editor-store";
import type { Node } from "../domain/types";
import { primitiveDefinitions, type PrimitiveSource } from "../geometry/primitives";
import { BooleanEditor } from "./BooleanEditor";
import { accessReason, displayTransform, eulerDegrees, mixedValue, parseNumber, prepareFlagCommands, prepareTransformCommands, sessionCurrent, updatedPrimitiveSource, type Axis, type EditSession, type TransformField } from "./inspector-logic";

const selectionKey = (state: EditorState) => state.selection.ids.join("\u0000");
const validSession = (store: EditorStore, session: EditSession) => sessionCurrent(store.getSnapshot(), store.getProjectEpoch(), session);
const format = (value: number) => String(Number(value.toPrecision(12)));
type TransformSession = EditSession & { groupId: string; applied?: string };

export function Inspector({ store, state, blocked }: { store: EditorStore; state: EditorState; blocked: boolean }) {
  const project = state.document.project;
  const nodes = state.selection.ids.map(id => project.nodes.find(node => node.id === id)).filter((node): node is DeepReadonly<Node> => !!node);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const session = useRef<TransformSession | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const epoch = store.getProjectEpoch();
  const selectedIds = selectionKey(state);
  useEffect(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null; session.current = null; setEditing(null); setError(null);
    return () => { if (pending.current) clearTimeout(pending.current); };
  }, [epoch, selectedIds, state.tool.mode, state.tool.space, blocked]);
  const modeReason = blocked ? "Дождитесь завершения операции." : state.tool.mode === "scene" ? "В режиме «Сцена» свойства модели не редактируются." : "";
  const transformReason = modeReason || nodes.map(node => node.id === project.model.rootNodeId ? "Корень модели защищён." : accessReason(project, node)).find(Boolean) || "";
  const flagReason = modeReason || nodes.map(node => node.id === project.model.rootNodeId ? "Корень модели защищён." : accessReason(project, node, true)).find(Boolean) || "";
  const displays = nodes.map(node => displayTransform(project, node, state.tool.space));
  const displayReason = displays.find(item => !item.ok);
  const disabled = !!transformReason || !!displayReason;
  function begin(key: string, value: number | null) {
    session.current = { revision: state.document.revision, epoch: store.getProjectEpoch(), ids: selectionKey(state), mode: state.tool.mode, space: state.tool.space, field: key, touched: false, groupId: crypto.randomUUID() };
    setEditing(key); setDraft(value === null ? "" : format(value)); setError(null);
  }
  function cancel(rollback = false) {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    const captured = session.current;
    if (rollback && captured?.applied && validSession(store, captured)) {
      const current = store.getSnapshot();
      if (current.history.entries[current.history.cursor - 1]?.groupId === captured.groupId) store.cancelGesture(captured.groupId, current.document.revision);
    }
    session.current = null; setEditing(null); setError(null);
  }
  function applyValue(field: TransformField, axis: Axis, key: string, raw: string, final: boolean, currentValue: number | null) {
    const captured = session.current;
    if (!captured || captured.field !== key) return;
    if (!validSession(store, captured) || blocked) { cancel(); return; }
    if (!captured.touched) { if (final) cancel(); return; }
    const parsed = parseNumber(raw);
    if (!parsed.ok) { if (final) { cancel(true); setError({ field: key, message: parsed.message }); } return; }
    if (captured.applied === raw || !captured.applied && currentValue !== null && Math.abs(parsed.value - currentValue) <= 1e-12) { if (final) cancel(); return; }
    const prepared = prepareTransformCommands(store.getSnapshot(), { field, axis, value: parsed.value });
    if (!prepared.ok) { if (final) { cancel(true); setError({ field: key, message: prepared.message }); } return; }
    const result = store.executeTransaction(prepared.value, captured.revision, undefined, captured.groupId);
    if (!result.ok) { if (final) { cancel(); setError({ field: key, message: result.message }); } return; }
    captured.revision = result.revision;
    captured.applied = raw;
    if (final) cancel();
  }
  function commit(field: TransformField, axis: Axis, key: string, currentValue: number | null) {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    applyValue(field, axis, key, draft, true, currentValue);
  }
  function schedule(field: TransformField, axis: Axis, key: string, raw: string, value: number | null) {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { pending.current = null; applyValue(field, axis, key, raw, false, value); }, 220);
  }
  function reset(field: TransformField) {
    if (disabled) return;
    const current = store.getSnapshot();
    const prepared = prepareTransformCommands(current, { field, reset: true });
    if (!prepared.ok) { setError({ field, message: prepared.message }); return; }
    const result = store.executeTransaction(prepared.value, current.document.revision);
    if (!result.ok) setError({ field, message: result.message }); else cancel();
  }
  function changeFlag(field: "visible" | "locked", value: boolean) {
    if (flagReason) return;
    const current = store.getSnapshot();
    const prepared = prepareFlagCommands(current, field, value);
    if (!prepared.ok) { setError({ field, message: prepared.message }); return; }
    const result = store.executeTransaction(prepared.value, current.document.revision);
    if (!result.ok) setError({ field, message: result.message }); else setError(null);
  }
  const fields = ([ ["position", "Положение"], ["rotation", "Вращение"], ["scale", "Масштаб"] ] as const);
  const axisLabels = ["X", "Y", "Z"] as const;
  const primitive = nodes.length === 1 && nodes[0]?.kind === "mesh" && nodes[0].meshSource.kind === "primitive" ? nodes[0] : null;
  const mesh = nodes.length === 1 && nodes[0]?.kind === "mesh" ? nodes[0] : null;
  return <div className="inspector">
    <p className="eyebrow">{state.tool.mode === "scene" ? "Сцена" : "Свойства модели"}</p>
    {!nodes.length ? <p className="panel-hint">Выберите объект в дереве или в рабочей области.</p> : <>
      <h3>{nodes.length === 1 ? nodes[0]!.name : `Выбрано объектов: ${nodes.length}`}</h3>
      {nodes.length === 1 && <p className="panel-hint">{nodes[0]!.kind === "group" ? "Группа" : nodes[0]!.meshSource.kind === "asset" ? "Импортированная сетка" : nodes[0]!.meshSource.kind === "editable" ? "Редактируемая сетка" : primitiveDefinitions[nodes[0]!.meshSource.primitive].label}</p>}
      <section aria-label="Трансформация"><h4>Трансформация · {state.tool.space === "world" ? "мировая" : "локальная"}</h4>
        {transformReason && <p className="panel-hint">{transformReason}</p>}
        {displayReason && !displayReason.ok && <p className="primitive-error" role="alert">{displayReason.message}</p>}
        {fields.map(([field, label]) => <div className="inspector-group" key={field}>
          <div className="inspector-group-heading"><strong>{label}</strong><button type="button" disabled={disabled} title="Сбросить в текущей системе координат" onClick={() => reset(field)}>Сбросить</button></div>
          <div className="inspector-vector">{axisLabels.map((axisLabel, axis) => {
            const key = `${field}-${axis}`;
            const values = displays.flatMap(item => item.ok ? [field === "rotation" ? eulerDegrees(item.value)[axis]! : item.value[field][axis]!] : []);
            const value = values.length === nodes.length ? mixedValue(values) : null;
            return <label key={key}>{axisLabel}{field === "rotation" ? "°" : ""}<input type="text" inputMode="decimal" aria-label={`${label} ${axisLabel}${field === "rotation" ? " в градусах" : ""}`} placeholder={value === null ? "—" : undefined} value={editing === key ? draft : value === null ? "" : format(value)} disabled={disabled} title={transformReason || (!displayReason?.ok ? displayReason?.message : "") || undefined} onFocus={() => begin(key, value)} onChange={event => { if (session.current) session.current.touched = true; setDraft(event.target.value); setError(null); schedule(field, axis as Axis, key, event.target.value, value); }} onBlur={() => { if (editing === key) commit(field, axis as Axis, key, value); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); commit(field, axis as Axis, key, value); (event.target as HTMLInputElement).blur(); } else if (event.key === "Escape") { event.preventDefault(); cancel(true); (event.target as HTMLInputElement).blur(); } }} />{error?.field === key && <span className="primitive-error" role="alert">{error.message}</span>}</label>;
          })}</div>
          {error?.field === field && <p className="primitive-error" role="alert">{error.message}</p>}
        </div>)}
      </section>
      <section aria-label="Состояние"><h4>Состояние</h4>{flagReason && <p className="panel-hint">{flagReason}</p>}
        {([ ["visible", "Видимость"], ["locked", "Блокировка"] ] as const).map(([field, label]) => {
          const common = nodes.every(node => node[field] === nodes[0]?.[field]) ? nodes[0]![field] : null;
          const ownReason = nodes.some(node => field === "visible" ? node.locked : !node.visible) ? "Сначала восстановите видимость или снимите блокировку объекта." : "";
          return <div className="inspector-flag" key={field}><span>{label}: {common === null ? "— смешано" : common ? "да" : "нет"}</span><button type="button" disabled={!!flagReason || !!ownReason && !(field === "visible" && common === false || field === "locked" && common === true)} title={flagReason || ownReason || undefined} onClick={() => changeFlag(field, common !== true)}>{field === "visible" ? common === true ? "Скрыть" : "Показать" : common === true ? "Разблокировать" : "Заблокировать"}</button></div>;
        })}
        {error && ["visible", "locked"].includes(error.field) && <p className="primitive-error" role="alert">{error.message}</p>}
      </section>
      <section aria-label="Геометрия"><h4>Геометрия</h4>
        {primitive ? <PrimitiveEditor key={primitive.id} store={store} node={primitive} disabled={!!modeReason || !!accessReason(project, primitive)} reason={modeReason || accessReason(project, primitive)} />
          : <p className="panel-hint">{nodes.length > 1 ? "Для нескольких объектов параметры геометрии не редактируются вместе." : nodes[0]?.kind === "group" ? "У группы нет параметров геометрии." : nodes[0]?.kind === "mesh" && nodes[0].meshSource.kind === "editable" ? "Координаты вершин хранятся в редактируемой сетке." : "Геометрия импортированного GLB доступна только для просмотра."}</p>}
        {mesh && mesh.meshSource.kind !== "asset" && <MeshEditActions store={store} state={state} node={mesh} blocked={blocked} />}
      </section>
      {state.meshEdit.mode === "vertex" && <VertexEditor key={`${epoch === store.getProjectEpoch() ? project.id : "new"}:${state.meshEdit.nodeId}`} store={store} state={state} blocked={blocked} />}
      {nodes.length === 1 && nodes[0]?.kind === "mesh" && <BooleanEditor key={nodes[0].id} store={store} project={project} target={nodes[0]} disabled={blocked || state.tool.mode !== "model"} reason={modeReason || accessReason(project, nodes[0])} />}
    </>}
    <div className="info-block"><span>Схема документа</span><strong>{project.schemaVersion}</strong></div>
    <div className="info-block"><span>Узлов модели</span><strong>{project.nodes.length}</strong></div>
  </div>;
}

function meshRestriction(state: EditorState, node: DeepReadonly<Extract<Node, { kind: "mesh" }>>, blocked: boolean): string {
  if (blocked) return "Дождитесь завершения операции.";
  if (state.tool.mode !== "model") return "Доступно только в режиме «Модель».";
  const access = accessReason(state.document.project, node);
  if (access) return access;
  if (node.modifierIds.some(id => state.document.project.modifiers.find(item => item.id === id)?.enabled)
    || state.document.project.modifiers.some(item => item.enabled && item.kind === "boolean" && item.parameters.cutterNodeId === node.id))
    return "Перед редактированием отключите активные модификаторы и зависимые Boolean.";
  return "";
}

function MeshEditActions({ store, state, node, blocked }: { store: EditorStore; state: EditorState; node: DeepReadonly<Extract<Node, { kind: "mesh" }>>; blocked: boolean }) {
  const [error, setError] = useState("");
  const reason = meshRestriction(state, node, blocked);
  const plane = node.meshSource.kind === "primitive" && node.meshSource.primitive === "plane";
  const restriction = reason || (plane ? "Плоскость не является замкнутой сеткой и пока не преобразуется." : "");
  function convert() {
    const current = store.getSnapshot();
    const selected = current.document.project.nodes.find(item => item.id === node.id);
    if (current.selection.ids.length !== 1 || current.selection.activeId !== node.id || selected?.kind !== "mesh" || selected.meshSource.kind !== "primitive"
      || current.document.revision !== state.document.revision || store.getProjectEpoch() !== epoch) { setError("Проект изменился. Повторите действие."); return; }
    const result = store.executeCommand({ commandId: crypto.randomUUID(), type: "CONVERT_PRIMITIVE_TO_EDITABLE", targetIds: [node.id], payload: { nodeId: node.id } }, current.document.revision);
    setError(result.ok ? "" : result.message);
  }
  const epoch = store.getProjectEpoch();
  function enter() {
    const message = store.enterVertexMode(state.document.revision, epoch);
    setError(message ?? "");
  }
  return <div className="mesh-edit-actions">
    {node.meshSource.kind === "primitive" && <button type="button" disabled={!!restriction} title={restriction || undefined} onClick={convert}>Преобразовать в редактируемую сетку</button>}
    {node.meshSource.kind === "editable" && (state.meshEdit.mode === "vertex"
      ? <button type="button" onClick={() => store.exitVertexMode()}>Вернуться к объектам</button>
      : <button type="button" disabled={!!reason || state.selection.ids.length !== 1} title={reason || undefined} onClick={enter}>Редактировать вершины</button>)}
    {restriction && <p className="panel-hint">{restriction}</p>}
    {error && <p className="primitive-error" role="alert">{error}</p>}
  </div>;
}

function VertexEditor({ store, state, blocked }: { store: EditorStore; state: EditorState; blocked: boolean }) {
  const [delta, setDelta] = useState<[string, string, string]>(["0", "0", "0"]);
  const [error, setError] = useState("");
  const node = state.document.project.nodes.find(item => item.id === state.meshEdit.nodeId);
  const epoch = store.getProjectEpoch();
  if (node?.kind !== "mesh" || node.meshSource.kind !== "editable") return null;
  const nodeId = node.id;
  const reason = meshRestriction(state, node, blocked);
  function apply() {
    const current = store.getSnapshot();
    const active = current.document.project.nodes.find(item => item.id === nodeId);
    if (current.document.revision !== state.document.revision || store.getProjectEpoch() !== epoch || current.meshEdit.mode !== "vertex" || current.meshEdit.nodeId !== nodeId
      || active?.kind !== "mesh" || active.meshSource.kind !== "editable" || current.meshEdit.vertexIndices.length !== state.meshEdit.vertexIndices.length
      || current.meshEdit.vertexIndices.some((index, position) => index !== state.meshEdit.vertexIndices[position])) {
      setError("Проект или выделение изменилось. Повторите действие."); return;
    }
    const parsed = delta.map(parseNumber);
    const failure = parsed.find(item => !item.ok);
    if (failure && !failure.ok) { setError(failure.message); return; }
    const values = parsed.map(item => item.ok ? item.value : 0) as [number, number, number];
    if (values.every(value => value === 0)) { setError(""); return; }
    const result = store.executeCommand({ commandId: crypto.randomUUID(), type: "TRANSLATE_EDITABLE_VERTICES", targetIds: [nodeId],
      payload: { nodeId, vertexIndices: [...current.meshEdit.vertexIndices], delta: values } }, current.document.revision);
    setError(result.ok ? "" : result.message);
  }
  return <section aria-label="Редактирование вершин"><h4>Редактирование вершин</h4>
    <p className="panel-hint">{node.name} · Выбрано вершин: {state.meshEdit.vertexIndices.length}</p>
    <p className="panel-hint">Локальные координаты объекта</p>
    <div className="inspector-vector">{(["X", "Y", "Z"] as const).map((axis, index) => <label key={axis}>Смещение {axis}<input type="text" inputMode="decimal" aria-label={`Смещение ${axis}`} value={delta[index]} onChange={event => { setDelta(current => current.map((value, i) => i === index ? event.target.value : value) as [string, string, string]); setError(""); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); apply(); } }} /></label>)}</div>
    <button type="button" disabled={!!reason || !state.meshEdit.vertexIndices.length} onClick={apply}>Применить смещение</button>
    {reason && <p className="panel-hint">{reason}</p>}{error && <p className="primitive-error" role="alert">{error}</p>}
  </section>;
}

function PrimitiveEditor({ store, node, disabled, reason }: { store: EditorStore; node: DeepReadonly<Extract<Node, { kind: "mesh" }>>; disabled: boolean; reason: string }) {
  const source = node.meshSource as DeepReadonly<PrimitiveSource>;
  const specs = primitiveDefinitions[source.primitive].parameters;
  const keys = source.primitive === "cube" && Object.keys(source.parameters).length === 1 && Object.hasOwn(source.parameters, "size")
    ? ["size"] : Object.keys(specs).filter(key => key !== "size");
  const committed = (key: string) => source.parameters[key] ?? (source.primitive === "cube" ? source.parameters.size : undefined) ?? specs[key]!.defaultValue;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const session = useRef<EditSession | null>(null);
  const epoch = store.getProjectEpoch();
  useEffect(() => { session.current = null; setEditing(null); setDraft({}); setError(""); }, [node.id, epoch]);
  function apply(key: string, raw: string) {
    const captured = session.current;
    if (!captured || !validSession(store, captured) || disabled) { setEditing(null); return; }
    if (!captured.touched) { setEditing(null); session.current = null; return; }
    const parsed = parseNumber(raw);
    if (!parsed.ok) { setError(parsed.message); return; }
    const next = updatedPrimitiveSource(source, key, parsed.value);
    if (!next.ok) { setError(next.message); return; }
    const result = store.executeCommand({ commandId: crypto.randomUUID(), type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source: next.value } }, captured.revision);
    if (!result.ok) { setError(result.message); return; }
    setEditing(null); setDraft({}); setError(""); session.current = null;
  }
  return <div className="primitive-editor"><h3>{primitiveDefinitions[source.primitive].label}</h3>
    {keys.map(key => <label key={key}>{specs[key]!.label}<span className="inspector-parameter"><input type="text" inputMode={specs[key]!.integer ? "numeric" : "decimal"} value={editing === key ? draft[key] ?? "" : format(committed(key))} disabled={disabled} onFocus={() => { const current = store.getSnapshot(); session.current = { revision: current.document.revision, epoch: store.getProjectEpoch(), ids: selectionKey(current), mode: current.tool.mode, space: current.tool.space, field: key, touched: false }; setEditing(key); setDraft({ [key]: format(committed(key)) }); setError(""); }} onChange={event => { if (session.current) session.current.touched = true; setDraft({ [key]: event.target.value }); setError(""); }} onBlur={() => { if (editing === key && !error) apply(key, draft[key] ?? ""); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); apply(key, draft[key] ?? ""); (event.target as HTMLInputElement).blur(); } else if (event.key === "Escape") { event.preventDefault(); setEditing(null); session.current = null; (event.target as HTMLInputElement).blur(); } }} /><button type="button" disabled={disabled} title={`Восстановить: ${specs[key]!.defaultValue}`} onClick={() => { const current = store.getSnapshot(); session.current = { revision: current.document.revision, epoch: store.getProjectEpoch(), ids: selectionKey(current), mode: current.tool.mode, space: current.tool.space, field: key, touched: true }; apply(key, String(specs[key]!.defaultValue)); }}>↺</button></span></label>)}
    {reason && <p className="panel-hint">{reason}</p>}{error && <p className="primitive-error" role="alert">{error}</p>}
    <p className="panel-hint">Enter или выход из поля применяет значение. Esc отменяет ввод.</p>
  </div>;
}

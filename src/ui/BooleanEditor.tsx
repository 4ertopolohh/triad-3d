import { useState } from "react";
import { applyBooleanChange, booleanOperandReason, type BooleanChange } from "../app/boolean-actions";
import type { DeepReadonly, EditorStore } from "../app/editor-store";
import type { MeshNode, Project } from "../domain/types";
import type { BooleanParameters } from "../geometry/modifiers/types";
import { accessReason } from "./inspector-logic";
import { ArrayAdd, ArrayItem } from "./ArrayEditor";

const operations = { subtract: "Вычитание", union: "Объединение", intersect: "Пересечение" } as const;
type Operation = BooleanParameters["operation"];

export function BooleanEditor({ store, project, target, disabled, reason }: { store: EditorStore; project: DeepReadonly<Project>; target: DeepReadonly<MeshNode>; disabled: boolean; reason: string }) {
  const [operation, setOperation] = useState<Operation>("subtract");
  const [cutterId, setCutterId] = useState("");
  const [hideCutter, setHideCutter] = useState(false);
  const [message, setMessage] = useState("");
  const cutters = project.nodes.filter((node): node is DeepReadonly<MeshNode> => node.kind === "mesh" && node.id !== target.id);
  const selectedCutter = cutters.find(node => node.id === cutterId);
  const targetReason = booleanOperandReason(target) || reason;
  const cutterReason = selectedCutter ? booleanOperandReason(selectedCutter) : null;
  const canHide = selectedCutter && selectedCutter.visible && !selectedCutter.locked && !accessReason(project, selectedCutter);
  const available = cutters.filter(node => !booleanOperandReason(node));
  async function run(change: BooleanChange) {
    setMessage("");
    const outcome = await applyBooleanChange(store, change);
    setMessage(outcome.ok ? "Boolean применён." : `${outcome.error.code}: ${outcome.error.message}`);
  }
  const stack = target.modifierIds.map(id => project.modifiers.find(modifier => modifier.id === id)).filter(modifier => modifier !== undefined);
  return <section aria-label="Модификаторы" className="boolean-editor">
    <h4>Булевы операции</h4>
    <p className="panel-hint">Выберите второй замкнутый mesh. Геометрия резака остаётся редактируемой; результат пересчитывается при его перемещении.</p>
    {targetReason && <p className="primitive-error" role="alert">{targetReason}</p>}
    <label>Операция<select value={operation} disabled={disabled || !!targetReason} onChange={event => setOperation(event.target.value as Operation)}>{Object.entries(operations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Режущий объект<select value={cutterId} disabled={disabled || !!targetReason} onChange={event => { setCutterId(event.target.value); setHideCutter(false); }}><option value="">Выберите mesh</option>{cutters.map(node => <option key={node.id} value={node.id} disabled={!!booleanOperandReason(node)}>{node.name}{booleanOperandReason(node) ? ` — ${booleanOperandReason(node)}` : ""}</option>)}</select></label>
    {!available.length && <p className="panel-hint">Нет подходящего резака. Добавьте куб, сферу, тор, цилиндр или конус.</p>}
    {cutterReason && <p className="primitive-error" role="alert">{cutterReason}</p>}
    <label className="boolean-check"><input type="checkbox" checked={hideCutter} disabled={disabled || !canHide} onChange={event => setHideCutter(event.target.checked)} />Скрыть резак после применения</label>
    {selectedCutter && !canHide && <p className="panel-hint">Скрытие недоступно для заблокированного или уже скрытого резака.</p>}
    <button type="button" disabled={disabled || !!targetReason || !selectedCutter || !!cutterReason} onClick={() => void run({ type: "add", targetId: target.id, cutterId, operation, hideCutter })}>Применить Boolean</button>
    <ArrayAdd store={store} targetId={target.id} disabled={disabled} reason={reason} />
    <h4>Стек модификаторов</h4>
    {!stack.length && <p className="panel-hint">Модификаторов пока нет.</p>}
    {stack.map((modifier, index) => {
      if (!modifier) return null;
      if (modifier.kind === "array") return <ArrayItem key={modifier.id} store={store} targetId={target.id} modifier={modifier} index={index} length={stack.length} disabled={disabled} reason={reason} />;
      const params = modifier.parameters;
      const linked = project.nodes.find(node => node.id === params.cutterNodeId);
      return <div className="boolean-stack-item" key={modifier.id}>
        <strong>{index + 1}. {operations[params.operation as Operation] ?? "Boolean"} · {linked?.name ?? "Резак не найден"}</strong>
        <label className="boolean-check"><input type="checkbox" checked={modifier.enabled} disabled={disabled || !!targetReason} onChange={event => void run({ type: "enable", targetId: target.id, modifierId: modifier.id, enabled: event.target.checked })} />Включён</label>
        <label>Операция<select value={String(params.operation)} disabled={disabled || !!targetReason} onChange={event => void run({ type: "update", targetId: target.id, modifierId: modifier.id, operation: event.target.value as Operation, cutterId: String(params.cutterNodeId) })}>{Object.entries(operations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Резак<select value={String(params.cutterNodeId)} disabled={disabled || !!targetReason} onChange={event => void run({ type: "update", targetId: target.id, modifierId: modifier.id, operation: params.operation as Operation, cutterId: event.target.value })}>{cutters.map(node => <option key={node.id} value={node.id} disabled={!!booleanOperandReason(node)}>{node.name}{booleanOperandReason(node) ? ` — ${booleanOperandReason(node)}` : ""}</option>)}</select></label>
        <div className="boolean-stack-actions"><button type="button" disabled={disabled || !!targetReason || index === 0} aria-label={`Поднять ${modifier.id}`} onClick={() => void run({ type: "move", targetId: target.id, modifierId: modifier.id, toIndex: index - 1 })}>↑ Выше</button><button type="button" disabled={disabled || !!targetReason || index === stack.length - 1} aria-label={`Опустить ${modifier.id}`} onClick={() => void run({ type: "move", targetId: target.id, modifierId: modifier.id, toIndex: index + 1 })}>↓ Ниже</button><button type="button" disabled={disabled || !!targetReason} onClick={() => void run({ type: "remove", targetId: target.id, modifierId: modifier.id })}>Удалить</button></div>
      </div>;
    })}
    {message && <p className={message.startsWith("Boolean применён") ? "panel-hint" : "primitive-error"} role="status">{message}</p>}
    <p className="panel-hint">CSG пересчитывает нормали. UV и группы материалов на поверхности результата не сохраняются; несколько material slots не переносятся по граням.</p>
  </section>;
}

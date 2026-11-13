import { checkedModifierChange } from "./checked-modifier-change";
import { type ProjectCommand } from "../domain/command-bus";
import { ModifierEvaluator } from "../geometry/modifiers";
import type { ArrayParameters } from "../geometry/modifiers/types";
import type { EditorStore } from "./editor-store";
import type { JobOutcome } from "./job-controller";

export type ArrayChange =
  | { type: "add"; targetId: string; parameters: ArrayParameters }
  | { type: "update"; targetId: string; modifierId: string; parameters: ArrayParameters }
  | { type: "enable"; targetId: string; modifierId: string; enabled: boolean }
  | { type: "move"; targetId: string; modifierId: string; toIndex: number }
  | { type: "remove"; targetId: string; modifierId: string };
const failure = (id: string, message: string): JobOutcome => ({ ok: false, id, status: "validation_failed", error: { code: "VALIDATION_FAILED", message } });

export async function applyArrayChange(store: EditorStore, change: ArrayChange, evaluatorFactory: () => ModifierEvaluator = () => new ModifierEvaluator()): Promise<JobOutcome> {
  const snapshot = store.getSnapshot();
  const project = snapshot.document.project;
  const target = project.nodes.find(node => node.id === change.targetId);
  const id = crypto.randomUUID();
  if (!target || target.kind !== "mesh") return failure(id, "Выберите один mesh.");
  if(change.type!=="add"){const modifier=project.modifiers.find(m=>m.id===change.modifierId);if(!modifier||modifier.nodeId!==target.id||modifier.kind!=="array")return failure(id,"Модификатор не принадлежит выбранному объекту или имеет другой тип.");}
  const commandId = crypto.randomUUID();
  let command: ProjectCommand;
  if (change.type === "add") {
    const modifierId = crypto.randomUUID();
    command = { commandId, type: "ADD_ARRAY_MODIFIER", targetIds: [target.id, modifierId], payload: { nodeId: target.id, modifierId, parameters: change.parameters } };
  } else if (change.type === "update") command = { commandId, type: "UPDATE_ARRAY_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, parameters: change.parameters } };
  else if (change.type === "enable") command = { commandId, type: "SET_MODIFIER_ENABLED", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, enabled: change.enabled } };
  else if (change.type === "move") command = { commandId, type: "MOVE_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, toIndex: change.toIndex } };
  else command = { commandId, type: "REMOVE_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId } };
  return checkedModifierChange(store,target.id,[command],"Проверка массива",evaluatorFactory);
}

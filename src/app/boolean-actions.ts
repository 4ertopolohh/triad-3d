import { createCommandBus, type ProjectCommand } from "../domain/command-bus";
import type { Project, MeshNode } from "../domain/types";
import { ModifierEvaluator } from "../geometry/modifiers";
import type { BooleanParameters } from "../geometry/modifiers/types";
import type { EditorStore, DeepReadonly } from "./editor-store";
import type { JobOutcome } from "./job-controller";

export type BooleanChange =
  | { type: "add"; targetId: string; cutterId: string; operation: BooleanParameters["operation"]; hideCutter?: boolean }
  | { type: "update"; targetId: string; modifierId: string; cutterId: string; operation: BooleanParameters["operation"] }
  | { type: "enable"; targetId: string; modifierId: string; enabled: boolean }
  | { type: "move"; targetId: string; modifierId: string; toIndex: number }
  | { type: "remove"; targetId: string; modifierId: string };

export function booleanOperandReason(node: DeepReadonly<MeshNode>): string | null {
  if (node.meshSource.kind === "asset") return "Boolean для импортированного GLB пока недоступен: нет resolver геометрии.";
  if (node.meshSource.primitive === "plane") return "Плоскость не является замкнутым объёмом.";
  return null;
}

const failure = (id: string, message: string): JobOutcome => ({ ok: false, id, status: "validation_failed", error: { code: "VALIDATION_FAILED", message } });

/** Geometry is checked on an isolated CommandBus candidate before JobController commits the same commands. */
export async function applyBooleanChange(store: EditorStore, change: BooleanChange, evaluatorFactory: () => ModifierEvaluator = () => new ModifierEvaluator()): Promise<JobOutcome> {
  const snapshot = store.getSnapshot();
  const project = snapshot.document.project;
  const target = project.nodes.find(node => node.id === change.targetId);
  const id = crypto.randomUUID();
  if (!target || target.kind !== "mesh") return failure(id, "Выберите один mesh как целевой объект.");
  if (booleanOperandReason(target)) return failure(id, booleanOperandReason(target)!);
  if (change.type === "add" || change.type === "update") {
    const cutter = project.nodes.find(node => node.id === change.cutterId);
    if (!cutter || cutter.kind !== "mesh") return failure(id, "Выберите существующий mesh-резак.");
    if (cutter.id === target.id) return failure(id, "Цель и резак должны быть разными объектами.");
    if (booleanOperandReason(cutter)) return failure(id, booleanOperandReason(cutter)!);
  }
  const commandId = () => crypto.randomUUID();
  const commands: ProjectCommand[] = [];
  if (change.type === "add") {
    const modifierId = crypto.randomUUID();
    commands.push({ commandId: commandId(), type: "ADD_BOOLEAN_MODIFIER", targetIds: [target.id, modifierId, change.cutterId], payload: { nodeId: target.id, modifierId, operation: change.operation, cutterNodeId: change.cutterId } });
    if (change.hideCutter) commands.push({ commandId: commandId(), type: "SET_NODE_FLAGS", targetIds: [change.cutterId], payload: { nodeId: change.cutterId, visible: false } });
  } else if (change.type === "update") commands.push({ commandId: commandId(), type: "UPDATE_BOOLEAN_MODIFIER", targetIds: [change.modifierId, change.cutterId], payload: { modifierId: change.modifierId, operation: change.operation, cutterNodeId: change.cutterId } });
  else if (change.type === "enable") commands.push({ commandId: commandId(), type: "SET_MODIFIER_ENABLED", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, enabled: change.enabled } });
  else if (change.type === "move") commands.push({ commandId: commandId(), type: "MOVE_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, toIndex: change.toIndex } });
  else commands.push({ commandId: commandId(), type: "REMOVE_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId } });

  let candidate: Project;
  try {
    const bus = createCommandBus(structuredClone(project) as Project);
    const prepared = bus.executeTransaction(commands, bus.getRevision(), id);
    if (!prepared.ok) return failure(id, `${prepared.code}: ${prepared.message}${prepared.issues?.[0] ? ` ${prepared.issues[0].message}` : ""}`);
    if (!prepared.changed) return failure(id, "Изменений нет.");
    candidate = prepared.project;
  } catch (error) { return failure(id, error instanceof Error ? error.message : "Не удалось проверить кандидата."); }

  const hasEnabledStage = candidate.nodes.some(node => node.id === target.id && node.modifierIds.some(modifierId => candidate.modifiers.find(item => item.id === modifierId)?.enabled));
  if (!hasEnabledStage) {
    const committed = store.executeTransaction(commands, snapshot.document.revision, id);
    return committed.ok ? { ok: true, id, status: "succeeded", committed: committed.changed } : failure(id, committed.message);
  }
  const evaluator = evaluatorFactory();
  try {
    return await store.jobs.run({
      id, name: "Проверка Boolean", cancellable: true,
      validate: input => input.revision === snapshot.document.revision && input.projectId === project.id ? null : { code: "STALE_PROJECT", message: "Проект изменился до вычисления." },
      compute: async (_input, signal) => {
        const result = await evaluator.evaluate(candidate, target.id, signal);
        return result.ok ? { ok: true as const, value: commands } : { ok: false as const, error: { code: "COMPUTE_FAILED" as const, message: `${result.error.code}: ${result.error.message}` } };
      },
      commands: value => value,
    });
  } finally { evaluator.dispose(); }
}

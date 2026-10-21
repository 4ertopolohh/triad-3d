import type { EditorStore } from "../app/editor-store";
import type { Project } from "../domain/types";
import { ModifierEvaluator } from "../geometry/modifiers";
import type { EvaluationResult } from "../geometry/modifiers/types";
import type { SceneSync } from "./scene-sync";

/** Serializes renderer-owned evaluations. A cancelled job may settle before its Worker does. */
export class ModifierPreview {
  private readonly evaluator: ModifierEvaluator;
  private generation = -1;
  private epoch: object | undefined;
  private geometryKey = "";
  private token = 0;
  private active = false;
  private closed = false;
  private pending: Promise<void> = Promise.resolve();
  constructor(private store: EditorStore, private scene: SceneSync, evaluator?: ModifierEvaluator) {
    this.evaluator = evaluator ?? new ModifierEvaluator();
  }
  sync(): void {
    if (this.closed) return;
    const state = this.store.getSnapshot();
    const epoch = this.store.getProjectEpoch();
    if (this.generation === state.derived.generation && this.epoch === epoch) return;
    const project = state.document.project;
    const geometryKey = JSON.stringify([project.nodes.map(node => [node.id, node.parentId, node.transform, node.kind === "mesh" ? node.meshSource : null, node.modifierIds]), project.modifiers, project.assets]);
    if (this.epoch === epoch && this.geometryKey === geometryKey) { this.generation = state.derived.generation; return; }
    this.geometryKey = geometryKey;
    this.generation = state.derived.generation; this.epoch = epoch;
    const token = ++this.token;
    if (this.active) this.store.jobs.cancelJob();
    this.scene.resetDerived(project, this.store.readAssetBytes, epoch);
    const modifiers = new Map(project.modifiers.map(modifier => [modifier.id, modifier]));
    const nodes = project.nodes.filter(node => node.kind === "mesh" && node.modifierIds.some(id => modifiers.get(id)?.enabled));
    this.pending = this.pending.then(async () => {
      for (const node of nodes) {
        if (!this.current(token, epoch)) return;
        if (node.kind !== "mesh") continue;
        if (node.meshSource.kind === "asset") {
          this.scene.setModifierDiagnostics(node.id, ["Модификаторы для GLB пока недоступны; показана исходная геометрия."]);
          continue;
        }
        try { await this.evaluate(project as Project, node.id, token, epoch); }
        catch (error) { if (this.current(token, epoch)) this.scene.setModifierDiagnostics(node.id, [error instanceof Error ? error.message : "Ошибка предпросмотра модификатора."]); }
      }
    });
  }
  private current(token: number, epoch: object): boolean {
    return !this.closed && token === this.token && epoch === this.store.getProjectEpoch()
      && this.generation === this.store.getSnapshot().derived.generation;
  }
  private async evaluate(project: Project, nodeId: string, token: number, epoch: object): Promise<void> {
    let result: EvaluationResult | undefined;
    let computation: Promise<EvaluationResult> | undefined;
    this.active = true;
    try {
    const outcome = await this.store.jobs.run({
      id: `modifier-preview-${token}-${nodeId}`, name: "Вычисление модификаторов", cancellable: true,
      validate: () => null,
      compute: async (_input, signal) => {
        computation = this.evaluator.evaluate(project, nodeId, signal);
        result = await computation;
        return result.ok ? { ok: true as const, value: result } : {
          ok: false as const, error: { code: "COMPUTE_FAILED" as const, message: `${result.error.code}: ${result.error.message}` },
        };
      },
    });
    // JobController releases the UI immediately on Cancel; wait for the evaluator to
    // release its single active slot before scheduling another node or generation.
    if (computation) await computation;
    if (!this.current(token, epoch)) return;
    if (outcome.ok && result?.ok) {
      const messages = result.warnings.map(warning => warning.message);
      if (result.empty) messages.push("Результат Boolean пуст; геометрия узла не отображается.");
      this.scene.setDerived(nodeId, result.mesh, result.empty, messages);
    } else if (!outcome.ok) {
      const description = result && !result.ok ? `${result.error.code}: ${result.error.message}` : `${outcome.error.code}: ${outcome.error.message}`;
      if (result && !result.ok && result.fallback && result.mesh) {
        this.scene.setDerived(nodeId, result.mesh, !!result.empty, [`Fallback последнего валидного этапа: ${description}`]);
      } else this.scene.setModifierDiagnostics(nodeId, [`${description}; показана исходная геометрия.`]);
      if (outcome.status === "cancelled") this.token++;
    }
    } finally { this.active = false; }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true; this.token++;
    if (this.active) this.store.jobs.cancelJob();
    this.evaluator.dispose();
  }
}

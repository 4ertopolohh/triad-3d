import { Matrix4, Quaternion, Vector3 } from "three";
import type { MeshNode, Modifier, Node, Project } from "../../domain/types";
import { primitiveGeometry } from "../../renderer/primitive";
import { editableMeshData } from "../mesh-edit";
import { CsgError, CsgService, fromThree, validateMesh, type MeshData } from "../csg";
import type { AssetGeometryResolver, BooleanParameters, EvaluationResult, GeometryAttributes, ModifierDiagnostic, ModifierErrorCode, ModifierWarning } from "./types";
import { ArrayError, evaluateArray, parseArrayParameters } from "./array";
import { MirrorError, evaluateMirror, parseMirrorParameters } from "./mirror";
import { DeformError, evaluateDeform, parseBendParameters, parseTwistParameters, parseTaperParameters } from "./deform";
import { BevelError, evaluateBevel, parseBevelParameters } from "./bevel";

type CsgRunner = Pick<CsgService, "run" | "cancel">;
type Stage = { mesh: MeshData; key: string; attributes: GeometryAttributes; warnings: ModifierWarning[]; applied: string[]; empty: boolean };
type Context = { project: Readonly<Project>; snapshot: string; nodes: Map<string, Node>; modifiers: Map<string, Modifier>; signal: AbortSignal | undefined; epoch: number; active: Set<string> };
const cloneMesh = (mesh: MeshData): MeshData => ({ positions: mesh.positions.slice(), indices: mesh.indices.slice() });
const cloneStage = (stage: Stage): Stage => ({ ...stage, mesh: cloneMesh(stage.mesh), attributes: { ...stage.attributes }, warnings: [...stage.warnings], applied: [...stage.applied] });
const bytes = (stage: Stage) => stage.mesh.positions.byteLength + stage.mesh.indices.byteLength;
const stable = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item) && !(item instanceof Float32Array) && !(item instanceof Uint32Array)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

class EvaluationFailure extends Error {
  constructor(readonly code: ModifierErrorCode, message: string, readonly nodeId?: string, readonly modifierId?: string) { super(message); }
}
function booleanParameters(modifier: Modifier): BooleanParameters {
  const p = modifier.parameters;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== 2 || typeof p.operation !== "string" || !["subtract", "union", "intersect"].includes(p.operation) || typeof p.cutterNodeId !== "string" || !p.cutterNodeId.trim())
    throw new EvaluationFailure("INVALID_MODIFIER", "Некорректные параметры Boolean: нужны operation и cutterNodeId.", modifier.nodeId, modifier.id);
  return { operation: p.operation as BooleanParameters["operation"], cutterNodeId: p.cutterNodeId };
}
function ordered(node: MeshNode, modifiers: Map<string, Modifier>): Modifier[] {
  const seen = new Set<string>();
  let previous = -1;
  return node.modifierIds.map((id) => {
    const modifier = modifiers.get(id);
    if (!modifier || seen.has(id) || modifier.nodeId !== node.id || !Number.isInteger(modifier.order) || modifier.order <= previous || !Number.isInteger(modifier.version) || modifier.version < 0)
      throw new EvaluationFailure("INVALID_MODIFIER", "Неверная ссылка или порядок стека модификаторов.", node.id, id);
    seen.add(id); previous = modifier.order;
    return modifier;
  });
}
function worldMatrix(node: Node, nodes: Map<string, Node>): number[] {
  const visited = new Set<string>();
  const chain: Node[] = [];
  let current: Node | undefined = node;
  while (current) {
    if (visited.has(current.id)) throw new EvaluationFailure("DEPENDENCY_CYCLE", "Цикл в иерархии узлов.", node.id);
    visited.add(current.id); chain.push(current);
    if (current.parentId === null) break;
    current = nodes.get(current.parentId);
    if (!current) throw new EvaluationFailure("INVALID_REFERENCE", "Родительский узел не найден.", node.id);
  }
  const matrix = new Matrix4();
  for (const item of chain.reverse()) {
    const t = item.transform;
    const values = [...t.position, ...t.rotationQuat, ...t.scale];
    if (values.some((n) => !Number.isFinite(n))) throw new EvaluationFailure("FILE_INVALID", "Некорректное преобразование узла.", item.id);
    matrix.multiply(new Matrix4().compose(new Vector3(...t.position), new Quaternion(...t.rotationQuat), new Vector3(...t.scale)));
  }
  return matrix.toArray();
}

/** Sequential, RAM-only evaluator. One active evaluation per instance; caller retains ownership of returned buffers. */
export class ModifierEvaluator {
  private readonly runner: CsgRunner;
  private readonly ownsRunner: boolean;
  private readonly cache = new Map<string, Stage>();
  private cacheBytes = 0;
  private busy = false;
  private disposed = false;
  private epoch = 0;
  private nextJob = 0;
  constructor(private readonly options: { assetResolver?: AssetGeometryResolver; csg?: CsgRunner; byteBudget?: number } = {}) {
    this.ownsRunner = !options.csg;
    this.runner = options.csg ?? new CsgService();
    if (options.byteBudget !== undefined && (!Number.isSafeInteger(options.byteBudget) || options.byteBudget < 0)) throw new Error("Invalid modifier cache byte budget");
  }
  get cacheSizeBytes(): number { return this.cacheBytes; }
  clearCache(): void { this.cache.clear(); this.cacheBytes = 0; this.epoch++; }
  dispose(): void { this.disposed = true; this.clearCache(); this.runner.cancel(); if (this.ownsRunner) (this.runner as CsgService).dispose(); }
  private read(key: string): Stage | undefined {
    const stage = this.cache.get(key);
    if (stage) { this.cache.delete(key); this.cache.set(key, stage); return cloneStage(stage); }
    return undefined;
  }
  private write(stage: Stage): void {
    const budget = this.options.byteBudget ?? 64 * 1024 * 1024;
    if (bytes(stage) > budget || this.cache.has(stage.key)) return;
    this.cache.set(stage.key, cloneStage(stage)); this.cacheBytes += bytes(stage);
    while (this.cacheBytes > budget) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cacheBytes -= bytes(this.cache.get(oldest)!); this.cache.delete(oldest);
    }
  }
  async evaluate(project: Readonly<Project>, nodeId: string, signal?: AbortSignal): Promise<EvaluationResult> {
    const fail = (error: ModifierDiagnostic, fallback?: Stage): EvaluationResult => ({ ok: false, error, ...(fallback ? { mesh: cloneMesh(fallback.mesh), empty: fallback.empty } : {}), warnings: fallback?.warnings ?? [], appliedModifierIds: fallback?.applied ?? [], fallback: !!fallback });
    if (this.disposed) return fail({ code: "WORKER_FAILED", message: "Evaluator освобождён." });
    if (this.busy) return fail({ code: "JOB_BUSY", message: "Вычисление уже выполняется." });
    this.busy = true;
    const epoch = this.epoch;
    const snapshot = stable(project);
    let last: Stage | undefined;
    try {
      const ctx: Context = { project, snapshot, nodes: new Map(project.nodes.map((n) => [n.id, n])), modifiers: new Map(project.modifiers.map((m) => [m.id, m])), signal, epoch, active: new Set() };
      const stage = await this.resolve(nodeId, ctx, (s) => { last = s; });
      this.check(signal, epoch);
      this.checkProject(ctx, nodeId);
      return { ok: true, mesh: cloneMesh(stage.mesh), empty: stage.empty, warnings: [...stage.warnings], appliedModifierIds: [...stage.applied], fallback: false };
    } catch (error) {
      const code: ModifierErrorCode = error instanceof EvaluationFailure || error instanceof CsgError || error instanceof ArrayError || error instanceof MirrorError || error instanceof DeformError || error instanceof BevelError ? error.code : "WORKER_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      const diagnostic: ModifierDiagnostic = { code, message, ...(error instanceof EvaluationFailure && error.nodeId ? { nodeId: error.nodeId } : { nodeId }), ...(error instanceof EvaluationFailure && error.modifierId ? { modifierId: error.modifierId } : {}) };
      return fail(diagnostic, code === "JOB_CANCELLED" || code === "STALE_PROJECT" ? undefined : last);
    } finally { this.busy = false; }
  }
  private check(signal: AbortSignal | undefined, epoch: number): void {
    if (signal?.aborted || this.disposed || epoch !== this.epoch) throw new EvaluationFailure("JOB_CANCELLED", "Вычисление отменено.");
  }
  private checkProject(ctx: Context, nodeId: string): void {
    if (stable(ctx.project) !== ctx.snapshot) throw new EvaluationFailure("STALE_PROJECT", "Проект изменился во время вычисления.", nodeId);
  }
  private async resolve(nodeId: string, ctx: Context, progress?: (stage: Stage) => void): Promise<Stage> {
    this.check(ctx.signal, ctx.epoch);
    const node = ctx.nodes.get(nodeId);
    if (!node) throw new EvaluationFailure("INVALID_REFERENCE", "Узел не найден.", nodeId);
    if (node.kind !== "mesh") throw new EvaluationFailure("INVALID_REFERENCE", "Узел не является mesh.", nodeId);
    if (ctx.active.has(nodeId)) throw new EvaluationFailure("DEPENDENCY_CYCLE", "Цикл зависимостей Boolean.", nodeId);
    ctx.active.add(nodeId);
    try {
      const modifiers = ordered(node, ctx.modifiers);
      const source = node.meshSource;
      let mesh: MeshData;
      let fingerprint: string;
      let attributes: GeometryAttributes = {};
      if (source.kind === "primitive") {
        let geometry;
        try { geometry = primitiveGeometry(source); }
        catch (error) { throw new EvaluationFailure("FILE_INVALID", error instanceof Error ? error.message : String(error), nodeId); }
        try { mesh = fromThree(geometry); attributes = { uv: geometry.hasAttribute("uv"), normals: geometry.hasAttribute("normal"), materialGroups: geometry.groups.length > 0, materialSlots: node.materialSlots.length }; }
        finally { geometry.dispose(); }
        fingerprint = stable(source);
      } else if (source.kind === "editable") {
        try { mesh = editableMeshData(source); }
        catch (error) { throw new EvaluationFailure("FILE_INVALID", error instanceof Error ? error.message : "Некорректная редактируемая сетка.", nodeId); }
        attributes = { uv: !!source.uv, normals: false, materialSlots: node.materialSlots.length };
        fingerprint = stable(source);
      } else {
        const asset = ctx.project.assets.find((a) => a.id === source.assetId);
        if (!asset || !this.options.assetResolver) throw new EvaluationFailure("ASSET_DECODE_FAILED", "Геометрия asset недоступна локально.", nodeId);
        const resolved = await this.options.assetResolver(node, ctx.project, ctx.signal);
        if (!resolved.fingerprint) throw new EvaluationFailure("ASSET_DECODE_FAILED", "Не указан fingerprint геометрии asset.", nodeId);
        this.check(ctx.signal, ctx.epoch);
        this.checkProject(ctx, nodeId);
        mesh = cloneMesh(resolved.mesh); attributes = { ...resolved.attributes, materialSlots: Math.max(resolved.attributes?.materialSlots ?? 0, node.materialSlots.length) };
        fingerprint = stable([source, asset.hash, resolved.fingerprint]);
      }
      validateMesh(mesh);
      let stage: Stage = { mesh, key: stable([ctx.project.id, node.id, fingerprint, attributes]), attributes, warnings: [], applied: [], empty: false };
      stage = this.read(stage.key) ?? stage;
      progress?.(stage);
      this.write(stage);
      for (const modifier of modifiers) {
        this.check(ctx.signal, ctx.epoch);
        if (!modifier.enabled) continue;
        if (modifier.kind === "bevel") {
          let params;
          try { params = parseBevelParameters(modifier.parameters); }
          catch (error) { throw new EvaluationFailure(error instanceof BevelError ? error.code : "INVALID_MODIFIER", error instanceof Error ? error.message : "Некорректный Bevel.", nodeId, modifier.id); }
          const key = stable([stage.key, modifier.id, modifier.kind, modifier.version, modifier.order, modifier.parameters]);
          const hit = this.read(key);
          if (hit) { stage = hit; progress?.(stage); continue; }
          let output: MeshData;
          try { output = await evaluateBevel(stage.mesh, params, ctx.signal); }
          catch (error) { throw new EvaluationFailure(error instanceof BevelError || error instanceof CsgError ? error.code : "WORKER_FAILED", error instanceof Error ? error.message : "Ошибка Bevel.", nodeId, modifier.id); }
          this.check(ctx.signal, ctx.epoch); this.checkProject(ctx, nodeId);
          const unchanged = output.positions.length === stage.mesh.positions.length && output.indices.length === stage.mesh.indices.length
            && output.positions.every((value, index) => value === stage.mesh.positions[index])
            && output.indices.every((value, index) => value === stage.mesh.indices[index]);
          const warnings = [...stage.warnings];
          if (!unchanged) {
            if (stage.attributes.uv) warnings.push({ code: "UV_DROPPED", message: "MeshData Bevel не переносит исходные UV." });
            if (stage.attributes.normals) warnings.push({ code: "NORMALS_RECOMPUTED", message: "Авторские нормали не сохраняются; отображение пересчитывает их." });
            if (stage.attributes.materialGroups || (stage.attributes.materialSlots ?? 0) > 1) warnings.push({ code: "MATERIALS_DROPPED", message: "Группы и слоты материалов не сохраняются." });
          }
          stage = { ...stage, mesh: output, key, attributes: unchanged ? stage.attributes : {}, warnings, applied: [...stage.applied, modifier.id] };
          this.write(stage); progress?.(stage);
          continue;
        }
        if (modifier.kind === "bend" || modifier.kind === "twist" || modifier.kind === "taper") {
          const key = stable([stage.key, modifier.id, modifier.kind, modifier.version, modifier.order, modifier.parameters]);
          let params;
          try {
            params = modifier.kind === "bend" ? parseBendParameters(modifier.parameters) : modifier.kind === "twist" ? parseTwistParameters(modifier.parameters) : parseTaperParameters(modifier.parameters);
          } catch (error) { throw new EvaluationFailure(error instanceof DeformError ? error.code : "INVALID_MODIFIER", error instanceof Error ? error.message : "Некорректная деформация.", nodeId, modifier.id); }
          const hit = this.read(key);
          if (hit) { stage = hit; progress?.(stage); continue; }
          let output: MeshData;
          try {
            output = modifier.kind === "bend" ? await evaluateDeform(stage.mesh, "bend", params as ReturnType<typeof parseBendParameters>, ctx.signal)
              : modifier.kind === "twist" ? await evaluateDeform(stage.mesh, "twist", params as ReturnType<typeof parseTwistParameters>, ctx.signal)
                : await evaluateDeform(stage.mesh, "taper", params as ReturnType<typeof parseTaperParameters>, ctx.signal);
          } catch (error) { throw new EvaluationFailure(error instanceof DeformError ? error.code : "WORKER_FAILED", error instanceof Error ? error.message : "Ошибка деформации.", nodeId, modifier.id); }
          this.check(ctx.signal, ctx.epoch); this.checkProject(ctx, nodeId);
          const warnings = [...stage.warnings];
          if (stage.attributes.uv) warnings.push({ code: "UV_DROPPED", message: "MeshData деформации не переносит исходные UV." });
          if (stage.attributes.normals) warnings.push({ code: "NORMALS_RECOMPUTED", message: "Авторские нормали не сохраняются; отображение пересчитывает их." });
          if (stage.attributes.materialGroups || (stage.attributes.materialSlots ?? 0) > 1) warnings.push({ code: "MATERIALS_DROPPED", message: "Группы и слоты материалов не сохраняются." });
          stage = { ...stage, mesh: output, key, attributes: {}, warnings, applied: [...stage.applied, modifier.id] };
          this.write(stage); progress?.(stage);
          continue;
        }
        if (modifier.kind === "array") {
          let params;
          try { params = parseArrayParameters(modifier.parameters); }
          catch (error) { throw new EvaluationFailure(error instanceof ArrayError ? error.code : "INVALID_MODIFIER", error instanceof Error ? error.message : "Некорректный массив.", nodeId, modifier.id); }
          const key = stable([stage.key, modifier.id, modifier.kind, modifier.version, modifier.order, modifier.parameters]);
          const hit = this.read(key);
          if (hit) { stage = hit; progress?.(stage); continue; }
          let output;
          try { output = await evaluateArray(stage.mesh, params, ctx.signal); }
          catch (error) { throw new EvaluationFailure(error instanceof ArrayError ? error.code : "WORKER_FAILED", error instanceof Error ? error.message : "Ошибка массива.", nodeId, modifier.id); }
          this.check(ctx.signal, ctx.epoch);
          this.checkProject(ctx, nodeId);
          validateMesh(output, stage.empty);
          stage = { ...stage, mesh: output, key, applied: [...stage.applied, modifier.id] };
          this.write(stage); progress?.(stage);
          continue;
        }
        if (modifier.kind === "mirror") {
          let params;
          try { params = parseMirrorParameters(modifier.parameters); }
          catch (error) { throw new EvaluationFailure(error instanceof MirrorError ? error.code : "INVALID_MODIFIER", error instanceof Error ? error.message : "Некорректный Mirror.", nodeId, modifier.id); }
          const key = stable([stage.key, modifier.id, modifier.kind, modifier.version, modifier.order, modifier.parameters]);
          const hit = this.read(key);
          if (hit) { stage = hit; progress?.(stage); continue; }
          let result;
          try { result = await evaluateMirror(stage.mesh, params, ctx.signal, { runner: this.runner, jobId: () => `modifier-${++this.nextJob}`, attributes: stage.attributes }); }
          catch (error) { throw new EvaluationFailure(error instanceof MirrorError || error instanceof CsgError ? error.code : "WORKER_FAILED", error instanceof Error ? error.message : "Ошибка Mirror.", nodeId, modifier.id); }
          this.check(ctx.signal, ctx.epoch);
          this.checkProject(ctx, nodeId);
          stage = { ...stage, mesh: result.mesh, key, attributes: {}, warnings: [...stage.warnings, ...result.warnings], applied: [...stage.applied, modifier.id] };
          this.write(stage); progress?.(stage);
          continue;
        }
        if (modifier.kind !== "boolean") throw new EvaluationFailure("UNSUPPORTED_MODIFIER", `Модификатор ${modifier.kind} пока не поддерживается.`, nodeId, modifier.id);
        const params = booleanParameters(modifier);
        if (params.cutterNodeId === node.id) throw new EvaluationFailure("DEPENDENCY_CYCLE", "Boolean не может ссылаться на свой mesh.", nodeId, modifier.id);
        const cutter = await this.resolve(params.cutterNodeId, ctx);
        const cutterNode = ctx.nodes.get(params.cutterNodeId)!;
        const targetWorld = worldMatrix(node, ctx.nodes), cutterWorld = worldMatrix(cutterNode, ctx.nodes);
        const key = stable([stage.key, modifier.id, modifier.kind, modifier.version, modifier.order, modifier.parameters, cutter.key, targetWorld, cutterWorld]);
        const hit = this.read(key);
        if (hit) { stage = hit; progress?.(stage); continue; }
        if (stage.empty || cutter.empty) throw new EvaluationFailure("GEOMETRY_DEGENERATE", "Пустая сетка не может служить входом CSG.", nodeId, modifier.id);
        const result = await this.runner.run({ jobId: `modifier-${++this.nextJob}`, operation: params.operation,
          target: { mesh: cloneMesh(stage.mesh), worldMatrix: targetWorld, attributes: stage.attributes },
          cutter: { mesh: cloneMesh(cutter.mesh), worldMatrix: cutterWorld, attributes: cutter.attributes } }, ctx.signal);
        this.check(ctx.signal, ctx.epoch);
        this.checkProject(ctx, nodeId);
        validateMesh(result.output, result.empty);
        if (result.coordinateSpace !== "target-local" || result.empty !== (result.output.indices.length === 0)) throw new EvaluationFailure("WORKER_FAILED", "Некорректный результат CSG.", nodeId, modifier.id);
        stage = { mesh: cloneMesh(result.output), key, attributes: {}, warnings: [...stage.warnings, ...cutter.warnings, ...result.warnings], applied: [...stage.applied, modifier.id], empty: result.empty };
        this.write(stage); progress?.(stage);
      }
      return stage;
    } finally { ctx.active.delete(nodeId); }
  }
}

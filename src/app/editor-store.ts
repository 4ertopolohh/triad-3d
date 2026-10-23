import { createCommandBus } from "../domain/command-bus";
import { CommandErrorCode } from "../domain/command-bus";
import type { CommandResult, ProjectCommand, ProjectPatch } from "../domain/command-bus";
import type { EntityId, Project } from "../domain/types";
import { AssetBytes } from "../assets/asset-bytes";
import { ARCHIVE_LIMITS, type LoadedProject } from "../assets/native-project-archive";
import { createJobController, isJobActive, type JobController, type JobState } from "./job-controller";
import { MAX_VISIBLE_VERTICES, normalizeVertexIndices } from "../geometry/vertex-selection";
import { buildMeshTopology, MAX_TOPOLOGY_TRIANGLES, selectedTopologyVertices } from "../geometry/mesh-topology";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface EditorState {
  readonly document: { readonly project: DeepReadonly<Project>; readonly revision: number; readonly dirty: boolean };
  readonly selection: { readonly ids: readonly EntityId[]; readonly activeId: EntityId | null };
  readonly meshEdit: { readonly mode: "object" | "vertex" | "edge" | "face"; readonly nodeId: EntityId | null; readonly vertexIndices: readonly number[]; readonly edgeIds: readonly string[]; readonly faceIds: readonly number[] };
  readonly tool: { readonly mode: "model" | "scene"; readonly active: "select" | "move" | "rotate" | "scale" | "displace"; readonly space: "local" | "world" };
  readonly view: { readonly leftTab: "structure" | "assets"; readonly timelineExpanded: boolean };
  readonly job: JobState;
  readonly history: { readonly entries: readonly HistoryEntry[]; readonly cursor: number; readonly canUndo: boolean; readonly canRedo: boolean };
  readonly derived: { readonly generation: number; readonly documentRevision: number; readonly scope: "all" };
}

export interface HistoryEntry {
  readonly id: string;
  readonly revision: number;
  readonly patch: DeepReadonly<ProjectPatch>;
  readonly undoPatch: DeepReadonly<ProjectPatch>;
  readonly groupId?: string;
}

export interface EditorStore {
  readonly jobs: JobController;
  getSnapshot(): EditorState;
  subscribe(listener: () => void): () => void;
  executeCommand(command: ProjectCommand, expectedRevision: number, groupId?: string): CommandResult;
  executeTransaction(commands: ProjectCommand[], expectedRevision: number, transactionId?: string, groupId?: string): CommandResult;
  undo(expectedRevision: number): CommandResult;
  redo(expectedRevision: number): CommandResult;
  cancelGesture(groupId: string, expectedRevision: number): CommandResult;
  addMeshAsset(command: Extract<ProjectCommand, { type: "ADD_MESH_ASSET" }>, bytes: Uint8Array, expectedRevision: number, expectedIdentity: object): CommandResult;
  addAsset(command: Extract<ProjectCommand, { type: "ADD_ASSET" }>, bytes: Uint8Array, expectedRevision: number, expectedIdentity: object, signal?: AbortSignal): Promise<CommandResult>;
  setSelection(ids: readonly EntityId[], activeId?: EntityId | null): void;
  enterVertexMode(expectedRevision: number, expectedEpoch: object): string | null;
  exitVertexMode(): void;
  setVertexSelection(indices: readonly number[], expectedRevision: number, expectedEpoch: object): boolean;
  enterMeshEditMode(mode: "vertex" | "edge" | "face", expectedRevision: number, expectedEpoch: object): string | null;
  exitMeshEditMode(): void;
  setSubElementSelection(ids: readonly string[] | readonly number[], expectedRevision: number, expectedEpoch: object): boolean;
  selectedMeshVertices(): number[] | null;
  setTool(next: Partial<EditorState["tool"]>): void;
  setView(next: Partial<EditorState["view"]>): void;
  getAssetBytes(): AssetBytes;
  readAssetBytes(id: string): Uint8Array | undefined;
  getProjectEpoch(): object;
  captureDocument(): { project: Project; assets: AssetBytes; revision: number; identity: object };
  captureImportContext(): { revision: number; identity: object };
  confirmSaved(revision: number, identity: object): boolean;
  replaceProject(loaded: LoadedProject, identity: object): boolean;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function createEditorStore(initialProject: Project): EditorStore {
  let bus = createCommandBus(initialProject);
  let assetBytes = new AssetBytes();
  let identity: object = {};
  let projectEpoch: object = {};
  let savedPosition: object | null = {};
  let positions: object[] = [savedPosition];
  const listeners = new Set<() => void>();
  let state: EditorState = Object.freeze({
    document: Object.freeze({ project: deepFreeze(bus.getSnapshot()), revision: bus.getRevision(), dirty: false }),
    selection: Object.freeze({ ids: Object.freeze([]) as readonly EntityId[], activeId: null }),
    meshEdit: Object.freeze({ mode: "object" as const, nodeId: null, vertexIndices: Object.freeze([]) as readonly number[], edgeIds: Object.freeze([]) as readonly string[], faceIds: Object.freeze([]) as readonly number[] }),
    tool: Object.freeze({ mode: "model" as const, active: "select" as const, space: "world" as const }),
    view: Object.freeze({ leftTab: "structure" as const, timelineExpanded: true }),
    job: Object.freeze({ id: null, name: null, status: "idle", progress: null, cancellable: false, error: null }),
    history: Object.freeze({ entries: Object.freeze([]) as readonly HistoryEntry[], cursor: 0, canUndo: false, canRedo: false }),
    derived: Object.freeze({ generation: 0, documentRevision: bus.getRevision(), scope: "all" as const }),
  });

  function publish(next: EditorState): void {
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) { try { listener(); } catch (error) { console.error("EditorStore subscriber failed", error); } }
    }
  }

  function historyState(entries: readonly HistoryEntry[], cursor: number): EditorState["history"] {
    return Object.freeze({ entries: Object.freeze(entries), cursor, canUndo: cursor > 0, canRedo: cursor < entries.length });
  }

  function pruneAssets(project: Project, entries: readonly HistoryEntry[]): void {
    const needed = new Set(project.assets.map((asset) => asset.id));
    for (const entry of entries) for (const change of entry.patch.changes) {
      if (change.kind === "addAsset" || change.kind === "removeAsset") needed.add(change.asset.id);
    }
    for (const id of assetBytes.ids()) if (!needed.has(id)) assetBytes.delete(id);
  }

  const emptyMeshEdit = (): EditorState["meshEdit"] => Object.freeze({ mode: "object", nodeId: null, vertexIndices: Object.freeze([]), edgeIds: Object.freeze([]), faceIds: Object.freeze([]) });
  const subEdit = (mode: "vertex" | "edge" | "face", nodeId: string, vertexIndices: readonly number[] = [], edgeIds: readonly string[] = [], faceIds: readonly number[] = []): EditorState["meshEdit"] =>
    Object.freeze({ mode, nodeId, vertexIndices: Object.freeze([...vertexIndices]), edgeIds: Object.freeze([...edgeIds]), faceIds: Object.freeze([...faceIds]) });
  function canEditVertex(project: DeepReadonly<Project>, nodeId: string | null): boolean {
    if (!nodeId || state.tool.mode !== "model" || state.selection.ids.length !== 1 || state.selection.activeId !== nodeId || jobActive()) return false;
    let node = project.nodes.find(item => item.id === nodeId);
    if (node?.kind !== "mesh" || node.meshSource.kind !== "editable" || node.meshSource.positions.length / 3 > MAX_VISIBLE_VERTICES
      || node.modifierIds.some(id => project.modifiers.find(item => item.id === id)?.enabled)
      || project.modifiers.some(item => item.enabled && item.kind === "boolean" && item.parameters.cutterNodeId === nodeId)) return false;
    while (node) {
      if (!node.visible || node.locked) return false;
      node = node.parentId ? project.nodes.find(item => item.id === node!.parentId) : undefined;
    }
    return true;
  }
  function reconcileMeshEdit(project: Project, patch?: ProjectPatch): EditorState["meshEdit"] {
    const old = state.meshEdit;
    if (old.mode === "object" || !canEditVertex(project, old.nodeId)) return emptyMeshEdit();
    const node = project.nodes.find(item => item.id === old.nodeId)!;
    if (node.kind !== "mesh" || node.meshSource.kind !== "editable") return emptyMeshEdit();
    const changed = patch?.changes.some(change => change.kind === "setMeshSource" && change.nodeId === old.nodeId);
    if (changed) {
      const change = patch!.changes.find(item => item.kind === "setMeshSource" && item.nodeId === old.nodeId);
      if (change?.kind !== "setMeshSource" || change.before.kind !== "editable" || change.after.kind !== "editable") return emptyMeshEdit();
      if (JSON.stringify(change.before.indices) !== JSON.stringify(change.after.indices)
        || JSON.stringify(change.before.uv) !== JSON.stringify(change.after.uv)) return subEdit(old.mode, old.nodeId!);
      // Edge and face IDs describe the old geometric embedding; re-pick after a geometry edit.
      if (old.mode !== "vertex") return subEdit(old.mode, old.nodeId!);
    }
    if (old.mode === "vertex") {
      const indices = normalizeVertexIndices(node.meshSource, old.vertexIndices);
      return indices ? subEdit("vertex", old.nodeId!, indices) : emptyMeshEdit();
    }
    const topology = buildMeshTopology(node.meshSource);
    if (!topology) return emptyMeshEdit();
    const available = new Set<string | number>(old.mode === "edge" ? topology.edges.map(edge => edge.id) : topology.faces.map(face => face.id));
    const ids = old.mode === "edge" ? old.edgeIds.filter(id => available.has(id)) : old.faceIds.filter(id => available.has(id));
    return old.mode === "edge" ? subEdit("edge", old.nodeId!, [], ids as string[]) : subEdit("face", old.nodeId!, [], [], ids as number[]);
  }

  function commit(result: CommandResult, groupId?: string): CommandResult {
    if (!result.ok || !result.changed) return result;
    identity = {};
    const cursor = state.history.cursor;
    const entries = state.history.entries.slice(0, cursor);
    positions = positions.slice(0, cursor + 1);
    const previous = entries.at(-1);
    const combine = !!groupId && previous?.groupId === groupId && cursor === state.history.entries.length
      && positions[cursor] !== savedPosition;
    const entry: HistoryEntry = Object.freeze({
      id: result.id,
      revision: result.revision,
      patch: deepFreeze(structuredClone(combine ? { changes: [...previous.patch.changes, ...result.patch.changes] } : result.patch)),
      undoPatch: deepFreeze(structuredClone(combine ? { changes: [...result.undoPatch.changes, ...previous.undoPatch.changes] } : result.undoPatch)),
      ...(groupId ? { groupId } : {}),
    });
    if (combine) entries[entries.length - 1] = entry;
    else entries.push(entry);
    if (combine) positions[cursor] = {};
    else positions.push({});
    const nextCursor = entries.length;
    pruneAssets(result.project, entries);
    const validIds = new Set(result.project.nodes.map(node => node.id));
    const selectedIds = state.selection.ids.filter(id => validIds.has(id));
    publish({
      ...state,
      document: Object.freeze({ project: deepFreeze(structuredClone(result.project)), revision: result.revision, dirty: true }),
      selection: Object.freeze({ ids: Object.freeze(selectedIds), activeId: state.selection.activeId && selectedIds.includes(state.selection.activeId) ? state.selection.activeId : selectedIds[0] ?? null }),
      meshEdit: reconcileMeshEdit(result.project, result.patch),
      history: historyState(entries, nextCursor),
      derived: Object.freeze({ generation: state.derived.generation + 1, documentRevision: result.revision, scope: "all" }),
    });
    return result;
  }

  function travel(direction: -1 | 1, expectedRevision: number): CommandResult {
    if (jobActive()) return busy("history");
    if (expectedRevision !== state.document.revision)
      return { ok: false, id: "history", code: CommandErrorCode.REVISION_CONFLICT, message: "Ревизия документа изменилась." };
    const cursor = state.history.cursor;
    const entry = state.history.entries[direction === -1 ? cursor - 1 : cursor];
    if (!entry) return { ok: false, id: "history", code: CommandErrorCode.INVALID_COMMAND, message: "Шаг истории недоступен." };
    const result = bus.applyHistoryPatch(structuredClone(direction === -1 ? entry.undoPatch : entry.patch) as ProjectPatch, expectedRevision);
    if (!result.ok) return result;
    identity = {};
    const nextCursor = cursor + direction;
    const validIds = new Set(result.project.nodes.map((node) => node.id));
    const ids = state.selection.ids.filter((id) => validIds.has(id));
    publish({ ...state,
      document: Object.freeze({ project: deepFreeze(result.project), revision: result.revision, dirty: positions[nextCursor] !== savedPosition }),
      selection: Object.freeze({ ids: Object.freeze(ids), activeId: state.selection.activeId && ids.includes(state.selection.activeId) ? state.selection.activeId : null }),
      meshEdit: reconcileMeshEdit(result.project, direction === -1 ? entry.undoPatch as ProjectPatch : entry.patch as ProjectPatch),
      history: historyState(state.history.entries, nextCursor),
      derived: Object.freeze({ generation: state.derived.generation + 1, documentRevision: result.revision, scope: "all" }),
    });
    return result;
  }

  const jobActive = () => isJobActive(state.job.status);
  const busy = (id: string): CommandResult => ({ ok: false, id, code: CommandErrorCode.JOB_BUSY, message: "Редактирование заблокировано до завершения операции." });
  const jobs = createJobController({
    capture: () => Object.freeze({ project: deepFreeze(structuredClone(state.document.project) as Project), revision: state.document.revision,
      projectId: state.document.project.id, identity, epoch: projectEpoch }),
    isCurrent: (context) => identity === context.identity && projectEpoch === context.epoch
      && state.document.revision === context.revision && state.document.project.id === context.projectId,
    publish: (job) => publish({ ...state, job }),
    commit: (commands, revision, id) => {
      if (state.job.id !== id || state.job.status !== "applying") return busy(id);
      return commit(bus.executeTransaction(commands, revision, id));
    },
  });

  return {
    jobs,
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    executeCommand: (command, expectedRevision, groupId) => jobActive() ? busy(command.commandId) : commit(bus.executeCommand(command, expectedRevision), groupId),
    executeTransaction: (commands, expectedRevision, transactionId, groupId) =>
      jobActive() ? busy(transactionId ?? commands[0]?.commandId ?? "transaction") : commit(bus.executeTransaction(commands, expectedRevision, transactionId), groupId),
    undo: (expectedRevision) => travel(-1, expectedRevision),
    redo: (expectedRevision) => travel(1, expectedRevision),
    cancelGesture(groupId, expectedRevision) {
      if (jobActive()) return busy(groupId);
      const cursor = state.history.cursor;
      const entry = state.history.entries[cursor - 1];
      if (expectedRevision !== state.document.revision || cursor !== state.history.entries.length || !entry || entry.groupId !== groupId || positions[cursor] === savedPosition)
        return { ok: false, id: groupId, code: CommandErrorCode.REVISION_CONFLICT, message: "Жест изменился и не может быть отменён." };
      const result = bus.applyHistoryPatch(structuredClone(entry.undoPatch) as ProjectPatch, expectedRevision);
      if (!result.ok) return result;
      identity = {};
      const entries = state.history.entries.slice(0, -1);
      positions = positions.slice(0, -1);
      publish({ ...state,
        document: Object.freeze({ project: deepFreeze(result.project), revision: result.revision, dirty: positions[cursor - 1] !== savedPosition }),
        history: historyState(entries, cursor - 1),
        meshEdit: reconcileMeshEdit(result.project, entry.undoPatch as ProjectPatch),
        derived: Object.freeze({ generation: state.derived.generation + 1, documentRevision: result.revision, scope: "all" }),
      });
      return result;
    },
    addMeshAsset(command, bytes, expectedRevision, expectedIdentity) {
      if (jobActive()) return busy(command.commandId);
      if (identity !== expectedIdentity || state.document.revision !== expectedRevision)
        return { ok: false, id: command.commandId, code: CommandErrorCode.REVISION_CONFLICT, message: "Проект изменился во время подготовки импорта." };
      if (command.payload.asset && (bytes.byteLength === 0 || state.document.project.assets.some((asset) => asset.id === command.payload.asset?.id)))
        return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_COMMAND, message: "Байты ресурса отсутствуют или ID уже занят." };
      if (!command.payload.asset && (command.payload.node.meshSource.kind !== "asset" || !assetBytes.ids().includes(command.payload.node.meshSource.assetId)))
        return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_REFERENCE, message: "Байты повторно используемого ресурса отсутствуют." };
      try {
        const nextAssets = assetBytes.fork();
        if (command.payload.asset) nextAssets.set(command.payload.asset.id, bytes);
        const result = bus.executeCommand(command, expectedRevision);
        if (!result.ok) return result;
        assetBytes = nextAssets;
        return commit(result);
      } catch {
        return { ok: false, id: command.commandId, code: CommandErrorCode.INTERNAL_ERROR, message: "Не удалось добавить ресурс в проект." };
      }
    },
    async addAsset(command, bytes, expectedRevision, expectedIdentity, signal) {
      if (signal?.aborted) return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_COMMAND, message: "Импорт отменён." };
      if (jobActive()) return busy(command.commandId);
      if (identity !== expectedIdentity || state.document.revision !== expectedRevision)
        return { ok: false, id: command.commandId, code: CommandErrorCode.REVISION_CONFLICT, message: "Проект изменился во время подготовки импорта." };
      const asset = command.payload.asset;
      if (!bytes.byteLength || bytes.byteLength > ARCHIVE_LIMITS.asset)
        return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_COMMAND, message: "Ресурс пуст или превышает лимит 64 МиБ." };
      try {
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map(n => n.toString(16).padStart(2, "0")).join("");
        if (hash !== asset.hash) return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_COMMAND, message: "SHA-256 ресурса не совпадает с байтами." };
      } catch { return { ok: false, id: command.commandId, code: CommandErrorCode.INTERNAL_ERROR, message: "Не удалось проверить SHA-256 ресурса." }; }
      if (signal?.aborted) return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_COMMAND, message: "Импорт отменён." };
      if (jobActive()) return busy(command.commandId);
      if (identity !== expectedIdentity || state.document.revision !== expectedRevision)
        return { ok: false, id: command.commandId, code: CommandErrorCode.REVISION_CONFLICT, message: "Проект изменился во время подготовки импорта." };
      const duplicate = state.document.project.assets.find(item => item.hash === asset.hash && item.mediaType === asset.mediaType);
      if (duplicate) {
        const existing = assetBytes.get(duplicate.id);
        if (existing && existing.byteLength === bytes.byteLength && existing.every((value, index) => value === bytes[index]))
          return { ok: true, id: command.commandId, project: structuredClone(state.document.project) as Project, revision: expectedRevision,
            patch: { changes: [] }, undoPatch: { changes: [] }, changed: false };
      }
      if (state.document.project.assets.some(item => item.id === asset.id))
        return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_COMMAND, message: "ID ресурса уже занят." };
      try {
        const nextAssets = assetBytes.fork();
        nextAssets.set(asset.id, bytes);
        const result = bus.executeCommand(command, expectedRevision);
        if (!result.ok) return result;
        assetBytes = nextAssets;
        return commit(result);
      } catch {
        return { ok: false, id: command.commandId, code: CommandErrorCode.INTERNAL_ERROR, message: "Не удалось добавить ресурс в проект." };
      }
    },
    getAssetBytes: () => assetBytes.clone(),
    readAssetBytes: (id) => assetBytes.get(id),
    getProjectEpoch: () => projectEpoch,
    captureDocument: () => ({ project: structuredClone(state.document.project) as Project, assets: assetBytes.clone(), revision: state.document.revision, identity }),
    captureImportContext: () => ({ revision: state.document.revision, identity }),
    confirmSaved(revision, expectedIdentity) {
      if (jobActive()) return false;
      if (identity !== expectedIdentity || state.document.revision !== revision) return false;
      savedPosition = positions[state.history.cursor] ?? null;
      if (state.document.dirty) publish({ ...state, document: Object.freeze({ ...state.document, dirty: false }) });
      return true;
    },
    replaceProject(loaded, expectedIdentity) {
      if (jobActive()) return false;
      if (identity !== expectedIdentity) return false;
      const nextBus = createCommandBus(loaded.project);
      const nextAssets = loaded.assets.clone();
      bus = nextBus;
      assetBytes.clear();
      assetBytes = nextAssets;
      identity = {};
      projectEpoch = {};
      savedPosition = {};
      positions = [savedPosition];
      publish({
        ...state,
        document: Object.freeze({ project: deepFreeze(bus.getSnapshot()), revision: bus.getRevision(), dirty: false }),
        selection: Object.freeze({ ids: Object.freeze([]) as readonly EntityId[], activeId: null }),
        meshEdit: emptyMeshEdit(),
        history: historyState([], 0),
        derived: Object.freeze({ generation: state.derived.generation + 1, documentRevision: bus.getRevision(), scope: "all" }),
      });
      return true;
    },
    setSelection(ids, activeId) {
      if (jobActive()) return;
      const valid = new Set(state.document.project.nodes.map((node) => node.id));
      const selected = [...new Set(ids.filter((id) => valid.has(id)))];
      const active = activeId === undefined ? (selected[0] ?? null) :
        activeId !== null && selected.includes(activeId) ? activeId : null;
      if (active === state.selection.activeId && selected.length === state.selection.ids.length
        && selected.every((id, index) => id === state.selection.ids[index])) return;
      publish({ ...state, selection: Object.freeze({ ids: Object.freeze(selected), activeId: active }),
        meshEdit: state.meshEdit.mode !== "object" && (selected.length !== 1 || active !== state.meshEdit.nodeId) ? emptyMeshEdit() : state.meshEdit });
    },
    enterVertexMode(expectedRevision, expectedEpoch) { return this.enterMeshEditMode("vertex", expectedRevision, expectedEpoch); },
    enterMeshEditMode(mode, expectedRevision, expectedEpoch) {
      if (expectedRevision !== state.document.revision || expectedEpoch !== projectEpoch) return "Проект изменился. Повторите действие.";
      const id = state.selection.activeId;
      const node = state.document.project.nodes.find(item => item.id === id);
      if (node?.kind === "mesh" && node.meshSource.kind === "editable" && node.meshSource.positions.length / 3 > MAX_VISIBLE_VERTICES)
        return `Сетка содержит более ${MAX_VISIBLE_VERTICES} render vertices; отображение маркеров недоступно.`;
      if (!canEditVertex(state.document.project, id)) return "Выберите один видимый и разблокированный Editable Mesh в режиме «Модель».";
      if (mode !== "vertex" && node?.kind === "mesh" && node.meshSource.kind === "editable" && !buildMeshTopology(node.meshSource))
        return `Не удалось построить топологию сетки. Предел: ${MAX_TOPOLOGY_TRIANGLES} треугольников.`;
      publish({ ...state, meshEdit: subEdit(mode, id!) });
      return null;
    },
    exitVertexMode() { this.exitMeshEditMode(); },
    exitMeshEditMode() { if (state.meshEdit.mode !== "object") publish({ ...state, meshEdit: emptyMeshEdit() }); },
    setVertexSelection(indices, expectedRevision, expectedEpoch) {
      if (expectedRevision !== state.document.revision || expectedEpoch !== projectEpoch || !canEditVertex(state.document.project, state.meshEdit.nodeId)) return false;
      const node = state.document.project.nodes.find(item => item.id === state.meshEdit.nodeId);
      if (node?.kind !== "mesh" || node.meshSource.kind !== "editable" || state.meshEdit.mode !== "vertex") return false;
      const normalized = normalizeVertexIndices(node.meshSource, indices);
      if (!normalized) return false;
      if (normalized.length === state.meshEdit.vertexIndices.length && normalized.every((id, i) => id === state.meshEdit.vertexIndices[i])) return true;
      publish({ ...state, meshEdit: subEdit("vertex", node.id, normalized) });
      return true;
    },
    setSubElementSelection(ids, expectedRevision, expectedEpoch) {
      if (expectedRevision !== state.document.revision || expectedEpoch !== projectEpoch || !canEditVertex(state.document.project, state.meshEdit.nodeId)) return false;
      const mode = state.meshEdit.mode;
      const node = state.document.project.nodes.find(item => item.id === state.meshEdit.nodeId);
      if ((mode !== "edge" && mode !== "face") || node?.kind !== "mesh" || node.meshSource.kind !== "editable") return false;
      const topology = buildMeshTopology(node.meshSource);
      if (!topology || !selectedTopologyVertices(topology, mode, ids)) return false;
      if (mode === "edge") {
        const normalized = [...new Set(ids as readonly string[])].sort();
        publish({ ...state, meshEdit: subEdit(mode, node.id, [], normalized) });
      } else {
        const normalized = [...new Set(ids as readonly number[])].sort((a, b) => a - b);
        publish({ ...state, meshEdit: subEdit(mode, node.id, [], [], normalized) });
      }
      return true;
    },
    selectedMeshVertices() {
      const selection = state.meshEdit;
      const node = state.document.project.nodes.find(item => item.id === selection.nodeId);
      if (!canEditVertex(state.document.project, selection.nodeId) || node?.kind !== "mesh" || node.meshSource.kind !== "editable") return null;
      if (selection.mode === "vertex") return [...selection.vertexIndices];
      if (selection.mode === "object") return null;
      const topology = buildMeshTopology(node.meshSource);
      return topology ? selectedTopologyVertices(topology, selection.mode, selection.mode === "edge" ? selection.edgeIds : selection.faceIds) : null;
    },
    setTool(next) {
      if (jobActive()) return;
      const tool = { ...state.tool, ...next };
      if (tool.mode === state.tool.mode && tool.active === state.tool.active && tool.space === state.tool.space) return;
      publish({ ...state, tool: Object.freeze(tool), meshEdit: tool.mode === "model" ? state.meshEdit : emptyMeshEdit() });
    },
    setView(next) {
      const view = { ...state.view, ...next };
      if (view.leftTab === state.view.leftTab && view.timelineExpanded === state.view.timelineExpanded) return;
      publish({ ...state, view: Object.freeze(view) });
    },
  };
}

export const selectProject = (state: EditorState) => state.document.project;
export const selectRevision = (state: EditorState) => state.document.revision;
export const selectDirty = (state: EditorState) => state.document.dirty;
export const selectSelectedIds = (state: EditorState) => state.selection.ids;
export const selectActiveId = (state: EditorState) => state.selection.activeId;
export const selectTool = (state: EditorState) => state.tool;
export const selectJob = (state: EditorState) => state.job;
export const selectDerived = (state: EditorState) => state.derived;
export const selectCanUndo = (state: EditorState) => state.history.canUndo;
export const selectCanRedo = (state: EditorState) => state.history.canRedo;

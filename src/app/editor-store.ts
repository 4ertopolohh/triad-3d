import { createCommandBus } from "../domain/command-bus";
import { CommandErrorCode } from "../domain/command-bus";
import type { CommandResult, ProjectCommand, ProjectPatch } from "../domain/command-bus";
import type { EntityId, Project } from "../domain/types";
import { AssetBytes } from "../assets/asset-bytes";
import type { LoadedProject } from "../assets/native-project-archive";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface EditorState {
  readonly document: { readonly project: DeepReadonly<Project>; readonly revision: number; readonly dirty: boolean };
  readonly selection: { readonly ids: readonly EntityId[]; readonly activeId: EntityId | null };
  readonly tool: { readonly mode: "model" | "scene"; readonly active: "select" | "move" | "rotate" | "scale"; readonly space: "local" | "world" };
  readonly view: { readonly leftTab: "structure" | "assets"; readonly timelineExpanded: boolean };
  readonly job: { readonly status: "idle" | "validating" | "running" | "applying" | "succeeded" | "failed" | "cancelled" };
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
  getSnapshot(): EditorState;
  subscribe(listener: () => void): () => void;
  executeCommand(command: ProjectCommand, expectedRevision: number, groupId?: string): CommandResult;
  executeTransaction(commands: ProjectCommand[], expectedRevision: number, transactionId?: string, groupId?: string): CommandResult;
  undo(expectedRevision: number): CommandResult;
  redo(expectedRevision: number): CommandResult;
  addMeshAsset(command: Extract<ProjectCommand, { type: "ADD_MESH_ASSET" }>, bytes: Uint8Array, expectedRevision: number, expectedIdentity: object): CommandResult;
  setSelection(ids: readonly EntityId[], activeId?: EntityId | null): void;
  setTool(next: Partial<EditorState["tool"]>): void;
  setView(next: Partial<EditorState["view"]>): void;
  getAssetBytes(): AssetBytes;
  captureDocument(): { project: Project; assets: AssetBytes; revision: number; identity: object };
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
  let savedPosition: object | null = {};
  let positions: object[] = [savedPosition];
  const listeners = new Set<() => void>();
  let state: EditorState = Object.freeze({
    document: Object.freeze({ project: deepFreeze(bus.getSnapshot()), revision: bus.getRevision(), dirty: false }),
    selection: Object.freeze({ ids: Object.freeze([]) as readonly EntityId[], activeId: null }),
    tool: Object.freeze({ mode: "model" as const, active: "select" as const, space: "world" as const }),
    view: Object.freeze({ leftTab: "structure" as const, timelineExpanded: true }),
    job: Object.freeze({ status: "idle" as const }),
    history: Object.freeze({ entries: Object.freeze([]) as readonly HistoryEntry[], cursor: 0, canUndo: false, canRedo: false }),
    derived: Object.freeze({ generation: 0, documentRevision: bus.getRevision(), scope: "all" as const }),
  });

  function publish(next: EditorState): void {
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
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
    publish({
      ...state,
      document: Object.freeze({ project: deepFreeze(structuredClone(result.project)), revision: result.revision, dirty: true }),
      history: historyState(entries, nextCursor),
      derived: Object.freeze({ generation: state.derived.generation + 1, documentRevision: result.revision, scope: "all" }),
    });
    return result;
  }

  function travel(direction: -1 | 1, expectedRevision: number): CommandResult {
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
      history: historyState(state.history.entries, nextCursor),
      derived: Object.freeze({ generation: state.derived.generation + 1, documentRevision: result.revision, scope: "all" }),
    });
    return result;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    executeCommand: (command, expectedRevision, groupId) => commit(bus.executeCommand(command, expectedRevision), groupId),
    executeTransaction: (commands, expectedRevision, transactionId, groupId) =>
      commit(bus.executeTransaction(commands, expectedRevision, transactionId), groupId),
    undo: (expectedRevision) => travel(-1, expectedRevision),
    redo: (expectedRevision) => travel(1, expectedRevision),
    addMeshAsset(command, bytes, expectedRevision, expectedIdentity) {
      if (identity !== expectedIdentity || state.document.revision !== expectedRevision)
        return { ok: false, id: command.commandId, code: CommandErrorCode.REVISION_CONFLICT, message: "Проект изменился во время подготовки импорта." };
      if (command.payload.asset && (bytes.byteLength === 0 || state.document.project.assets.some((asset) => asset.id === command.payload.asset?.id)))
        return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_COMMAND, message: "Байты ресурса отсутствуют или ID уже занят." };
      if (!command.payload.asset && (command.payload.node.meshSource.kind !== "asset" || !assetBytes.ids().includes(command.payload.node.meshSource.assetId)))
        return { ok: false, id: command.commandId, code: CommandErrorCode.INVALID_REFERENCE, message: "Байты повторно используемого ресурса отсутствуют." };
      try {
        const nextAssets = assetBytes.clone();
        if (command.payload.asset) nextAssets.set(command.payload.asset.id, bytes);
        const result = bus.executeCommand(command, expectedRevision);
        if (!result.ok) return result;
        assetBytes = nextAssets;
        return commit(result);
      } catch {
        return { ok: false, id: command.commandId, code: CommandErrorCode.INTERNAL_ERROR, message: "Не удалось добавить ресурс в проект." };
      }
    },
    getAssetBytes: () => assetBytes.clone(),
    captureDocument: () => ({ project: structuredClone(state.document.project) as Project, assets: assetBytes.clone(), revision: state.document.revision, identity }),
    confirmSaved(revision, expectedIdentity) {
      if (identity !== expectedIdentity || state.document.revision !== revision) return false;
      savedPosition = positions[state.history.cursor] ?? null;
      if (state.document.dirty) publish({ ...state, document: Object.freeze({ ...state.document, dirty: false }) });
      return true;
    },
    replaceProject(loaded, expectedIdentity) {
      if (identity !== expectedIdentity) return false;
      const nextBus = createCommandBus(loaded.project);
      const nextAssets = loaded.assets.clone();
      bus = nextBus;
      assetBytes.clear();
      assetBytes = nextAssets;
      identity = {};
      savedPosition = {};
      positions = [savedPosition];
      publish({
        ...state,
        document: Object.freeze({ project: deepFreeze(bus.getSnapshot()), revision: bus.getRevision(), dirty: false }),
        selection: Object.freeze({ ids: Object.freeze([]) as readonly EntityId[], activeId: null }),
        history: historyState([], 0),
        derived: Object.freeze({ generation: state.derived.generation + 1, documentRevision: bus.getRevision(), scope: "all" }),
      });
      return true;
    },
    setSelection(ids, activeId) {
      const valid = new Set(state.document.project.nodes.map((node) => node.id));
      const selected = [...new Set(ids.filter((id) => valid.has(id)))];
      const active = activeId === undefined ? (selected[0] ?? null) :
        activeId !== null && selected.includes(activeId) ? activeId : null;
      if (active === state.selection.activeId && selected.length === state.selection.ids.length
        && selected.every((id, index) => id === state.selection.ids[index])) return;
      publish({ ...state, selection: Object.freeze({ ids: Object.freeze(selected), activeId: active }) });
    },
    setTool(next) {
      const tool = { ...state.tool, ...next };
      if (tool.mode === state.tool.mode && tool.active === state.tool.active && tool.space === state.tool.space) return;
      publish({ ...state, tool: Object.freeze(tool) });
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

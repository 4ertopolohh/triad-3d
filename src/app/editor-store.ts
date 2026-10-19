import { createCommandBus } from "../domain/command-bus";
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
  readonly history: { readonly entries: readonly HistoryEntry[] };
  readonly derived: { readonly generation: number; readonly documentRevision: number; readonly scope: "all" };
}

export interface HistoryEntry {
  readonly id: string;
  readonly revision: number;
  readonly patch: DeepReadonly<ProjectPatch>;
  readonly undoPatch: DeepReadonly<ProjectPatch>;
}

export interface EditorStore {
  getSnapshot(): EditorState;
  subscribe(listener: () => void): () => void;
  executeCommand(command: ProjectCommand, expectedRevision: number): CommandResult;
  executeTransaction(commands: ProjectCommand[], expectedRevision: number, transactionId?: string): CommandResult;
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
  const listeners = new Set<() => void>();
  let state: EditorState = Object.freeze({
    document: Object.freeze({ project: deepFreeze(bus.getSnapshot()), revision: bus.getRevision(), dirty: false }),
    selection: Object.freeze({ ids: Object.freeze([]) as readonly EntityId[], activeId: null }),
    tool: Object.freeze({ mode: "model" as const, active: "select" as const, space: "world" as const }),
    view: Object.freeze({ leftTab: "structure" as const, timelineExpanded: true }),
    job: Object.freeze({ status: "idle" as const }),
    history: Object.freeze({ entries: Object.freeze([]) as readonly HistoryEntry[] }),
    derived: Object.freeze({ generation: 0, documentRevision: bus.getRevision(), scope: "all" as const }),
  });

  function publish(next: EditorState): void {
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
    }
  }

  function commit(result: CommandResult): CommandResult {
    if (!result.ok || !result.changed) return result;
    identity = {};
    const entry: HistoryEntry = Object.freeze({
      id: result.id,
      revision: result.revision,
      patch: deepFreeze(structuredClone(result.patch)),
      undoPatch: deepFreeze(structuredClone(result.undoPatch)),
    });
    publish({
      ...state,
      document: Object.freeze({ project: deepFreeze(structuredClone(result.project)), revision: result.revision, dirty: true }),
      history: Object.freeze({ entries: Object.freeze([...state.history.entries, entry]) }),
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
    executeCommand: (command, expectedRevision) => commit(bus.executeCommand(command, expectedRevision)),
    executeTransaction: (commands, expectedRevision, transactionId) =>
      commit(bus.executeTransaction(commands, expectedRevision, transactionId)),
    getAssetBytes: () => assetBytes.clone(),
    captureDocument: () => ({ project: structuredClone(state.document.project) as Project, assets: assetBytes.clone(), revision: state.document.revision, identity }),
    confirmSaved(revision, expectedIdentity) {
      if (identity !== expectedIdentity || state.document.revision !== revision) return false;
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
      publish({
        ...state,
        document: Object.freeze({ project: deepFreeze(bus.getSnapshot()), revision: bus.getRevision(), dirty: false }),
        selection: Object.freeze({ ids: Object.freeze([]) as readonly EntityId[], activeId: null }),
        history: Object.freeze({ entries: Object.freeze([]) as readonly HistoryEntry[] }),
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

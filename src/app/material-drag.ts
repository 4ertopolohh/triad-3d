import type { EditorStore } from "./editor-store";
import { materialPresets, type MaterialPreset } from "../materials/presets";
import { isJobActive } from "./job-controller";

export const MATERIAL_PRESET_MIME = "application/x-triad3d-material-preset";
type DragSession = { store: EditorStore; presetId: string; revision: number; epoch: object };
let session: DragSession | null = null;

export function beginMaterialDrag(store: EditorStore, presetId: string): boolean {
  if (!materialPresets.some(item => item.id === presetId)) return false;
  const state = store.getSnapshot();
  if (state.tool.mode !== "model" || isJobActive(state.job.status)) return false;
  session = { store, presetId, revision: state.document.revision, epoch: store.getProjectEpoch() };
  return true;
}

export function endMaterialDrag(): void { session = null; }

export function materialDragActive(store: EditorStore, types: readonly string[]): boolean {
  return session?.store === store && session.revision === store.getSnapshot().document.revision
    && session.epoch === store.getProjectEpoch() && types.includes(MATERIAL_PRESET_MIME);
}

export function resolveMaterialDrop(store: EditorStore, types: readonly string[], payload: string): { preset: MaterialPreset; revision: number; epoch: object } | null {
  const current = session;
  if (!current || current.store !== store || !types.includes(MATERIAL_PRESET_MIME) || current.presetId !== payload) return null;
  const preset = materialPresets.find(item => item.id === payload);
  return preset ? { preset, revision: current.revision, epoch: current.epoch } : null;
}

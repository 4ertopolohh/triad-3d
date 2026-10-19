import { useSyncExternalStore } from "react";
import type { EditorState, EditorStore } from "./editor-store";

export function useEditorStore(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

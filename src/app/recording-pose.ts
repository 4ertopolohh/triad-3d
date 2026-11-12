import { evaluateClip } from "../animation/timeline";
import type { EditorState, EditorStore } from "./editor-store";

/** Inspector world transforms must include the evaluated local pose of every ancestor. */
export function recordingPose(store: EditorStore, state = store.getSnapshot()): EditorState {
  const recording = store.getAnimationRecording();
  if (!recording || !state.document.project.animations.some(c => c.id === recording.clipId)) return state;
  const pose = evaluateClip(state.document.project,recording.clipId,recording.time,false);
  return { ...state,document:{...state.document,project:{...state.document.project,nodes:state.document.project.nodes.map(node => ({...node,transform:pose.get(node.id) ?? node.transform}))}} };
}

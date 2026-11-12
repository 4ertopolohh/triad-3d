import type { Project, Transform, TrackProperty } from "../domain/types";
import { timelineOf } from "./timeline";
import type { ProjectCommand } from "../domain/command-bus";

/** Converts approved transform edits into keys without changing authored transforms. */
export function recordTransforms(project: Project, clipId: string, time: number, edits: { nodeId: string; transform: Transform }[]): ProjectCommand {
  const timeline = structuredClone(timelineOf(project));
  const clip = timeline.animations.find(c => c.id === clipId);
  if (!clip || !Number.isFinite(time) || time < 0 || time > clip.durationSeconds) throw new Error("Время записи находится вне клипа.");
  const solo = timeline.tracks.some(t => clip.trackIds.includes(t.id) && t.solo && !t.muted);
  for (const edit of edits) for (const field of ["position","rotationQuat","scale"] as const) {
    const property: TrackProperty = `transform.${field}`;
    let track = timeline.tracks.find(t => clip.trackIds.includes(t.id) && t.nodeId === edit.nodeId && t.property === property);
    if (track?.muted || solo && !track?.solo) continue;
    if (!track) { track = { id: crypto.randomUUID(),nodeId: edit.nodeId,property,keyframeIds: [] }; timeline.tracks.push(track); clip.trackIds.push(track.id); }
    const value = structuredClone(edit.transform[field]);
    const existing = timeline.keyframes.find(k => track!.keyframeIds.includes(k.id) && Math.abs(k.timeSeconds-time) < 1e-6);
    if (existing) existing.value = value;
    else { const key = { id: crypto.randomUUID(),timeSeconds:time,value,interpolation:"linear" as const }; timeline.keyframes.push(key); track.keyframeIds.push(key.id); }
  }
  return { commandId: crypto.randomUUID(),type:"SET_TIMELINE",targetIds:[project.id],payload:{projectId:project.id,timeline} };
}

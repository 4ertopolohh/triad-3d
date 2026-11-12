import { Quaternion as ThreeQuaternion } from "three";
import type { Project, Transform } from "../domain/types";
import type { DeepReadonly } from "../app/editor-store";

export type Timeline = Pick<Project, "animations" | "tracks" | "keyframes">;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(id) && new Set(v).size === v.length;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fields = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));

/** Also checks unknown command payloads before they can enter the document. */
export function timelineError(value: unknown): string | null {
  if (!object(value) || !fields(value, ["animations", "tracks", "keyframes"]) || !Array.isArray(value.animations) || !Array.isArray(value.tracks) || !Array.isArray(value.keyframes)) return "Некорректная структура таймлайна.";
  const seen = new Set<string>();
  for (const entity of [...value.animations, ...value.tracks, ...value.keyframes]) {
    if (!object(entity) || !id(entity.id) || seen.has(entity.id)) return "ID анимации отсутствует или повторяется.";
    seen.add(entity.id);
  }
  for (const clip of value.animations) if (!fields(clip, ["id", "name", "durationSeconds", "loop", "trackIds", "fps", "loopStartSeconds", "loopEndSeconds"]) || !id(clip.name) || !finite(clip.durationSeconds) || clip.durationSeconds <= 0 || clip.durationSeconds > 86400 || typeof clip.loop !== "boolean" || !ids(clip.trackIds)) return "Некорректные параметры клипа.";
  for (const track of value.tracks) if (!fields(track, ["id", "nodeId", "property", "keyframeIds", "muted", "solo", "pivot"]) || !id(track.nodeId) || !["transform.position", "transform.scale", "transform.rotationQuat"].includes(track.property) || !ids(track.keyframeIds)) return "Некорректная дорожка.";
  for (const clip of value.animations) {
    if (clip.fps !== undefined && (!Number.isInteger(clip.fps) || clip.fps < 1 || clip.fps > 240)) return "FPS должен быть от 1 до 240.";
    const start = clip.loopStartSeconds ?? 0, end = clip.loopEndSeconds ?? clip.durationSeconds;
    if (!finite(start) || !finite(end) || start < 0 || end > clip.durationSeconds || end <= start) return "Некорректный диапазон цикла.";
  }
  for (const track of value.tracks) if (track.muted !== undefined && typeof track.muted !== "boolean" || track.solo !== undefined && typeof track.solo !== "boolean") return "Некорректное состояние дорожки.";
  for (const track of value.tracks) if (track.pivot !== undefined && (!Array.isArray(track.pivot) || track.pivot.length !== 3 || !track.pivot.every(finite))) return "Некорректный центр вращения дорожки.";
  for (const key of value.keyframes) {
    if (!fields(key, ["id", "timeSeconds", "value", "interpolation", "easing"]) || !finite(key.timeSeconds) || key.timeSeconds < 0 || !Array.isArray(key.value) || ![3, 4].includes(key.value.length) || !key.value.every(finite) || !["step", "linear", "bezier"].includes(key.interpolation)) return "Некорректный ключ анимации.";
    if (key.easing !== undefined && (!Array.isArray(key.easing) || key.easing.length !== 4 || !key.easing.every(finite) || key.easing[0] < 0 || key.easing[0] > 1 || key.easing[2] < 0 || key.easing[2] > 1 || Math.abs(key.easing[1]) > 10 || Math.abs(key.easing[3]) > 10)) return "Некорректные контрольные точки Bezier.";
  }
  const timeline = value as unknown as Timeline;
  const tracks = new Map(timeline.tracks.map(t => [t.id, t]));
  const keys = new Map(timeline.keyframes.map(k => [k.id, k]));
  for (const track of timeline.tracks) {
    const times = new Set<number>();
    for (const keyId of track.keyframeIds) {
      const key = keys.get(keyId);
      if (!key || times.has(key.timeSeconds) || !Array.isArray(key.value) || key.value.length !== (track.property === "transform.rotationQuat" ? 4 : 3)) return "Ключи дорожки несовместимы или повторяют время.";
      times.add(key.timeSeconds);
      if (track.property === "transform.rotationQuat" && Math.abs(Math.hypot(...key.value) - 1) > 1e-5) return "Кватернион ключа должен быть нормализован.";
      if (track.property === "transform.scale" && key.value.some(v => v <= 0)) return "Масштаб ключа должен быть положительным.";
      if (track.property === "transform.scale" && key.easing && (key.easing[1] < 0 || key.easing[1] > 1 || key.easing[3] < 0 || key.easing[3] > 1)) return "Кривая масштаба не должна выходить за диапазон ключей.";
    }
  }
  for (const clip of timeline.animations) {
    const channels = new Set<string>();
    for (const trackId of clip.trackIds) {
      const track = tracks.get(trackId);
      if (!track) return "Дорожка клипа не найдена.";
      const channel = `${track.nodeId}:${track.property}`;
      if (channels.has(channel)) return "Клип содержит несколько дорожек одного канала.";
      channels.add(channel);
      if (track.keyframeIds.some(k => keys.get(k)!.timeSeconds > clip.durationSeconds)) return "Ключ находится за пределами клипа.";
    }
  }
  return null;
}

/** CSS-style cubic easing: invert x before evaluating y. */
export function cubicEasing(t: number, curve: readonly number[] = [.42, 0, .58, 1]): number {
  if (t <= 0 || t >= 1) return Math.min(1, Math.max(0, t));
  const coordinate = (u: number, a: number, b: number) => 3 * (1-u) ** 2 * u * a + 3 * (1-u) * u*u * b + u ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 48; i++) { const mid = (lo+hi)/2; if (coordinate(mid, curve[0]!, curve[2]!) < t) lo = mid; else hi = mid; }
  return coordinate((lo+hi)/2, curve[1]!, curve[3]!);
}

/** Absolute evaluation; never integrates a previous pose or mutates Project. */
export function evaluateClip(project: DeepReadonly<Project>, clipId: string, seconds: number, wrap = true): Map<string, Transform> {
  if (!Number.isFinite(seconds)) throw new Error("Время должно быть конечным.");
  const clip = project.animations.find(c => c.id === clipId);
  if (!clip) throw new Error("Клип не найден.");
  const start = clip.loopStartSeconds ?? 0, end = clip.loopEndSeconds ?? clip.durationSeconds;
  const time = clip.loop && wrap ? start + ((seconds-start) % (end-start) + end-start) % (end-start) : Math.max(0, Math.min(clip.durationSeconds, seconds));
  const solo = project.tracks.some(t => clip.trackIds.includes(t.id) && t.solo && !t.muted);
  const pose = new Map<string, Transform>();
  const keys = new Map(project.keyframes.map(k => [k.id, k]));
  for (const trackId of clip.trackIds) {
    const track = project.tracks.find(t => t.id === trackId)!;
    if (track.muted || solo && !track.solo) continue;
    const node = project.nodes.find(n => n.id === track.nodeId)!;
    const sorted = track.keyframeIds.map(k => keys.get(k)!).sort((a,b) => a.timeSeconds-b.timeSeconds);
    if (!sorted.length) continue;
    const right = sorted.findIndex(k => k.timeSeconds > time);
    const a = sorted[right < 0 ? sorted.length-1 : Math.max(0,right-1)]!;
    const b = sorted[right < 0 ? sorted.length-1 : right]!;
    let alpha = a === b || a.interpolation === "step" ? 0 : (time-a.timeSeconds)/(b.timeSeconds-a.timeSeconds);
    alpha = Math.max(0, Math.min(1, alpha));
    if (a.interpolation === "bezier") alpha = cubicEasing(alpha, a.easing);
    const transform: Transform = pose.get(node.id) ?? structuredClone(node.transform);
    const av = a.value as readonly number[], bv = b.value as readonly number[];
    if (track.property === "transform.rotationQuat") {
      const q = new ThreeQuaternion().fromArray(av).slerp(new ThreeQuaternion().fromArray(bv), alpha).normalize();
      transform.rotationQuat = [q.x, q.y, q.z, q.w];
    } else {
      const v = av.map((n,i) => n*(1-alpha)+bv[i]!*alpha) as [number, number, number];
      if (track.property === "transform.position") transform.position = v;
      else transform.scale = v;
    }
    pose.set(node.id, transform);
  }
  return pose;
}

export function timelineOf(project: Project): Timeline {
  return { animations: project.animations, tracks: project.tracks, keyframes: project.keyframes };
}

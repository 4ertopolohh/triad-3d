import { Quaternion, Vector3 } from "three";
import type { Project, Track, TrackProperty, KeyframeValue } from "../domain/types";
import { evaluateClip, type Timeline } from "./timeline";

export type AnimationPreset = "spin" | "orbit" | "move" | "reveal" | "oscillate" | "bounce";
export interface PresetOptions { amount?: number; axis?: "x" | "y" | "z"; pivot?: [number,number,number] }
/** Pivot is expressed in the node's parent coordinates; generated keys remain ordinary TRS. */
export function addPreset(timeline: Timeline, project: Project, clipId: string, nodeId: string, kind: AnimationPreset, options: number | PresetOptions = 1, nextId = () => crypto.randomUUID()): void {
  const clip = timeline.animations.find(c => c.id === clipId);
  const node = project.nodes.find(n => n.id === nodeId);
  const config = typeof options === "number" ? {amount:options} : options;
  const amount = config.amount ?? 1, axis = config.axis ?? "y";
  if (!clip || !node || !Number.isFinite(amount) || !["x","y","z"].includes(axis) || !["spin","orbit","move","reveal","oscillate","bounce"].includes(kind)
    || config.pivot && (config.pivot.length !== 3 || !config.pivot.every(Number.isFinite))) throw new Error("Некорректный пресет анимации.");
  const direction = new Vector3(axis === "x" ? 1 : 0,axis === "y" ? 1 : 0,axis === "z" ? 1 : 0);
  const position = new Vector3(...node.transform.position);
  const property: TrackProperty = kind === "spin" ? "transform.rotationQuat" : kind === "reveal" ? "transform.scale" : "transform.position";
  const properties: TrackProperty[] = [property];
  if (kind === "spin" && config.pivot) properties.push("transform.position");
  if (timeline.tracks.some(t => clip.trackIds.includes(t.id) && t.nodeId === nodeId && properties.includes(t.property)))
    throw new Error("Канал уже содержит дорожку. Удалите её перед применением пресета.");
  const segments = kind === "orbit" || kind === "oscillate" || kind === "bounce" ? 64 : kind === "spin" ? Math.max(64,Math.ceil(Math.abs(amount)*64)) : 1;
  if (segments > 4096) throw new Error("Слишком много оборотов.");
  const tracks: Track[] = properties.map(property => ({id:nextId(),nodeId,property,keyframeIds:[] as string[]}));
  const keys: Timeline["keyframes"] = [];
  // Orbit without a custom center starts at the authored position with the requested radius.
  const radial = axis === "x" ? new Vector3(0,amount,0) : new Vector3(amount,0,0);
  const pivot = config.pivot ? new Vector3(...config.pivot) : position.clone().sub(radial);
  if (kind === "orbit" || kind === "spin" && config.pivot) tracks.forEach(track => {track.pivot = pivot.toArray() as [number,number,number];});
  for (let i = 0; i <= segments; i++) {
    const t = i/segments;
    const rotation = new Quaternion().setFromAxisAngle(direction,t*Math.PI*2*(kind === "spin" ? amount : 1));
    for (const track of tracks) {
      let value: KeyframeValue;
      if (track.property === "transform.rotationQuat") {
        // Custom pivot rotates in parent coordinates; ordinary spin rotates around the local axis.
        const original = new Quaternion().fromArray(node.transform.rotationQuat);
        const q = config.pivot ? rotation.clone().multiply(original) : original.multiply(rotation);
        value = q.toArray() as [number,number,number,number];
      } else if (kind === "orbit" || kind === "spin") {
        value = position.clone().sub(pivot).applyQuaternion(rotation).add(pivot).toArray() as [number,number,number];
      } else if (kind === "move" || kind === "oscillate" || kind === "bounce") {
        let phase = t;
        if (kind === "oscillate") phase = Math.sin(t*Math.PI*2);
        if (kind === "bounce") { const n=7.5625,d=2.75; if (t<1/d) phase=n*t*t; else if (t<2/d) phase=n*(t-1.5/d)**2+.75; else if (t<2.5/d) phase=n*(t-2.25/d)**2+.9375; else phase=n*(t-2.625/d)**2+.984375; }
        value = position.clone().addScaledVector(direction,amount*phase).toArray() as [number,number,number];
      } else value = node.transform.scale.map(v => v*(.0001+.9999*t)) as [number,number,number];
      const key = {id:nextId(),timeSeconds:t*clip.durationSeconds,value,interpolation:"linear" as const};
      keys.push(key); track.keyframeIds.push(key.id);
    }
  }
  timeline.keyframes.push(...keys); timeline.tracks.push(...tracks); clip.trackIds.push(...tracks.map(t => t.id));
}

export interface LoopDifference { nodeId: string; position: number; rotationRadians: number; scale: number; velocity: number; angularVelocity: number; scaleVelocity: number }
export function analyzeLoop(project: Project, clipId: string): LoopDifference[] {
  const clip = project.animations.find(c => c.id === clipId);
  if (!clip) throw new Error("Клип не найден.");
  const begin = clip.loopStartSeconds ?? 0, finish = clip.loopEndSeconds ?? clip.durationSeconds;
  const dt = Math.min(.001, (finish-begin)/1000);
  const start = evaluateClip(project, clipId, begin, false), end = evaluateClip(project, clipId, finish, false);
  const next = evaluateClip(project, clipId, begin+dt, false), previous = evaluateClip(project, clipId, finish-dt, false);
  const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v,i) => v-b[i]!));
  const angular = (a: readonly number[], b: readonly number[]) => {
    const q = new Quaternion().fromArray(a).invert().multiply(new Quaternion().fromArray(b)).normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const length = Math.hypot(q.x, q.y, q.z);
    const factor = length < 1e-12 ? 2/dt : 2*Math.atan2(length,q.w)/length/dt;
    return [q.x*factor,q.y*factor,q.z*factor];
  };
  return [...start].map(([nodeId,a]) => {
    const b = end.get(nodeId)!;
    const startVelocity = next.get(nodeId)!.position.map((v,i) => (v-a.position[i]!)/dt);
    const endVelocity = b.position.map((v,i) => (v-previous.get(nodeId)!.position[i]!)/dt);
    const scaleStart = next.get(nodeId)!.scale.map((v,i) => (v-a.scale[i]!)/dt);
    const scaleEnd = b.scale.map((v,i) => (v-previous.get(nodeId)!.scale[i]!)/dt);
    return { nodeId, position: distance(a.position,b.position), rotationRadians: new Quaternion().fromArray(a.rotationQuat).angleTo(new Quaternion().fromArray(b.rotationQuat)), scale: distance(a.scale,b.scale), velocity: distance(startVelocity,endVelocity), angularVelocity: distance(angular(a.rotationQuat,next.get(nodeId)!.rotationQuat),angular(previous.get(nodeId)!.rotationQuat,b.rotationQuat)), scaleVelocity: distance(scaleStart,scaleEnd) };
  });
}

/** Explicitly replaces end values and eases endpoint tangents to rest. */
export function alignLoop(project: Project, clipId: string): Timeline {
  const clip = project.animations.find(c => c.id === clipId);
  if (!clip) throw new Error("Клип не найден.");
  const start = clip.loopStartSeconds ?? 0, end = clip.loopEndSeconds ?? clip.durationSeconds;
  const pose = evaluateClip(project,clipId,start,false);
  const timeline = structuredClone({animations:project.animations,tracks:project.tracks,keyframes:project.keyframes});
  const solo = timeline.tracks.some(t => clip.trackIds.includes(t.id) && t.solo && !t.muted);
  for (const track of timeline.tracks.filter(t => clip.trackIds.includes(t.id))) {
    if (track.muted || solo && !track.solo) continue;
    const transform = pose.get(track.nodeId); if (!transform) continue;
    const value = transform[track.property.slice(10) as keyof typeof transform];
    for (const time of [start,end]) {
      let key = timeline.keyframes.find(k => track.keyframeIds.includes(k.id) && Math.abs(k.timeSeconds-time) < 1e-8);
      if (!key) { key = {id:crypto.randomUUID(),timeSeconds:time,value:structuredClone(value),interpolation:"bezier"}; timeline.keyframes.push(key); track.keyframeIds.push(key.id); }
      key.value = structuredClone(value);
      if (time === start) { key.interpolation = "bezier"; key.easing = [.42,0,.58,1]; }
    }
    const previous = timeline.keyframes.filter(k => track.keyframeIds.includes(k.id) && k.timeSeconds < end).sort((a,b) => b.timeSeconds-a.timeSeconds)[0];
    if (previous) { previous.interpolation = "bezier"; previous.easing = [.42,0,.58,1]; }
  }
  return timeline;
}

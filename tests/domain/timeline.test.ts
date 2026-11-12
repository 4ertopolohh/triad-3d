import { expect, it } from "vitest";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { cubicEasing, evaluateClip, timelineError, timelineOf } from "../../src/animation/timeline";
import { createEditorStore } from "../../src/app/editor-store";
import { addPreset, analyzeLoop, alignLoop } from "../../src/animation/presets";
import { recordingPose } from "../../src/app/recording-pose";
import { prepareTransformCommands } from "../../src/ui/inspector-logic";

it("records successive inspector axes from the evaluated pose and preserves rotation", () => {
  const project = createMaterialAnimationProject();
  const node = project.nodes.find(n => n.id === "mesh-node")!;
  node.transform = {...node.transform,rotationQuat:[0,1,0,0]};
  const store = createEditorStore(project);
  store.setSelection(["mesh-node"]);
  store.setAnimationRecording({clipId:"clip-1",time:1});
  for (const [axis,value] of [[0,3],[1,4]] as const) {
    const commands = prepareTransformCommands(recordingPose(store),{field:"position",axis,value});
    expect(commands.ok).toBe(true);
    if (commands.ok) expect(store.executeTransaction(commands.value,store.getSnapshot().document.revision).ok).toBe(true);
  }
  const result = evaluateClip(store.getSnapshot().document.project,"clip-1",1,false).get("mesh-node")!;
  expect(result.position).toEqual([3,4,0]);
  expect(result.rotationQuat).toEqual([0,1,0,0]);
  expect(store.getSnapshot().document.project.nodes.find(n => n.id === "mesh-node")!.transform.position).toEqual([0,0,0]);
});

it("does not rewrite muted tracks when aligning loop endpoints", () => {
  const project = createMaterialAnimationProject();
  project.tracks[0]!.muted = true;
  const aligned = alignLoop(project,"clip-1");
  expect(aligned).toEqual(timelineOf(project));
});

it("evaluates absolute time, clamps endpoints, wraps negative time and never changes source", () => {
  const project = createMaterialAnimationProject();
  const original = structuredClone(project);
  expect(evaluateClip(project, "clip-1", 1).get("mesh-node")!.position).toEqual([0, .5, 0]);
  expect(evaluateClip(project, "clip-1", 20).get("mesh-node")!.position).toEqual([0, 1, 0]);
  expect(evaluateClip(project, "clip-1", -20).get("mesh-node")!.position).toEqual([0, 0, 0]);
  expect(project).toEqual(original);
  project.animations[0]!.loop = true;
  expect(evaluateClip(project, "clip-1", -1)).toEqual(evaluateClip(project, "clip-1", 1));
  expect(evaluateClip(project, "clip-1", 2).get("mesh-node")!.position).toEqual([0, 0, 0]);
  expect(evaluateClip(project, "clip-1", 2, false).get("mesh-node")!.position).toEqual([0, 1, 0]);
});

it("inverts Bezier x, respects step boundaries and quaternion shortest arc", () => {
  expect(cubicEasing(.25, [0, 0, 1, 1])).toBeCloseTo(.25, 10);
  expect(cubicEasing(.25)).toBeLessThan(.25);
  const project = createMaterialAnimationProject();
  project.keyframes[0]!.interpolation = "step";
  expect(evaluateClip(project, "clip-1", 1).get("mesh-node")!.position).toEqual([0, 0, 0]);
  expect(evaluateClip(project, "clip-1", 2).get("mesh-node")!.position).toEqual([0, 1, 0]);
  project.tracks[0]!.property = "transform.rotationQuat";
  project.keyframes[0]!.value = [0,0,0,1]; project.keyframes[0]!.interpolation = "linear";
  project.keyframes[1]!.value = [0,0,0,-1];
  expect(evaluateClip(project, "clip-1", 1).get("mesh-node")!.rotationQuat).toEqual([0,0,0,1]);
});

it("commits timeline atomically with undo/redo and rejects duplicate times", () => {
  const project = createMaterialAnimationProject();
  const store = createEditorStore(project);
  const timeline = structuredClone(timelineOf(project));
  timeline.keyframes[1]!.timeSeconds = 0;
  expect(timelineError(timeline)).not.toBeNull();
  const command = { commandId: "timeline-edit", type: "SET_TIMELINE" as const, targetIds: [project.id] as [string], payload: { projectId: project.id, timeline } };
  const before = store.getSnapshot();
  expect(store.executeCommand(command, 0).ok).toBe(false);
  expect(store.getSnapshot()).toBe(before);
  timeline.keyframes[1]!.timeSeconds = 1;
  expect(store.executeCommand(command, 0).ok).toBe(true);
  expect(store.undo(1).ok).toBe(true);
  expect(store.captureDocument().project.keyframes[1]!.timeSeconds).toBe(2);
  expect(store.redo(2).ok).toBe(true);
  expect(store.captureDocument().project.keyframes[1]!.timeSeconds).toBe(1);
});

it("edits unrelated channels in a clip with a locked object but protects its keys", () => {
  const project = createMaterialAnimationProject();
  project.nodes.find(n => n.id === "mesh-node")!.locked = true;
  const store = createEditorStore(project);
  const timeline = structuredClone(timelineOf(project));
  timeline.tracks.push({ id: "other-track",nodeId: "nested-group",property: "transform.position",keyframeIds: [] });
  timeline.animations[0]!.trackIds.push("other-track");
  const command = { commandId: "other",type: "SET_TIMELINE" as const,targetIds: [project.id] as [string],payload: { projectId: project.id,timeline } };
  expect(store.executeCommand(command,0).ok).toBe(true);
  timeline.keyframes[0]!.value = [1,0,0];
  expect(store.executeCommand(command,1).ok).toBe(false);
});

it("rejects scale overshoot and measures angular velocity at the loop boundary", () => {
  const project = createMaterialAnimationProject();
  project.tracks = []; project.keyframes = []; project.animations[0]!.trackIds = [];
  addPreset(project,project,"clip-1","mesh-node","spin");
  expect(analyzeLoop(project,"clip-1")[0]!.rotationRadians).toBeCloseTo(0,6);
  expect(analyzeLoop(project,"clip-1")[0]!.angularVelocity).toBeLessThan(1e-6);
  project.keyframes[0]!.interpolation = "step";
  expect(analyzeLoop(project,"clip-1")[0]!.angularVelocity).toBeGreaterThan(1);
  const scale = createMaterialAnimationProject(); scale.tracks[0]!.property = "transform.scale";
  scale.keyframes[0]!.value = [1,1,1]; scale.keyframes[1]!.value = [2,2,2];
  scale.keyframes[0]!.easing = [0,-10,1,-10];
  expect(timelineError(timelineOf(scale))).not.toBeNull();
});

it("records two transform edits as keys without altering the base pose, then replaces a same-time key", () => {
  const project = createMaterialAnimationProject();
  project.tracks = []; project.keyframes = []; project.animations[0]!.trackIds = [];
  const store = createEditorStore(project);
  const transform = structuredClone(project.nodes.find(n => n.id === "mesh-node")!.transform);
  const write = (x: number) => store.executeCommand({ commandId: crypto.randomUUID(),type:"SET_NODE_TRANSFORM",targetIds:["mesh-node"],payload:{nodeId:"mesh-node",transform:{...transform,position:[x,0,0]}} },store.getSnapshot().document.revision);
  store.setAnimationRecording({clipId:"clip-1",time:0}); expect(write(1).ok).toBe(true);
  store.setAnimationRecording({clipId:"clip-1",time:2}); expect(write(3).ok).toBe(true);
  expect(write(5).ok).toBe(true);
  const result = store.captureDocument().project;
  expect(result.nodes.find(n => n.id === "mesh-node")!.transform).toEqual(transform);
  expect(result.keyframes).toHaveLength(6);
  expect(evaluateClip(result,"clip-1",1).get("mesh-node")!.position).toEqual([3,0,0]);
  expect(store.undo(store.getSnapshot().document.revision).ok).toBe(true);
  expect(evaluateClip(store.captureDocument().project,"clip-1",1).get("mesh-node")!.position).toEqual([2,0,0]);
  store.setAnimationRecording(null); expect(write(8).ok).toBe(true);
  expect(store.getSnapshot().document.project.nodes.find(n => n.id === "mesh-node")!.transform.position).toEqual([8,0,0]);
});


it("generates coupled pivot rotation tracks and preserves their circular endpoints", () => {
  const project = createMaterialAnimationProject();
  project.tracks = []; project.keyframes = []; project.animations[0]!.trackIds = [];
  const node = project.nodes.find(n => n.id === "mesh-node")!;
  node.transform = {...node.transform,position:[2,0,0]};
  addPreset(project,project,"clip-1","mesh-node","spin",{amount:1,axis:"z",pivot:[1,0,0]});
  expect(timelineError(timelineOf(project))).toBeNull();
  const quarter = evaluateClip(project,"clip-1",.5,false).get("mesh-node")!;
  expect(quarter.position[0]).toBeCloseTo(1); expect(quarter.position[1]).toBeCloseTo(1);
  expect(quarter.rotationQuat[2]).toBeCloseTo(Math.SQRT1_2);
  const end = evaluateClip(project,"clip-1",2,false).get("mesh-node")!;
  expect(end.position[0]).toBeCloseTo(2); expect(end.position[1]).toBeCloseTo(0);
  const original = structuredClone(project);
  expect(() => addPreset(project,project,"clip-1","mesh-node","spin",{pivot:[0,0,0]})).toThrow();
  expect(project).toEqual(original);
});


it("preserves muted rotation keys during transform recording", () => {
  const project = createMaterialAnimationProject();
  project.tracks[0]!.property = "transform.rotationQuat"; project.tracks[0]!.muted = true;
  project.keyframes[0]!.value = [0,1,0,0]; project.keyframes[1]!.value = [0,1,0,0];
  const store = createEditorStore(project); store.setSelection(["mesh-node"]);
  store.setAnimationRecording({clipId:"clip-1",time:0});
  const commands = prepareTransformCommands(recordingPose(store),{field:"position",axis:0,value:2});
  if (!commands.ok) throw new Error(commands.message);
  expect(store.executeTransaction(commands.value,0).ok).toBe(true);
  expect(store.getSnapshot().document.project.keyframes.find(k => k.id === "key-1")!.value).toEqual([0,1,0,0]);
});

it("does not interpret orbit radius as a turn count", () => {
  const project = createMaterialAnimationProject(); project.tracks=[]; project.keyframes=[]; project.animations[0]!.trackIds=[];
  addPreset(project,project,"clip-1","mesh-node","orbit",100);
  expect(project.keyframes).toHaveLength(65);
});


it("keeps pivot metadata separate from base pose and generates oscillation/bounce as keys", () => {
  for (const kind of ["oscillate","bounce"] as const) {
    const project = createMaterialAnimationProject();project.tracks=[];project.keyframes=[];project.animations[0]!.trackIds=[];
    const original = structuredClone(project.nodes);
    addPreset(project,project,"clip-1","mesh-node",kind,{axis:"x",amount:2});
    expect(timelineError(timelineOf(project))).toBeNull();expect(project.nodes).toEqual(original);
    const end = evaluateClip(project,"clip-1",2,false).get("mesh-node")!;
    expect(end.position[0]).toBeCloseTo(kind === "oscillate" ? 0 : 2);
    if (kind === "oscillate") expect(evaluateClip(project,"clip-1",.5,false).get("mesh-node")!.position[0]).toBeCloseTo(2);
  }
  const project = createMaterialAnimationProject();project.tracks=[];project.keyframes=[];project.animations[0]!.trackIds=[];
  addPreset(project,project,"clip-1","mesh-node","spin",{pivot:[2,3,4]});
  expect(project.tracks.every(track => JSON.stringify(track.pivot) === "[2,3,4]")).toBe(true);
});

import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { EditorStore, EditorState } from "../app/editor-store";
import type { Transform } from "../domain/types";
import { applyTransform, type SceneSync } from "./scene-sync";

type Drag = { id: string; object: T.Object3D; start: Transform; revision: number; epoch: object; tool: string; space: string };
const EPS = 1e-6;

export function editable(state: EditorState, id: string | null, blocked: boolean): boolean {
  if (!id || blocked || state.tool.mode !== "model" || id === state.document.project.model.rootNodeId) return false;
  const nodes = new Map(state.document.project.nodes.map(node => [node.id, node]));
  let node = nodes.get(id);
  if (!node) return false;
  while (node) {
    if (!node.visible || node.locked) return false;
    node = node.parentId ? nodes.get(node.parentId) : undefined;
  }
  return true;
}

export function localTransform(object: T.Object3D): Transform | null {
  const p = object.position.toArray();
  const q = object.quaternion.toArray();
  const s = object.scale.toArray();
  const length = Math.hypot(...q);
  if (![...p, ...q, ...s].every(Number.isFinite) || length < EPS || s.some(value => Math.abs(value) < EPS || value < 0)) return null;
  const normalized = q.map(value => value / length) as [number, number, number, number];
  return { position: p as [number, number, number], rotationQuat: normalized, scale: s as [number, number, number] };
}

export function transformChanged(a: Transform, b: Transform): boolean {
  const distance = (x: readonly number[], y: readonly number[]) => x.some((value, index) => Math.abs(value - (y[index] ?? 0)) > EPS);
  const q = Math.abs(a.rotationQuat.reduce((sum, value, index) => sum + value * (b.rotationQuat[index] ?? 0), 0));
  return distance(a.position, b.position) || distance(a.scale, b.scale) || 1 - q > EPS;
}

function visibleBounds(object: T.Object3D, box: T.Box3): T.Box3 {
  box.makeEmpty();
  object.updateWorldMatrix(true, true);
  const visit = (part: T.Object3D, visible: boolean) => {
    const shown = visible && part.visible;
    if (!shown) return;
    if (part instanceof T.Mesh && part.geometry) {
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) box.union(part.geometry.boundingBox.clone().applyMatrix4(part.matrixWorld));
    }
    for (const child of part.children) visit(child, shown);
  };
  visit(object, true);
  return box;
}

export class ViewportInteractions {
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  private readonly raycaster = new T.Raycaster();
  private readonly bounds = new T.Box3();
  private readonly outline = new T.Box3Helper(this.bounds, 0xf9b44c);
  private drag: Drag | null = null;
  private down: { x: number; y: number; pointerId: number } | null = null;
  private cameraVersion = -1;
  private disposed = false;
  private blocked = false;
  private snap = false;
  private gizmoPress = false;
  private unsubscribe: () => void;

  constructor(private graph: SceneSync, private canvas: HTMLCanvasElement, private store: EditorStore,
    private report: (message: string | null) => void, blocked: boolean) {
    this.blocked = blocked;
    this.orbit = new OrbitControls(graph.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.minDistance = 0.05;
    this.orbit.maxDistance = 100000;
    this.orbit.screenSpacePanning = true;
    this.gizmo = new TransformControls(graph.camera, canvas);
    graph.scene.add(this.gizmo.getHelper());
    this.outline.visible = false;
    graph.scene.add(this.outline);
    this.gizmo.addEventListener("mouseDown", this.onGizmoDown);
    this.gizmo.addEventListener("mouseUp", this.onGizmoUp);
    this.gizmo.addEventListener("dragging-changed", this.onDraggingChanged);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    window.addEventListener("keydown", this.onKeyDown);
    this.unsubscribe = store.subscribe(this.sync);
    this.sync();
  }

  private onGizmoDown = () => {
    this.gizmoPress = true;
    const state = this.store.getSnapshot();
    const id = state.selection.activeId;
    const object = id && this.graph.objects.get(id)?.object;
    if (!id || !object || !editable(state, id, this.blocked)) { this.cancel("Объект недоступен для редактирования."); return; }
    this.drag = { id, object, start: structuredClone(state.document.project.nodes.find(node => node.id === id)!.transform) as Transform,
      revision: state.document.revision, epoch: this.store.getProjectEpoch(), tool: state.tool.active, space: state.tool.space };
    this.report(null);
  };
  private onGizmoUp = () => {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const state = this.store.getSnapshot();
    if (state.document.revision !== drag.revision || this.store.getProjectEpoch() !== drag.epoch
      || state.tool.active !== drag.tool || state.tool.space !== drag.space
      || state.selection.activeId !== drag.id || !editable(state, drag.id, this.blocked)
      || this.graph.objects.get(drag.id)?.object !== drag.object) {
      this.restore(drag); this.report("Изменение отменено: объект или проект изменился во время перетаскивания."); return;
    }
    const transform = localTransform(drag.object);
    if (!transform) { this.restore(drag); this.report("Изменение отменено: недопустимое положение, вращение или масштаб."); return; }
    if (!transformChanged(drag.start, transform)) { this.restore(drag); return; }
    const result = this.store.executeCommand({ commandId: crypto.randomUUID(), type: "SET_NODE_TRANSFORM", targetIds: [drag.id],
      payload: { nodeId: drag.id, transform } }, drag.revision);
    if (!result.ok) { this.restore(drag); this.report(`Изменение отменено: ${result.message}`); }
  };
  private onDraggingChanged = (event: { value: unknown }) => { this.orbit.enabled = event.value !== true; };
  private restore(drag: Drag): void {
    const current = this.store.getSnapshot().document.project.nodes.find(node => node.id === drag.id);
    if (current && this.graph.objects.get(drag.id)?.object === drag.object) applyTransform(drag.object, current.transform as Transform);
  }
  cancel(message: string | null = null): void {
    if (this.drag) { this.restore(this.drag); this.drag = null; this.gizmo.dragging = false; this.gizmo.axis = null; this.orbit.enabled = true; }
    if (message) this.report(message);
  }
  private onPointerDown = (event: PointerEvent) => {
    if (event.button === 0) this.down = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  };
  private onPointerUp = (event: PointerEvent) => {
    const down = this.down; this.down = null;
    const gizmoPress = this.gizmoPress; this.gizmoPress = false;
    if (!down || down.pointerId !== event.pointerId || event.button !== 0 || gizmoPress || this.gizmo.dragging || this.drag
      || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    // TransformControls clears its axis in its own pointerup handler; a gizmo press is not a selection click.
    if (this.gizmo.axis) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.raycaster.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), this.graph.camera);
    const candidates: T.Object3D[] = [];
    for (const entry of this.graph.objects.values()) if (entry.content && entry.object.visible) candidates.push(entry.content);
    const hit = this.raycaster.intersectObjects(candidates, true).find(item => {
      let current: T.Object3D | null = item.object;
      while (current) { if (!current.visible) return false; current = current.parent; }
      return true;
    });
    const wrappers = new Map<T.Object3D, string>([...this.graph.objects].map(([id, entry]) => [entry.object, id]));
    let parent = hit?.object;
    while (parent && !wrappers.has(parent)) parent = parent.parent ?? undefined;
    const id = parent ? wrappers.get(parent) : undefined;
    this.store.setSelection(id ? [id] : []);
  };
  private onPointerCancel = () => { this.down = null; this.gizmoPress = false; this.cancel("Преобразование отменено."); };
  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.altKey || target?.closest("input, textarea, select, [contenteditable], [role='dialog'], [aria-modal='true']")) return;
    if (event.key === "Escape") {
      if (this.drag) this.cancel("Преобразование отменено.");
      else this.store.setSelection([]);
      event.preventDefault(); return;
    }
    const key = event.key.toLowerCase();
    if (key === "f") { this.fit(); event.preventDefault(); }
    else if (editable(this.store.getSnapshot(), this.store.getSnapshot().selection.activeId, this.blocked) && ["g", "r", "s"].includes(key)) {
      this.store.setTool({ active: key === "g" ? "move" : key === "r" ? "rotate" : "scale" }); event.preventDefault();
    }
  };

  setBlocked(blocked: boolean): void { this.blocked = blocked; this.sync(); }
  setSnap(enabled: boolean): void {
    this.snap = enabled;
    this.gizmo.setTranslationSnap(enabled ? 0.5 : null);
    this.gizmo.setRotationSnap(enabled ? Math.PI / 12 : null);
    this.gizmo.setScaleSnap(enabled ? 0.1 : null);
  }
  private sync = () => {
    if (this.disposed) return;
    const state = this.store.getSnapshot();
    if (this.drag && (state.document.revision !== this.drag.revision || this.store.getProjectEpoch() !== this.drag.epoch
      || state.tool.active !== this.drag.tool || state.tool.space !== this.drag.space
      || state.selection.activeId !== this.drag.id || !editable(state, this.drag.id, this.blocked)))
      this.cancel("Изменение отменено: состояние проекта изменилось.");
    const id = state.selection.activeId;
    const object = id && this.graph.objects.get(id)?.object;
    this.gizmo.detach();
    if (object && editable(state, id, this.blocked) && state.tool.active !== "select") {
      this.gizmo.setMode(state.tool.active === "move" ? "translate" : state.tool.active === "rotate" ? "rotate" : "scale");
      this.gizmo.setSpace(state.tool.space);
      this.gizmo.attach(object);
    }
    this.outline.visible = !!object && id !== state.document.project.model.rootNodeId && object.visible;
    this.updateOutline(object || null);
  };
  private updateOutline(object: T.Object3D | null): void {
    if (!object) { this.outline.visible = false; return; }
    visibleBounds(object, this.bounds);
    this.outline.visible = !this.bounds.isEmpty() && this.bounds.min.toArray().every(Number.isFinite) && this.bounds.max.toArray().every(Number.isFinite);
    if (this.outline.visible) this.outline.updateMatrixWorld(true);
  }
  frame(): void {
    if (this.cameraVersion !== this.graph.cameraVersion) {
      this.cameraVersion = this.graph.cameraVersion;
      this.orbit.target.copy(this.graph.cameraTarget);
      this.orbit.update();
    }
    this.orbit.update();
    const id = this.store.getSnapshot().selection.activeId;
    const rootId = this.store.getSnapshot().document.project.model.rootNodeId;
    this.updateOutline(id && id !== rootId ? this.graph.objects.get(id)?.object ?? null : null);
  }
  fit(): void {
    const state = this.store.getSnapshot();
    const selected = state.selection.activeId ? this.graph.objects.get(state.selection.activeId)?.object : undefined;
    const root = this.graph.objects.get(state.document.project.model.rootNodeId)?.object;
    const target = selected?.visible ? selected : root;
    if (!target) { this.reset(); return; }
    visibleBounds(target, this.bounds);
    if (this.bounds.isEmpty()) { this.reset(); return; }
    const center = this.bounds.getCenter(new T.Vector3());
    const size = this.bounds.getSize(new T.Vector3());
    const radius = Math.max(size.length() / 2, 0.05);
    const camera = this.graph.camera;
    const halfFov = T.MathUtils.degToRad(camera.fov / 2);
    const distance = Math.min(100000, Math.max(0.1, radius * 1.5 / Math.sin(Math.atan(Math.tan(halfFov) * Math.min(1, camera.aspect)))));
    const direction = camera.position.clone().sub(this.orbit.target).normalize();
    if (!direction.toArray().every(Number.isFinite) || direction.lengthSq() < EPS) direction.set(1, 0.7, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(0.001, (distance - radius * 2) / 100);
    camera.far = Math.max(camera.near + 1, distance + radius * 4);
    camera.updateProjectionMatrix();
    this.orbit.target.copy(center); this.orbit.update();
  }
  reset(): void {
    const camera = this.store.getSnapshot().document.project.scene.camera;
    this.graph.camera.position.fromArray(camera.position);
    this.graph.camera.near = camera.near; this.graph.camera.far = camera.far; this.graph.camera.fov = camera.fovDegrees;
    this.graph.camera.updateProjectionMatrix();
    this.orbit.target.fromArray(camera.target); this.orbit.update();
  }
  dispose(): void {
    if (this.disposed) return;
    this.cancel(); this.disposed = true; this.unsubscribe();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    window.removeEventListener("keydown", this.onKeyDown);
    this.gizmo.removeEventListener("mouseDown", this.onGizmoDown);
    this.gizmo.removeEventListener("mouseUp", this.onGizmoUp);
    this.gizmo.removeEventListener("dragging-changed", this.onDraggingChanged);
    this.gizmo.detach(); this.gizmo.getHelper().removeFromParent(); this.gizmo.dispose();
    this.outline.removeFromParent(); this.outline.geometry.dispose(); (this.outline.material as T.Material).dispose();
    this.orbit.dispose();
  }
}

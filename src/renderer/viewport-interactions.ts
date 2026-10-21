import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { EditorStore, EditorState } from "../app/editor-store";
import type { Transform } from "../domain/types";
import { applyTransform, type SceneSync } from "./scene-sync";
import { vertexRepresentatives } from "../geometry/vertex-selection";
import { pickEditableVertex } from "./vertex-picking";
import { buildMeshTopology, type MeshTopology } from "../geometry/mesh-topology";
import { pickEditableEdge } from "./sub-element-picking";
import { brushAffectedVertices, brushCenters, brushParameters, MAX_BRUSH_SAMPLES, MAX_BRUSH_VERTICES, type BrushSymmetry } from "../geometry/displace-brush";
import type { SurfaceHit } from "../geometry/surface-query";

export function brushUnavailable(state: EditorState, blocked: boolean): string | null {
  if (state.tool.mode !== "model") return "Кисть доступна в режиме «Модель».";
  if (blocked) return "Дождитесь завершения операции.";
  if (state.selection.ids.length !== 1 || !state.selection.activeId) return "Выберите одну редактируемую сетку.";
  const node = state.document.project.nodes.find(item => item.id === state.selection.activeId);
  if (node?.kind !== "mesh") return "Выберите Mesh.";
  if (node.meshSource.kind === "primitive") return "Сначала преобразуйте примитив в Editable Mesh.";
  if (node.meshSource.kind !== "editable") return "GLB-сетка пока недоступна для кисти.";
  if (node.meshSource.positions.length / 3 > MAX_BRUSH_VERTICES) return `Кисть поддерживает не более ${MAX_BRUSH_VERTICES} вершин.`;
  if (node.modifierIds.some(id => state.document.project.modifiers.find(m => m.id === id)?.enabled)
    || state.document.project.modifiers.some(m => m.enabled && m.kind === "boolean" && m.parameters.cutterNodeId === node.id))
    return "Отключите активные модификаторы и зависимые Boolean.";
  if (!editable(state, node.id, blocked)) return "Объект или его предок скрыт либо заблокирован.";
  if (state.meshEdit.mode !== "object") return "Выйдите из режима редактирования элементов.";
  return null;
}

type Drag = { id: string; object: T.Object3D; start: Transform; revision: number; epoch: object; tool: string; space: string };
type Stroke = { id: string; revision: number; epoch: object; pointerId: number; radius: number; strength: number; symmetry: BrushSymmetry; samples: [number, number, number][] };
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
  private markers: T.Group | null = null;
  private markerKey = "";
  private topologySource: object | null = null;
  private topology: MeshTopology | null = null;
  private stroke: Stroke | null = null;
  private brushRadius = 0.35;
  private brushStrength = 0.06;
  private brushSymmetry: BrushSymmetry = "off";
  private brushValid = true;
  private brushPoints: T.Points | null = null;

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
    canvas.addEventListener("pointerdown", this.onPointerDown, true);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("lostpointercapture", this.onLostCapture);
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
    if (!id || !object || state.meshEdit.mode !== "object" || !editable(state, id, this.blocked)) { this.cancel("Объект недоступен для редактирования."); return; }
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
    if (this.stroke) {
      const pointerId = this.stroke.pointerId;
      this.stroke = null; this.orbit.enabled = true; this.clearBrushPreview();
      if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    }
    if (this.drag) { this.restore(this.drag); this.drag = null; this.gizmo.dragging = false; this.gizmo.axis = null; this.orbit.enabled = true; }
    if (message) this.report(message);
  }
  private onPointerDown = (event: PointerEvent) => {
    if (this.store.getSnapshot().tool.active === "displace") {
      event.stopImmediatePropagation();
      if (event.button !== 0 || this.stroke || !this.brushValid) return;
      const state = this.store.getSnapshot();
      const hit = this.brushHit(event);
      if (brushUnavailable(state, this.blocked) || !hit) return;
      this.stroke = { id: hit.nodeId, revision: state.document.revision, epoch: this.store.getProjectEpoch(), pointerId: event.pointerId,
        radius: this.brushRadius, strength: this.brushStrength, symmetry: this.brushSymmetry,
        samples: [hit.pointNodeLocal.toArray() as [number, number, number]] };
      this.orbit.enabled = false;
      this.canvas.setPointerCapture(event.pointerId);
      this.report("Выполняется мазок…");
      return;
    }
    if (event.button === 0) this.down = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  };
  private brushHit(event: PointerEvent): SurfaceHit | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    this.raycaster.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), this.graph.camera);
    const hit = this.graph.surfaces.nearest(this.raycaster.ray, this.raycaster.near, this.raycaster.far);
    return hit?.nodeId === this.store.getSnapshot().selection.activeId ? hit : null;
  }
  setBrush(radius: number, strength: number, symmetry: BrushSymmetry = "off"): void {
    if (this.stroke && (radius !== this.brushRadius || strength !== this.brushStrength || symmetry !== this.brushSymmetry))
      this.cancel("Мазок отменён: параметры кисти изменились.");
    this.brushValid = brushParameters(radius, strength);
    this.brushRadius = radius; this.brushStrength = strength; this.brushSymmetry = symmetry;
    this.clearBrushPreview();
  }
  private clearBrushPreview(): void {
    if (!this.brushPoints) return;
    this.brushPoints.removeFromParent();
    this.brushPoints.geometry.dispose();
    (this.brushPoints.material as T.Material).dispose();
    this.brushPoints = null;
  }
  private showBrush(hit: SurfaceHit | null): void {
    const state = this.store.getSnapshot();
    const node = state.document.project.nodes.find(n => n.id === hit?.nodeId);
    const wrapper = hit && this.graph.objects.get(hit.nodeId)?.object;
    if (!hit || !wrapper || node?.kind !== "mesh" || node.meshSource.kind !== "editable") { this.clearBrushPreview(); return; }
    const source = node.meshSource;
    const symmetry = this.stroke?.symmetry ?? this.brushSymmetry;
    const radius = this.stroke?.radius ?? this.brushRadius;
    const centers = brushCenters(hit.pointNodeLocal.toArray(), symmetry);
    const affected = brushAffectedVertices(source, hit.pointNodeLocal.toArray(), radius, symmetry);
    if (!this.brushPoints || this.brushPoints.parent !== wrapper) {
      this.clearBrushPreview();
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(source.positions.length + 6), 3));
      const material = new T.PointsMaterial({ color: 0xff9a24, size: 9, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false });
      this.brushPoints = new T.Points(geometry, material);
      this.brushPoints.raycast = () => {};
      this.brushPoints.renderOrder = 1001;
      wrapper.add(this.brushPoints);
    }
    const attr = this.brushPoints.geometry.getAttribute("position") as T.BufferAttribute;
    centers.forEach((center, k) => attr.setXYZ(k, center[0]!, center[1]!, center[2]!));
    affected.forEach((i, k) => attr.setXYZ(k + centers.length, source.positions[3 * i]!, source.positions[3 * i + 1]!, source.positions[3 * i + 2]!));
    attr.needsUpdate = true;
    this.brushPoints.geometry.setDrawRange(0, affected.length + centers.length);
    this.brushPoints.geometry.computeBoundingSphere();
  }
  private onPointerMove = (event: PointerEvent) => {
    if (this.store.getSnapshot().tool.active !== "displace") return;
    const hit = this.brushHit(event);
    if (!this.stroke) { this.showBrush(!this.brushValid || brushUnavailable(this.store.getSnapshot(), this.blocked) ? null : hit); return; }
    if (event.pointerId !== this.stroke.pointerId) return;
    if (!hit) { this.clearBrushPreview(); return; }
    this.showBrush(hit);
    const samples = this.stroke.samples, previous = new T.Vector3(...samples.at(-1)!);
    const next = hit.pointNodeLocal;
    const distance = previous.distanceTo(next), spacing = Math.max(0.005, this.stroke.radius * 0.25);
    const steps = Math.ceil(distance / spacing);
    if (steps > MAX_BRUSH_SAMPLES - samples.length) { this.cancel("Мазок слишком длинный; начните новый."); return; }
    for (let i = 1; i <= steps; i++) samples.push(previous.clone().lerp(next, i / steps).toArray() as [number, number, number]);
  };
  private onPointerLeave = () => { if (!this.stroke) this.clearBrushPreview(); };
  private onLostCapture = () => { if (this.stroke) this.cancel("Мазок отменён: потерян захват указателя."); };
  private onPointerUp = (event: PointerEvent) => {
    if (this.store.getSnapshot().tool.active === "displace" || this.stroke) {
      const stroke = this.stroke;
      if (!stroke || stroke.pointerId !== event.pointerId) return;
      this.stroke = null; this.orbit.enabled = true;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      const state = this.store.getSnapshot();
      if (state.document.revision !== stroke.revision || this.store.getProjectEpoch() !== stroke.epoch
        || state.selection.activeId !== stroke.id || state.tool.active !== "displace" || brushUnavailable(state, this.blocked)) {
        this.clearBrushPreview(); this.report("Мазок отменён: проект или объект изменился."); return;
      }
      const result = this.store.executeCommand({ commandId: crypto.randomUUID(), type: "APPLY_DISPLACE_STROKE", targetIds: [stroke.id],
        payload: { nodeId: stroke.id, samples: stroke.samples, radius: stroke.radius, strength: stroke.strength, symmetry: stroke.symmetry } }, stroke.revision);
      this.clearBrushPreview(); this.report(result.ok ? result.changed ? "Рельеф применён." : "Мазок не изменил сетку." : result.message);
      return;
    }
    const down = this.down; this.down = null;
    const gizmoPress = this.gizmoPress; this.gizmoPress = false;
    if (!down || down.pointerId !== event.pointerId || event.button !== 0 || gizmoPress || this.gizmo.dragging || this.drag
      || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    // TransformControls clears its axis in its own pointerup handler; a gizmo press is not a selection click.
    if (this.gizmo.axis && this.store.getSnapshot().meshEdit.mode === "object") return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.raycaster.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), this.graph.camera);
    const hit = this.graph.surfaces.nearest(this.raycaster.ray, this.raycaster.near, this.raycaster.far);
    const current = this.store.getSnapshot();
    if (current.meshEdit.mode !== "object") {
      const id = current.meshEdit.nodeId;
      const node = current.document.project.nodes.find(item => item.id === id);
      if (!id || node?.kind !== "mesh" || node.meshSource.kind !== "editable") return;
      if (hit?.nodeId && hit.nodeId !== id) { this.report("Для выбора другого объекта выйдите из режима элементов."); return; }
      const mode = current.meshEdit.mode;
      if (mode === "vertex") {
        const vertex = hit?.nodeId === id ? pickEditableVertex(hit, node.meshSource, this.graph.camera, event.clientX, event.clientY, rect) : null;
        const selected = current.meshEdit.vertexIndices;
        const next = vertex === null ? event.shiftKey || event.ctrlKey || event.metaKey ? selected : [] : event.ctrlKey || event.metaKey ? selected.includes(vertex) ? selected.filter(index => index !== vertex) : [...selected, vertex]
          : event.shiftKey ? [...selected, vertex] : [vertex];
        this.store.setVertexSelection(next, current.document.revision, this.store.getProjectEpoch());
      } else {
        const topology = this.getTopology(node.meshSource);
        const picked = hit?.nodeId === id && topology ? mode === "edge" ? pickEditableEdge(hit, node.meshSource, topology, this.graph.camera, event.clientX, event.clientY, rect)
          : hit.faceIndex === undefined ? null : topology.triangleFace[hit.faceIndex] ?? null : null;
        const selected = mode === "edge" ? current.meshEdit.edgeIds : current.meshEdit.faceIds;
        const next = picked === null ? event.shiftKey || event.ctrlKey || event.metaKey ? [...selected] : [] : event.ctrlKey || event.metaKey ? selected.includes(picked as never) ? selected.filter(value => value !== picked) : [...selected, picked]
          : event.shiftKey ? [...selected, picked] : [picked];
        this.store.setSubElementSelection(next as string[] | number[], current.document.revision, this.store.getProjectEpoch());
      }
      this.report(null);
      return;
    }
    const id = hit?.nodeId;
    if (id && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      const ids = this.store.getSnapshot().selection.ids;
      const next = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
      this.store.setSelection(next, next.includes(id) ? id : next[0] ?? null);
    } else this.store.setSelection(id ? [id] : []);
  };
  private onPointerCancel = () => { this.down = null; this.gizmoPress = false; this.cancel(this.stroke ? "Мазок отменён." : "Преобразование отменено."); };
  private onKeyDown = (event: KeyboardEvent) => {
    if (this.store.getSnapshot().tool.active === "displace") {
      if (event.key === "Escape") { if (this.stroke) this.cancel("Мазок отменён."); else this.store.setTool({ active: "select" }); event.preventDefault(); }
      else if (["g", "r", "s", "Delete"].includes(event.key)) event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.altKey || target?.closest("input, textarea, select, [contenteditable], [role='dialog'], [aria-modal='true']")) return;
    const meshEdit = this.store.getSnapshot().meshEdit;
    if (meshEdit.mode !== "object") {
      if (event.key === "Escape") {
        if (meshEdit.vertexIndices.length || meshEdit.edgeIds.length || meshEdit.faceIds.length) {
          const state = this.store.getSnapshot();
          if (meshEdit.mode === "vertex") this.store.setVertexSelection([], state.document.revision, this.store.getProjectEpoch());
          else this.store.setSubElementSelection([], state.document.revision, this.store.getProjectEpoch());
        } else this.store.exitMeshEditMode();
        event.preventDefault();
      } else if (event.key === "Delete" || ["g", "r", "s"].includes(event.key.toLowerCase())) event.preventDefault();
      else if (event.key.toLowerCase() === "f") { this.fit(); event.preventDefault(); }
      return;
    }
    if (event.key === "Escape") {
      if (this.drag) this.cancel("Преобразование отменено.");
      else this.store.setSelection([]);
      event.preventDefault(); return;
    }
    if (event.key === "Delete" && !this.blocked && this.store.getSnapshot().tool.mode === "model") {
      const snapshot = this.store.getSnapshot();
      const id = snapshot.selection.activeId;
      if (id && id !== snapshot.document.project.model.rootNodeId) {
        const result = this.store.executeCommand({ commandId: crypto.randomUUID(), type: "DELETE_NODE", targetIds: [id], payload: { nodeId: id } }, snapshot.document.revision);
        if (!result.ok) this.report(result.message);
        event.preventDefault(); return;
      }
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
    if (this.stroke && (state.document.revision !== this.stroke.revision || this.store.getProjectEpoch() !== this.stroke.epoch
      || state.tool.active !== "displace" || state.selection.activeId !== this.stroke.id || brushUnavailable(state, this.blocked)))
      this.cancel("Мазок отменён: состояние проекта изменилось.");
    if (state.tool.active !== "displace" || brushUnavailable(state, this.blocked)) this.clearBrushPreview();
    if (this.drag && (state.document.revision !== this.drag.revision || this.store.getProjectEpoch() !== this.drag.epoch
      || state.tool.active !== this.drag.tool || state.tool.space !== this.drag.space
      || state.selection.activeId !== this.drag.id || !editable(state, this.drag.id, this.blocked)))
      this.cancel("Изменение отменено: состояние проекта изменилось.");
    const id = state.selection.activeId;
    const object = id && this.graph.objects.get(id)?.object;
    this.gizmo.enabled = state.tool.active !== "displace";
    this.gizmo.detach();
    if (object && state.meshEdit.mode === "object" && editable(state, id, this.blocked) && state.tool.active !== "select" && state.tool.active !== "displace") {
      this.gizmo.setMode(state.tool.active === "move" ? "translate" : state.tool.active === "rotate" ? "rotate" : "scale");
      this.gizmo.setSpace(state.tool.space);
      this.gizmo.attach(object);
    }
    this.outline.visible = !!object && id !== state.document.project.model.rootNodeId && object.visible;
    this.updateOutline(object || null);
    this.syncMarkers(state);
  };
  private clearMarkers(): void {
    if (!this.markers) return;
    this.markers.removeFromParent();
    this.markers.traverse(part => {
      if (part instanceof T.Mesh || part instanceof T.LineSegments || part instanceof T.InstancedMesh) { part.geometry.dispose(); (part.material as T.Material).dispose(); }
    });
    this.markers = null;
    this.markerKey = "";
  }
  private syncMarkers(state: EditorState): void {
    const id = state.meshEdit.nodeId;
    const node = state.document.project.nodes.find(item => item.id === id);
    const wrapper = id ? this.graph.objects.get(id)?.object : undefined;
    if (state.meshEdit.mode === "object" || node?.kind !== "mesh" || node.meshSource.kind !== "editable" || !wrapper || this.blocked) { this.clearMarkers(); return; }
    const key = `${id}:${state.derived.generation}:${state.meshEdit.mode}:${state.meshEdit.vertexIndices.join(",")}:${state.meshEdit.edgeIds.join(",")}:${state.meshEdit.faceIds.join(",")}`;
    if (key === this.markerKey && this.markers?.parent === wrapper) return;
    this.clearMarkers();
    const group = new T.Group();
    group.name = "Временное выделение элементов";
    group.traverse(part => { part.raycast = () => {}; });
    if (state.meshEdit.mode !== "vertex") {
      const topology = this.getTopology(node.meshSource);
      if (!topology) return;
      const source = node.meshSource;
      if (state.meshEdit.mode === "edge") {
        const selected = new Set(state.meshEdit.edgeIds);
        const lines: number[] = [];
        for (const edge of topology.edges) if (selected.has(edge.id)) for (const index of edge.vertices)
          lines.push(...source.positions.slice(index * 3, index * 3 + 3));
        if (lines.length) {
          const geometry = new T.BufferGeometry(); geometry.setAttribute("position", new T.Float32BufferAttribute(lines, 3));
          const material = new T.LineBasicMaterial({ color: 0xffbb55, depthTest: true, depthWrite: false, toneMapped: false });
          const overlay = new T.LineSegments(geometry, material); overlay.raycast = () => {}; overlay.renderOrder = 1000; group.add(overlay);
        }
      } else {
        const selected = new Set(state.meshEdit.faceIds), positions: number[] = [];
        for (const face of topology.faces) if (selected.has(face.id)) for (const triangle of face.triangles)
          for (let corner = 0; corner < 3; corner++) positions.push(...source.positions.slice(source.indices[triangle * 3 + corner]! * 3, source.indices[triangle * 3 + corner]! * 3 + 3));
        if (positions.length) {
          const geometry = new T.BufferGeometry(); geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
          const material = new T.MeshBasicMaterial({ color: 0xffbb55, transparent: true, opacity: 0.45, side: T.DoubleSide, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
          const overlay = new T.Mesh(geometry, material); overlay.raycast = () => {}; overlay.renderOrder = 1000; group.add(overlay);
        }
      }
      wrapper.add(group); this.markers = group; this.markerKey = key; return;
    }
    const selected = new Set(state.meshEdit.vertexIndices);
    const normal: number[] = [], active: number[] = [];
    for (const index of vertexRepresentatives(node.meshSource)) {
      const target = selected.has(index) ? active : normal;
      target.push(...node.meshSource.positions.slice(index * 3, index * 3 + 3));
    }
    const accent = typeof document === "undefined" || !document.documentElement || typeof getComputedStyle === "undefined" ? "#5c83d2"
      : getComputedStyle(document.documentElement).getPropertyValue("--color-primary-accent-strong").trim() || "#5c83d2";
    const bounds = new T.Box3();
    for (let i = 0; i < node.meshSource.positions.length; i += 3)
      bounds.expandByPoint(new T.Vector3(...node.meshSource.positions.slice(i, i + 3) as [number, number, number]));
    const extent = Math.max(bounds.getSize(new T.Vector3()).length(), 1e-3);
    for (const [values, color, size] of [[normal, "#ffffff", 0.012], [active, accent, 0.022]] as const) {
      if (!values.length) continue;
      const geometry = new T.TetrahedronGeometry(1);
      const material = new T.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false });
      const markers = new T.InstancedMesh(geometry, material, values.length / 3);
      const matrix = new T.Matrix4();
      const scale = new T.Vector3(1, 1, 1).multiplyScalar(extent * size);
      for (let i = 0; i < values.length / 3; i++) {
        matrix.compose(new T.Vector3(values[i * 3]!, values[i * 3 + 1]!, values[i * 3 + 2]!), new T.Quaternion(), scale);
        markers.setMatrixAt(i, matrix);
      }
      markers.instanceMatrix.needsUpdate = true;
      markers.renderOrder = 1000;
      markers.frustumCulled = false;
      group.add(markers);
    }
    wrapper.add(group);
    this.markers = group;
    this.markerKey = key;
  }
  private getTopology(source: { readonly kind: "editable"; readonly positions: readonly number[]; readonly indices: readonly number[]; readonly uv?: readonly number[] }): MeshTopology | null {
    if (this.topologySource !== source) { this.topologySource = source; this.topology = buildMeshTopology(source); }
    return this.topology;
  }
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
    this.clearMarkers();
    this.clearBrushPreview();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown, true);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("lostpointercapture", this.onLostCapture);
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

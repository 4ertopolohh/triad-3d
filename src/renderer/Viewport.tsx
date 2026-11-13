import { PhysicsController } from "../animation/physics-controller";
import { Color } from "three";
import { evaluateClip } from "../animation/timeline";
import { applyTransform } from "./scene-sync";
import type { AnimationPreview } from "../ui/Timeline";
import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import { useEditorStore } from "../app/use-editor-store";
import { ThreeRendererAdapter, PREVIEW_PROFILES, type PreviewQuality, type BackendMode, type RendererStatus } from "./adapter";
import type { SceneStatus } from "./scene-sync";
import { ViewportInteractions, editable, brushUnavailable } from "./viewport-interactions";
import { brushParameters, type BrushSymmetry } from "../geometry/displace-brush";
import { ModifierPreview } from "./modifier-preview";
import { InstancePreview } from "./instance-preview";
import { InteractionController } from "../animation/interaction-controller";
import type { Project } from "../domain/types";
import { applyMaterialPresetToNode, materialNodeReason } from "../app/material-actions";
import { endMaterialDrag, materialDragActive, MATERIAL_PRESET_MIME, resolveMaterialDrop } from "../app/material-drag";

export function Viewport({ store, mode, blocked, notice, animationPreview = null }: { animationPreview?: AnimationPreview; store: EditorStore; mode: "model" | "scene"; blocked: boolean; notice: (kind: "info" | "success" | "error", text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const interactions = useRef<ViewportInteractions | null>(null);
  const rendererAdapter = useRef<ThreeRendererAdapter | null>(null);
  const instancePreview = useRef<InstancePreview | null>(null);
  const [interactivePreview,setInteractivePreview]=useState(false);
  const interactiveRef=useRef(false);interactiveRef.current=interactivePreview;
  const animationRef=useRef(animationPreview);animationRef.current=animationPreview;
  const [quality, setQuality] = useState<PreviewQuality>("final");
  const qualityRef = useRef(quality); qualityRef.current = quality;
  const state = useEditorStore(store);
  const [snap, setSnap] = useState(false);
  const [radiusText, setRadiusText] = useState("0.35");
  const [strengthText, setStrengthText] = useState("0.06");
  const [brushMode,setBrushMode] = useState<"displace" | "paint" | "material">("displace");
  const [brushColor,setBrushColor] = useState("#e56040");
  const [brushShape,setBrushShape] = useState<"round" | "box">("round");
  const [brushFill,setBrushFill] = useState(false);
  const [brushSlot,setBrushSlot] = useState(0);
  const [symmetry, setSymmetry] = useState<BrushSymmetry>("off");
  const brushRadius = Number(radiusText), brushStrength = Number(strengthText);
  const validBrush = radiusText.trim() !== "" && strengthText.trim() !== "" && brushParameters(brushRadius, brushStrength);
  const brushConfig = useRef({validBrush,brushRadius,brushStrength,symmetry,brushMode,brushColor,brushShape,brushFill,brushSlot});
  brushConfig.current = {validBrush,brushRadius,brushStrength,symmetry,brushMode,brushColor,brushShape,brushFill,brushSlot};
  const blockedRef = useRef(blocked);
  const snapRef = useRef(snap);
  blockedRef.current = blocked;
  snapRef.current = snap;
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [materialHover, setMaterialHover] = useState<"allowed" | "denied" | null>(null);
  const [materialHoverReason, setMaterialHoverReason] = useState<string | null>(null);
  useEffect(() => () => endMaterialDrag(), []);
  useEffect(() => {
    const clear = () => { setMaterialHover(null); setMaterialHoverReason(null); };
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);
  const [backendMode, setBackendMode] = useState<BackendMode>("auto");
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<RendererStatus>({ phase: "initializing", backend: "не определён", message: "Инициализация 3D…" });
  const [scene, setScene] = useState<SceneStatus>({ loading: 0, diagnostics: [], errors: 0, empty: true });
  useEffect(() => {
    if (!host.current) return;
    const adapter = new ThreeRendererAdapter(next => {
      setStatus(next);
      if (next.phase === "lost" || next.phase === "error") {
        interactions.current?.dispose(); interactions.current = null;
      }
    }, setScene);
    rendererAdapter.current = adapter;
    adapter.setQuality(qualityRef.current);
    const preview = new ModifierPreview(store, adapter.graph);
    const instances = new InstancePreview(store, adapter.graph, setInteractionError);
    let ruleController:InteractionController|undefined;
    const physicsController=new PhysicsController(setInteractionError);
    instancePreview.current = instances;
    let generation = -1;
    let interactionEpoch=store.getProjectEpoch();
    const sync = () => {
      const state = store.getSnapshot();
      if(interactionEpoch!==store.getProjectEpoch()){interactionEpoch=store.getProjectEpoch();interactiveRef.current=false;setInteractivePreview(false);ruleController?.reset();physicsController.reset();}
      if(interactiveRef.current&&(state.tool.active!=="select"||state.meshEdit.mode!=="object")){
        // This subscriber runs before ViewportInteractions attaches the new gizmo.
        // Temporary interaction transforms must never become a gesture's starting pose.
        interactiveRef.current=false;setInteractivePreview(false);ruleController?.reset();physicsController.reset();
        const project=state.document.project,animation=animationRef.current;
        const pose=animation&&project.animations.some(c=>c.id===animation.clipId)?evaluateClip(project,animation.clipId,animation.time,false):new Map();
        for(const node of project.nodes){const object=adapter.graph.objects.get(node.id)?.object;if(object)applyTransform(object,pose.get(node.id)??node.transform);}
        instances.setAnimation(animation);adapter.graph.scene.updateMatrixWorld(true);
      }
      if (generation === state.derived.generation) { instances.visibility(); return; }
      generation = state.derived.generation;
      adapter.sync(state.document.project, store.readAssetBytes, store.getProjectEpoch());
      preview.sync();
      instances.sync();
      ruleController?.reset();physicsController.reset();
    };
    let disposed = false;
    void adapter.initialize(host.current, backendMode).then(() => {
      const canvas = adapter.canvas;
      if (disposed || !canvas) return;
      const controller = new ViewportInteractions(adapter.graph, canvas, store, setInteractionError, blockedRef.current);
      controller.setSnap(snapRef.current);
      interactions.current = controller;
      const config = brushConfig.current;
      controller.setBrush(config.validBrush ? config.brushRadius : NaN,config.brushStrength,config.symmetry);
      controller.setFootprint({shape:config.brushShape,fill:config.brushFill});
      controller.setSurfaceBrush(config.brushMode === "displace" ? null : {mode:config.brushMode,color:new Color(config.brushColor).toArray() as [number,number,number],shape:config.brushShape,fill:config.brushFill,materialSlot:config.brushSlot});
      ruleController=new InteractionController(canvas,adapter.graph.camera);
      let last=performance.now(),interactiveTime=0;
      adapter.setFrameHook(() => {
        const now=performance.now(),delta=(now-last)/1000;last=now;
        const state=store.getSnapshot(),project=state.document.project as Project;
        if(interactiveRef.current&&!blockedRef.current&&state.tool.active==="select"){
          interactiveTime+=delta;
          const animation=animationRef.current,pose=animation&&project.animations.some(c=>c.id===animation.clipId)?evaluateClip(project,animation.clipId,animation.time,false):new Map();
          for(const node of project.nodes){const object=adapter.graph.objects.get(node.id)?.object;if(object)applyTransform(object,pose.get(node.id)??node.transform);}
          instances.setAnimation(animation);adapter.graph.scene.updateMatrixWorld(true);
          const seconds=animation?.absoluteTime??animation?.time??interactiveTime;
          const primary=state.tool.mode==="model"||!project.scene.instances.length;
          const root=primary?adapter.graph.objects.get(project.model.rootNodeId)?.object:instances.layer;
          ruleController!.beginFrame(root?[root]:[]);
          if(primary)ruleController!.apply("model",project.interactions??[],new Map([...adapter.graph.objects].map(([id,entry])=>[id,entry.object])),seconds,delta);
          else instances.applyInteractions(ruleController!,seconds,delta);
          physicsController.apply(primary?[{id:"model",actors:project.physics??[],objects:new Map([...adapter.graph.objects].map(([id,entry])=>[id,entry.object]))}]:instances.physicsScopes(),delta);
        }else {interactiveTime=0;physicsController.reset();}
        ruleController?.endFrame();controller.frame();
      });
    });
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => { disposed = true; unsubscribe(); ruleController?.dispose();physicsController.dispose();preview.dispose(); instances.dispose(); instancePreview.current = null; interactions.current?.dispose(); interactions.current = null;
      rendererAdapter.current = null; adapter.setFrameHook(undefined); void adapter.dispose().catch(() => { /* Detached renderer cannot publish UI errors. */ }); };
  }, [store, backendMode, attempt]);
  useEffect(() => {
    const graph = rendererAdapter.current?.graph;
    if (!graph) return;
    const project = store.getSnapshot().document.project;
    const pose = animationPreview && project.animations.some(c => c.id === animationPreview.clipId) ? evaluateClip(project, animationPreview.clipId, animationPreview.time, false) : new Map();
    for (const node of project.nodes) {
      const object = graph.objects.get(node.id)?.object;
      if (object) applyTransform(object, pose.get(node.id) ?? node.transform);
    }
    graph.scene.updateMatrixWorld(true);
    instancePreview.current?.setAnimation(animationPreview);
  }, [animationPreview, store, state.document.revision, backendMode, attempt,interactivePreview]);
  useEffect(() => interactions.current?.setBlocked(blocked), [blocked]);
  useEffect(() => rendererAdapter.current?.setQuality(quality), [quality]);
  useEffect(() => interactions.current?.setSnap(snap), [snap]);
  useEffect(() => { interactions.current?.setBrush(validBrush ? brushRadius : NaN, brushStrength, symmetry); }, [validBrush, brushRadius, brushStrength, symmetry]);
  const canTransform = editable(state, state.selection.activeId, blocked);
  const subMode = state.meshEdit.mode !== "object";
  const activeNode = state.document.project.nodes.find(node => node.id === state.selection.activeId);
  useEffect(() => {
    interactions.current?.setFootprint({shape:brushShape,fill:brushFill});
    interactions.current?.setSurfaceBrush(brushMode === "displace" ? null : {mode:brushMode,color:new Color(brushColor).toArray() as [number,number,number],shape:brushShape,fill:brushFill,materialSlot:brushSlot});
  },[brushMode,brushColor,brushShape,brushFill,brushSlot,backendMode,attempt]);
  const brushNode = state.document.project.nodes.find(n => n.id === state.selection.activeId);
  const brushReason = brushUnavailable(state, blocked);
  return <section className={`renderer-viewport ${materialHover ? `material-drop-${materialHover}` : ""}`} aria-label="3D-предпросмотр модели"
    onDragOver={event => {
      const types = Array.from(event.dataTransfer.types);
      const internal = materialDragActive(store, types);
      const nodeId = internal ? interactions.current?.pickMaterialTarget(event.clientX, event.clientY) : null;
      const reason = !internal ? null : !nodeId ? "Наведите материал на видимую поверхность Mesh."
        : blocked ? "Дождитесь завершения операции." : materialNodeReason(store, nodeId);
      const allowed = internal && !reason;
      event.preventDefault();
      event.dataTransfer.dropEffect = allowed ? "copy" : "none";
      setMaterialHover(internal ? allowed ? "allowed" : "denied" : null);
      setMaterialHoverReason(reason);
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setMaterialHover(null); setMaterialHoverReason(null); } }}
    onDrop={event => {
      event.preventDefault();
      setMaterialHover(null);
      setMaterialHoverReason(null);
      const resolved = resolveMaterialDrop(store, Array.from(event.dataTransfer.types), event.dataTransfer.getData(MATERIAL_PRESET_MIME));
      endMaterialDrag();
      if (!resolved) { notice("error", "Неподдерживаемый или неизвестный материал."); return; }
      const nodeId = interactions.current?.pickMaterialTarget(event.clientX, event.clientY);
      if (!nodeId) { notice("error", "Перетащите материал на видимую поверхность Mesh."); return; }
      const result = applyMaterialPresetToNode(store, resolved.preset, resolved.revision, nodeId, resolved.epoch);
      notice(result.ok ? "success" : "error", result.message);
    }}>
    <div className="renderer-toolbar">
      <button type="button" aria-pressed={interactivePreview} disabled={blocked} onClick={()=>setInteractivePreview(value=>!value)}>Интерактивный просмотр</button>
      <div className="viewport-tools" role="group" aria-label="Режим выбора">
        <button type="button" aria-pressed={!subMode} onClick={() => store.exitMeshEditMode()}>Объект</button>
        {([ ["vertex", "Вершины"], ["edge", "Рёбра"], ["face", "Грани"] ] as const).map(([editMode, label]) => <button key={editMode} type="button" aria-pressed={state.meshEdit.mode === editMode}
          disabled={mode !== "model" || blocked || state.selection.ids.length !== 1 || activeNode?.kind !== "mesh" || activeNode.meshSource.kind !== "editable"}
          title={activeNode?.kind !== "mesh" || activeNode.meshSource.kind !== "editable" ? "Выберите редактируемую сетку." : blocked ? "Дождитесь завершения операции." : undefined}
          onClick={() => { const message = store.enterMeshEditMode(editMode, state.document.revision, store.getProjectEpoch()); setInteractionError(message); }}>{label}</button>)}
      </div>
      <div className="viewport-tools" role="group" aria-label="Инструменты 3D">
        {([ ["select", "Выбор (Esc)"], ["move", "Переместить (G)"], ["rotate", "Вращать (R)"], ["scale", "Масштабировать (S)"] ] as const).map(([tool, label]) =>
          <button key={tool} type="button" title={label} aria-label={label} aria-pressed={state.tool.active === tool}
            disabled={subMode || tool !== "select" && !canTransform} onClick={() => store.setTool({ active: tool })}>{label.split(" (")[0]}</button>)}
      </div>
      <div className="viewport-tools" role="group" aria-label="Кисть рельефа">
        <button type="button" aria-pressed={state.tool.active === "displace"} disabled={!!brushReason || !validBrush}
          title={brushReason ?? "Смещение вершин вдоль нормалей"} onClick={() => store.setTool({ active: "displace" })}>Кисть поверхности</button>
        {state.tool.active === "displace" && <span className="brush-settings">
          <label>Тип<select aria-label="Тип кисти" value={brushMode} onChange={e => setBrushMode(e.target.value as typeof brushMode)}><option value="displace">Рельеф</option><option value="paint">Цвет вершин</option><option value="material">Материал граней</option></select></label>
          {<><label>Форма<select value={brushShape} onChange={e => setBrushShape(e.target.value as typeof brushShape)}><option value="round">Круглая</option><option value="box">Кубическая</option></select></label><label><input type="checkbox" checked={brushFill} onChange={e => setBrushFill(e.target.checked)} />Заливка всего объекта</label></>}
          {brushMode === "paint" && <input type="color" aria-label="Цвет кисти" value={brushColor} onChange={e => setBrushColor(e.target.value)} />}
          {brushMode === "material" && <><label>Слот<select aria-label="Материал кисти" value={brushSlot} onChange={e => setBrushSlot(Number(e.target.value))}>{brushNode?.materialSlots.map((slot,i) => <option key={slot.name} value={i}>{slot.name}</option>)}</select></label><select aria-label="Добавить материал в слоты" value="" disabled={blocked} onChange={e => {
            if (!brushNode || !e.target.value) return;
            const material = state.document.project.materials.find(m => m.id === e.target.value)!;
            const index = brushNode.materialSlots.length;
            const result = store.executeCommand({commandId:crypto.randomUUID(),type:"SET_MATERIAL_SLOT",targetIds:[brushNode.id,material.id],payload:{nodeId:brushNode.id,slotName:`Кисть ${index+1}: ${material.name}`,materialId:material.id}},state.document.revision);
            if (result.ok) setBrushSlot(index); else setInteractionError(result.message);
          }}><option value="">Добавить слот…</option>{state.document.project.materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></>}

          <label>Радиус <input type="number" min="0.01" max="10" step="0.01" value={radiusText} onChange={event => setRadiusText(event.target.value)} /></label>
          <label>Сила <input type="number" min="-0.5" max="0.5" step="0.01" value={strengthText} onChange={event => setStrengthText(event.target.value)} /></label>
          <label>Симметрия <select value={symmetry} onChange={event => setSymmetry(event.target.value as BrushSymmetry)}
            title="Плоскость проходит через локальное начало координат объекта">
            <option value="off">Выключена</option><option value="x">X · плоскость YZ</option>
            <option value="y">Y · плоскость XZ</option><option value="z">Z · плоскость XY</option>
          </select></label>
          <span title="Плоскость проходит через локальное начало координат объекта">Через локальное начало объекта.</span>
          <span>{brushMode === "displace" ? "Положительная сила — выступ, отрицательная — углубление." : "Цвет умножается на цвет материала. Модуль силы 0,5 — полная заливка; материал назначается треугольникам в области кисти."}</span>
          {!validBrush && <span role="alert">Радиус: 0,01–10; сила: −0,5…0,5.</span>}
        </span>}
      </div>
      <div className="viewport-tools" role="group" aria-label="Пространство координат">
        <button type="button" aria-pressed={state.tool.space === "local"} disabled={mode !== "model" || blocked} onClick={() => store.setTool({ space: "local" })}>Локально</button>
        <button type="button" aria-pressed={state.tool.space === "world"} disabled={mode !== "model" || blocked} onClick={() => store.setTool({ space: "world" })}>Мировое</button>
      </div>
      <button type="button" aria-pressed={snap} disabled={mode !== "model" || blocked} title="Перенос: 0,5 · Вращение: 15° · Масштаб: 0,1"
        onClick={() => setSnap(value => !value)}>Привязка {snap ? "вкл" : "выкл"}</button>
      <button type="button" title="Показать выбранный объект или всю модель (F)" onClick={() => interactions.current?.fit()}>Показать объект</button>
      <button type="button" title="Вернуть исходный вид проекта" onClick={() => interactions.current?.reset()}>Сбросить вид</button>
      <label>Графика <select aria-label="Режим графики" value={backendMode} onChange={event => setBackendMode(event.target.value as BackendMode)}>
        <option value="auto">Auto / WebGPU</option><option value="webgl2">WebGL2</option>
      </select></label><span>Backend: {status.backend}</span>
      <label title="Профили меняют разрешение растрового предпросмотра. Path tracing и дополнительные эффекты не включаются.">Качество <select aria-label="Качество предпросмотра" value={quality} onChange={event => setQuality(event.target.value as PreviewQuality)}>{(Object.keys(PREVIEW_PROFILES) as PreviewQuality[]).map(key => <option key={key} value={key}>{PREVIEW_PROFILES[key].label}</option>)}</select></label>
      <button type="button" onClick={() => setAttempt(n => n + 1)}>Повторить запуск</button>
    </div>
    <div className="renderer-host" ref={host} />
    <div className="renderer-status" role={status.phase === "error" || status.phase === "lost" ? "alert" : "status"}>
      <span>{status.message}{scene.loading > 0 ? " · Загрузка ресурсов…" : scene.errors > 0 ? " · Ошибка геометрии или ресурса" : status.phase === "ready" && scene.empty ? " · Модель пуста — импортируйте GLB" : ""}</span>
      {state.tool.active === "displace" && brushReason && <span>{brushReason}</span>}
      {!subMode && state.tool.active !== "select" && state.tool.active !== "displace" && !canTransform && <span>Нет доступного для трансформации объекта.</span>}
      {subMode && <span>Выбор элементов: Shift — добавить, Ctrl — переключить, Esc — очистить или выйти.</span>}
      {interactionError && <span role="alert">{interactionError}</span>}
      {materialHoverReason && <span role="status">{materialHoverReason}</span>}
      {mode === "scene" && <span>{state.document.project.scene.instances.length ? "Экземпляры сохранённых снимков модели." : "Добавьте экземпляр, чтобы разместить модель в сцене."}</span>}
      {scene.diagnostics.map(text => <span key={text}>{text}</span>)}
    </div>
  </section>;
}

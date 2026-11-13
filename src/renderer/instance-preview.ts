import { Group, Mesh, type Object3D } from "three";
import type { EditorStore } from "../app/editor-store";
import { isJobActive } from "../app/job-controller";
import type { Instance, ModelSnapshot, Project } from "../domain/types";
import { snapshotProject } from "../domain/model-snapshots";
import { ModifierEvaluator } from "../geometry/modifiers";
import { evaluateClip } from "../animation/timeline";
import { SceneSync, applyTransform } from "./scene-sync";
import type { InteractionController } from "../animation/interaction-controller";

type Prototype = { graph: SceneSync; project: Project; ready: boolean; pending: boolean; failed: boolean; materials:Map<string,ReturnType<SceneSync["createOverrideMaterial"]>> };
/** Clone only scene objects; geometry, materials and textures belong to one cached prototype. */
export class InstancePreview {
  readonly layer = new Group();
  private cache = new Map<string, Prototype>();
  private copies = new Map<string, { root: Group; nodes: Map<string,Object3D>; instance: Instance; source: Prototype }>();
  private epoch: object | undefined;
  private closed = false;
  private active = false;
  private scheduled = false;
  private jobId: string | undefined;
  private animation: {clipId:string;time:number;absoluteTime?:number;wrap?:boolean}|null = null;
  private unsubscribe:()=>void;
  constructor(private store: EditorStore, private graph: SceneSync, private report: (message:string)=>void) { this.layer.userData.instanceLayer=true;graph.scene.add(this.layer); this.unsubscribe=store.subscribe(()=>{if(!isJobActive(store.getSnapshot().job.status))this.schedule();}); }
  sync(): void {
    if(this.closed)return;
    const state=this.store.getSnapshot(), project=state.document.project as Project;
    if(this.epoch!==this.store.getProjectEpoch()){this.clear();this.epoch=this.store.getProjectEpoch();}
    const used=new Set<string>();
    const usedMaterials=new Set<string>();
    this.copies.clear();this.layer.clear();
    for(const instance of project.scene.instances){
      const snapshot=project.modelSnapshots?.find(s=>s.id===instance.snapshotId);if(!snapshot)continue;
      const requested=instance.materialOverride?.textureMappings?.baseColor??{mode:"uv"};
      const effectiveMappings=snapshot.nodes.filter(n=>n.kind==="mesh").flatMap(n=>n.materialSlots.length?n.materialSlots.map(slot=>snapshot.materials.find(m=>m.id===slot.materialId)?.textureMappings?.baseColor??{mode:"uv"}):[{mode:"uv"}]);
      const projection=instance.materialOverride&&effectiveMappings.some(mapping=>JSON.stringify(mapping)!==JSON.stringify(requested))?requested:undefined;
      const key=JSON.stringify([snapshot.id,projection]);used.add(key);
      let source=this.cache.get(key);
      if(!source){
        const view=structuredClone(snapshotProject(project,snapshot as ModelSnapshot));
        view.scene.lights=[];delete view.scene.background.environmentAssetId;
        if(projection&&instance.materialOverride){view.materials=[structuredClone(instance.materialOverride)];for(const node of view.nodes)if(node.kind==="mesh")node.materialSlots=(node.materialSlots.length?node.materialSlots:[{name:"Материал"}]).map(slot=>({...slot,materialId:instance.materialOverride!.id}));}
        const graph=new SceneSync(status=>{if(status.diagnostics.length)this.report(status.diagnostics.join("; "));this.schedule();});
        source={graph,project:view,ready:false,pending:false,failed:false,materials:new Map()};this.cache.set(key,source);
        graph.sync(view,this.store.readAssetBytes,this.epoch);
        source.ready=!view.modifiers.some(m=>m.enabled);
      }
      if(source.ready){
        const prototype=source.graph.objects.get(source.project.model.rootNodeId)?.object;
        if(!prototype)continue;
        const root=new Group(),clone=prototype.clone(true),nodes=new Map<string,Object3D>();
        clone.traverse(object=>{if(typeof object.userData.nodeId==="string")nodes.set(object.userData.nodeId,object);});
        if(instance.materialOverride)clone.traverse(object=>{if(!(object instanceof Mesh))return;const materialKey=JSON.stringify([key,instance.materialOverride,object.geometry.uuid]);usedMaterials.add(materialKey);let material=source!.materials.get(materialKey);if(!material){material=source!.graph.createOverrideMaterial(instance.materialOverride!,object.geometry);source!.materials.set(materialKey,material);}object.material=material;});
        root.add(clone);applyTransform(root,instance.transform);root.visible=instance.visible;this.layer.add(root);
        this.copies.set(instance.id,{root,nodes,instance,source});
      }
    }
    for(const [key,source] of this.cache)if(!used.has(key)&&!source.pending){source.graph.dispose();this.cache.delete(key);}
    for(const source of this.cache.values())for(const [key,material]of source.materials)if(!usedMaterials.has(key)){source.graph.releaseOverrideMaterial(material);source.materials.delete(key);}
    this.visibility();this.setAnimation(this.animation);
    if(!this.active&&!isJobActive(state.job.status))this.scheduleEvaluation();
  }
  private schedule():void{if(this.closed||this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;if(!this.closed)this.sync();});}
  private scheduleEvaluation():void{
    const source=[...this.cache.values()].find(s=>!s.ready&&!s.pending&&!s.failed);if(!source)return;
    this.active=true;source.pending=true;
    // Let the primary model's queued modifier job acquire the single job slot first.
    setTimeout(()=>{void this.evaluate(source);},0);
  }
  private async evaluate(source:Prototype):Promise<void>{
    if(this.closed||isJobActive(this.store.getSnapshot().job.status)){source.pending=false;this.active=false;if(this.closed)source.graph.dispose();return;}
    const epoch=this.epoch,evaluator=new ModifierEvaluator();
    let computation:Promise<unknown>|undefined;
    try{
      this.jobId=crypto.randomUUID();
      const outcome=await this.store.jobs.run({id:this.jobId,name:"Геометрия экземпляров",cancellable:true,validate:()=>null,compute:async(_input,signal)=>{
        computation=(async()=>{
          for(const node of source.project.nodes){
            signal.throwIfAborted();if(node.kind!=="mesh"||!node.modifierIds.some(id=>source.project.modifiers.find(m=>m.id===id)?.enabled))continue;
            const result=await evaluator.evaluate(source.project,node.id,signal);signal.throwIfAborted();
            if(!result.ok)throw new Error(result.error.message);
            if(!this.closed&&epoch===this.epoch)source.graph.setDerived(node.id,result.mesh,result.empty,result.warnings.map(w=>w.message));
          }
        })();await computation;return {ok:true,value:null};
      }});
      if(!outcome.ok){source.failed=true;if(!this.closed)this.report(`Экземпляры: ${outcome.error.message} Повторите запуск предпросмотра.`);}else source.ready=true;
    }finally{await computation?.catch(()=>{});evaluator.dispose();source.pending=false;this.active=false;this.jobId=undefined;if(this.closed||epoch!==this.epoch||![...this.cache.values()].includes(source))source.graph.dispose();if(!this.closed)this.schedule();}
  }
  visibility():void{
    const state=this.store.getSnapshot(),scene=state.tool.mode==="scene";
    this.layer.visible=scene;
    const root=this.graph.objects.get(state.document.project.model.rootNodeId)?.object;
    if(root)root.visible=!!state.document.project.nodes.find(n=>n.id===state.document.project.model.rootNodeId)?.visible&&(!scene||!state.document.project.scene.instances.length);
  }
  physicsScopes(){return [...this.copies].map(([id,copy])=>({id,actors:copy.source.project.physics??[],objects:copy.nodes}));}
  applyInteractions(controller:InteractionController,time:number,delta:number):void{for(const [id,copy]of this.copies)controller.apply(id,copy.source.project.interactions??[],copy.nodes,time,delta);}
  setAnimation(preview:{clipId:string;time:number;absoluteTime?:number;wrap?:boolean}|null):void{
    this.animation=preview;
    for(const {nodes,instance,source} of this.copies.values()){
      const p=source.project,clip=instance.animationOverride?instance.animationOverride.clipId:(p.animations.find(c=>c.id===preview?.clipId)?.id??p.animations[0]?.id);
      const pose=preview&&clip?evaluateClip(p,clip,(preview.absoluteTime??preview.time)*(instance.animationOverride?.speed??1),preview.wrap??false):new Map();
      for(const node of p.nodes){const object=nodes.get(node.id);if(object)applyTransform(object,pose.get(node.id)??node.transform);}
    }
    this.graph.scene.updateMatrixWorld(true);
  }
  private clear():void{this.copies.clear();this.layer.clear();for(const source of this.cache.values())if(!source.pending)source.graph.dispose();this.cache.clear();}
  dispose():void{if(this.closed)return;this.closed=true;this.unsubscribe();if(this.jobId&&this.store.getSnapshot().job.id===this.jobId)this.store.jobs.cancelJob();this.clear();this.layer.removeFromParent();}
}

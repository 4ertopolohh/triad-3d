import { Mesh, Plane, Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import { InteractionMixer } from "./interactions";
import type { InteractionRule, Transform } from "../domain/types";

/** Pointer adapter shared by editor and exported runtime. All mutations are derived poses. */
export class InteractionController {
  private pointer:Vector2|null=null;
  private click=false;
  private hit:Object3D|undefined;
  private ray=new Raycaster();
  private mixers=new Map<string,InteractionMixer>();
  private move=(event:PointerEvent)=>{const rect=this.canvas.getBoundingClientRect();if(rect.width&&rect.height)this.pointer=new Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);};
  private leave=()=>{this.pointer=null;};
  private clicked=()=>{this.click=true;};
  constructor(private canvas:HTMLElement,private camera:Camera){canvas.addEventListener("pointermove",this.move);canvas.addEventListener("pointerleave",this.leave);canvas.addEventListener("click",this.clicked);}
  reset():void{this.mixers.clear();this.click=false;}
  endFrame():void{this.click=false;}
  beginFrame(roots:readonly Object3D[]):void{
    this.hit=undefined;if(!this.pointer)return;this.ray.setFromCamera(this.pointer,this.camera);
    this.hit=this.ray.intersectObjects([...roots],true).find(hit=>{if(!(hit.object instanceof Mesh))return false;let object:Object3D|null=hit.object;while(object){if(!object.visible)return false;object=object.parent;}return true;})?.object;
  }
  apply(scope:string,rules:readonly InteractionRule[],objects:ReadonlyMap<string,Object3D>,time:number,delta:number):void{
    if(!rules.length)return;
    let mixer=this.mixers.get(scope);if(!mixer){mixer=new InteractionMixer();this.mixers.set(scope,mixer);}
    const hovered=new Set<string>(),ids=new Map([...objects].map(([id,object])=>[object,id]));
    let hoveredObject=this.hit;while(hoveredObject){const id=ids.get(hoveredObject);if(id)hovered.add(id);hoveredObject=hoveredObject.parent??undefined;}
    const depth=(id:string)=>{let n=0,object=objects.get(id)?.parent;while(object){n++;object=object.parent;}return n;};
    for(const nodeId of [...new Set(rules.map(rule=>rule.nodeId))].sort((a,b)=>depth(a)-depth(b))){
      const object=objects.get(nodeId);if(!object)continue;
      const base:Transform={position:object.position.toArray(),rotationQuat:object.quaternion.toArray(),scale:object.scale.toArray()};
      let point:Vector3|null=null;
      if(this.pointer){const normal=this.camera.getWorldDirection(new Vector3()),origin=object.getWorldPosition(new Vector3());point=this.ray.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal,origin),new Vector3());if(point&&object.parent)object.parent.worldToLocal(point);}
      const pose=mixer.evaluate(base,rules.filter(rule=>rule.nodeId===nodeId),{time,deltaSeconds:delta,pointer:point?point.toArray():null,hovered:hovered.has(nodeId),clicked:this.click&&hovered.has(nodeId)});
      object.position.fromArray(pose.position);object.quaternion.fromArray(pose.rotationQuat).normalize();object.scale.fromArray(pose.scale);object.updateMatrix();object.updateMatrixWorld(true);
    }
  }
  dispose():void{this.canvas.removeEventListener("pointermove",this.move);this.canvas.removeEventListener("pointerleave",this.leave);this.canvas.removeEventListener("click",this.clicked);this.reset();}
}

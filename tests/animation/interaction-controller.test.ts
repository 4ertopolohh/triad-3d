import { expect,it } from "vitest";
import { BoxGeometry,Group,Mesh,MeshBasicMaterial,PerspectiveCamera,Scene } from "three";
import { InteractionController } from "../../src/animation/interaction-controller";
import type { InteractionRule } from "../../src/domain/types";
it("dispatches one click only to the frontmost instance across separate mixer scopes",()=>{
  const target=Object.assign(new EventTarget(),{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}),camera=new PerspectiveCamera(50,1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
  const scene=new Scene(),front=new Group(),back=new Group(),geometry=new BoxGeometry(),material=new MeshBasicMaterial();front.position.z=2;front.add(new Mesh(geometry,material));back.add(new Mesh(geometry,material));scene.add(front,back);scene.updateMatrixWorld(true);
  const controller=new InteractionController(target as unknown as HTMLElement,camera),rule:InteractionRule={id:"toggle",nodeId:"node",name:"Клик",enabled:true,priority:0,blend:"additive",weight:1,releaseSeconds:.1,event:"click",condition:{kind:"always"},action:{kind:"click-toggle",radius:1,strength:2,frequency:1}};
  target.dispatchEvent(Object.assign(new Event("pointermove"),{clientX:50,clientY:50}));target.dispatchEvent(new Event("click"));
  controller.beginFrame([scene]);controller.apply("front",[rule],new Map([["node",front]]),0,.25);controller.apply("back",[rule],new Map([["node",back]]),0,.25);controller.endFrame();
  expect(front.scale.x).toBeGreaterThan(1.9);expect(back.scale.x).toBe(1);controller.dispose();geometry.dispose();material.dispose();
});

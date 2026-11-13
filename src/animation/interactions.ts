import { Quaternion } from "three";
import type { Transform, Vec3, InteractionRule } from "../domain/types";

export interface InteractionInput { time:number; deltaSeconds:number; pointer:Vec3|null; hovered:boolean; clicked:boolean }
export interface PoseLayer { id:string; priority:number; blend:"additive"|"override"; weight:number; position?:Vec3; scale?:Vec3; rotationQuat?:readonly[number,number,number,number] }
/** Independent channels: a position layer never overwrites timeline rotation. */
export function mixLayers(base:Transform,layers:readonly PoseLayer[]):Transform{
  const result=structuredClone(base);
  for(const layer of [...layers].sort((a,b)=>a.priority-b.priority||(a.id<b.id?-1:a.id>b.id?1:0))){
    const weight=Math.max(0,Math.min(1,layer.weight));
    for(const property of ["position","scale"]as const){const value=layer[property];if(!value)continue;
      result[property]=result[property].map((current,i)=>layer.blend==="override"?current+(value[i]!-current)*weight:property==="position"?current+value[i]!*weight:current*(1+(value[i]!-1)*weight))as unknown as Vec3;
    }
    if(layer.rotationQuat){const target=new Quaternion(...layer.rotationQuat).normalize(),current=new Quaternion(...result.rotationQuat);if(layer.blend==="additive")current.multiply(new Quaternion().slerp(target,weight));else current.slerp(target,weight);result.rotationQuat=current.normalize().toArray()as[number,number,number,number];}
  }
  return result;
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const number=(value:unknown,min:number,max:number)=>typeof value==="number"&&Number.isFinite(value)&&value>=min&&value<=max;
export function interactionError(value:unknown,nodeIds:ReadonlySet<string>):string|null{
  if(!Array.isArray(value)||value.length>128)return "Допускается до 128 правил.";
  const ids=new Set<string>();
  for(const rule of value){
    if(!record(rule)||Object.keys(rule).some(k=>!["id","nodeId","name","enabled","priority","blend","weight","releaseSeconds","event","condition","action"].includes(k))||typeof rule.id!=="string"||!rule.id||ids.has(rule.id)||typeof rule.name!=="string"||!rule.name.trim()||rule.name.length>128||typeof rule.nodeId!=="string"||!nodeIds.has(rule.nodeId)||typeof rule.enabled!=="boolean"||!number(rule.priority,-100,100)||!Number.isInteger(rule.priority)||!["additive","override"].includes(String(rule.blend))||!number(rule.weight,0,1)||!number(rule.releaseSeconds,.01,10))return "Некорректное правило, ID или целевой узел.";
    ids.add(rule.id);
    if(!["pointer","click","time","proximity"].includes(String(rule.event)))return "Неизвестное событие.";
    const condition=rule.condition;
    if(!record(condition)||!["always","distance","timeRange"].includes(String(condition.kind))||Object.keys(condition).some(k=>!["kind","min","max"].includes(k)))return "Недопустимое условие: доступны только типизированные предикаты.";
    if(condition.kind==="always"?Object.keys(condition).length!==1:!number(condition.min,0,86400)||!number(condition.max,0,86400)||(condition.min as number)>(condition.max as number))return "Некорректный диапазон условия.";
    const action=rule.action;
    if(!record(action)||Object.keys(action).some(k=>!["kind","radius","strength","frequency"].includes(k))||!["magnet","click-toggle","hover-reveal","orbit-follow","pulse"].includes(String(action.kind))||!number(action.radius,.01,1000)||!number(action.strength,0,10)||!number(action.frequency,.01,20))return "Некорректное действие или его параметры.";
    if(action.kind==="click-toggle"&&rule.event!=="click")return "Click-toggle требует события click.";
  }
  return null;
}
type RuleState={influence:number;toggled:boolean;offset:Vec3};
export function interactionConflicts(rules:readonly InteractionRule[]):string[]{
  const warnings:string[]=[],seen=new Map<string,string>();
  for(const rule of rules){if(!rule.enabled||rule.blend!=="override")continue;const channel=["magnet","orbit-follow"].includes(rule.action.kind)?"position":"scale",key=JSON.stringify([rule.nodeId,channel,rule.priority]);const previous=seen.get(key);if(previous)warnings.push(`Конфликт override «${previous}» / «${rule.name}»: одинаковый приоритет канала ${channel}; задайте разные приоритеты. При равенстве порядок определяется ID.`);else seen.set(key,rule.name);}
  return warnings;
}
/** Session-only state; no scripts, string expressions, rule calls or dependency cycles. */
export class InteractionMixer {
  private states=new Map<string,RuleState>();
  clear():void{this.states.clear();}
  evaluate(base:Transform,rules:readonly InteractionRule[],input:InteractionInput):Transform{
    if(!Number.isFinite(input.time)||!Number.isFinite(input.deltaSeconds)||input.deltaSeconds<0)throw new Error("Некорректное время взаимодействия.");
    const layers:PoseLayer[]=[];
    for(const rule of rules){
      if(!rule.enabled){this.states.delete(rule.id);continue;}
      const state=this.states.get(rule.id)??{influence:0,toggled:false,offset:[0,0,0]as Vec3};this.states.set(rule.id,state);
      const delta=input.pointer?input.pointer.map((v,i)=>v-base.position[i]!)as unknown as Vec3:null;
      const distance=delta?Math.hypot(...delta):Infinity;
      const condition=rule.condition.kind==="always"||rule.condition.kind==="distance"&&distance>=rule.condition.min&&distance<=rule.condition.max||rule.condition.kind==="timeRange"&&input.time>=rule.condition.min&&input.time<=rule.condition.max;
      const event=rule.event==="time"||rule.event==="click"&&input.clicked||rule.event==="pointer"&&input.hovered||rule.event==="proximity"&&distance<rule.action.radius;
      if(rule.enabled&&condition&&input.clicked&&rule.event==="click"&&rule.action.kind==="click-toggle")state.toggled=!state.toggled;
      const active=rule.enabled&&condition&&(rule.action.kind==="click-toggle"?state.toggled:event);
      const falloff=rule.action.kind==="magnet"?Math.max(0,1-distance/rule.action.radius)**2:1;
      const target=active?falloff:0,alpha=1-Math.exp(-Math.min(input.deltaSeconds,.25)/rule.releaseSeconds);
      state.influence+=(target-state.influence)*alpha;
      if(active&&delta){state.offset=rule.action.kind==="orbit-follow"?[Math.cos(Math.atan2(delta[1],delta[0]))*rule.action.radius*rule.action.strength,Math.sin(Math.atan2(delta[1],delta[0]))*rule.action.radius*rule.action.strength,0]:delta.map(v=>v*rule.action.strength)as unknown as Vec3;}
      const layer:PoseLayer={id:rule.id,priority:rule.priority,blend:rule.blend,weight:rule.weight*state.influence};
      if(rule.action.kind==="magnet"||rule.action.kind==="orbit-follow")layer.position=rule.blend==="additive"?state.offset:base.position.map((v,i)=>v+state.offset[i]!)as unknown as Vec3;
      else{
        const factor=rule.action.kind==="pulse"?Math.max(.001,1+Math.sin(input.time*Math.PI*2*rule.action.frequency)*rule.action.strength*.1):rule.action.kind==="hover-reveal"?1:Math.max(.001,rule.action.strength);
        if(rule.action.kind==="hover-reveal"){
          const reveal=.001+(1-.001)*state.influence;layer.weight=rule.weight;layer.scale=rule.blend==="additive"?[reveal,reveal,reveal]:base.scale.map(v=>v*reveal)as unknown as Vec3;
        }else layer.scale=rule.blend==="additive"?[factor,factor,factor]:base.scale.map(v=>v*factor)as unknown as Vec3;
      }
      if(rule.enabled||state.influence>.00001)layers.push(layer);
    }
    return mixLayers(base,layers);
  }
}

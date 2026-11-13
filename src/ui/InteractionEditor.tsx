import { useState } from "react";
import type { EditorStore, EditorState } from "../app/editor-store";
import type { InteractionRule } from "../domain/types";
import { CommitNumber } from "./CommitNumber";
import { interactionConflicts } from "../animation/interactions";
export function InteractionEditor({store,state,nodeId,disabled}:{store:EditorStore;state:EditorState;nodeId:string;disabled:boolean}){
  const [error,setError]=useState("");const project=state.document.project,epoch=store.getProjectEpoch();
  const labels={magnet:"Магнит","click-toggle":"Переключение по клику","hover-reveal":"Появление при наведении","orbit-follow":"Следование по орбите",pulse:"Пульсация"};
  function commit(rules:InteractionRule[]){if(epoch!==store.getProjectEpoch()||disabled)return;const result=store.executeCommand({commandId:crypto.randomUUID(),type:"SET_INTERACTIONS",targetIds:[project.id],payload:{projectId:project.id,rules}},state.document.revision);setError(result.ok?"":result.message);}
  function update(rule:InteractionRule,change:Partial<InteractionRule>){commit((project.interactions??[]).map(r=>r.id===rule.id?{...structuredClone(rule),...change}:structuredClone(r)as InteractionRule));}
  return <section className="interaction-editor"><h4>Взаимодействия</h4><p>Включите «Интерактивный просмотр» над сценой. Правила сохраняются и работают в TSX.</p>
    <label>Добавить пресет<select disabled={disabled} value="" onChange={e=>{const kind=e.target.value as InteractionRule["action"]["kind"];if(!kind)return;commit([...(structuredClone(project.interactions??[])as InteractionRule[]),{id:crypto.randomUUID(),nodeId,name:labels[kind],enabled:true,priority:0,blend:"additive",weight:1,releaseSeconds:.25,event:kind==="click-toggle"?"click":kind==="pulse"?"time":kind==="hover-reveal"?"pointer":"proximity",condition:{kind:"always"},action:{kind,radius:3,strength:kind==="click-toggle"?1.5:.5,frequency:1}}]);}}><option value="">Выберите…</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    {(project.interactions??[]).filter(r=>r.nodeId===nodeId).map(readonlyRule=>{const rule=readonlyRule as InteractionRule;return <fieldset key={rule.id} disabled={disabled}><legend>{rule.name}</legend>
      <label><input type="checkbox" checked={rule.enabled} onChange={e=>update(rule,{enabled:e.target.checked})}/>Включено</label>
      <label>Событие<select value={rule.event} onChange={e=>update(rule,{event:e.target.value as InteractionRule["event"]})}><option value="pointer">Наведение</option><option value="click">Клик</option><option value="time">Время</option><option value="proximity">Близость курсора</option></select></label>
      <label>Условие<select value={rule.condition.kind} onChange={e=>update(rule,{condition:e.target.value==="always"?{kind:"always"}:{kind:e.target.value as "distance"|"timeRange",min:0,max:rule.action.radius}})}><option value="always">Всегда</option><option value="distance">Диапазон расстояния</option><option value="timeRange">Диапазон времени</option></select></label>
      {rule.condition.kind!=="always"&&(["min","max"]as const).map(key=><label key={key}>{key==="min"?"От":"До"}<CommitNumber value={rule.condition.kind!=="always"?rule.condition[key]:0} onCommit={value=>{if(rule.condition.kind!=="always")update(rule,{condition:{...rule.condition,[key]:value}});}}/></label>)}
      <label>Действие<select value={rule.action.kind} onChange={e=>update(rule,{action:{...rule.action,kind:e.target.value as InteractionRule["action"]["kind"]}})}>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      {(["radius","strength","frequency"]as const).filter(key=>key==="frequency"?rule.action.kind==="pulse":key==="strength"?rule.action.kind!=="hover-reveal":rule.event==="proximity"||rule.action.kind==="magnet"||rule.action.kind==="orbit-follow").map(key=><label key={key}>{key==="radius"?"Радиус, лок. ед.":key==="strength"?"Сила / масштаб":"Частота, Гц"}<CommitNumber value={rule.action[key]} onCommit={value=>update(rule,{action:{...rule.action,[key]:value}})}/></label>)}
      <label>Смешивание<select value={rule.blend} onChange={e=>update(rule,{blend:e.target.value as InteractionRule["blend"]})}><option value="additive">Добавить к каналу</option><option value="override">Заменить канал</option></select></label>
      {(["weight","priority","releaseSeconds"]as const).map(key=><label key={key}>{key==="weight"?"Вес 0–1":key==="priority"?"Приоритет −100…100":"Плавность возврата, с"}<CommitNumber value={rule[key]} onCommit={value=>update(rule,{[key]:value})}/></label>)}
      <button onClick={()=>commit((project.interactions??[]).filter(r=>r.id!==rule.id).map(r=>structuredClone(r)as InteractionRule))}>Удалить правило</button>
    </fieldset>;})}
    {error&&<p role="alert">{error}</p>}
    {interactionConflicts((project.interactions??[])as InteractionRule[]).map(message=><p key={message} role="status">{message}</p>)}
  </section>;
}

import { useState } from "react";
import { applyStampChange, type StampChange } from "../app/stamp-actions";
import type { DeepReadonly, EditorStore } from "../app/editor-store";
import type { Modifier } from "../domain/types";
import { parseStampParameters, type StampParameters } from "../geometry/modifiers/stamp";
import { CommitNumber } from "./CommitNumber";

export function StampItem({store,targetId,modifier,index,length,disabled,reason}:{store:EditorStore;targetId:string;modifier:DeepReadonly<Modifier>;index:number;length:number;disabled:boolean;reason:string}) {
  const [message,setMessage]=useState("");
  const params=parseStampParameters(modifier.parameters);
  async function run(change:StampChange){const result=await applyStampChange(store,change);setMessage(result.ok?"Штамп обновлён.":result.error.message);}
  const update=(parameters:StampParameters)=>void run({type:"update",targetId,modifierId:modifier.id,parameters});
  return <fieldset disabled={disabled||!!reason} className="boolean-stack-item"><legend>{index+1}. Процедурный штамп</legend>
    <label><input type="checkbox" checked={modifier.enabled} onChange={e=>void run({type:"enable",targetId,modifierId:modifier.id,enabled:e.target.checked})}/>Включён</label>
    <label>Форма штампа<select value={params.shape} onChange={e=>update({...params,shape:e.target.value as StampParameters["shape"]})}><option value="hole">Отверстие</option><option value="dent">Углубление</option><option value="spike">Шип</option></select></label>
    {(["radius","depth","count","spread","seed"] as const).map(key=><label key={key}>{{radius:"Радиус штампа",depth:"Глубина / высота",count:"Повторений 1–16",spread:"Разброс в касательной плоскости",seed:"Начальное значение генератора"}[key]}<CommitNumber value={params[key]} onCommit={value=>update({...params,[key]:value})}/></label>)}
    <label>Зеркало штампа<select value={params.mirror} onChange={e=>update({...params,mirror:e.target.value as StampParameters["mirror"]})}><option value="off">Выключено</option><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
    {(["center","normal"] as const).map(field=><div key={field}>{[0,1,2].map(axis=><label key={axis}>{field==="center"?"Центр":"Направление проекции"} {"XYZ"[axis]}<CommitNumber value={params[field][axis]!} onCommit={value=>{const vector=[...params[field]] as [number,number,number];vector[axis]=value;if(field==="normal"){const norm=Math.hypot(...vector);if(norm===0){setMessage("Нормаль не может быть нулевой.");return;}for(let i=0;i<3;i++)vector[i]=vector[i]!/norm;}update({...params,[field]:vector});}}/></label>)}</div>)}
    <p>Повторения проецируются на поверхность вдоль исходной нормали; выбирается ближайшее к центру пересечение. Ориентация каждого штампа берётся из поверхности. Промах отменяет всю операцию. UV и группы материалов результата не сохраняются.</p>
    <button disabled={index===0} onClick={()=>void run({type:"move",targetId,modifierId:modifier.id,toIndex:index-1})}>↑ Выше</button>
    <button disabled={index===length-1} onClick={()=>void run({type:"move",targetId,modifierId:modifier.id,toIndex:index+1})}>↓ Ниже</button>
    <button onClick={()=>void run({type:"remove",targetId,modifierId:modifier.id})}>Удалить штамп</button>
    {message&&<p role="status">{message}</p>}
  </fieldset>;
}

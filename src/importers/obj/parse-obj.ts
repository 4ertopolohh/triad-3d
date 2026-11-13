import type { MeshNode } from "../../domain/types";
import { validateEditableSource, type EditableMeshSource } from "../../geometry/mesh-edit";

import { OBJ_LIMITS } from "./limits";
export interface ObjImport { nodes:MeshNode[]; triangles:number; diagnostics:string[] }
/** Strict local OBJ subset. No material library or URI is ever resolved. */
export function parseObj(text:string,parentId:string,name:string,nextId:()=>string=()=>crypto.randomUUID()):ObjImport{
  if(new TextEncoder().encode(text).length>OBJ_LIMITS.bytes||text.includes("\0"))throw new Error("OBJ повреждён или превышает 16 МиБ.");
  const positions:number[][]=[],uvs:number[][]=[],normals:number[][]=[];
  const nodes:MeshNode[]=[],diagnostics=new Set<string>();let triangles=0,face=0,smoothing="off";
  let groupName=name.slice(0,180)||"OBJ",source:EditableMeshSource={kind:"editable",positions:[],indices:[],uv:[]},vertices=new Map<string,number>(),hasUv=true;
  const finish=()=>{
    if(!source.indices.length)return;
    if(!hasUv){delete source.uv;if(uvs.length)diagnostics.add("Неполные UV: координаты текстуры этой группы пропущены.");}
    else diagnostics.add("Нормали на UV-швах пересчитываются раздельно: возможны дополнительные жёсткие границы сглаживания.");
    const error=validateEditableSource(source);if(error)throw new Error(`${groupName}: ${error}`);
    if(nodes.length>=OBJ_LIMITS.objects)throw new Error("OBJ содержит больше 128 групп.");
    nodes.push({id:nextId(),kind:"mesh",name:groupName,parentId,children:[],visible:true,locked:false,materialSlots:[],modifierIds:[],transform:{position:[0,0,0],rotationQuat:[0,0,0,1],scale:[1,1,1]},meshSource:source});
    source={kind:"editable",positions:[],indices:[],uv:[]};vertices=new Map();hasUv=true;
  };
  const number=(value:string|undefined)=>{const n=Number(value);if(value===undefined||value.trim()===""||!Number.isFinite(n)||!Number.isFinite(Math.fround(n)))throw new Error("Некорректная координата OBJ.");return n;};
  const index=(value:string,count:number)=>{if(!/^-?[1-9]\d*$/.test(value))throw new Error("Некорректный индекс OBJ.");const n=Number(value),i=n>0?n-1:count+n;if(!Number.isSafeInteger(n)||i<0||i>=count)throw new Error("Индекс OBJ вне диапазона.");return i;};
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/);
  for(let line=0;line<lines.length;line++){
    const raw=lines[line]!;if(raw.length>OBJ_LIMITS.line)throw new Error(`Строка ${line+1}: превышен лимит длины.`);
    const parts=raw.split("#",1)[0]!.trim().split(/\s+/),kind=parts.shift()!;if(!kind)continue;
    try{
      if(kind==="v"){
        if(parts.length!==3&&parts.length!==4&&parts.length!==6)throw new Error("Ожидается v x y z [w] либо RGB-расширение.");
        if(positions.length>=OBJ_LIMITS.vertices)throw new Error("Превышен лимит 300 000 вершин.");
        if(parts.length===4&&number(parts[3])!==1)throw new Error("Однородные вершины w≠1 не поддерживаются.");
        if(parts.length===6){parts.slice(3).forEach(number);diagnostics.add("Расширение vertex RGB пропущено; назначьте материал в редакторе.");}
        positions.push(parts.slice(0,3).map(number));
      }else if(kind==="vt"){
        if(parts.length<2||parts.length>3||uvs.length>=OBJ_LIMITS.vertices)throw new Error("Некорректная или слишком большая таблица UV.");
        uvs.push(parts.slice(0,2).map(number));if(parts.length===3){number(parts[2]);diagnostics.add("Третья координата vt пропущена.");}
      }else if(kind==="vn"){
        if(parts.length!==3||normals.length>=OBJ_LIMITS.vertices)throw new Error("Некорректная таблица нормалей.");normals.push(parts.map(number));
        diagnostics.add("Направления авторских нормалей пересчитаны; разрывы по индексам vn сохранены.");
      }else if(kind==="o"||kind==="g"){
        finish();groupName=parts.join(" ").slice(0,180)||name.slice(0,180)||"OBJ";
      }else if(kind==="s"){
        if(parts.length!==1||!(/^(?:off|on|0|[1-9]\d*)$/.test(parts[0]!)))throw new Error("Некорректная smoothing group.");smoothing=parts[0]==="0"?"off":parts[0]==="on"?"1":parts[0]!;
      }else if(kind==="f"){
        if(parts.length<3||parts.length>4)throw new Error("Поддерживаются треугольники и выпуклые плоские четырёхугольники. Триангулируйте N-gon перед импортом.");
        if(triangles+parts.length-2>OBJ_LIMITS.triangles)throw new Error("OBJ превышает 100 000 треугольников.");
        const corners=parts.map(part=>{const fields=part.split("/");if(fields.length>3||!fields[0])throw new Error("Некорректная ссылка грани.");const v=index(fields[0],positions.length),uv=fields[1]?index(fields[1],uvs.length):null,n=fields[2]?index(fields[2],normals.length):null;return {v,uv,n};});
        if(new Set(corners.map(c=>c.v)).size!==corners.length)throw new Error("Грань содержит повторяющиеся вершины.");
        if(corners.length===4)validateQuad(corners.map(c=>positions[c.v]!));
        const ids=corners.map(c=>{
          if(c.uv===null)hasUv=false;
          const key=`${c.v}/${c.uv}/${c.n??(smoothing==="off"?`face${face}`:`smooth${smoothing}`)}`;
          let id=vertices.get(key);if(id===undefined){id=source.positions.length/3;vertices.set(key,id);source.positions.push(...positions[c.v]!);source.uv!.push(...(c.uv===null?[0,0]:uvs[c.uv]!));}return id;
        });
        source.indices.push(ids[0]!,ids[1]!,ids[2]!);if(ids.length===4)source.indices.push(ids[0]!,ids[2]!,ids[3]!);
        triangles+=ids.length-2;face++;
      }else if(kind==="mtllib"||kind==="usemtl")diagnostics.add("MTL, текстуры и привязки материалов не импортируются; внешние пути не открываются.");
      else if(kind==="l"||kind==="p")diagnostics.add("Линии и точки пропущены: импортируются только поверхности.");
      else throw new Error(`Неподдерживаемая директива ${kind.slice(0,40)}.`);
    }catch(error){throw new Error(`Строка ${line+1}: ${error instanceof Error?error.message:String(error)}`,{cause:error});}
  }
  finish();if(!nodes.length)throw new Error("OBJ не содержит поддерживаемых граней.");
  diagnostics.add("OBJ не хранит единицы, анимацию и PBR. Координаты импортированы без изменения масштаба; группы становятся отдельными mesh.");
  return {nodes,triangles,diagnostics:[...diagnostics]};
}
function validateQuad(p:number[][]){
  const sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]!);
  const cross=(a:number[],b:number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
  const dot=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+v*b[i]!,0);
  const n=cross(sub(p[1]!,p[0]!),sub(p[2]!,p[0]!)),length=Math.hypot(...n),extent=Math.max(...p.map(v=>Math.hypot(...sub(v,p[0]!))));
  if(length===0||Math.abs(dot(n,sub(p[3]!,p[0]!)))>length*Math.max(1,extent)*1e-6)throw new Error("Четырёхугольник вырожден или неплоский.");
  for(let i=0;i<4;i++)if(dot(cross(sub(p[(i+1)%4]!,p[i]!),sub(p[(i+2)%4]!,p[(i+1)%4]!)),n)<=0)throw new Error("Четырёхугольник невыпуклый или самопересекается.");
}

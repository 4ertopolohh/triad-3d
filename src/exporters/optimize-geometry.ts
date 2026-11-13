import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import type { ExportGeometry } from "./export-types";
import { compressGeometry } from "./compress-geometry";
import type { PackedGeometry } from "./packed-geometry";

export interface GeometryOptimization { ratio: number; error: number }
export interface GeometryOptimizationResult { geometry: ExportGeometry; report: string; packed?:PackedGeometry }
const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Exact attribute-aware weld, conservative per-material simplification, then compaction. */
export async function optimizeGeometry(source: ExportGeometry, options: GeometryOptimization): Promise<GeometryOptimizationResult> {
  if (!Number.isFinite(options.ratio) || options.ratio < .1 || options.ratio > 1 || !Number.isFinite(options.error) || options.error < 0 || options.error > .05) throw new Error("Недопустимый бюджет оптимизации.");
  const count = source.positions.length / 3;
  if(count===0&&!(source.indices?.length||source.normals?.length||source.uv?.length||source.colors?.length||source.groups.length))return {geometry:structuredClone(source),report:"Пустой результат геометрии сохранён без оптимизации."};
  if (!Number.isInteger(count) || count < 3 || count > 500_000) throw new Error("Оптимизация поддерживает 3–500000 вершин.");
  const channels = [{key:"positions" as const,size:3}, ...(source.normals ? [{key:"normals" as const,size:3}] : []), ...(source.uv ? [{key:"uv" as const,size:2}] : []), ...(source.colors ? [{key:"colors" as const,size:3}] : [])];
  for (const channel of channels) if (source[channel.key]!.length !== count * channel.size || !source[channel.key]!.every(Number.isFinite)) throw new Error("Повреждённые атрибуты геометрии.");
  const inputIndices = source.indices ?? Array.from({length:count},(_,i)=>i);
  if(inputIndices.length>16_777_216)throw new Error("Индексы превышают бюджет 64 MiB.");
  if (!inputIndices.length || inputIndices.length % 3 || inputIndices.some(i=>!Number.isInteger(i)||i<0||i>=count)) throw new Error("Повреждённые индексы геометрии.");
  const groups = source.groups.length ? source.groups : [{start:0,count:inputIndices.length,materialIndex:0}];
  let end=0;
  for (const group of groups) { if (group.start!==end || group.count<=0 || group.count%3) throw new Error("Группы должны покрывать геометрию без перекрытий."); end+=group.count; }
  if(end!==inputIndices.length)throw new Error("Группы не покрывают геометрию.");
  const welded: ExportGeometry = {positions:[],indices:[],groups:[],...(source.missingUvSlots?{missingUvSlots:[...source.missingUvSlots]}:{})};
  for(const channel of channels)welded[channel.key]=[];
  const keys=new Map<string,number>(),remap:number[]=[];
  for(let i=0;i<count;i++){
    const key=channels.flatMap(c=>source[c.key]!.slice(i*c.size,(i+1)*c.size)).join(",");
    let index=keys.get(key);
    if(index===undefined){index=keys.size;keys.set(key,index);for(const c of channels)welded[c.key]!.push(...source[c.key]!.slice(i*c.size,(i+1)*c.size));}
    remap.push(index);
  }
  await MeshoptSimplifier.ready;
  if(!MeshoptSimplifier.supported)throw new Error("Meshopt недоступен в этом браузере.");
  const positions=new Float32Array(welded.positions), attributes=channels.filter(c=>c.key!=="positions"),stride=attributes.reduce((n,c)=>n+c.size,0);
  if(!positions.every(Number.isFinite))throw new Error("Координаты превышают диапазон Float32.");
  const attributeData=new Float32Array(keys.size*stride);
  for(let i=0;i<keys.size;i++){let offset=i*stride;for(const c of attributes)for(let k=0;k<c.size;k++)attributeData[offset++]=welded[c.key]![i*c.size+k]!;}
  if(!attributeData.every(Number.isFinite))throw new Error("Атрибуты превышают диапазон Float32.");
  let maxError=0;
  for(const group of groups){
    const indices=new Uint32Array(inputIndices.slice(group.start,group.start+group.count).map(i=>remap[i]!));
    const target=Math.max(3,Math.floor(indices.length*options.ratio/3)*3);
    const [reduced,error]=stride ? MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,attributeData,stride,Array(stride).fill(1),null,target,options.error,["LockBorder"])
      : MeshoptSimplifier.simplify(indices,positions,3,target,options.error,["LockBorder"]);
    maxError=Math.max(maxError,error);welded.groups.push({...group,start:welded.indices!.length,count:reduced.length});for(const index of reduced)welded.indices!.push(index);
  }
  const compact: ExportGeometry={...welded,positions:[],indices:[]};for(const c of channels)compact[c.key]=[];
  const used=new Map<number,number>();
  for(const old of welded.indices!){let index=used.get(old);if(index===undefined){index=used.size;used.set(old,index);for(const c of channels)compact[c.key]!.push(...welded[c.key]!.slice(old*c.size,(old+1)*c.size));}compact.indices!.push(index);}
  const before=byteSize(source),after=byteSize(compact);
  // Keep original if JSON representation grows; no quality tradeoff without a size benefit.
  const geometry=after<before?compact:structuredClone(source);
  const packed=await compressGeometry(geometry);
  return {geometry,packed,report:`Треугольники ${inputIndices.length/3} → ${(geometry.indices?.length??geometry.positions.length/3)/3}; JSON ${before} → ${byteSize(geometry)} байт; Meshopt/base64 ${byteSize(packed)} байт; оценка ошибки Meshopt ${after<before?maxError.toPrecision(3):0} (относительная, с весами атрибутов). Швы и границы материалов сохранены; целевой процент не гарантирован.`};
}

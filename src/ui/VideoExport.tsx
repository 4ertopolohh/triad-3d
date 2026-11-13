import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import type { PreparedExport } from "../exporters/package";
import { parameterOverrides } from "../exporters/parameter-overrides";
import type { ExportParameter } from "../exporters/export-types";
import { videoPlan, type VideoOptions } from "../exporters/video-plan";

export function VideoExport({store,prepared,disabled,parameters}:{store:EditorStore;prepared:PreparedExport;disabled:boolean;parameters:ExportParameter[]}){
  const [options,setOptions]=useState<VideoOptions>({width:1280,height:720,fps:30,duration:10,format:"webm"});
  const [result,setResult]=useState<{blob:Blob;format:string}|null>(null),[error,setError]=useState("");
  const [capabilities,setCapabilities]=useState<string>("Проверка кодеков…");
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{let current=true;void import("../exporters/video").then(m=>m.videoCapabilities(options)).then(c=>{if(current)setCapabilities(`WebCodecs: WebM/VP9 — ${c.webm?"да":"нет"}; MP4/H.264 — ${c.mp4?"да":"нет"}. MediaRecorder/WebM — ${c.mediaRecorder?"да":"нет"} (не используется для точного FPS).`);}).catch(e=>{if(current)setCapabilities(String(e));});return()=>{current=false;};},[options]);
  function change(value:Partial<VideoOptions>){setOptions(old=>({...old,...value}));setResult(null);setError("");}
  async function prepare(){
    setResult(null);setError("");let blob:Blob|undefined;
    const outcome=await store.jobs.run({id:crypto.randomUUID(),name:"Видеорендер",cancellable:true,validate:()=>{try{videoPlan(options);return null;}catch(e){return {code:"VALIDATION_FAILED",message:String(e)};}},compute:async(_input,signal,progress)=>{
      try{const {exportVideo}=await import("../exporters/video");blob=await exportVideo(prepared,options,signal,progress,parameterOverrides(parameters,prepared.parameterNodeIds));return {ok:true,value:true};}
      catch(e){return {ok:false,error:{code:signal.aborted?"JOB_CANCELLED":"COMPUTE_FAILED",message:String(e)}};}
    }});
    if(!active.current)return;
    if(outcome.ok&&blob)setResult({blob,format:options.format});else if(!outcome.ok)setError(outcome.error.message);
  }
  return <details><summary>Видео WebM / MP4</summary><p>Фиксированный шаг timeline, без звука. Камера и материалы из подготовленного экспорта. Физика отключена; события курсора и клика не записываются. Временные правила воспроизводятся последовательно.</p>
    <p>{capabilities}</p><fieldset disabled={disabled}>
      <label>Размер видео<select aria-label="Размер видео" value={`${options.width}x${options.height}`} onChange={e=>{const [width,height]=e.target.value.split("x").map(Number);change({width:width!,height:height!});}}><option value="640x360">640 × 360</option><option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option></select></label>
      <label>FPS видео<select aria-label="FPS видео" value={options.fps} onChange={e=>change({fps:Number(e.target.value)})}>{[24,25,30,60].map(fps=><option key={fps}>{fps}</option>)}</select></label>
      <label>Длительность видео, с<input type="number" min="1" max="30" step="1" value={options.duration} onChange={e=>change({duration:Number(e.target.value)})}/></label>
      <label>Формат видео<select aria-label="Формат видео" value={options.format} onChange={e=>change({format:e.target.value as VideoOptions["format"]})}><option value="webm">WebM / VP9</option><option value="mp4">MP4 / H.264</option></select></label>
      <button onClick={()=>void prepare()}>Подготовить видео</button>
      {result&&<button onClick={()=>{const url=URL.createObjectURL(result.blob),link=document.createElement("a");link.href=url;link.download=`triad-video.${result.format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Скачать видео</button>}
    </fieldset>{error&&<p role="alert">{error}</p>}</details>;
}

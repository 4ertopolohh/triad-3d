import { createRoot } from "react-dom/client";
import { BufferTarget, CanvasSource, Output, WebMOutputFormat, Mp4OutputFormat, Quality, canEncodeVideo } from "mediabunny";
import type { PreparedExport } from "./package";
import { TriadRuntime, type TriadModelProps } from "./runtime";
import { renderVideoFrames, videoPlan, type VideoOptions } from "./video-plan";

const quality=new Quality({bitrate:8_000_000});
export async function videoCapabilities(options:VideoOptions){
  videoPlan(options);
  const config={width:options.width,height:options.height,frameRate:options.fps,quality};
  const [webm,mp4]=await Promise.all([canEncodeVideo("vp9",config),canEncodeVideo("avc",config)]);
  return {webm,mp4,mediaRecorder:typeof MediaRecorder!=="undefined"&&MediaRecorder.isTypeSupported("video/webm")};
}

export async function exportVideo(prepared:PreparedExport,options:VideoOptions,signal:AbortSignal,progress:(value:number)=>void,nodeOverrides:TriadModelProps["nodeOverrides"]={}):Promise<Blob>{
  videoPlan(options);signal.throwIfAborted();
  const supported=await videoCapabilities(options);signal.throwIfAborted();
  if(!supported[options.format])throw new Error("Кодек недоступен. Выберите WebM или откройте проект в браузере с WebCodecs; можно также экспортировать TSX/ZIP.");
  const host=document.createElement("div");
  host.style.cssText=`position:fixed;left:-10000px;top:0;width:${options.width}px;height:${options.height}px;pointer-events:none`;
  host.setAttribute("aria-hidden","true");document.body.append(host);
  const root=createRoot(host),urls:Record<string,string>=Object.create(null);
  let output:Output< WebMOutputFormat|Mp4OutputFormat,BufferTarget>|undefined;
  let rejectReady:(error:Error)=>void=()=>{};
  let runtimeError:Error|undefined;
  const abort=()=>{rejectReady(new Error("Видеорендер отменён."));void output?.cancel().catch(()=>{});};
  signal.addEventListener("abort",abort,{once:true});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    for(const asset of prepared.bundle.project.assets){
      const bytes=prepared.files.get(`public/${asset.path}`);
      if(!bytes)throw new Error(`Нет байтов ресурса ${asset.id}.`);
      urls[asset.id]=URL.createObjectURL(new Blob([bytes.slice().buffer],{type:asset.mediaType}));
    }
    const render=await new Promise<(seconds:number)=>Promise<HTMLCanvasElement>>((resolve,reject)=>{
      rejectReady=reject;timer=setTimeout(()=>reject(new Error("Истёк срок подготовки видеорендера.")),60_000);
      root.render(<TriadRuntime data={prepared.bundle} width={options.width} height={options.height} assetUrls={urls} playing={false} time={0}
        nodeOverrides={nodeOverrides} __triadCapture={{ready:resolve}} onError={message=>{runtimeError=new Error(message);reject(runtimeError);}} />);
      if(signal.aborted)abort();
    });
    clearTimeout(timer);signal.throwIfAborted();
    const canvas=await render(0);signal.throwIfAborted();
    output=new Output({format:options.format==="webm"?new WebMOutputFormat():new Mp4OutputFormat(),target:new BufferTarget()});
    const source=new CanvasSource(canvas,{codec:options.format==="webm"?"vp9":"avc",quality});
    output.addVideoTrack(source,{frameRate:options.fps});await output.start();
    await renderVideoFrames(options,async(time,duration)=>{
      if(runtimeError)throw runtimeError;
      await render(time);signal.throwIfAborted();
      await source.add(time,duration);
    },signal,progress);
    source.close();await output.finalize();signal.throwIfAborted();
    if(runtimeError)throw runtimeError;
    if(!output.target.buffer)throw new Error("Кодировщик не создал видео.");
    return new Blob([output.target.buffer],{type:options.format==="webm"?"video/webm":"video/mp4"});
  }finally{
    clearTimeout(timer);signal.removeEventListener("abort",abort);
    if(output&&output.state!=="finalized"&&output.state!=="canceled")await output.cancel().catch(()=>{});
    root.unmount();host.remove();Object.values(urls).forEach(url=>URL.revokeObjectURL(url));
  }
}

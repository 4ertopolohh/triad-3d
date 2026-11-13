import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
const start=document.querySelector('#start'),cancel=document.querySelector('#cancel'),status=document.querySelector('#status'),video=document.querySelector('#result');
let current,objectUrl;
cancel.onclick=()=>{current?.terminate();current=undefined;status.textContent='Отменено';start.disabled=false;cancel.disabled=true;};
start.onclick=async()=>{
  start.disabled=true;cancel.disabled=false;const ffmpeg=new FFmpeg();current=ffmpeg;const begin=performance.now();
  status.textContent='Загрузка WASM…';
  try{
    await ffmpeg.load({coreURL,wasmURL});if(current!==ffmpeg)return;
    const loaded=performance.now();status.textContent='Кодирование 300 кадров…';
    const exit=await ffmpeg.exec(['-f','lavfi','-i','testsrc=size=640x360:rate=30','-t','10','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart','output.mp4']);
    if(exit!==0)throw new Error(`FFmpeg exit ${exit}`);
    const bytes=await ffmpeg.readFile('output.mp4');if(current!==ffmpeg)return;
    if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));video.src=objectUrl;
    status.textContent=JSON.stringify({ok:true,loadMs:loaded-begin,encodeMs:performance.now()-loaded,totalMs:performance.now()-begin,bytes:bytes.length,expectedFrames:300,expectedDuration:10,crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer!=='undefined',userAgent:navigator.userAgent},null,2);
  }catch(error){if(current===ffmpeg)status.textContent=String(error);}
  finally{ffmpeg.terminate();if(current===ffmpeg){current=undefined;start.disabled=false;cancel.disabled=true;}}
};

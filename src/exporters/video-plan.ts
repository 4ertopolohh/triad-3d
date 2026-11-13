export interface VideoOptions { width:number; height:number; fps:number; duration:number; format:"webm"|"mp4" }
export function videoPlan(options:VideoOptions):{frames:number;duration:number}{
  if(![options.width,options.height].every(n=>Number.isInteger(n)&&n>=128&&n<=1920&&n%2===0)
    ||options.width*options.height>1920*1080||![24,25,30,60].includes(options.fps)
    ||!Number.isFinite(options.duration)||options.duration<1||options.duration>30
    ||!["webm","mp4"].includes(options.format))throw new Error("Видео: чётные размеры 128–1920 px, до 1920×1080, 24/25/30/60 FPS, длительность 1–30 с.");
  const frames=Math.round(options.duration*options.fps);
  return {frames,duration:frames/options.fps};
}

/** Frame timestamps derive from the index, never the wall clock or cumulative deltas. */
export async function renderVideoFrames(options:VideoOptions,render:(time:number,duration:number,index:number)=>Promise<void>,signal:AbortSignal,progress:(value:number)=>void){
  const {frames}=videoPlan(options);
  for(let i=0;i<frames;i++){
    signal.throwIfAborted();
    await render(i/options.fps,1/options.fps,i);
    signal.throwIfAborted();progress((i+1)/frames);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
}

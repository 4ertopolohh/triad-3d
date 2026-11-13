import { browserImageDecoder, prepareImageAsset } from "../assets/prepare-image-asset";
import type { Asset } from "../domain/types";
export interface TextureOptimizationResult { bytes:Uint8Array; asset:Asset; report:string }
/** Export-only color texture conversion; numeric PBR maps are excluded by the caller. */
export async function optimizeTexture(asset:Asset,bytes:Uint8Array):Promise<TextureOptimizationResult>{
  const validated=await prepareImageAsset(new File([bytes.slice().buffer],asset.path,{type:asset.mediaType}),browserImageDecoder);
  if(!validated.ok)throw new Error(validated.error.message);
  const original=await createImageBitmap(new Blob([bytes.slice().buffer],{type:asset.mediaType}),{premultiplyAlpha:"none"});
  let decoded:ImageBitmap|undefined;
  try{
    const scale=Math.min(1,2048/Math.max(original.width,original.height)),width=Math.max(1,Math.round(original.width*scale)),height=Math.max(1,Math.round(original.height*scale));
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("Canvas 2D недоступен.");
    ctx.drawImage(original,0,0,width,height);const reference=ctx.getImageData(0,0,width,height).data;
    const blob=await canvas.convertToBlob({type:"image/webp",quality:.9});
    if(blob.type!=="image/webp")return {asset,bytes,report:"WebP-кодер недоступен; исходная текстура сохранена."};
    decoded=await createImageBitmap(blob,{premultiplyAlpha:"none"});ctx.clearRect(0,0,width,height);ctx.drawImage(decoded,0,0);const encoded=ctx.getImageData(0,0,width,height).data;
    let squared=0,maximum=0;for(let i=0;i<reference.length;i++){const delta=Math.abs(reference[i]!-encoded[i]!);squared+=delta*delta;maximum=Math.max(maximum,delta);}
    const rmse=Math.sqrt(squared/reference.length),candidate=new Uint8Array(await blob.arrayBuffer());
    if(candidate.length>=bytes.length)return {asset,bytes,report:`WebP не уменьшил размер (${bytes.length} → ${candidate.length} байт); сохранён исходник.`};
    const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",candidate))].map(n=>n.toString(16).padStart(2,"0")).join("");
    return {asset:{...asset,hash,path:`assets/${hash}.webp`,mediaType:"image/webp"},bytes:candidate,report:`Цветовая текстура ${original.width}×${original.height} → ${width}×${height}, ${bytes.length} → ${candidate.length} байт; WebP quality 0,9; RGBA RMSE ${rmse.toFixed(2)}/255, max ${maximum}/255 относительно уменьшенного оригинала. Потеря деталей от масштабирования в RMSE не входит.`};
  }finally{original.close();decoded?.close();}
}

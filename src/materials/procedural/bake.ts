import type { ProceduralHeightConfig, ProceduralRoughnessConfig } from "../../domain/types";
import { generateProceduralMap } from "./generate";

/** PNG rows are inverted to roundtrip through the raster loader's flipY. No color conversion. */
export function bakePixels(config: ProceduralHeightConfig | ProceduralRoughnessConfig, baseRoughness = .5): {width:number; height:number; rgba:Uint8ClampedArray} {
  if (!Number.isFinite(baseRoughness) || baseRoughness < 0 || baseRoughness > 1) throw new Error("Некорректная шероховатость.");
  const result = generateProceduralMap({kind:config.kind,seed:config.seed,scale:config.scale,intensity:config.intensity,width:config.resolution,height:config.resolution,...("directionRadians" in config ? {directionRadians:config.directionRadians} : {})});
  if (!result.ok) throw new Error(result.error.message);
  const {width,height,pixels,channel} = result.value;
  const rgba = new Uint8ClampedArray(width*height*4);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const value = pixels[y*width+x]!;
    const scalar = channel === "roughness" ? Math.round(255*Math.min(1,Math.max(0,baseRoughness+(value-128)/255))) : value;
    const index = ((height-1-y)*width+x)*4;
    rgba.set([scalar,scalar,scalar,255],index);
  }
  return {width,height,rgba};
}

export async function bakePng(config: ProceduralHeightConfig | ProceduralRoughnessConfig, baseRoughness = .5): Promise<Blob> {
  const {width,height,rgba} = bakePixels(config,baseRoughness);
  const canvas = new OffscreenCanvas(width,height), context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не поддерживает запекание PNG.");
  context.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>,width,height),0,0);
  return canvas.convertToBlob({type:"image/png"});
}

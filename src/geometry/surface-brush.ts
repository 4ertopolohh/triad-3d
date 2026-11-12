import type { Vec3 } from "../domain/types";
import { brushCenters, isBrushSymmetry, MAX_BRUSH_SAMPLES, MAX_BRUSH_VERTICES, type BrushSymmetry } from "./displace-brush";
import { validateEditableSource, type EditableMeshSource } from "./mesh-edit";

export interface SurfaceStroke {
  mode: "paint" | "material";
  samples: Vec3[];
  radius: number;
  strength: number;
  symmetry: BrushSymmetry;
  shape: "round" | "box";
  fill: boolean;
  color: Vec3;
  materialSlot: number;
}

export function validSurfaceStroke(value: unknown): value is SurfaceStroke {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as SurfaceStroke;
  return Object.keys(v).every(k => ["mode","samples","radius","strength","symmetry","shape","fill","color","materialSlot"].includes(k))
    && (v.mode === "paint" || v.mode === "material") && (v.shape === "round" || v.shape === "box")
    && typeof v.fill === "boolean" && isBrushSymmetry(v.symmetry)
    && Number.isFinite(v.radius) && v.radius >= .01 && v.radius <= 10
    && Number.isFinite(v.strength) && v.strength >= 0 && v.strength <= 1
    && Number.isInteger(v.materialSlot) && v.materialSlot >= 0 && v.materialSlot <= 255
    && Array.isArray(v.color) && v.color.length === 3 && v.color.every(n => Number.isFinite(n) && n >= 0 && n <= 1)
    && Array.isArray(v.samples) && v.samples.length > 0 && v.samples.length <= MAX_BRUSH_SAMPLES
    && v.samples.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite));
}

/** One stroke uses maximum influence, so pointer sampling frequency cannot accumulate paint. */
export function surfaceStroke(source: EditableMeshSource, stroke: SurfaceStroke): EditableMeshSource {
  if (!validSurfaceStroke(stroke)) throw new Error("Некорректные параметры кисти поверхности.");
  const error = validateEditableSource(source); if (error) throw new Error(error);
  if (source.positions.length/3 > MAX_BRUSH_VERTICES) throw new Error("Слишком много вершин для кисти.");
  if (!stroke.strength) return source;
  const centers = stroke.samples.flatMap(p => brushCenters(p,stroke.symmetry));
  const weight = (point: readonly number[]) => {
    if (stroke.fill) return stroke.strength;
    let influence = 0;
    for (const center of centers) {
      const delta = point.map((v,i) => Math.abs(v-center[i]!));
      const distance = stroke.shape === "box" ? Math.max(...delta) : Math.hypot(...delta);
      if (distance < stroke.radius) influence = Math.max(influence,(1-distance/stroke.radius)**2);
    }
    return influence*stroke.strength;
  };
  let changed = false;
  if (stroke.mode === "paint") {
    const colors = source.colors?.slice() ?? Array<number>(source.positions.length).fill(1);
    for (let i = 0; i < colors.length; i += 3) {
      const influence = weight(source.positions.slice(i,i+3));
      for (let channel = 0; channel < 3; channel++) {
        const next = Math.fround(colors[i+channel]!*(1-influence)+stroke.color[channel]!*influence);
        if (next !== colors[i+channel]) { changed = true; colors[i+channel] = next; }
      }
    }
    return changed ? {...source,colors} : source;
  }
  const faceMaterials = source.faceMaterials?.slice() ?? Array<number>(source.indices.length/3).fill(0);
  for (let triangle = 0; triangle < faceMaterials.length; triangle++) {
    const ids = source.indices.slice(3*triangle,3*triangle+3);
    const center = [0,1,2].map(axis => ids.reduce((sum,id) => sum+source.positions[id*3+axis]!,0)/3);
    if (weight(center) > 0 && faceMaterials[triangle] !== stroke.materialSlot) { changed = true; faceMaterials[triangle] = stroke.materialSlot; }
  }
  return changed ? {...source,faceMaterials} : source;
}

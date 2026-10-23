export type ProceduralPatternKind = "grain" | "scratches" | "stone";
export type ProceduralMapChannel = "roughness" | "height";

export interface ProceduralMapRequest {
  kind: ProceduralPatternKind;
  width: number;
  height: number;
  seed: number;
  scale: number;
  intensity: number;
  directionRadians?: number;
}

export interface ProceduralMapResult {
  kind: ProceduralPatternKind;
  channel: ProceduralMapChannel;
  width: number;
  height: number;
  /** Scalar, linear data; one byte per pixel, row major. */
  pixels: Uint8Array;
}

export interface ProceduralMapError {
  code: "INVALID_REQUEST";
  field: string;
  message: string;
}

export type ProceduralMapGeneration =
  | { ok: true; value: ProceduralMapResult }
  | { ok: false; error: ProceduralMapError };

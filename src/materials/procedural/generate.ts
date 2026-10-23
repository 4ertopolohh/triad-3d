import { hash01, valueNoise } from "./noise";
import type { ProceduralMapGeneration, ProceduralMapRequest } from "./types";

const keys = new Set(["kind", "width", "height", "seed", "scale", "intensity", "directionRadians"]);
const invalid = (field: string, message: string): ProceduralMapGeneration => ({ ok: false, error: { code: "INVALID_REQUEST", field, message } });

function validate(input: unknown): ProceduralMapGeneration | ProceduralMapRequest {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return invalid("request", "Expected a plain request object.");
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalid("request", "Expected a plain request object.");
  const request = input as Record<string, unknown>;
  for (const key of Reflect.ownKeys(request)) {
    if (typeof key !== "string" || !keys.has(key)) return invalid(String(key), "Unknown request field.");
  }
  if (request.kind !== "grain" && request.kind !== "scratches" && request.kind !== "stone") return invalid("kind", "Unknown pattern kind.");
  for (const field of ["width", "height"] as const) {
    const value = request[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 16 || value > 512) return invalid(field, "Expected an integer from 16 to 512.");
  }
  if (typeof request.seed !== "number" || !Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) return invalid("seed", "Expected a uint32 seed.");
  if (typeof request.scale !== "number" || !Number.isFinite(request.scale) || request.scale < 0.25 || request.scale > 64) return invalid("scale", "Expected a finite number from 0.25 to 64.");
  if (typeof request.intensity !== "number" || !Number.isFinite(request.intensity) || request.intensity < 0 || request.intensity > 1) return invalid("intensity", "Expected a finite number from 0 to 1.");
  if (request.kind !== "scratches" && "directionRadians" in request) return invalid("directionRadians", "Direction is only valid for scratches.");
  if ("directionRadians" in request && (typeof request.directionRadians !== "number" || !Number.isFinite(request.directionRadians) || request.directionRadians < -Math.PI || request.directionRadians > Math.PI)) return invalid("directionRadians", "Expected a finite angle from -π to π.");
  return request as unknown as ProceduralMapRequest;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function grain(x: number, y: number, scale: number, seed: number): number {
  const frequency = scale * 6;
  const coarse = valueNoise(x * frequency, y * frequency, seed);
  const fine = valueNoise(x * frequency * 3.7, y * frequency * 3.7, seed ^ 0xa57c);
  return (coarse * 0.38 + fine * 0.62 - 0.5) * 2;
}

function stone(x: number, y: number, scale: number, seed: number): number {
  const broad = valueNoise(x * scale * 1.7, y * scale * 1.7, seed);
  const detail = valueNoise(x * scale * 5.1, y * scale * 5.1, seed ^ 0x71e3);
  const grainlet = valueNoise(x * scale * 13.3, y * scale * 13.3, seed ^ 0x43c1);
  const ridge = 1 - Math.abs(2 * broad - 1);
  return (broad * 0.48 + detail * 0.3 + grainlet * 0.12 + ridge * 0.1 - 0.5) * 2;
}

function scratches(x: number, y: number, scale: number, seed: number, direction: number): number {
  const cos = Math.cos(direction);
  const sin = Math.sin(direction);
  const along = (x * cos + y * sin) * scale * 8;
  const across = (-x * sin + y * cos) * scale * 16;
  const lane = Math.floor(across);
  const segment = Math.floor(along / 3);
  const lanePresence = hash01(lane, 0, seed ^ 0x2743);
  const offset = 0.15 + hash01(lane, 1, seed) * 0.7;
  const distance = Math.abs(across - lane - offset);
  const width = 0.035 + hash01(lane, 2, seed) * 0.12;
  const segmentPresence = hash01(lane, segment, seed ^ 0x9ac3);
  const edge = Math.min(1, (along / 3 - segment) * 9, (1 - (along / 3 - segment)) * 9);
  const line = lanePresence > 0.36 && segmentPresence > 0.2
    ? Math.max(0, 1 - distance / width) * Math.max(0, edge) : 0;
  const background = valueNoise(x * scale * 3, y * scale * 3, seed ^ 0x857f);
  return line * 0.85 + (background - 0.5) * 0.22;
}

/**
 * Pure scalar map generator. Neutral roughness is 128 and neutral height is 128.
 * Intensity linearly blends the neutral value with the pattern; no document or GPU state is used.
 */
export function generateProceduralMap(input: unknown): ProceduralMapGeneration {
  const checked = validate(input);
  if ("ok" in checked) return checked;
  const { kind, width, height, seed, scale, intensity } = checked;
  const channel = kind === "stone" ? "height" : "roughness";
  const pixels = new Uint8Array(width * height);
  if (intensity === 0) {
    pixels.fill(128);
    return { ok: true, value: { kind, channel, width, height, pixels } };
  }
  const direction = checked.directionRadians ?? 0;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const x = (column + 0.5) / width;
      const y = (row + 0.5) / height;
      const variation = kind === "grain" ? grain(x, y, scale, seed)
        : kind === "stone" ? stone(x, y, scale, seed)
          : scratches(x, y, scale, seed, direction);
      pixels[row * width + column] = Math.round(clamp01((128 / 255) + variation * intensity * 0.42) * 255);
    }
  }
  return { ok: true, value: { kind, channel, width, height, pixels } };
}

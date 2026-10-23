import { hexToLinear } from "./presets";

function linearChannelToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

export function linearToHex(color: readonly number[]): string | null {
  if (color.length !== 3 || color.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return null;
  return `#${color.map(value => Math.round(linearChannelToSrgb(value) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function parseHexColor(raw: string): readonly [number, number, number] | null {
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? hexToLinear(raw) : null;
}

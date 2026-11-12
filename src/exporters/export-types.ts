import type { Project } from "../domain/types";
export type ExportProfile = "max" | "balanced" | "lite";
export interface ExportGeometry { positions: number[]; indices: number[] | null; normals?: number[]; uv?: number[]; colors?: number[]; missingUvSlots?: number[]; groups: { start: number; count: number; materialIndex?: number | undefined }[] }
export interface RuntimeBundle { project: Project; geometries: Record<string, ExportGeometry>; profile: ExportProfile }

export interface ExportParameter { name: string; nodeId: string; property: "scale" | "color"; defaultValue: number | string }

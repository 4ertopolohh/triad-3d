import type { Project, GroupNode, MeshNode, MeshSource } from "../domain/types";
export type ExportProfile = "max" | "balanced" | "lite";
export interface ExportGeometry { positions: number[]; indices: number[] | null; normals?: number[]; uv?: number[]; colors?: number[]; missingUvSlots?: number[]; groups: { start: number; count: number; materialIndex?: number | undefined }[] }
export type RuntimeProject = Omit<Project,"nodes"> & {nodes:(GroupNode | (Omit<MeshNode,"meshSource"> & {meshSource:MeshSource|{kind:"baked"}}))[]};
export interface RuntimeBundle { project: RuntimeProject; geometries: Record<string, ExportGeometry>; profile: ExportProfile; instancePlayback?: {clips:Record<string,string>;defaultClip:string|null;speed:number;inherited:boolean}[] }

export interface ExportParameter { name: string; nodeId: string; property: "scale" | "color"; defaultValue: number | string }

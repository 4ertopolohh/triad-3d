import type { Project, MeshNode } from "../../domain/types";
import type { CsgErrorCode, CsgOperation, CsgWarning, MeshData } from "../csg";

export type BooleanParameters = { operation: CsgOperation; cutterNodeId: string };
export type MirrorParameters = { axes: "x" | "y" | "z" | "xy" | "xz" | "yz" | "xyz"; pivot: readonly [number, number, number]; mergeSeam: boolean };
export type ArrayParameters =
  | { mode: "linear"; count: number; axis: "x" | "y" | "z"; step: number; offset: readonly [number, number, number] }
  | { mode: "radial"; count: number; axis: "x" | "y" | "z"; angleStepDegrees: number; pivot: readonly [number, number, number]; offset: readonly [number, number, number] };
export type ModifierErrorCode = CsgErrorCode | "INVALID_REFERENCE" | "DEPENDENCY_CYCLE" | "INVALID_MODIFIER" | "UNSUPPORTED_MODIFIER" | "ASSET_DECODE_FAILED" | "STALE_PROJECT";
export type ModifierDiagnostic = { code: ModifierErrorCode; message: string; nodeId?: string; modifierId?: string };
export type ModifierWarning = CsgWarning | { code: "MIRROR_UNMERGED"; message: string };
export type GeometryAttributes = { uv?: boolean; normals?: boolean; materialGroups?: boolean; materialSlots?: number };
/** Resolver returns detached local-space buffers and a content fingerprint (normally Asset.hash). No network access. */
export type AssetGeometryResolver = (node: Readonly<MeshNode>, project: Readonly<Project>, signal?: AbortSignal) => Promise<{ mesh: MeshData; fingerprint: string; attributes?: GeometryAttributes }>;
export type EvaluationResult =
  | { ok: true; mesh: MeshData; empty: boolean; warnings: ModifierWarning[]; appliedModifierIds: string[]; fallback: false }
  | { ok: false; error: ModifierDiagnostic; mesh?: MeshData; empty?: boolean; warnings: ModifierWarning[]; appliedModifierIds: string[]; fallback: boolean };

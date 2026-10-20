export type CsgOperation = "subtract" | "union" | "intersect";
export type MeshData = { positions: Float32Array; indices: Uint32Array };
export type CsgErrorCode = "FILE_INVALID" | "GEOMETRY_NON_MANIFOLD" | "GEOMETRY_DEGENERATE" | "RESOURCE_TOO_LARGE" | "JOB_CANCELLED" | "WORKER_FAILED" | "JOB_BUSY";
export class CsgError extends Error {
  constructor(public readonly code: CsgErrorCode, message: string) { super(`${code}: ${message}`); this.name = "CsgError"; }
}

/** Column-major local-to-world matrices. The result is always in target local coordinates. */
export type CsgOperand = {
  mesh: MeshData;
  worldMatrix?: readonly number[];
  attributes?: { uv?: boolean; normals?: boolean; materialGroups?: boolean; materialSlots?: number };
};
export type CsgRequest = { jobId: string; operation: CsgOperation; target: CsgOperand; cutter: CsgOperand };
export type CsgWarning = { code: "UV_DROPPED" | "NORMALS_RECOMPUTED" | "MATERIALS_DROPPED"; message: string };
export type CsgResult = {
  jobId: string;
  /** XYZ and triangles only. No UV, normals, material groups, or face provenance. */
  output: MeshData;
  /** Per output triangle: 0 target surface, 1 cutter surface, 2 new subtract cut surface. */
  faceOrigins: Uint8Array;
  coordinateSpace: "target-local";
  empty: boolean;
  stats: { inputTriangles: number; outputTriangles: number; computeMs: number };
  warnings: CsgWarning[];
};

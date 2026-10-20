import type { CsgErrorCode, CsgOperation, CsgResult, CsgWarning, MeshData } from "./types";
export type WorkerRequest = { jobId: string; operation: CsgOperation; first: MeshData; second: MeshData; warnings: CsgWarning[] };
export type WorkerResponse = { jobId: string; ok: true; result: CsgResult } | { jobId: string; ok: false; code: CsgErrorCode; message: string };

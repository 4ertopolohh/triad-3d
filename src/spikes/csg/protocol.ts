import type { MeshData, Operation } from "./core";
export type Request = { id: number; operation: Operation; first: MeshData; second: MeshData };
export type Response =
  | { id: number; ok: true; result: Awaited<ReturnType<typeof import("./core").compute>> }
  | { id: number; ok: false; code: string; message: string };

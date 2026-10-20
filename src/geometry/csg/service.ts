import { MAX_CSG_INPUT_BYTES, validateMesh } from "./core";
import { prepareCsgRequest } from "./prepare";
import { CsgError, type CsgErrorCode, type CsgRequest, type CsgResult } from "./types";
import type { WorkerResponse } from "./protocol";

export class CsgService {
  private active: { worker: Worker; jobId: string; reject: (error: CsgError) => void; cleanup: () => void } | undefined;
  private disposed = false;

  run(request: CsgRequest, signal?: AbortSignal): Promise<CsgResult> {
    if (this.disposed) return Promise.reject(new CsgError("WORKER_FAILED", "CSG service disposed"));
    if (this.active) return Promise.reject(new CsgError("JOB_BUSY", "CSG job already running"));
    if (signal?.aborted) return Promise.reject(new CsgError("JOB_CANCELLED", "Вычисление отменено"));
    let prepared: ReturnType<typeof prepareCsgRequest>;
    try { prepared = prepareCsgRequest(request); }
    catch (error) { return Promise.reject(error); }
    const inputBytes = prepared.first.positions.byteLength + prepared.first.indices.byteLength + prepared.second.positions.byteLength + prepared.second.indices.byteLength;
    if (inputBytes > MAX_CSG_INPUT_BYTES) return Promise.reject(new CsgError("RESOURCE_TOO_LARGE", "Общий объём буферов CSG превышает защитный лимит 64 MiB"));
    let worker: Worker;
    try { worker = new Worker(new URL("./csg.worker.ts", import.meta.url), { type: "module" }); }
    catch (error) { return Promise.reject(new CsgError("WORKER_FAILED", String(error))); }
    return new Promise((resolve, reject) => {
      let settled = false;
      // A silent worker exit has no reliable browser event. This is a liveness guard, not a compute budget.
      const watchdog = setTimeout(() => fail(new CsgError("WORKER_FAILED", "CSG worker stopped responding")), 5 * 60 * 1000);
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        signal?.removeEventListener("abort", abort);
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
        worker.terminate();
        if (this.active?.worker === worker) this.active = undefined;
      };
      const fail = (error: CsgError) => { cleanup(); reject(error); };
      const abort = () => fail(new CsgError("JOB_CANCELLED", "Вычисление отменено"));
      this.active = { worker, jobId: request.jobId, reject: fail, cleanup };
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (this.active?.worker !== worker) return;
        const response = event.data;
        if (!response || typeof response.jobId !== "string") { fail(new CsgError("WORKER_FAILED", "Malformed CSG worker response")); return; }
        if (response.jobId !== request.jobId) { fail(new CsgError("WORKER_FAILED", "Unexpected CSG worker jobId")); return; }
        if (typeof response.ok !== "boolean") { fail(new CsgError("WORKER_FAILED", "Malformed CSG worker response")); return; }
        if (!response.ok) {
          const codes: CsgErrorCode[] = ["FILE_INVALID", "GEOMETRY_NON_MANIFOLD", "GEOMETRY_DEGENERATE", "RESOURCE_TOO_LARGE", "JOB_CANCELLED", "WORKER_FAILED", "JOB_BUSY"];
          if (!codes.includes(response.code) || typeof response.message !== "string") fail(new CsgError("WORKER_FAILED", "Malformed CSG worker error"));
          else fail(new CsgError(response.code, response.message));
          return;
        }
        try {
          if (response.result?.jobId !== request.jobId || response.result.coordinateSpace !== "target-local") throw new Error("Invalid result contract");
          validateMesh(response.result.output, response.result.empty);
          if (!(response.result.faceOrigins instanceof Uint8Array) || response.result.faceOrigins.length !== response.result.output.indices.length / 3 || response.result.faceOrigins.some((value) => value > 2)) throw new Error("Invalid face provenance");
          if (response.result.empty !== (response.result.output.indices.length === 0)) throw new Error("Invalid empty result");
          cleanup(); resolve(response.result);
        } catch (error) { fail(new CsgError("WORKER_FAILED", `Malformed CSG result: ${String(error)}`)); }
      };
      worker.onerror = (event) => fail(new CsgError("WORKER_FAILED", event.message || "CSG worker failed"));
      worker.onmessageerror = () => fail(new CsgError("WORKER_FAILED", "CSG worker message decoding failed"));
      try { worker.postMessage(prepared, [prepared.first.positions.buffer, prepared.first.indices.buffer, prepared.second.positions.buffer, prepared.second.indices.buffer]); }
      catch (error) { fail(new CsgError("WORKER_FAILED", `CSG worker dispatch failed: ${String(error)}`)); }
    });
  }

  cancel(jobId?: string): void {
    if (this.active && (!jobId || this.active.jobId === jobId)) this.active.reject(new CsgError("JOB_CANCELLED", "Вычисление отменено"));
  }
  dispose(): void { this.disposed = true; this.cancel(); }
}

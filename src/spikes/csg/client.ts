import type { MeshData, Operation } from "./core";
import type { Request, Response } from "./protocol";

export class CsgClient {
  private worker: Worker | undefined;
  private sequence = 0;
  private rejectPending: ((error: Error) => void) | undefined;

  run(operation: Operation, first: MeshData, second: MeshData): Promise<Response & { ok: true }> {
    this.cancel();
    const id = ++this.sequence;
    const worker = new Worker(new URL("./csg.worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      this.rejectPending = reject;
      worker.onmessage = (event: MessageEvent<Response>) => {
        if (this.worker !== worker || event.data.id !== id) return;
        this.worker = undefined; this.rejectPending = undefined; worker.terminate();
        if (event.data.ok) resolve(event.data);
        else reject(new Error(`${event.data.code}: ${event.data.message}`));
      };
      worker.onerror = (event) => {
        if (this.worker !== worker) return;
        this.worker = undefined; this.rejectPending = undefined; worker.terminate();
        reject(new Error(event.message));
      };
      const request: Request = { id, operation, first, second };
      worker.postMessage(request); // structured clone preserves caller-owned buffers
    });
  }

  cancel() {
    ++this.sequence;
    this.worker?.terminate();
    this.worker = undefined;
    this.rejectPending?.(new Error("JOB_CANCELLED: Вычисление отменено"));
    this.rejectPending = undefined;
  }

  dispose() { this.cancel(); }
}

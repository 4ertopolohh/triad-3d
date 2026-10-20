import { afterEach, expect, it, vi } from "vitest";
import { CsgService } from "../../src/geometry/csg";
import { makeInputs } from "../../src/geometry/csg/core";
import type { WorkerResponse } from "../../src/geometry/csg/protocol";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  requestId = "";
  constructor() { FakeWorker.all.push(this); }
  postMessage(request: { jobId: string }, transfer: ArrayBuffer[]) { this.requestId = request.jobId; expect(transfer).toHaveLength(4); }
  terminate() { this.terminated = true; }
  respond(data: unknown) { this.onmessage?.({ data } as MessageEvent<WorkerResponse>); }
  success() { this.respond({ jobId: this.requestId, ok: true, result: { jobId: this.requestId, coordinateSpace: "target-local", empty: true, output: { positions: new Float32Array(), indices: new Uint32Array() }, faceOrigins: new Uint8Array(), stats: { inputTriangles: 0, outputTriangles: 0, computeMs: 0 }, warnings: [] } }); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeWorker.all = []; });

function fixture(id: string) {
  const [a, b] = makeInputs("union", "low");
  return { jobId: id, operation: "union" as const, target: { mesh: a }, cutter: { mesh: b } };
}

it("refuses concurrent work, cancels by signal, ignores late responses and retries", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const service = new CsgService();
  const request = fixture("one");
  const source = request.target.mesh.positions.slice();
  const abort = new AbortController();
  const pending = service.run(request, abort.signal);
  await expect(service.run(fixture("two"))).rejects.toMatchObject({ code: "JOB_BUSY" });
  const old = FakeWorker.all[0]!;
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: "JOB_CANCELLED" });
  expect(old.terminated).toBe(true);
  const next = service.run(fixture("two"));
  old.success();
  FakeWorker.all[1]!.success();
  await expect(next).resolves.toMatchObject({ jobId: "two", empty: true });
  expect(request.target.mesh.positions).toEqual(source);
  service.dispose();
});

it("rejects malformed responses and Worker errors without leaving the service busy", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const service = new CsgService();
  const first = service.run(fixture("bad"));
  FakeWorker.all[0]!.respond({ nonsense: true });
  await expect(first).rejects.toMatchObject({ code: "WORKER_FAILED" });
  const second = service.run(fixture("error"));
  FakeWorker.all[1]!.onerror?.({ message: "crash" } as ErrorEvent);
  await expect(second).rejects.toMatchObject({ code: "WORKER_FAILED" });
  const third = service.run(fixture("dispose"));
  service.dispose();
  await expect(third).rejects.toMatchObject({ code: "JOB_CANCELLED" });
  expect(FakeWorker.all.every((worker) => worker.terminated)).toBe(true);
});

it("fails a silently stalled Worker and releases it", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const request = fixture("stalled");
  vi.useFakeTimers();
  const service = new CsgService();
  const pending = service.run(request);
  const assertion = expect(pending).rejects.toMatchObject({ code: "WORKER_FAILED" });
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
  await assertion;
  expect(FakeWorker.all[0]!.terminated).toBe(true);
});

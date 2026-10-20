import { afterEach, expect, it, vi } from "vitest";
import { CsgClient } from "../../src/spikes/csg/client";
import { makeInputs } from "../../src/spikes/csg/core";
import type { WorkerResponse } from "../../src/geometry/csg/protocol";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  requestId = "";
  constructor() { FakeWorker.all.push(this); }
  postMessage(request: { jobId: string }) { this.requestId = request.jobId; }
  terminate() { this.terminated = true; }
  respond() { this.onmessage?.({ data: { jobId: this.requestId, ok: true, result: { jobId: this.requestId, output: { positions: new Float32Array(), indices: new Uint32Array() }, faceOrigins: new Uint8Array(), coordinateSpace: "target-local", empty: true, stats: { computeMs: 0, inputTriangles: 0, outputTriangles: 0 }, warnings: [] } } } as unknown as MessageEvent<WorkerResponse>); }
}

afterEach(() => { vi.unstubAllGlobals(); FakeWorker.all = []; });

it("cancels the active worker, ignores late results and runs again", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const client = new CsgClient();
  const [a, b] = makeInputs("union", "low");
  const snapshot = a.positions.slice();
  const pending = client.run("union", a, b);
  const old = FakeWorker.all[0]!;
  client.cancel();
  await expect(pending).rejects.toThrow("JOB_CANCELLED");
  expect(old.terminated).toBe(true);
  const next = client.run("union", a, b);
  old.respond();
  const current = FakeWorker.all[1]!;
  current.respond();
  await expect(next).resolves.toMatchObject({ ok: true });
  expect(a.positions).toEqual(snapshot);
  client.dispose();
});

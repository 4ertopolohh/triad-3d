import { compute } from "./core";
import { CsgError } from "./types";
import type { WorkerRequest, WorkerResponse } from "./protocol";

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const computed = await compute(request.operation, request.first, request.second);
    const response: WorkerResponse = { jobId: request.jobId, ok: true, result: {
      jobId: request.jobId, output: computed.output, faceOrigins: computed.faceOrigins, coordinateSpace: "target-local", empty: computed.empty,
      stats: { inputTriangles: computed.inputTriangles, outputTriangles: computed.outputTriangles, computeMs: computed.computeMs }, warnings: request.warnings,
    } };
    self.postMessage(response, { transfer: [computed.output.positions.buffer, computed.output.indices.buffer, computed.faceOrigins.buffer] });
  } catch (error) {
    const response: WorkerResponse = { jobId: request.jobId, ok: false, code: error instanceof CsgError ? error.code : "WORKER_FAILED", message: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
};

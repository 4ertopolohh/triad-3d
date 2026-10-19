import { compute, CsgError } from "./core";
import type { Request, Response } from "./protocol";

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, operation, first, second } = event.data;
  try {
    const result = await compute(operation, first, second);
    const response: Response = { id, ok: true, result };
    self.postMessage(response, { transfer: [result.output.positions.buffer, result.output.indices.buffer] });
  } catch (error) {
    const response: Response = { id, ok: false, code: error instanceof CsgError ? error.code : "FILE_INVALID", message: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
};

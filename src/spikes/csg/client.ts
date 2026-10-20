import { CsgService } from "../../geometry/csg";
import type { MeshData, Operation } from "./core";

/** Compatibility adapter for the TASK-003 demonstration. */
export class CsgClient {
  private service = new CsgService();
  private id = 0;
  async run(operation: Operation, first: MeshData, second: MeshData) {
    const result = await this.service.run({ jobId: String(++this.id), operation, target: { mesh: first }, cutter: { mesh: second } });
    return { ok: true as const, result: { output: result.output, status: "NoError", computeMs: result.stats.computeMs, empty: result.empty, inputTriangles: result.stats.inputTriangles, outputTriangles: result.stats.outputTriangles } };
  }
  cancel() { this.service.cancel(); }
  dispose() { this.service.dispose(); }
}

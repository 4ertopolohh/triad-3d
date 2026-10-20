import type { ProjectCommand, CommandResult } from "../domain/command-bus";
import type { Project } from "../domain/types";
import type { CsgErrorCode } from "../geometry/csg/types";
import type { DeepReadonly } from "./editor-store";

export type JobErrorCode = CsgErrorCode | "VALIDATION_FAILED" | "STALE_PROJECT" | "COMMIT_FAILED" | "COMPUTE_FAILED" | "JOB_DISPOSED";
export type JobError = { readonly code: JobErrorCode; readonly message: string };
export type JobStatus = "idle" | "validating" | "validation_failed" | "running" | "cancelling" | "applying" | "succeeded" | "failed" | "cancelled";
export const isJobActive = (status: JobStatus): boolean =>
  status === "validating" || status === "running" || status === "cancelling" || status === "applying";
export type JobState = Readonly<{
  id: string | null;
  name: string | null;
  status: JobStatus;
  progress: number | null;
  cancellable: boolean;
  error: JobError | null;
}>;
export type JobOutcome =
  | { readonly ok: true; readonly id: string; readonly status: "succeeded"; readonly committed: boolean }
  | { readonly ok: false; readonly id: string; readonly status: "validation_failed" | "failed" | "cancelled"; readonly error: JobError };
export type JobComputeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: JobError };
export type JobInput = Readonly<{ project: DeepReadonly<Project>; revision: number; projectId: string }>;
export type JobSpec<T> = Readonly<{
  id: string;
  name: string;
  cancellable?: boolean;
  validate: (input: JobInput) => JobError | null;
  compute: (input: JobInput, signal: AbortSignal, reportProgress: (progress: number) => void) => Promise<JobComputeResult<T>>;
  commands?: (value: T) => readonly ProjectCommand[];
}>;
export interface JobController {
  run<T>(spec: JobSpec<T>): Promise<JobOutcome>;
  cancelJob(): boolean;
  dispose(): void;
}

type Context = JobInput & { readonly identity: object; readonly epoch: object };
type Host = {
  capture(): Context;
  isCurrent(context: Context): boolean;
  publish(state: JobState): void;
  commit(commands: ProjectCommand[], revision: number, id: string): CommandResult;
};
const terminal = (id: string, status: "validation_failed" | "failed" | "cancelled", error: JobError): JobOutcome =>
  ({ ok: false, id, status, error });
const cancelled: JobError = { code: "JOB_CANCELLED", message: "Операция отменена." };

/** The host's commit capability is kept in the EditorStore closure, never exposed to compute callbacks. */
export function createJobController(host: Host): JobController {
  let current: { id: string; abort: AbortController; context: Context; canCancel: boolean; state: JobState } | null = null;
  let disposed = false;
  const show = (job: NonNullable<typeof current>, status: JobStatus, progress: number | null = job.state.progress, error: JobError | null = null) => {
    job.state = Object.freeze({ id: job.id, name: job.state.name, status, progress, cancellable: status === "running" && job.canCancel, error });
    host.publish(job.state);
  };
  const finish = (job: NonNullable<typeof current>, status: "validation_failed" | "failed" | "cancelled", error: JobError): JobOutcome => {
    if (current === job) { show(job, status, null, error); current = null; }
    return terminal(job.id, status, error);
  };
  return {
    async run<T>(spec: JobSpec<T>): Promise<JobOutcome> {
      if (current) return terminal(spec.id, "failed", { code: "JOB_BUSY", message: "Другая операция ещё выполняется." });
      if (disposed) return terminal(spec.id, "failed", { code: "JOB_DISPOSED", message: "Контроллер завершён." });
      const context = host.capture();
      const job = { id: spec.id, abort: new AbortController(), context, canCancel: !!spec.cancellable,
        state: Object.freeze({ id: spec.id, name: spec.name, status: "validating" as JobStatus, progress: null, cancellable: false, error: null }) as JobState };
      current = job;
      host.publish(job.state);
      try {
        if (!spec.id.trim() || !spec.name.trim()) return finish(job, "validation_failed", { code: "VALIDATION_FAILED", message: "Нужны ID и название операции." });
        const validation = spec.validate(context);
        if (validation) return finish(job, "validation_failed", validation);
        if (job.abort.signal.aborted || current !== job) return finish(job, "cancelled", cancelled);
        if (!host.isCurrent(context)) return finish(job, "failed", { code: "STALE_PROJECT", message: "Проект изменился до запуска вычисления." });
        show(job, "running");
        const report = (progress: number) => {
          if (current !== job || job.abort.signal.aborted || job.state.status !== "running" || !Number.isFinite(progress) || progress < 0 || progress > 1 || progress === job.state.progress) return;
          show(job, "running", progress);
        };
        const abortPromise = new Promise<"aborted">(resolve => job.abort.signal.addEventListener("abort", () => resolve("aborted"), { once: true }));
        const computation = Promise.resolve().then<JobComputeResult<T> | "aborted">(() => {
          if (job.abort.signal.aborted) return "aborted" as const;
          return spec.compute(context, job.abort.signal, report);
        });
        const result = await Promise.race([computation, abortPromise]);
        if (result === "aborted" || job.abort.signal.aborted) return finish(job, "cancelled", cancelled);
        if (!result.ok) return finish(job, result.error.code === "JOB_CANCELLED" ? "cancelled" : "failed", result.error);
        if (current !== job || !host.isCurrent(context)) return finish(job, "failed", { code: "STALE_PROJECT", message: "Проект изменился во время вычисления." });
        const commands = spec.commands?.(result.value);
        if (commands && commands.length === 0) return finish(job, "failed", { code: "COMMIT_FAILED", message: "Пустая транзакция не применяется." });
        if (job.abort.signal.aborted) return finish(job, "cancelled", cancelled);
        let committed = false;
        if (commands) {
          show(job, "applying", null);
          if (job.abort.signal.aborted || current !== job) return finish(job, "cancelled", cancelled);
          if (!host.isCurrent(context)) return finish(job, "failed", { code: "STALE_PROJECT", message: "Проект изменился до применения результата." });
          const outcome = host.commit([...commands], context.revision, spec.id);
          if (!outcome.ok) return finish(job, "failed", { code: "COMMIT_FAILED", message: `${outcome.code}: ${outcome.message}` });
          committed = outcome.changed;
        }
        show(job, "succeeded", null);
        current = null;
        return { ok: true, id: spec.id, status: "succeeded", committed };
      } catch (error) {
        if (job.abort.signal.aborted) return finish(job, "cancelled", cancelled);
        const value = error as { code?: unknown; message?: unknown };
        const code = typeof value?.code === "string" ? value.code as JobErrorCode : "COMPUTE_FAILED";
        const message = typeof value?.message === "string" ? value.message : "Ошибка вычисления.";
        return finish(job, job.state.status === "validating" ? "validation_failed" : code === "JOB_CANCELLED" ? "cancelled" : "failed", { code, message });
      }
    },
    cancelJob() {
      if (!current || current.state.status !== "running" || !current.state.cancellable) return false;
      const job = current;
      show(job, "cancelling", null);
      job.abort.abort();
      return true;
    },
    dispose() {
      disposed = true;
      if (current && isJobActive(current.state.status)) {
        const job = current;
        job.abort.abort();
        finish(job, "cancelled", cancelled);
      }
    },
  };
}

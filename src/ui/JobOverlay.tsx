import { useEffect, useRef } from "react";
import { isJobActive, type JobState } from "../app/job-controller";

const messages: Record<string, string> = {
  validating: "Проверка операции…",
  running: "Вычисление выполняется…",
  cancelling: "Отмена операции…",
  applying: "Применение результата…",
};

export function JobOverlay({ job, cancel }: { job: JobState; cancel: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const active = isJobActive(job.status);
  useEffect(() => {
    if (!active) return;
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (button.current ?? dialog.current)?.focus();
    return () => { if (previous.current?.isConnected) previous.current.focus(); };
  }, [active]);
  if (!active) return job.error ? <div className="job-result" role="alert">{job.name}: {job.error.code} — {job.error.message}</div> : null;
  return <div className="job-backdrop">
    <div className="job-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="job-title" aria-describedby="job-status" tabIndex={-1}
      onKeyDown={(event) => { if (event.key === "Tab") { event.preventDefault(); (button.current ?? dialog.current)?.focus(); } }}>
      <h2 id="job-title">{job.name}</h2>
      <p id="job-status" role="status" aria-live="polite">{messages[job.status]}</p>
      {job.progress === null ? <div className="job-indeterminate" aria-label="Прогресс неизвестен" /> :
        <progress max={1} value={job.progress} aria-label="Прогресс операции" />}
      {job.cancellable && <button ref={button} type="button" onClick={cancel}>Отменить</button>}
    </div>
  </div>;
}

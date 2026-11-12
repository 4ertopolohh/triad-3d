import { useEffect, useRef, useState } from "react";

/** A complete numeric edit is committed on blur/Enter; transient '-' and '0.' stay local. */
export function CommitNumber({ value, onCommit, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onFocus" | "type"> & { value: number; onCommit: (value: number) => void }) {
  const [draft,setDraft] = useState(String(value));
  const [focused,setFocused] = useState(false);
  const captured = useRef(onCommit);
  const original = useRef(String(value));
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value,focused]);
  const finish = () => { setFocused(false); const parsed = Number(draft); if (draft.trim() && Number.isFinite(parsed) && draft !== original.current) captured.current(parsed); else setDraft(String(value)); };
  return <input {...props} type="text" inputMode="decimal" value={draft} onFocus={() => { captured.current = onCommit; original.current = String(value); setFocused(true); }} onChange={e => setDraft(e.target.value)} onBlur={finish} onKeyDown={e => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { original.current = draft; setDraft(String(value)); e.currentTarget.blur(); }
  }} />;
}

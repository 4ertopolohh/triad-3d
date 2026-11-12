import { useEffect, useRef, useState } from "react";
type Curve = readonly [number,number,number,number];
const DEFAULT_CURVE: Curve = [.42,0,.58,1];
export function BezierEditor({ value = DEFAULT_CURVE, disabled, onCommit }: { value?: Curve; disabled: boolean; onCommit: (curve: Curve) => void }) {
  const [draft,setDraft] = useState<Curve>(value);
  const active = useRef<0 | 2 | null>(null);
  const current = useRef(draft);
  const commit = useRef(onCommit);
  useEffect(() => { if (active.current === null) { setDraft(value); current.current = value; } }, [value]);
  const x = (n: number) => 10+n*100, y = (n: number) => 110-n*100;
  return <svg aria-label="Редактор контрольных точек Bezier" width="150" height="120" viewBox="0 0 120 120" style={{touchAction:"none"}} onPointerMove={e => {
    if (active.current === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next = [...current.current] as [number,number,number,number];
    next[active.current] = Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*120-10)/100));
    next[active.current+1] = Math.max(0,Math.min(1,(110-(e.clientY-rect.top)/rect.height*120)/100));
    current.current = next; setDraft(next);
  }} onPointerUp={() => { if (active.current !== null) { active.current = null; commit.current(current.current); } }} onPointerCancel={() => { active.current = null; current.current = value; setDraft(value); }}>
    <path d="M10 10 V110 H110" stroke="#aab2be" fill="none" />
    <path d={`M10 110 C${x(draft[0])} ${y(draft[1])},${x(draft[2])} ${y(draft[3])},110 10`} stroke="currentColor" fill="none" strokeWidth="2" />
    <path d={`M10 110 L${x(draft[0])} ${y(draft[1])} M110 10 L${x(draft[2])} ${y(draft[3])}`} stroke="#8995a8" />
    {([0,2] as const).map(index => <circle key={index} cx={x(draft[index])} cy={y(draft[index+1]!)} r="5" fill={disabled ? "#aaa" : "#376bc4"} onPointerDown={e => { if (disabled) return; active.current = index; commit.current = onCommit; e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId); }} />)}
  </svg>;
}

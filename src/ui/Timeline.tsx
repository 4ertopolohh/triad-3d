import { recordingPose } from "../app/recording-pose";
import { CommitNumber } from "./CommitNumber";
import { addPreset, analyzeLoop, alignLoop, type AnimationPreset } from "../animation/presets";
import { BezierEditor } from "./BezierEditor";
import { useEffect, useState } from "react";
import type { EditorStore } from "../app/editor-store";
import { useEditorStore } from "../app/use-editor-store";
import { timelineOf, type Timeline as TimelineData } from "../animation/timeline";
import type { TrackProperty } from "../domain/types";

export type AnimationPreview = { clipId: string; time: number; recording?: boolean } | null;
export function Timeline({ store, blocked, onPreview }: { store: EditorStore; blocked: boolean; onPreview: (value: AnimationPreview) => void }) {
  const state = useEditorStore(store);
  const [clipId, setClipId] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording,setRecording] = useState(false);
  const [rate, setRate] = useState(1);
  const [zoom,setZoom] = useState(1);
  const [snap,setSnap] = useState(true);
  const [preset,setPreset] = useState<AnimationPreset>("spin");
  const [presetAmount,setPresetAmount] = useState(1);
  const [presetAxis,setPresetAxis] = useState<"x" | "y" | "z">("y");
  const [usePivot,setUsePivot] = useState(false);
  const [pivot,setPivot] = useState<[number,number,number]>([0,0,0]);
  const [error, setError] = useState("");
  const [loopReport, setLoopReport] = useState("");
  const clip = state.document.project.animations.find(c => c.id === clipId) ?? state.document.project.animations[0];
  const epoch = store.getProjectEpoch();
  useEffect(() => {
    const stored = state.document.project.tracks.find(t => clip?.trackIds.includes(t.id) && t.nodeId === state.selection.activeId && t.pivot)?.pivot;
    if (stored) {setUsePivot(true);setPivot([...stored]);} else setUsePivot(false);
  },[epoch,clip?.id,state.selection.activeId]);
  useEffect(() => { setPlaying(false); setRecording(false); setTime(0); onPreview(null); }, [epoch, onPreview]);
  useEffect(() => {
    if (!playing || !clip || blocked) return;
    const start = performance.now(), origin = time;
    let handle = 0;
    const frame = (now: number) => {
      const elapsed = origin + (now-start)/1000*rate;
      const begin = clip.loopStartSeconds ?? 0, end = clip.loopEndSeconds ?? clip.durationSeconds;
      const next = clip.loop ? begin + ((elapsed-begin) % (end-begin) + end-begin) % (end-begin) : Math.min(elapsed, clip.durationSeconds);
      setTime(next); onPreview({ clipId: clip.id, time: next });
      if (!clip.loop && elapsed >= clip.durationSeconds) setPlaying(false);
      else handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
    // The origin is captured only when playback starts or settings change.
  }, [playing, clip, rate, blocked, onPreview]);
  useEffect(() => {
    store.setAnimationRecording(recording && clip && !playing && !blocked ? {clipId:clip.id,time} : null);
    if (recording && clip && !playing && !blocked) onPreview({clipId:clip.id,time,recording:true});
    return () => store.setAnimationRecording(null);
  }, [store,recording,clip,time,playing,blocked,onPreview]);
  useEffect(() => { if (blocked) { setPlaying(false); setRecording(false); onPreview(null); } }, [blocked, onPreview]);
  function commit(edit: (timeline: TimelineData) => void) {
    const snapshot = store.getSnapshot().document;
    if (store.getProjectEpoch() !== epoch || snapshot.revision !== state.document.revision) { setError("Проект изменился. Повторите ввод."); return; }
    const document = { project: structuredClone(snapshot.project), revision: snapshot.revision };
    const timeline = timelineOf(document.project as import("../domain/types").Project);
    try { edit(timeline); } catch (error) { setError(error instanceof Error ? error.message : "Ошибка анимации"); return; }
    const result = store.executeCommand({ commandId: crypto.randomUUID(), type: "SET_TIMELINE", targetIds: [document.project.id], payload: { projectId: document.project.id, timeline } }, document.revision);
    setError(result.ok ? "" : result.message);
  }
  function addKey(property: TrackProperty) {
    const node = recordingPose(store,state).document.project.nodes.find(n => n.id === state.selection.activeId);
    if (!node || !clip) return;
    commit(timeline => {
      let track = timeline.tracks.find(t => clip.trackIds.includes(t.id) && t.nodeId === node.id && t.property === property);
      if (!track) { track = { id: crypto.randomUUID(), nodeId: node.id, property, keyframeIds: [] }; timeline.tracks.push(track); timeline.animations.find(c => c.id === clip.id)!.trackIds.push(track.id); }
      const value = structuredClone(node.transform[property.slice(10) as keyof typeof node.transform]);
      const existing = timeline.keyframes.find(k => track!.keyframeIds.includes(k.id) && Math.abs(k.timeSeconds-time) < 1e-6);
      if (existing) existing.value = value;
      else { const key = { id: crypto.randomUUID(), timeSeconds: time, value, interpolation: "linear" as const }; timeline.keyframes.push(key); track.keyframeIds.push(key.id); }
    });
  }
  return <section className={`timeline ${state.view.timelineExpanded ? "" : "is-collapsed"}`} aria-label="Область анимации">
    <div className="panel-heading"><h2>Таймлайн</h2>{!state.view.timelineExpanded && clip && <button disabled={blocked} onClick={() => { setRecording(false); setPlaying(!playing); }}>{playing ? "Пауза" : "Воспроизвести"}</button>}<button aria-expanded={state.view.timelineExpanded} onClick={() => store.setView({ timelineExpanded: !state.view.timelineExpanded })}>{state.view.timelineExpanded ? "Свернуть таймлайн" : "Развернуть таймлайн"}</button></div>
    <div className="timeline-body" hidden={!state.view.timelineExpanded}>
      <button disabled={blocked || playing} onClick={() => { const id = crypto.randomUUID(); commit(t => t.animations.push({ id, name: `Клип ${t.animations.length+1}`, durationSeconds: 2, loop: false, trackIds: [] })); setClipId(id); setTime(0); onPreview(null); }}>Добавить клип</button>
      {clip && <>
        <select aria-label="Клип" value={clip.id} disabled={playing || blocked} onChange={e => { setClipId(e.target.value); setTime(0); onPreview(null); }}>{state.document.project.animations.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button disabled={blocked} onClick={() => { setRecording(false); setPlaying(!playing); }}>{playing ? "Пауза" : "Воспроизвести"}</button>
        <button disabled={blocked || playing} onClick={() => { commit(t => {
          t.animations = t.animations.filter(c => c.id !== clip.id);
          const usedTracks = new Set(t.animations.flatMap(c => c.trackIds));
          t.tracks = t.tracks.filter(tr => usedTracks.has(tr.id));
          const usedKeys = new Set(t.tracks.flatMap(tr => tr.keyframeIds));
          t.keyframes = t.keyframes.filter(k => usedKeys.has(k.id));
        }); setTime(0); onPreview(null); }}>Удалить клип</button>
        <button onClick={() => { setPlaying(false); setRecording(false); onPreview(null); }}>Вернуть исходную позу</button>
        <label><input type="checkbox" checked={recording} disabled={blocked || playing} onChange={e => { setRecording(e.target.checked); if (!e.target.checked) onPreview(null); }} />Запись трансформаций</label>
        <label>Скорость<select value={rate} onChange={e => setRate(Number(e.target.value))}>{[.1,.25,.5,1,1.5,2].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
        <label>Длительность<CommitNumber aria-label="Длительность клипа" min="0.01" max="86400" step=".1" value={clip.durationSeconds} disabled={playing || blocked} onCommit={value => { commit(t => { t.animations.find(c => c.id === clip.id)!.durationSeconds = value; }); }} /></label>
        <label><input type="checkbox" checked={clip.loop} disabled={blocked || playing} onChange={e => commit(t => { t.animations.find(c => c.id === clip.id)!.loop = e.target.checked; })} />Цикл</label>
        <label>FPS<CommitNumber aria-label="FPS клипа" value={clip.fps ?? 30} disabled={blocked || playing} onCommit={value => commit(t => { t.animations.find(c => c.id === clip.id)!.fps = value; })} /></label>
        <label>Начало цикла<CommitNumber aria-label="Начало цикла" value={clip.loopStartSeconds ?? 0} disabled={blocked || playing} onCommit={value => commit(t => { t.animations.find(c => c.id === clip.id)!.loopStartSeconds = value; })} /></label>
        <label>Конец цикла<CommitNumber aria-label="Конец цикла" value={clip.loopEndSeconds ?? clip.durationSeconds} disabled={blocked || playing} onCommit={value => commit(t => { t.animations.find(c => c.id === clip.id)!.loopEndSeconds = value; })} /></label>
        <label>Масштаб шкалы<select value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[1,2,4,8].map(z => <option key={z} value={z}>{z}×</option>)}</select></label>
        <label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Привязка к кадрам</label>
        <label>Время: {time.toFixed(3)} с<input aria-label="Время анимации" type="range" min="0" max={clip.durationSeconds} step=".001" value={time} disabled={playing || blocked} onChange={e => { const value = Number(e.target.value); setTime(value); onPreview({ clipId: clip.id, time: value, recording }); }} /></label>
        {([ ["transform.position", "Ключ позиции"], ["transform.rotationQuat", "Ключ вращения"], ["transform.scale", "Ключ масштаба"] ] as const).map(([property,label]) => <button key={property} disabled={blocked || playing || !state.selection.activeId} onClick={() => addKey(property)}>{label}</button>)}
        <fieldset disabled={blocked || playing || !state.selection.activeId}><legend>Пресет анимации</legend>
          <select aria-label="Пресет анимации" value={preset} onChange={e => setPreset(e.target.value as AnimationPreset)}><option value="spin">Вращение</option><option value="orbit">Орбита</option><option value="move">Сдвиг</option><option value="reveal">Появление масштабом</option><option value="oscillate">Колебание</option><option value="bounce">Отскок</option></select>
          {preset !== "reveal" && <><label>Ось<select value={presetAxis} onChange={e => setPresetAxis(e.target.value as "x" | "y" | "z")}>{["x","y","z"].map(axis => <option key={axis} value={axis}>{axis.toUpperCase()}</option>)}</select></label><label>{preset === "spin" ? "Обороты" : preset === "orbit" ? "Радиус без центра" : "Расстояние"}<CommitNumber aria-label="Величина пресета" value={presetAmount} onCommit={setPresetAmount} /></label></>}
          {(preset === "spin" || preset === "orbit") && <><label><input type="checkbox" checked={usePivot} onChange={e => setUsePivot(e.target.checked)} />Задать центр в координатах родителя</label>{usePivot && pivot.map((value,axis) => <label key={axis}>{["X","Y","Z"][axis]}<CommitNumber aria-label={`Центр ${["X","Y","Z"][axis]}`} value={value} onCommit={v => setPivot(old => old.map((n,i) => i === axis ? v : n) as [number,number,number])} /></label>)}</>}
          <button onClick={() => commit(t => addPreset(t,structuredClone(state.document.project) as import("../domain/types").Project,clip.id,state.selection.activeId!,preset,{amount:presetAmount,axis:presetAxis,...(usePivot && (preset === "spin" || preset === "orbit") ? {pivot} : {})}))}>Применить пресет</button>
        </fieldset>
        <button onClick={() => { const differences = analyzeLoop(structuredClone(store.getSnapshot().document.project) as import("../domain/types").Project, clip.id); setLoopReport(differences.length ? differences.map(d => `${state.document.project.nodes.find(n => n.id === d.nodeId)?.name}: позиция Δ${d.position.toPrecision(3)}, вращение Δ${d.rotationRadians.toPrecision(3)} рад, масштаб Δ${d.scale.toPrecision(3)}, скорость позиции Δ${d.velocity.toPrecision(3)}, угловая скорость Δ${d.angularVelocity.toPrecision(3)}, скорость масштаба Δ${d.scaleVelocity.toPrecision(3)}`).join("; ") : "Нет дорожек для проверки."); }}>Проверить стык цикла</button>
        {loopReport && <p role="status">{loopReport}</p>}
        <button disabled={blocked || playing} title="Заменяет значения конца цикла значениями начала и сглаживает скорости до нуля" onClick={() => commit(t => Object.assign(t,alignLoop(structuredClone(state.document.project) as import("../domain/types").Project,clip.id)))}>Совместить конец с началом</button>
        <p className="panel-hint">В режиме записи перемещение, вращение и масштаб создают ключи на текущем времени; камера ключей не создаёт. Вне записи кнопки ключей используют исходную позу.</p>
        {clip.trackIds.map(id => {
          const track = state.document.project.tracks.find(t => t.id === id)!;
          return <details key={id}><summary>{state.document.project.nodes.find(n => n.id === track.nodeId)?.name}: {track.property}</summary>{track.pivot && <p>Центр вращения в координатах родителя: {track.pivot.join(", ")}</p>}<label><input type="checkbox" checked={track.muted ?? false} disabled={blocked || playing} onChange={e => commit(t => { t.tracks.find(tr => tr.id === id)!.muted = e.target.checked; })} />Отключить</label><label><input type="checkbox" checked={track.solo ?? false} disabled={blocked || playing} onChange={e => commit(t => { t.tracks.find(tr => tr.id === id)!.solo = e.target.checked; })} />Соло</label>
          <div style={{overflowX:"auto"}}><div className="key-ruler" style={{width:`${zoom*100}%`}}>{track.keyframeIds.map(keyId => {
            const key = state.document.project.keyframes.find(k => k.id === keyId)!;
            return <button key={keyId} title={`${key.timeSeconds.toFixed(3)} с — перетащите ключ`} aria-label={`Переместить ключ ${key.timeSeconds}`} disabled={blocked || playing} style={{left:`${key.timeSeconds/clip.durationSeconds*100}%`}} onPointerDown={e => { e.currentTarget.dataset.start = String(e.clientX); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => {
              const start = Number(e.currentTarget.dataset.start); if (Math.abs(e.clientX-start) < 3) return;
              const rect = e.currentTarget.parentElement!.getBoundingClientRect(); let seconds = Math.max(0,Math.min(clip.durationSeconds,(e.clientX-rect.left)/rect.width*clip.durationSeconds));
              if (snap) seconds = Math.min(clip.durationSeconds,Math.round(seconds*(clip.fps ?? 30))/(clip.fps ?? 30));
              commit(t => { t.keyframes.find(k => k.id === keyId)!.timeSeconds = seconds; });
            }}>◆</button>;
          })}</div></div>
<button disabled={blocked || playing} onClick={() => commit(t => {
            t.animations.find(c => c.id === clip.id)!.trackIds = clip.trackIds.filter(trackId => trackId !== id);
            if (!t.animations.some(c => c.trackIds.includes(id))) t.tracks = t.tracks.filter(tr => tr.id !== id);
            const usedKeys = new Set(t.tracks.flatMap(tr => tr.keyframeIds));
            t.keyframes = t.keyframes.filter(k => usedKeys.has(k.id));
          })}>Удалить дорожку</button>{track.keyframeIds.map(keyId => {
            const key = state.document.project.keyframes.find(k => k.id === keyId)!;
            return <div key={keyId}>
              <CommitNumber aria-label="Время ключа" step=".01" min="0" max={clip.durationSeconds} value={key.timeSeconds} disabled={blocked || playing} onCommit={value => commit(t => { t.keyframes.find(k => k.id === keyId)!.timeSeconds = value; })} />
              <select aria-label="Интерполяция ключа" value={key.interpolation} disabled={blocked || playing} onChange={e => commit(t => { t.keyframes.find(k => k.id === keyId)!.interpolation = e.target.value as "linear" | "step" | "bezier"; })}><option value="linear">Линейная</option><option value="step">Ступень</option><option value="bezier">Bezier</option></select>
              {Array.isArray(key.value) && key.value.map((component, index) => <CommitNumber key={index} aria-label={`Компонента ключа ${index+1}`} step=".01" value={component} disabled={blocked || playing} onCommit={value => commit(t => { const target = t.keyframes.find(k => k.id === keyId)!; const values = [...target.value as readonly number[]]; values[index] = value; if (values.length === 4) { const length = Math.hypot(...values); if (length === 0) throw new Error("Нулевой кватернион недопустим."); values.forEach((v,i) => { values[i] = v/length; }); } target.value = values as [number,number,number] | [number,number,number,number]; })} />)}
              {key.interpolation === "bezier" && <span>
                <BezierEditor {...(key.easing ? {value:key.easing} : {})} disabled={blocked || playing} onCommit={curve => commit(t => { t.keyframes.find(k => k.id === keyId)!.easing = curve; })} />
                {(key.easing ?? [.42,0,.58,1]).map((v,i) => <CommitNumber key={i} aria-label={`Bezier ${i+1}`} step=".05" min="0" max="1" value={v} disabled={blocked || playing} onCommit={value => commit(t => { const target = t.keyframes.find(k => k.id === keyId)!; const curve = [...target.easing ?? [.42,0,.58,1]] as [number,number,number,number]; curve[i] = value; target.easing = curve; })} />)}
              </span>}
              <button disabled={blocked || playing} onClick={() => commit(t => { t.tracks.forEach(tr => { tr.keyframeIds = tr.keyframeIds.filter(k => k !== keyId); }); t.keyframes = t.keyframes.filter(k => k.id !== keyId); })}>Удалить ключ</button>
            </div>;
          })}</details>;
        })}
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}

import { useState } from "react";
import type { EditorState, EditorStore } from "../app/editor-store";
import { physicsConflicts, type PhysicsActor } from "../domain/physics-config";
import { CommitNumber } from "./CommitNumber";

export function PhysicsEditor({ store, state, nodeId, disabled }: { store: EditorStore; state: EditorState; nodeId: string; disabled: boolean }) {
  const [error, setError] = useState("");
  const project = state.document.project, actor = project.physics?.find(a => a.nodeId === nodeId), epoch = store.getProjectEpoch();
  function commit(next: PhysicsActor | null) {
    if (disabled || epoch !== store.getProjectEpoch()) return;
    const actors = structuredClone(project.physics ?? []).filter(a => a.nodeId !== nodeId) as PhysicsActor[];
    if (next) actors.push(next);
    const result = store.executeCommand({ commandId: crypto.randomUUID(), type: "SET_PHYSICS", targetIds: [project.id], payload: { projectId: project.id, actors } }, state.document.revision);
    setError(result.ok ? "" : result.message);
  }
  const update = (change: Partial<PhysicsActor>) => { if (actor) commit({ ...structuredClone(actor), ...change } as PhysicsActor); };
  return <section className="interaction-editor"><h4>Физика</h4>
    <p>Работает в интерактивном просмотре. Коллайдер задаётся вручную вокруг начала координат; гравитация −9.81 по Y. Для пола добавьте статическое тело.</p>
    {!actor ? <button disabled={disabled} onClick={() => commit({ nodeId, enabled: true, body: "dynamic", collider: "box", size: [1, 1, 1], mass: 1, restitution: .5, friction: .5 })}>Добавить физическое тело</button> : <fieldset disabled={disabled}>
      <label><input type="checkbox" checked={actor.enabled} onChange={e => update({ enabled: e.target.checked })}/>Включено</label>
      <label>Тип тела<select value={actor.body} onChange={e => update({ body: e.target.value as PhysicsActor["body"] })}><option value="dynamic">Динамическое</option><option value="static">Статическое</option><option value="kinematic">Кинематическое (анимация)</option></select></label>
      <label>Коллайдер<select value={actor.collider} onChange={e => update({ collider: e.target.value as PhysicsActor["collider"] })}><option value="box">Коробка</option><option value="sphere">Сфера</option></select></label>
      {(actor.collider === "sphere" ? [0] : [0, 1, 2]).map(axis => <label key={axis}>{actor.collider === "sphere" ? "Диаметр" : `Размер ${"XYZ"[axis]}`}<CommitNumber value={actor.size[axis]!} onCommit={value => { const size = [...actor.size] as [number,number,number]; size[axis] = value; update({ size }); }}/></label>)}
      {(["mass", "restitution", "friction"] as const).map(key => <label key={key}>{key === "mass" ? "Масса, кг" : key === "restitution" ? "Упругость 0–1" : "Трение 0–10"}<CommitNumber value={actor[key]} onCommit={value => update({ [key]: value })}/></label>)}
      <p>Динамическое тело управляет позицией и вращением после анимации; Статическое остаётся на старте. Кинематическое следует анимации. Масштаб меняет коллайдер и перезапускает мир. Вложенные тела и сдвиг осей не поддерживаются. Для динамических/статических тел масштаб родителей должен быть равномерным.</p>
      <button onClick={() => commit(null)}>Удалить физическое тело</button>
    </fieldset>}
    {physicsConflicts((project.physics??[]) as PhysicsActor[], project.interactions??[],project.tracks).map(message=><p key={message} role="status">{message}</p>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}

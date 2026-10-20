import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { EditorStore, DeepReadonly } from "../app/editor-store";
import type { Node, Project } from "../domain/types";
import type { ProjectCommand } from "../domain/command-bus";

type Row = { node: DeepReadonly<Node>; depth: number; path: string };
const ROW = 30;
const identity = { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] } as const;
function projection(project: DeepReadonly<Project>, open: Set<string>, query: string): Row[] {
  const map = new Map(project.nodes.map(node => [node.id, node]));
  const result: Row[] = [];
  const visit = (id: string, depth: number, path: string): boolean => {
    const node = map.get(id); if (!node) return false;
    const nextPath = path ? `${path} / ${node.name}` : node.name;
    const start = result.length;
    result.push({ node, depth, path: nextPath });
    let match = node.name.toLocaleLowerCase().includes(query);
    if (!query && !open.has(id)) return true;
    for (const child of node.children) match = visit(child, depth + 1, nextPath) || match;
    if (query && !match) result.splice(start);
    return match;
  };
  visit(project.model.rootNodeId, 0, "");
  return result;
}
function access(project: DeepReadonly<Project>, node: DeepReadonly<Node>): string {
  const map = new Map(project.nodes.map(item => [item.id, item]));
  let current: DeepReadonly<Node> | undefined = node;
  while (current) {
    if (current.locked) return "Объект или его родитель заблокирован.";
    if (!current.visible) return "Объект или его родитель скрыт.";
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  return "";
}
export function ObjectTree({ store, project, selection, blocked, mode, notice }: {
  store: EditorStore; project: DeepReadonly<Project>;
  selection: { readonly ids: readonly string[]; readonly activeId: string | null };
  blocked: boolean; mode: "model" | "scene"; notice: (kind: "error" | "success" | "info", text: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([project.model.rootNodeId]));
  useEffect(() => { setOpen(previous => new Set([...previous, project.model.rootNodeId])); }, [project.model.rootNodeId]);
  const [query, setQuery] = useState("");
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(300);
  const [target, setTarget] = useState(project.model.rootNodeId);
  useEffect(() => { setTarget(project.model.rootNodeId); }, [project.model.rootNodeId]);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: "before" | "inside" | "after" } | null>(null);
  const anchor = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => projection(project, open, query.trim().toLocaleLowerCase()), [project, open, query]);
  const map = useMemo(() => new Map(project.nodes.map(node => [node.id, node])), [project]);
  const start = Math.max(0, Math.floor(scroll / ROW) - 4);
  const end = Math.min(rows.length, start + Math.ceil(height / ROW) + 8);
  const editable = !blocked && mode === "model";
  const selected = selection.ids.map(id => map.get(id)).filter((node): node is DeepReadonly<Node> => !!node);
  const reason = selected.map(node => access(project, node)).find(Boolean) || "";
  const flagReason = selected.map(node => node.parentId ? map.get(node.parentId) : undefined).filter((node): node is DeepReadonly<Node> => !!node).map(node => access(project, node)).find(Boolean) || "";
  const command = (value: ProjectCommand) => {
    const result = store.executeCommand(value, store.getSnapshot().document.revision);
    if (!result.ok) notice("error", result.message);
    return result.ok;
  };
  const batch = (values: ProjectCommand[]) => {
    const result = store.executeTransaction(values, store.getSnapshot().document.revision);
    if (!result.ok) notice("error", result.message);
  };
  function select(id: string, ctrl: boolean, shift: boolean) {
    if (shift && anchor.current) {
      const from = rows.findIndex(row => row.node.id === anchor.current);
      const to = rows.findIndex(row => row.node.id === id);
      if (from >= 0 && to >= 0) { const ids = rows.slice(Math.min(from, to), Math.max(from, to) + 1).map(row => row.node.id).filter(value => value !== project.model.rootNodeId); store.setSelection(ctrl ? [...selection.ids, ...ids] : ids, id); return; }
    }
    anchor.current = id;
    if (ctrl) { const ids = selection.ids.includes(id) ? selection.ids.filter(value => value !== id) : [...selection.ids, id]; store.setSelection(ids, ids.includes(id) ? id : ids[0] ?? null); }
    else store.setSelection(id === project.model.rootNodeId ? [] : [id], id === project.model.rootNodeId ? null : id);
  }
  function group() {
    if (!selected.length || reason) return;
    const parentId = selected[0]!.parentId;
    if (!parentId || selected.some(node => node.parentId !== parentId)) { notice("error", "Выберите объекты одного родителя."); return; }
    const id = crypto.randomUUID();
    const group: Node = { id, kind: "group", name: "Группа", parentId, children: [], transform: { position: [...identity.position], rotationQuat: [...identity.rotationQuat], scale: [...identity.scale] }, visible: true, locked: false, materialSlots: [], modifierIds: [] };
    if (command({ commandId: crypto.randomUUID(), type: "GROUP_NODES", targetIds: [...selection.ids, id], payload: { nodeIds: [...selection.ids], group } })) { setOpen(previous => new Set([...previous, id])); store.setSelection([id], id); }
  }
  function ungroup() { if (selected.length === 1 && selected[0]?.kind === "group") command({ commandId: crypto.randomUUID(), type: "UNGROUP_NODE", targetIds: [selected[0].id], payload: { nodeId: selected[0].id } }); }
  function remove() { if (selected.length) batch(selected.filter(node => { let parentId = node.parentId; while (parentId) { if (selected.some(other => other.id === parentId)) return false; parentId = map.get(parentId)?.parentId ?? null; } return true; }).map(node => ({ commandId: crypto.randomUUID(), type: "DELETE_NODE", targetIds: [node.id], payload: { nodeId: node.id } }))); }
  function flag(field: "visible" | "locked", value: boolean) {
    const depth = (node: DeepReadonly<Node>) => { let count = 0; let parentId = node.parentId; while (parentId) { count++; parentId = map.get(parentId)?.parentId ?? null; } return count; };
    const childrenFirst = value ? field === "locked" : field === "visible";
    const ordered = [...selected].sort((a, b) => (depth(a) - depth(b)) * (childrenFirst ? -1 : 1));
    batch(ordered.map(node => ({ commandId: crypto.randomUUID(), type: "SET_NODE_FLAGS", targetIds: [node.id], payload: { nodeId: node.id, [field]: value } })));
  }
  function move(id: string, parentId: string, index: number) {
    if (id === project.model.rootNodeId) return;
    command({ commandId: crypto.randomUUID(), type: "MOVE_NODE", targetIds: [id, parentId], payload: { nodeId: id, parentId, index } });
  }
  const dropZone = (event: DragEvent<HTMLDivElement>) => { const y = event.clientY - event.currentTarget.getBoundingClientRect().top; return y < 9 ? "before" : y > 21 ? "after" : "inside"; };
  const active = selection.activeId ? map.get(selection.activeId) : undefined;
  return <div className="object-tree">
    <p className="eyebrow">Текущий проект</p><div className="project-name">{project.name}</div>
    <input className="tree-search" aria-label="Поиск объектов" placeholder="Поиск объектов" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="tree-tools" role="group" aria-label="Действия с объектами">
      <button disabled={!editable || !selected.length || !!reason} title={reason} onClick={group}>Сгруппировать</button>
      <button disabled={!editable || selected.length !== 1 || active?.kind !== "group" || !!reason} title={reason} onClick={ungroup}>Разгруппировать</button>
      <button disabled={!editable || !selected.length || !!reason} title={reason} onClick={remove}>Удалить</button>
    </div>
    <div className="tree-scroll" ref={scroller} role="tree" aria-label="Дерево модели" onScroll={event => setScroll(event.currentTarget.scrollTop)}>
      <div style={{ height: rows.length * ROW, position: "relative" }}>{rows.slice(start, end).map((row, offset) => {
        const node = row.node; const isRoot = node.id === project.model.rootNodeId; const unavailable = access(project, node);
        return <div role="treeitem" aria-level={row.depth + 1} aria-expanded={node.children.length ? open.has(node.id) : undefined} aria-selected={selection.ids.includes(node.id)} key={node.id}
          className={`object-row ${selection.ids.includes(node.id) ? "is-selected" : ""} ${selection.activeId === node.id ? "is-active" : ""} ${drop?.id === node.id ? `is-drop-${drop.zone}` : ""}`}
          style={{ top: (start + offset) * ROW, paddingLeft: 8 + row.depth * 15 }}
          draggable={editable && !isRoot && !unavailable}
          onDragStart={event => { setDrag(node.id); event.dataTransfer.setData("text/plain", node.id); event.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => { setDrag(null); setDrop(null); }}
          onDragOver={event => { if (drag && drag !== node.id) { event.preventDefault(); const zone = dropZone(event); if (drop?.id !== node.id || drop.zone !== zone) setDrop({ id: node.id, zone }); } }}
          onDragLeave={() => setDrop(null)}
          onDrop={event => { event.preventDefault(); const id = drag; setDrop(null); setDrag(null); if (!id) return; const zone = dropZone(event); if (zone === "inside") move(id, node.id, node.children.length); else if (node.parentId) { const parent = map.get(node.parentId); if (parent) move(id, parent.id, parent.children.indexOf(node.id) + (zone === "after" ? 1 : 0)); } }}>
          <button className="tree-toggle" type="button" aria-label={open.has(node.id) ? "Свернуть" : "Раскрыть"} disabled={!node.children.length} onClick={() => setOpen(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}>{node.children.length ? open.has(node.id) ? "▾" : "▸" : "·"}</button>
          <button type="button" className="tree-name" title={row.path} onClick={event => select(node.id, event.ctrlKey || event.metaKey, event.shiftKey)} onKeyDown={event => { if (event.key === "Delete" && !isRoot && editable) { event.preventDefault(); command({ commandId: crypto.randomUUID(), type: "DELETE_NODE", targetIds: [node.id], payload: { nodeId: node.id } }); } }}>{node.kind === "group" ? "▦" : "◇"} {node.name}{selection.activeId === node.id ? " ●" : ""}</button>
          {!isRoot && <><button type="button" className="tree-icon" title={node.visible ? "Скрыть" : "Показать"} disabled={!editable} onClick={() => command({ commandId: crypto.randomUUID(), type: "SET_NODE_FLAGS", targetIds: [node.id], payload: { nodeId: node.id, visible: !node.visible } })}>{node.visible ? "◉" : "○"}</button><button type="button" className="tree-icon" title={node.locked ? "Разблокировать" : "Заблокировать"} disabled={!editable} onClick={() => command({ commandId: crypto.randomUUID(), type: "SET_NODE_FLAGS", targetIds: [node.id], payload: { nodeId: node.id, locked: !node.locked } })}>{node.locked ? "🔒" : "○"}</button></>}
        </div>;
      })}</div>
    </div>
    {project.nodes.length === 1 && <p className="panel-hint">Модель пуста. Добавьте примитив из библиотеки.</p>}
    <div className="tree-row">◫ Сцена <small>отдельно</small></div>
    <p className="panel-hint">Выбрано: {selected.length}. {reason}</p>
    {!!selected.length && <div className="tree-tools"><button disabled={!editable || !!flagReason} title={flagReason} onClick={() => flag("visible", !selected.every(node => node.visible))}>Видимость: {selected.every(node => node.visible) ? "да" : selected.every(node => !node.visible) ? "нет" : "смешано"}</button><button disabled={!editable || !!flagReason} title={flagReason} onClick={() => flag("locked", !selected.every(node => node.locked))}>Блокировка: {selected.every(node => node.locked) ? "да" : selected.every(node => !node.locked) ? "нет" : "смешано"}</button></div>}
    {active && <div className="tree-edit"><button disabled={!editable || !!reason} onClick={() => { const name = window.prompt("Новое имя объекта", active.name); if (name?.trim()) command({ commandId: crypto.randomUUID(), type: "RENAME_NODE", targetIds: [active.id], payload: { nodeId: active.id, name: name.trim() } }); }}>Переименовать</button><select aria-label="Переместить в группу" value={target} onChange={event => setTarget(event.target.value)}>{project.nodes.filter(node => node.kind === "group").map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select><button disabled={!editable || !!reason} onClick={() => move(active.id, target, map.get(target)?.children.length ?? 0)}>Переместить</button>{active.parentId && <><button disabled={!editable || !!reason || map.get(active.parentId)!.children[0] === active.id} onClick={() => move(active.id, active.parentId!, map.get(active.parentId!)!.children.indexOf(active.id) - 1)}>Выше</button><button disabled={!editable || !!reason || map.get(active.parentId)!.children.at(-1) === active.id} onClick={() => move(active.id, active.parentId!, map.get(active.parentId!)!.children.indexOf(active.id) + 2)}>Ниже</button></>}</div>}
    <p className="panel-hint">Ctrl — добавить к выделению, Shift — диапазон. При перетаскивании верх/низ строки задают порядок, середина помещает в группу.</p>
    <div className="tree-measure" ref={element => { if (element && scroller.current && height !== scroller.current.clientHeight) setHeight(scroller.current.clientHeight); }} />
  </div>;
}

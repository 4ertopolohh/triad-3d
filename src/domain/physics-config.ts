import type { Vec3, InteractionRule, Track } from "./types";

export interface PhysicsActor {
  nodeId: string;
  enabled: boolean;
  body: "dynamic" | "static" | "kinematic";
  collider: "box" | "sphere";
  size: Vec3;
  mass: number;
  restitution: number;
  friction: number;
}

export function physicsConflicts(actors: readonly PhysicsActor[], rules: readonly InteractionRule[], tracks: readonly Pick<Track,"nodeId">[]): string[] {
  const messages: string[] = [];
  for (const actor of actors.filter(a => a.enabled)) {
    for (const rule of rules.filter(r => r.enabled && r.nodeId === actor.nodeId)) {
      if (rule.action.kind === "magnet" || rule.action.kind === "orbit-follow") {
        if (actor.body !== "kinematic") messages.push(`«${rule.name}»: положение узла ${actor.nodeId} контролирует физика; движение правила будет перекрыто.`);
      } else messages.push(`«${rule.name}»: изменение масштаба узла ${actor.nodeId} пересоздаёт физический мир.`);
    }
    if (actor.body !== "kinematic" && tracks.some(t => t.nodeId === actor.nodeId)) messages.push(`Узел ${actor.nodeId}: физика перекрывает положение/вращение timeline; изменение масштаба пересоздаёт мир.`);
  }
  return messages;
}
export function physicsError(value: unknown, nodeIds: ReadonlySet<string>): string | null {
  if (!Array.isArray(value) || value.length > 128) return "Допускается до 128 физических тел.";
  const seen = new Set<string>();
  for (const actor of value) {
    if (!actor || typeof actor !== "object" || Object.keys(actor).sort().join() !== "body,collider,enabled,friction,mass,nodeId,restitution,size"
      || !nodeIds.has(actor.nodeId) || seen.has(actor.nodeId) || typeof actor.enabled !== "boolean"
      || !["dynamic", "static", "kinematic"].includes(actor.body) || !["box", "sphere"].includes(actor.collider)
      || !Array.isArray(actor.size) || actor.size.length !== 3 || !actor.size.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= .001 && n <= 1000)
      || !Number.isFinite(actor.mass) || actor.mass < .001 || actor.mass > 100000
      || !Number.isFinite(actor.restitution) || actor.restitution < 0 || actor.restitution > 1
      || !Number.isFinite(actor.friction) || actor.friction < 0 || actor.friction > 10)
      return "Некорректное физическое тело: проверьте узел, размеры, массу и коэффициенты.";
    seen.add(actor.nodeId);
  }
  return null;
}

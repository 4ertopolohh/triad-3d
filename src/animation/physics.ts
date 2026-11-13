import { physicsError, type PhysicsActor } from "../domain/physics-config";
import type { World, EventQueue, RigidBody } from "@dimforge/rapier3d-compat";
import type { Transform, Vec3 } from "../domain/types";

export interface PhysicsPose { position: Vec3; rotationQuat: Transform["rotationQuat"] }
export interface PhysicsInput { id: string; actor: PhysicsActor; pose: PhysicsPose; scale: Vec3 }
export interface CollisionEvent { first: string; second: string; started: boolean }
let initialization: Promise<void> | undefined;
let engine: typeof import("@dimforge/rapier3d-compat") | undefined;
export function initializePhysics(): Promise<void> {
  return initialization ??= import("@dimforge/rapier3d-compat").then(async module => { await module.init(); engine = module; }).catch(error => { initialization = undefined; throw error; });
}

/** Owns disposable WASM state only. The domain is never mutated by simulation. */
export class PhysicsWorld {
  static readonly stepSeconds = 1 / 60;
  private world: World;
  private events: EventQueue;
  private bodies = new Map<string, { body: RigidBody; kind: PhysicsActor["body"] }>();
  private colliderIds = new Map<number, string>();
  private accumulator = 0;
  private disposed = false;

  constructor(inputs: readonly PhysicsInput[]) {
    if(!engine)throw new Error("Сначала инициализируйте физический движок.");
    const RAPIER=engine;
    this.world=new RAPIER.World({x:0,y:-9.81,z:0});
    this.events=new RAPIER.EventQueue(true);
    this.world.timestep = PhysicsWorld.stepSeconds;
    try {
      if(inputs.length>256)throw new Error("Физический просмотр ограничен 256 телами во всей сцене.");
      for (const { id, actor, pose, scale } of inputs) {
        if (!actor.enabled) continue;
        if (this.bodies.has(id) || physicsError([actor], new Set([actor.nodeId])) || ![...pose.position, ...pose.rotationQuat, ...scale].every(Number.isFinite)
          || scale.some(n => n <= 0 || n > 10000) || Math.abs(Math.hypot(...pose.rotationQuat) - 1) > 1e-4)
          throw new Error("Некорректная поза или параметры физического тела.");
        const desc = actor.body === "dynamic" ? RAPIER.RigidBodyDesc.dynamic() : actor.body === "static" ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.kinematicPositionBased();
        desc.setTranslation(...pose.position).setRotation({ x: pose.rotationQuat[0], y: pose.rotationQuat[1], z: pose.rotationQuat[2], w: pose.rotationQuat[3] });
        if (actor.body === "dynamic") desc.setCcdEnabled(true);
        const body = this.world.createRigidBody(desc);
        // Box size is full extent; sphere uses size.x as diameter and maximum world scale.
        const collider = actor.collider === "sphere" ? RAPIER.ColliderDesc.ball(actor.size[0] * Math.max(...scale) / 2)
          : RAPIER.ColliderDesc.cuboid(actor.size[0] * scale[0] / 2, actor.size[1] * scale[1] / 2, actor.size[2] * scale[2] / 2);
        collider.setMass(actor.mass).setRestitution(actor.restitution).setFriction(actor.friction).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.colliderIds.set(this.world.createCollider(collider, body).handle, id);
        this.bodies.set(id, { body, kind: actor.body });
      }
    } catch (error) { this.dispose(); throw error; }
  }

  advance(deltaSeconds: number, targets: ReadonlyMap<string, PhysicsPose> = new Map()): CollisionEvent[] {
    if (this.disposed) throw new Error("Физический мир уже освобождён.");
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Некорректный шаг симуляции.");
    this.accumulator += Math.min(deltaSeconds, .1); // Bound catch-up after a suspended tab.
    const collisions: CollisionEvent[] = [];
    while (this.accumulator + 1e-10 >= PhysicsWorld.stepSeconds) {
      for (const [id, { body, kind }] of this.bodies) {
        const pose = targets.get(id);
        if (kind !== "kinematic" || !pose) continue;
        if (![...pose.position, ...pose.rotationQuat].every(Number.isFinite) || Math.abs(Math.hypot(...pose.rotationQuat) - 1) > 1e-4) throw new Error("Некорректная кинематическая поза.");
        body.setNextKinematicTranslation({ x: pose.position[0], y: pose.position[1], z: pose.position[2] });
        body.setNextKinematicRotation({ x: pose.rotationQuat[0], y: pose.rotationQuat[1], z: pose.rotationQuat[2], w: pose.rotationQuat[3] });
      }
      this.world.step(this.events);
      this.events.drainCollisionEvents((a, b, started) => {
        const first = this.colliderIds.get(a), second = this.colliderIds.get(b);
        if (first !== undefined && second !== undefined) collisions.push({ first, second, started });
      });
      this.accumulator -= PhysicsWorld.stepSeconds;
    }
    return collisions;
  }

  pose(id: string): PhysicsPose | undefined {
    if (this.disposed) return undefined;
    const body = this.bodies.get(id)?.body;
    if (!body) return undefined;
    const p = body.translation(), q = body.rotation();
    return { position: [p.x, p.y, p.z], rotationQuat: [q.x, q.y, q.z, q.w] };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.free(); this.world.free(); this.bodies.clear(); this.colliderIds.clear();
  }
}

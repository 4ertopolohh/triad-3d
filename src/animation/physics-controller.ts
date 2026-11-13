import { Matrix4, Quaternion, Vector3, type Object3D } from "three";
import type { PhysicsActor } from "../domain/physics-config";
import { initializePhysics, PhysicsWorld, type PhysicsInput } from "./physics";

export interface PhysicsCollision { first: {scopeId:string;nodeId:string}; second: {scopeId:string;nodeId:string}; started:boolean }

export interface PhysicsScope { id: string; actors: readonly PhysicsActor[]; objects: ReadonlyMap<string, Object3D> }

/** One world across all visible instances; scoped IDs keep their contacts distinct. */
export class PhysicsController {
  private ready = false;
  private closed = false;
  private world: PhysicsWorld | undefined;
  private signature = "";
  private failed = false;
  constructor(private report: (message: string) => void) {}
  private loading = false;
  private initialize(): void {
    if (this.loading) return;
    this.loading = true;
    void initializePhysics().then(() => { if (!this.closed) this.ready = true; }).catch(error => {
      this.loading = false; if (!this.closed) { this.failed = true; this.report(`Физика: ${String(error)}`); }
    });
  }
  reset(): void { this.world?.dispose(); this.world = undefined; this.signature = ""; this.failed = false; }

  apply(scopes: readonly PhysicsScope[], delta: number): PhysicsCollision[] {
    if (this.closed || this.failed) return [];
    if (!scopes.some(scope => scope.actors.some(actor => actor.enabled))) { this.reset(); return []; }
    if (!this.ready) { this.initialize(); return []; }
    try {
      const participants=new Map<string,{scopeId:string;nodeId:string}>();
      const inputs: PhysicsInput[] = [], objects = new Map<string, Object3D>();
      for (const scope of scopes) for (const actor of scope.actors) {
        if (!actor.enabled) continue;
        const object = scope.objects.get(actor.nodeId);
        if (!object) continue;
        let visible = true, parent: Object3D | null = object;
        while (parent) { if (!parent.visible) visible = false; parent = parent.parent; }
        if (!visible) continue;
        object.updateWorldMatrix(true, false);
        const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
        object.matrixWorld.decompose(position, rotation, scale);
        if(object.parent&&actor.body!=="kinematic"){
          const parentScale=object.parent.getWorldScale(new Vector3());
          if(Math.max(parentScale.x,parentScale.y,parentScale.z)-Math.min(parentScale.x,parentScale.y,parentScale.z)>1e-5)
            throw new Error("Для динамических и статических тел нужен равномерный масштаб родителей.");
        }
        const reconstructed = new Matrix4().compose(position, rotation, scale);
        if (object.matrixWorld.elements.some((n, i) => Math.abs(n - reconstructed.elements[i]!) > 1e-5 * Math.max(1, Math.abs(n))))
          throw new Error("Сдвиг осей от поворота под неравномерным масштабом не поддерживается физикой.");
        const id = JSON.stringify([scope.id, actor.nodeId]);
        inputs.push({ id, actor, pose: { position: position.toArray(), rotationQuat: rotation.toArray() }, scale: scale.toArray() });
        objects.set(id, object);participants.set(id,{scopeId:scope.id,nodeId:actor.nodeId});
      }
      const signature = JSON.stringify(inputs.map(i => [i.id, i.actor, i.scale.map(n=>Math.round(n*1e6)/1e6), objects.get(i.id)!.uuid]));
      if (signature !== this.signature) { this.reset(); this.world = new PhysicsWorld(inputs); this.signature = signature; }
      if (!this.world) return [];
      const events = this.world.advance(delta, new Map(inputs.map(i => [i.id, i.pose])));
      // Parent before child; the domain rejects nested actors to avoid double ownership.
      for (const input of inputs) {
        if (input.actor.body === "kinematic") continue;
        const object = objects.get(input.id)!, pose = this.world.pose(input.id)!;
        const position = new Vector3(...pose.position), rotation = new Quaternion(...pose.rotationQuat);
        if (object.parent) {
          object.parent.worldToLocal(position);
          rotation.premultiply(object.parent.getWorldQuaternion(new Quaternion()).invert());
        }
        object.position.copy(position); object.quaternion.copy(rotation); object.updateMatrix(); object.updateMatrixWorld(true);
      }
      return events.map(event=>({first:participants.get(event.first)!,second:participants.get(event.second)!,started:event.started}));
    } catch (error) { this.reset(); this.failed = true; this.report(error instanceof Error ? error.message : String(error)); return []; }
  }
  dispose(): void { this.closed = true; this.reset(); }
}

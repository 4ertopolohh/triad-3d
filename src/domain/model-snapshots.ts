import type { ModelSnapshot, Project } from "./types";

export function modelSource(project: Project): Omit<ModelSnapshot,"id"|"revision"> {
  return {rootNodeId:project.model.rootNodeId,nodes:project.nodes,modifiers:project.modifiers,materials:project.materials,animations:project.animations,tracks:project.tracks,keyframes:project.keyframes,...(project.physics?{physics:project.physics}:{}),...(project.interactions?{interactions:project.interactions}:{})};
}
export function snapshotMatches(project:Project,snapshot:ModelSnapshot):boolean{
  const {id: _id,revision: _revision,...source}=snapshot;
  void _id;void _revision;
  return JSON.stringify(source)===JSON.stringify(modelSource(project));
}
export function snapshotChanges(project:Project,snapshot:ModelSnapshot):string[]{
  const changes:string[]=[];
  for(const [label,before,after]of [["Узлы",snapshot.nodes,project.nodes],["Материалы",snapshot.materials,project.materials],["Модификаторы",snapshot.modifiers,project.modifiers],["Клипы",snapshot.animations,project.animations]]as const){
    const previous=new Map<string,unknown>(before.map(item=>[item.id,item]));
    const added=after.filter(item=>!previous.has(item.id)).length,removed=before.filter(item=>!after.some(next=>next.id===item.id)).length,modified=after.filter(item=>previous.has(item.id)&&JSON.stringify(previous.get(item.id))!==JSON.stringify(item)).length;
    changes.push(`${label}: добавлено ${added}, удалено ${removed}, изменено ${modified}.`);
  }
  if(JSON.stringify([snapshot.tracks,snapshot.keyframes])!==JSON.stringify([project.tracks,project.keyframes]))changes.push("Дорожки или ключи анимации изменены.");
  if(JSON.stringify(snapshot.physics)!==JSON.stringify(project.physics))changes.push("Физические тела изменены.");
  if(JSON.stringify(snapshot.interactions)!==JSON.stringify(project.interactions))changes.push("Правила взаимодействия изменены.");
  return changes;
}
export function rememberModel(project:Project,snapshotId:string):ModelSnapshot{
  const previous=project.modelSnapshots?.find(snapshot=>snapshotMatches(project,snapshot));
  if(previous)return previous;
  const snapshot:ModelSnapshot={id:snapshotId,revision:project.model.revision,...structuredClone(modelSource(project))};
  (project.modelSnapshots??=[]).push(snapshot);return snapshot;
}
export function pruneModelSnapshots(project:Project):void{
  const used=new Set(project.scene.instances.map(instance=>instance.snapshotId));
  const retained=project.modelSnapshots?.filter(snapshot=>used.has(snapshot.id));
  if(retained?.length)project.modelSnapshots=retained;else delete project.modelSnapshots;
}
export function snapshotProject(project:Project,snapshot:ModelSnapshot):Project{
  const result:Project={...project,model:{...project.model,rootNodeId:snapshot.rootNodeId,revision:snapshot.revision},scene:{...project.scene,instances:[]},nodes:snapshot.nodes,modifiers:snapshot.modifiers,materials:snapshot.materials,animations:snapshot.animations,tracks:snapshot.tracks,keyframes:snapshot.keyframes};
  delete result.modelSnapshots;if(snapshot.physics)result.physics=snapshot.physics;else delete result.physics;if(snapshot.interactions)result.interactions=snapshot.interactions;else delete result.interactions;return result;
}

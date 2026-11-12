import ts from "typescript";
import { Color, Euler, Quaternion } from "three";
import type { Material, Node, Vec3 } from "../../domain/types";
import { createPrimitiveNode, validatePrimitiveSource, type PrimitiveKind } from "../../geometry/primitives";
import { validateMaterial } from "../../domain/validate-material";

export interface SourceDiagnostic { kind: "supported" | "unsupported" | "warning"; line: number; column: number; endLine: number; endColumn: number; type: string; message: string }
export interface SourceImport { nodes: Node[]; materials: Material[]; diagnostics: SourceDiagnostic[] }
const geometries: Record<string,{kind:PrimitiveKind;args:string[]}>={boxGeometry:{kind:"cube",args:["width","height","depth"]},sphereGeometry:{kind:"sphere",args:["radius","widthSegments","heightSegments"]},torusGeometry:{kind:"torus",args:["radius","tube","radialSegments","tubularSegments"]},cylinderGeometry:{kind:"cylinder",args:["radiusTop","radiusBottom","height","radialSegments"]},coneGeometry:{kind:"cone",args:["radius","height","radialSegments"]},planeGeometry:{kind:"plane",args:["width","height"]}};
const constructorDefaults:Record<PrimitiveKind,number[]>={cube:[1,1,1],sphere:[1,32,16],torus:[1,.4,12,48],cylinder:[1,1,1,32],cone:[1,1,32],plane:[1,1]};
type Element=ts.JsxElement|ts.JsxSelfClosingElement;
const opening=(element:Element)=>ts.isJsxElement(element)?element.openingElement:element;
const tag=(element:Element)=>opening(element).tagName.getText();
function literal(expression:ts.Expression):unknown {
  if(ts.isNumericLiteral(expression))return Number(expression.text);
  if(ts.isStringLiteral(expression))return expression.text;
  if(expression.kind===ts.SyntaxKind.TrueKeyword)return true;
  if(expression.kind===ts.SyntaxKind.FalseKeyword)return false;
  if(ts.isPrefixUnaryExpression(expression)&&[ts.SyntaxKind.MinusToken,ts.SyntaxKind.PlusToken].includes(expression.operator)&&ts.isNumericLiteral(expression.operand))return (expression.operator===ts.SyntaxKind.MinusToken?-1:1)*Number(expression.operand.text);
  if(ts.isArrayLiteralExpression(expression))return expression.elements.map(e=>literal(e));
  throw new Error("Разрешены только литералы; выражение пропущено без исполнения.");
}
/** Pure static extraction: no imports, callbacks, constructors or source expressions execute. */
export function parseSource(source:string,parentId:string,nextId:()=>string=()=>crypto.randomUUID()):SourceImport {
  if(new TextEncoder().encode(source).length>256*1024)throw new Error("Исходник превышает 256 КиБ.");
  const file=ts.createSourceFile("input.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const syntax=(file as ts.SourceFile & {parseDiagnostics:readonly ts.Diagnostic[]}).parseDiagnostics;
  if(syntax.length){const first=syntax[0]!,position=file.getLineAndCharacterOfPosition(first.start??0);throw new Error(`Синтаксическая ошибка ${position.line+1}:${position.character+1}: ${ts.flattenDiagnosticMessageText(first.messageText," ")}`);}
  const result:SourceImport={nodes:[],materials:[],diagnostics:[]};
  const report=(node:ts.Node,kind:SourceDiagnostic["kind"],type:string,message:string)=>{const p=file.getLineAndCharacterOfPosition(node.getStart(file)),end=file.getLineAndCharacterOfPosition(node.end);result.diagnostics.push({kind,type,line:p.line+1,column:p.character+1,endLine:end.line+1,endColumn:end.character+1,message});};
  const attributes=(element:Element,allowed:string[])=>{
    const values:Record<string,unknown>=Object.create(null);
    for(const attribute of opening(element).attributes.properties){
      if(ts.isJsxSpreadAttribute(attribute))throw new Error("Spread-атрибуты не поддерживаются.");
      const name=attribute.name.getText();
      if(!allowed.includes(name)){report(attribute,"unsupported",name,"Атрибут пропущен; обработчики и ресурсы не исполняются и не загружаются.");continue;}
      if(Object.hasOwn(values,name))throw new Error(`Повторный атрибут ${name}.`);
      const initial=attribute.initializer;
      if(initial&&!ts.isStringLiteral(initial)&&!ts.isJsxExpression(initial))throw new Error("JSX в атрибуте не поддерживается.");
      values[name]=!initial?true:ts.isStringLiteral(initial)?initial.text:initial.expression?literal(initial.expression):undefined;
    }
    return values;
  };
  const vector=(value:unknown,fallback:Vec3,scalar=false):Vec3=>{if(value===undefined)return fallback;if(scalar&&typeof value==="number"&&Number.isFinite(value))return [value,value,value];if(Array.isArray(value)&&value.length===3&&value.every(v=>typeof v==="number"&&Number.isFinite(v)))return value as [number,number,number];throw new Error("Нужен статический вектор из трёх чисел.");};
  const flatten=(items:readonly ts.JsxChild[],depth=0):ts.JsxChild[]=>{if(depth>64)throw new Error("Превышена вложенность JSX fragments.");return items.flatMap(child=>ts.isJsxFragment(child)?flatten(child.children,depth+1):[child]);};
  const children=(element:Element)=>ts.isJsxElement(element)?flatten(element.children):[];
  let visited=0;
  function element(input:Element,parent:string,depth:number):void {
    if(depth>64||++visited>256)throw new Error("Превышен бюджет вложенности/элементов.");
    const name=tag(input);
    if(name!=="mesh"&&name!=="group"){
      report(input,"unsupported",name,"Элемент пропущен. Поддерживаются статические mesh/group и встроенные геометрии.");
      // HTML structural wrappers can contain declarative fragments, but script/style/custom components cannot.
      if(["html","body","main","div","section"].includes(name))for(const child of children(input))if(ts.isJsxElement(child)||ts.isJsxSelfClosingElement(child))element(child,parent,depth+1);
      return;
    }
    try {
      const a=attributes(input,["name","position","rotation","scale","visible"]);
      const id=nextId();let node:Node;
      const nested=Array.from(children(input)).filter((c):c is Element=>ts.isJsxElement(c)||ts.isJsxSelfClosingElement(c));
      if(name==="mesh"){
        const shapes=nested.filter(c=>Object.hasOwn(geometries,tag(c)));
        if(shapes.length!==1)throw new Error("Mesh требует ровно одну поддерживаемую геометрию.");
        const shape=shapes[0]!,definition=geometries[tag(shape)]!;
        node=createPrimitiveNode(definition.kind,parent,id);
        node.meshSource={kind:"primitive",primitive:definition.kind,parameters:Object.fromEntries(definition.args.map((key,i)=>[key,constructorDefaults[definition.kind][i]!]))};
        const parameters=attributes(shape,["args"]).args;
        if(parameters!==undefined){if(!Array.isArray(parameters)||parameters.length>definition.args.length||!parameters.every(v=>typeof v==="number"&&Number.isFinite(v)))throw new Error("Неподдерживаемые аргументы геометрии.");Object.assign(node.meshSource.parameters,Object.fromEntries(parameters.map((v,i)=>[definition.args[i]!,v])));}
        const invalid=validatePrimitiveSource(node.meshSource);if(invalid)throw new Error(invalid);
        const surfaces=nested.filter(c=>["meshStandardMaterial","meshPhysicalMaterial"].includes(tag(c)));
        if(surfaces.length>1)throw new Error("Несколько материалов в одном JSX mesh пока не поддерживаются.");
        if(surfaces[0]){
          const p=attributes(surfaces[0],["color","metalness","roughness","opacity","transmission","ior","clearcoat"]);
          if(p.color!==undefined&&(typeof p.color!=="string"||!/^#[0-9a-f]{6}$/i.test(p.color)))throw new Error("Цвет должен быть статическим HEX #rrggbb.");
          const material:Material={id:nextId(),name:"Импортированный материал",baseColor:new Color((p.color as string|undefined)??"#ffffff").toArray() as [number,number,number],metalness:0,roughness:1,emissive:[0,0,0],opacity:1,transmission:0,ior:1.5,clearcoat:0,envIntensity:1,textureAssetIds:[]};
          for(const key of ["metalness","roughness","opacity","transmission","ior","clearcoat"] as const)if(p[key]!==undefined){if(typeof p[key]!=="number")throw new Error(`Некорректный ${key}.`);material[key]=p[key] as number;}
          const invalid=validateMaterial(material);if(invalid.length)throw new Error(invalid[0]!.message);
          node.materialSlots=[{name:"Основной",materialId:material.id}];result.materials.push(material);
        }
      }else node={id,kind:"group",name:"Группа",parentId:parent,children:[],transform:{position:[0,0,0],rotationQuat:[0,0,0,1],scale:[1,1,1]},visible:true,locked:false,materialSlots:[],modifierIds:[]};
      node.name=typeof a.name==="string"&&a.name.trim()?a.name.slice(0,200):node.name;
      node.transform.position=vector(a.position,[0,0,0]);node.transform.scale=vector(a.scale,[1,1,1],true);
      if(node.transform.scale.some(v=>v<=0))throw new Error("Масштаб должен быть положительным.");
      node.transform.rotationQuat=new Quaternion().setFromEuler(new Euler(...vector(a.rotation,[0,0,0]))).toArray();
      if(a.visible!==undefined&&typeof a.visible!=="boolean")throw new Error("visible должен быть boolean.");node.visible=a.visible!==false;
      result.nodes.push(node);report(input,"supported",name,"Статический объект подготовлен.");
      for(const child of children(input)){
        if(ts.isJsxElement(child)||ts.isJsxSelfClosingElement(child)){if(!Object.hasOwn(geometries,tag(child))&&!["meshStandardMaterial","meshPhysicalMaterial"].includes(tag(child)))element(child,id,depth+1);}
        else if(ts.isJsxExpression(child)&&child.expression)report(child,"unsupported","expression","Динамическое содержимое не исполняется и пропущено.");
      }
    }catch(error){report(input,"unsupported",name,error instanceof Error?error.message:String(error));}
  }
  let scanned=0;
  const scan=(node:ts.Node,depth:number)=>{
    if(depth>128||++scanned>50000)throw new Error("Превышен бюджет AST.");
    if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)){element(node,parentId,0);return;}
    if(ts.isConditionalExpression(node)||ts.isBinaryExpression(node)||ts.isIfStatement(node)||ts.isIterationStatement(node,false)||ts.isSwitchStatement(node)||ts.isCallExpression(node)||ts.isNewExpression(node)){report(node,"unsupported",ts.SyntaxKind[node.kind],"Исполняемая конструкция пропущена целиком.");return;}
    if(ts.isImportDeclaration(node)){report(node,"unsupported","import","Импорт не разрешается и не загружается.");return;}
    ts.forEachChild(node,child=>scan(child,depth+1));
  };
  scan(file,0);
  const used=new Set(result.nodes.flatMap(n=>n.materialSlots.map(s=>s.materialId)));result.materials=result.materials.filter(m=>used.has(m.id));
  result.diagnostics.unshift({kind:"warning",line:1,column:1,endLine:1,endColumn:1,type:"static-only",message:"Извлечены только статические JSX-фрагменты. HTML поддерживается только как JSX-совместимая разметка. Компоненты, HTML canvas, скрипты, условия и анимация не исполняются. Оригинал не сохраняется."});
  return result;
}

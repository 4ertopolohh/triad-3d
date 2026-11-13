import { parseObj } from "./parse-obj";
self.onmessage=(event:MessageEvent<{text:string;parentId:string;name:string}>)=>{
  try{self.postMessage({ok:true,value:parseObj(event.data.text,event.data.parentId,event.data.name)});}
  catch(error){self.postMessage({ok:false,message:error instanceof Error?error.message:String(error)});}
};

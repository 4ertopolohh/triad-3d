import { parseSource } from "./parse-source";
self.onmessage=(event:MessageEvent<{source:string;parentId:string}>)=>{
  try{self.postMessage({ok:true,value:parseSource(event.data.source,event.data.parentId)});}
  catch(error){self.postMessage({ok:false,message:error instanceof Error?error.message:String(error)});}
};

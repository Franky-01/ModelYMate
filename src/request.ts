export type FailureKind='cancelled'|'timeout'|'interrupted'|'network'|'http'|'data'|'service';
export class RequestFailure extends Error {
  kind:FailureKind;status?:number;
  constructor(kind:FailureKind,message:string,status?:number){super(message);this.name='RequestFailure';this.kind=kind;this.status=status;}
}
const messages={cancelled:'已取消读取。',timeout:'读取超时，请重试。',interrupted:'连接中断，请重试。',network:'无法连接车辆服务，请检查连接后重试。'};
type Options=RequestInit&{timeoutMs?:number};

// One deadline covers headers AND the body. Caller cancellation stays distinct
// from our deadline and a transport AbortError (including Safari's wording).
export async function request<T>(url:string,consume:(response:Response)=>Promise<T>,options:Options={}):Promise<T>{
  const {signal,timeoutMs=25000,...init}=options;
  if(signal?.aborted)throw new RequestFailure('cancelled',messages.cancelled);
  const controller=new AbortController(),deadline=Date.now()+timeoutMs;
  let rejectFailure:(reason:RequestFailure)=>void=()=>{},stopped=false;
  const failure=new Promise<never>((_,reject)=>{rejectFailure=reject;});
  const stop=(kind:'cancelled'|'timeout')=>{if(stopped)return;stopped=true;rejectFailure(new RequestFailure(kind,messages[kind]));controller.abort();};
  const cancel=()=>stop('cancelled'),checkDeadline=()=>{if(Date.now()>=deadline)stop('timeout');};
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>stop('timeout'),timeoutMs);
  if(typeof window!=='undefined')window.addEventListener('pageshow',checkDeadline);
  if(typeof document!=='undefined')document.addEventListener('visibilitychange',checkDeadline);
  try{
    const task=(async()=>consume(await fetch(url,{...init,signal:controller.signal})))();
    return await Promise.race([task,failure]);
  }catch(error){
    if(error instanceof RequestFailure)throw error;
    const name=(error as Error)?.name;
    const kind=name==='TimeoutError'?'timeout':name==='AbortError'?'interrupted':'network';
    throw new RequestFailure(kind,messages[kind]);
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    if(typeof window!=='undefined')window.removeEventListener('pageshow',checkDeadline);
    if(typeof document!=='undefined')document.removeEventListener('visibilitychange',checkDeadline);
  }
}

export async function responseJSON(response:Response):Promise<any>{
  if(!/\bjson\b/i.test(response.headers.get('content-type')??''))throw new RequestFailure(response.ok?'data':'http',response.ok?'车辆服务暂时没有返回有效数据。':`服务暂时无法访问（${response.status}）。`,response.status);
  try{return await response.json();}
  catch(error){if((error as Error)?.name==='SyntaxError')throw new RequestFailure('data','车辆服务返回的数据无法解析。',response.status);throw error;}
}

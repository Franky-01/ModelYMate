import {decode} from './core.mjs';
import {demoResponse} from './demo.mjs';
import {request,responseJSON,RequestFailure} from './request';
export type J=Record<string,any>;
export type Config={amapKey:string;amapReady:boolean;backendConfigured:boolean;authenticated:boolean;scope:string;baseURL:string;authMode:'legacy'|'forward-auth';loginURL:string;logoutURL:string};
export const emptyConfig:Config={amapKey:'',amapReady:false,backendConfigured:false,authenticated:false,scope:'demo',baseURL:'https://teslamate.example.invalid',authMode:'legacy',loginURL:'',logoutURL:''};
function sessionRequired(response:Response){
  if(response.status===401){window.dispatchEvent(new Event('modelymate-session-required'));return true;}
  return false;
}
export async function getConfig(signal?:AbortSignal):Promise<Config>{return request('/pwa-api/config',async response=>{
  if(sessionRequired(response))throw new RequestFailure('http','登录已过期，请重新登录。',401);
  const payload=await responseJSON(response);
  if(!response.ok)throw new RequestFailure('http',`网站连接暂时不可用（${response.status}），请重试。`,response.status);
  if(!payload||typeof payload.authenticated!=='boolean'||typeof payload.scope!=='string')throw new RequestFailure('data','网站连接配置不完整，请重试。');
  return {...emptyConfig,...payload};
},{cache:'no-store',credentials:'same-origin',signal});}
export function makeAPI(demo:boolean){return async(path:string,signal?:AbortSignal):Promise<J>=>{
  if(demo){await new Promise(r=>setTimeout(r,80));if(signal?.aborted)throw new RequestFailure('cancelled','已取消读取。');return demoResponse(path);}
  return request('/pwa-api/teslamate/'+path,async response=>{
    if(sessionRequired(response))throw new RequestFailure('http','登录已过期，请重新登录。',401);
    const payload=await responseJSON(response);
    if(path.endsWith('/charges/current')&&[200,400,404].includes(response.status)&&['No active charging in progress.','No current charge found.'].includes(payload?.error))return{charge:null};
    try{return decode(payload,response.status);}
    catch(error){throw new RequestFailure(!response.ok?'http':payload?.error!=null?'service':'data',(error as Error).message,response.status);}
  },{cache:'no-store',credentials:'same-origin',signal});
};}

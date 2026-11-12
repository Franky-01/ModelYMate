import {createHash,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';

export const peerIP = value => String(value ?? '').replace(/^::ffff:/,'');
export const loopback = value => ['127.0.0.1','::1'].includes(peerIP(value));
export function proxyIPs(value='') {
  const ips = value.split(',').map(ip=>peerIP(ip.trim())).filter(Boolean);
  if (ips.some(ip=>!isIP(ip))) throw new Error('Trusted proxy addresses must be explicit IPs.');
  return new Set(ips);
}
export function positiveInteger(value,fallback,max) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error('Invalid security limit.');
  return number;
}
export function siteOrigin(value) {
  const url = new URL(value);
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/') {
    throw new Error('Site origin must be a plain HTTPS origin.');
  }
  return url.origin;
}
const digest = value => createHash('sha256').update(value).digest();
export function verifyForwardAuth(req,{ips,user,token,origin}) {
  return ips.has(peerIP(req.socket.remoteAddress)) &&
    req.headers.host===new URL(origin).host &&
    req.headers['x-forwarded-proto']==='https' &&
    req.headers['x-modelymate-user']===user &&
    typeof req.headers['x-modelymate-proxy-token']==='string' &&
    timingSafeEqual(digest(req.headers['x-modelymate-proxy-token']),digest(token));
}
export function sameOrigin(req,expected) {
  if (req.headers['sec-fetch-site']==='cross-site') return false;
  if (!req.headers.origin) return true; // Non-browser clients; no ambient cross-site cookie.
  try { return new URL(req.headers.origin).origin===expected; } catch { return false; }
}

// Bounded fixed windows. Global budgets cannot be bypassed by forged client IPs.
export class Budget {
  constructor(limit,windowMs=60000,maxEntries=1024) {
    this.limit=limit;this.windowMs=windowMs;this.maxEntries=maxEntries;this.entries=new Map();
  }
  take(key='global',now=Date.now()) {
    for (const [name,entry] of this.entries) if (entry.reset<=now) this.entries.delete(name);
    let entry=this.entries.get(key);
    if (!entry) {
      if (this.entries.size>=this.maxEntries) return false;
      entry={count:0,reset:now+this.windowMs};this.entries.set(key,entry);
    }
    if (entry.count>=this.limit) return false;
    entry.count++;return true;
  }
}

const coordinate = value => {
  if (!/^-?\d{1,3}(?:\.\d{1,8})?,-?\d{1,2}(?:\.\d{1,8})?$/.test(value)) return false;
  const [lng,lat]=value.split(',').map(Number);return Math.abs(lng)<=180 && Math.abs(lat)<=90;
};
const mapPolicies = {
  'v3/geocode/regeo': {
    location:coordinate, radius:v=>/^\d{1,4}$/.test(v)&&Number(v)<=1000,
    extensions:v=>v==='base',batch:v=>v==='false',roadlevel:v=>/^[01]$/.test(v),
  },
  'v3/direction/driving': {
    origin:coordinate,destination:coordinate,strategy:v=>/^(?:[0-9]|1[0-9]|20)$/.test(v),
    extensions:v=>v==='base',originid:v=>/^[\w-]{1,80}$/.test(v),destinationid:v=>/^[\w-]{1,80}$/.test(v),
  },
  'v4/map/styles': {styleid:v=>/^[\w-]{1,128}$/.test(v)},
};
const mapCommon={
  callback:v=>/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(v)&&v.length<=100,
  output:v=>v==='json',platform:v=>v==='JS',logversion:v=>/^\d{1,3}(?:\.\d{1,3})?$/.test(v),
  appname:v=>v.length<=160&&!/[\r\n]/.test(v),sdkversion:v=>/^[\w.-]{1,40}$/.test(v),
};
export function mapTarget(tail,params) {
  if (!Object.hasOwn(mapPolicies,tail)) throw new Error('Unsupported map path.');
  const policy=mapPolicies[tail];
  const target=new URL(tail,tail==='v4/map/styles'?'https://webapi.amap.com/':'https://restapi.amap.com/');
  const seen=new Set();
  for (const [name,value] of params) {
    if (seen.has(name)) throw new Error('Duplicate map parameter.');
    seen.add(name);
    // SDK credentials are always replaced with server configuration.
    if (name==='key'||name==='jscode') continue;
    const valid=Object.hasOwn(policy,name)?policy[name]:Object.hasOwn(mapCommon,name)?mapCommon[name]:null;
    if (!valid || !valid(value)) throw new Error('Invalid map parameter.');
    target.searchParams.set(name,value);
  }
  if (tail==='v3/geocode/regeo'&&!params.has('location')) throw new Error('Missing coordinate.');
  if (tail==='v3/direction/driving'&&(!params.has('origin')||!params.has('destination'))) throw new Error('Missing route endpoints.');
  return target;
}
export async function boundedResponse(response,limit) {
  const length=Number(response.headers.get('content-length'));
  if (Number.isFinite(length)&&length>limit) {
    await response.body?.cancel();throw new Error('Upstream response is too large.');
  }
  const chunks=[];let size=0;
  if (response.body) for await (const chunk of response.body) {
    size+=chunk.byteLength;
    if (size>limit) throw new Error('Upstream response is too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks,size);
}

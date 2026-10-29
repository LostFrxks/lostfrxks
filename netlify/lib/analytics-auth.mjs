import {createHash,createHmac,randomBytes} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {tokensEqual} from './analytics-core.mjs';

export const SESSION_COOKIE='__Host-lostfrxks_admin';
export const SESSION_SECONDS=8*60*60;
const PREFIX='sessions/';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const digest=token=>createHash('sha256').update(token).digest('hex');
export function sessionCookie(token='',maxAge=SESSION_SECONDS){
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
export function requestSessionToken(request){
  const cookies=(request.headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+'='));
  if(cookies.length!==1)return null;
  const token=cookies[0].slice(SESSION_COOKIE.length+1);
  return TOKEN.test(token)?token:null;
}
export function sameOrigin(request,{required=false}={}){
  const origin=request.headers.get('origin');
  if((required||origin!==null)&&origin!==new URL(request.url).origin)return false;
  const site=request.headers.get('sec-fetch-site');
  return !site||site==='same-origin'||site==='none';
}

export function createAdminAuth(dependencies={}){
  const clock=dependencies.now??(()=>new Date());
  const randomToken=dependencies.randomToken??(()=>randomBytes(32).toString('base64url'));
  let store=dependencies.store;
  const repository=()=>store??=(dependencies.storeFactory??(()=>getStore({name:'private-analytics-sessions',consistency:'strong'})))();
  const credentials=()=>{
    const env=dependencies.env??process.env;
    const password=env.ANALYTICS_ADMIN_PASSWORD,secret=env.ANALYTICS_SESSION_SECRET;
    if(typeof password!=='string'||!password||typeof secret!=='string'||secret.length<32)throw new Error('Admin authentication unavailable');
    return{password,version:createHmac('sha256',secret).update(password).digest('hex')};
  };
  const timestamp=()=>{const time=clock().getTime();if(!Number.isSafeInteger(time)||time<0)throw new Error('Invalid authentication time');return time;};
  async function logout(request){
    const token=request&&requestSessionToken(request);
    if(token)await repository().delete(PREFIX+digest(token));
  }
  return{
    async login(password,request){
      const configured=credentials();
      if(!tokensEqual(password,configured.password))return null;
      await logout(request);
      const issuedAt=timestamp(),expiresAt=issuedAt+SESSION_SECONDS*1000;
      for(let attempt=0;attempt<3;attempt++){
        const token=randomToken();if(!TOKEN.test(token))throw new Error('Invalid session token');
        const result=await repository().set(PREFIX+digest(token),JSON.stringify({version:1,issuedAt,expiresAt,credentialVersion:configured.version}),{onlyIfNew:true});
        if(result?.modified&&result.etag)return{token,expiresAt};
      }
      throw new Error('Could not create session');
    },
    async authenticate(request){
      const configured=credentials();
      if(!sameOrigin(request))return null;
      const token=requestSessionToken(request);if(!token)return null;
      const record=await repository().get(PREFIX+digest(token),{type:'json',consistency:'strong'});
      const now=timestamp();
      if(!record||record.version!==1||!Number.isSafeInteger(record.issuedAt)||!Number.isSafeInteger(record.expiresAt)||record.issuedAt>now||record.expiresAt<=now||record.expiresAt-record.issuedAt!==SESSION_SECONDS*1000||!tokensEqual(record.credentialVersion,configured.version))return null;
      return{expiresAt:record.expiresAt};
    },
    logout,
    async removeExpired(){
      const now=timestamp();let count=0;
      for await(const page of repository().list({prefix:PREFIX,paginate:true})){
        for(const {key}of page.blobs){
          if(!/^sessions\/[a-f0-9]{64}$/.test(key))continue;
          const value=await repository().get(key,{type:'json',consistency:'strong'});
          if(value&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt<=now){await repository().delete(key);count++;}
        }
      }
      return count;
    },
  };
}

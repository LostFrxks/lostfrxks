import {createAdminAuth,sameOrigin,sessionCookie} from '../lib/analytics-auth.mjs';
const LIMIT=2048;
function response(status,value,headers={}){
  return new Response(value===undefined?null:JSON.stringify(value),{status,headers:{'cache-control':'no-store',...(value===undefined?{}:{'content-type':'application/json; charset=utf-8'}),...headers}});
}
export function createAuthHandler(dependencies={}){
  const auth=dependencies.auth??createAdminAuth();const logger=dependencies.logger??console;
  return async request=>{
    if(!['GET','POST','DELETE'].includes(request.method))return response(405,undefined,{allow:'GET, POST, DELETE'});
    if(!sameOrigin(request,{required:request.method!=='GET'}))return response(403);
    try{
      if(request.method==='GET'){
        const session=await auth.authenticate(request);
        return response(200,{authenticated:!!session,...(session?{expiresAt:session.expiresAt}:{})},session?{}:{'set-cookie':sessionCookie('',0)});
      }
      if(request.method==='DELETE'){
        await auth.logout(request);return response(204,undefined,{'set-cookie':sessionCookie('',0)});
      }
      if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return response(415);
      const declared=request.headers.get('content-length');if(declared&&/^\d+$/.test(declared)&&BigInt(declared)>BigInt(LIMIT))return response(413);
      const bytes=await request.arrayBuffer();if(bytes.byteLength>LIMIT)return response(413);
      let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return response(400);}
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||typeof body.password!=='string'||!body.password)return response(400);
      const session=await auth.login(body.password,request);
      if(!session)return response(401,{error:'Access denied'});
      return response(200,{authenticated:true,expiresAt:session.expiresAt},{'set-cookie':sessionCookie(session.token)});
    }catch{
      logger.error('analytics authentication unavailable');return response(503,{error:'Authentication unavailable'});
    }
  };
}
export const config={path:'/api/analytics/auth',rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowLimit:20,windowSize:60}};
export default createAuthHandler();

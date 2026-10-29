import assert from 'node:assert/strict';import test from 'node:test';
import {createAdminAuth,SESSION_COOKIE,SESSION_SECONDS,sessionCookie}from'../netlify/lib/analytics-auth.mjs';
import {createAuthHandler}from'../netlify/functions/analytics-auth.mjs';
import {authFixture,signedIn,TEST_ENV,memorySessionStore}from'./helpers/admin-auth.mjs';
const ORIGIN='https://portfolio.example';
const request=(cookie,extra={})=>new Request(ORIGIN+'/api/analytics/stats',{headers:{...(cookie?{cookie}:{}),...extra}});
const post=(body,headers={})=>new Request(ORIGIN+'/api/analytics/auth',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('sessions use independent random opaque tokens and store neither the token nor password',async()=>{
 const f=await signedIn();const other=await f.auth.login(TEST_ENV.ANALYTICS_ADMIN_PASSWORD);assert.notEqual(f.token,other.token);assert.equal(Buffer.from(f.token,'base64url').length,32);
 const serialized=JSON.stringify([...f.store.records]);assert(!serialized.includes(f.token));assert(!serialized.includes(TEST_ENV.ANALYTICS_ADMIN_PASSWORD));
 assert(await f.auth.authenticate(request(f.cookie)));assert.equal(await f.auth.authenticate(request()),null);
 const cookie=sessionCookie(f.token);assert(cookie.includes('HttpOnly'));assert(cookie.includes('Secure'));assert(cookie.includes('SameSite=Strict'));assert(cookie.includes('Path=/'));assert(!cookie.includes('Domain='));assert(cookie.includes('Max-Age='+SESSION_SECONDS));assert(SESSION_COOKIE.startsWith('__Host-'));
});
test('expiry, logout and credential rotation invalidate sessions on the server',async()=>{
 let time=new Date('2026-10-29T10:00:00Z');const f=await signedIn(authFixture({now:()=>time}));
 time=new Date(time.getTime()+SESSION_SECONDS*1000);assert.equal(await f.auth.authenticate(request(f.cookie)),null);
 time=new Date('2026-10-29T10:00:00Z');const active=await f.auth.login(f.env.ANALYTICS_ADMIN_PASSWORD);
 const cookie=SESSION_COOKIE+'='+active.token;f.env.ANALYTICS_ADMIN_PASSWORD='rotated';assert.equal(await f.auth.authenticate(request(cookie)),null);
 const current=await f.auth.login('rotated');const next=SESSION_COOKIE+'='+current.token;assert(await f.auth.authenticate(request(next)));await f.auth.logout(request(next));assert.equal(await f.auth.authenticate(request(next)),null);
});
test('malformed, duplicated and forged cookies and old bearer passwords cannot authenticate',async()=>{
 const f=await signedIn();for(const cookie of ['other=x',SESSION_COOKIE+'=short',SESSION_COOKIE+'='+('x'.repeat(43)),f.cookie+'; '+f.cookie])assert.equal(await f.auth.authenticate(request(cookie)),null);
 assert.equal(await f.auth.authenticate(request(null,{authorization:'Bearer '+TEST_ENV.ANALYTICS_ADMIN_PASSWORD})),null);
});
test('wrong passwords do not create sessions and missing configuration fails closed',async()=>{
 const f=authFixture();assert.equal(await f.auth.login('incorrect'),null);assert.equal(f.store.records.size,0);
 for(const env of [{},{ANALYTICS_ADMIN_PASSWORD:'x'}]){const auth=createAdminAuth({env,store:memorySessionStore()});await assert.rejects(()=>auth.login('x'));await assert.rejects(()=>auth.authenticate(request()));}
});
test('login returns only an HttpOnly cookie and anonymous session checks remain quiet',async()=>{
 const f=authFixture();const handler=createAuthHandler({auth:f.auth});
 const anonymous=await handler(new Request(ORIGIN+'/api/analytics/auth'));assert.equal(anonymous.status,200);assert.equal((await anonymous.json()).authenticated,false);
 const response=await handler(post({password:TEST_ENV.ANALYTICS_ADMIN_PASSWORD}));assert.equal(response.status,200);const header=response.headers.get('set-cookie');assert(header.startsWith(SESSION_COOKIE+'='));assert(!JSON.stringify(await response.json()).includes(header.split(';')[0].split('=')[1]));assert.equal(response.headers.get('cache-control'),'no-store');
 const cookie=header.split(';')[0];assert.equal((await(await handler(new Request(ORIGIN+'/api/analytics/auth',{headers:{cookie}}))).json()).authenticated,true);
 const logout=await handler(new Request(ORIGIN+'/api/analytics/auth',{method:'DELETE',headers:{origin:ORIGIN,cookie}}));assert.equal(logout.status,204);assert(logout.headers.get('set-cookie').includes('Max-Age=0'));assert.equal(await f.auth.authenticate(request(cookie)),null);
});
test('login and logout reject cross-origin requests before accessing sessions',async()=>{
 const f=authFixture();const handler=createAuthHandler({auth:f.auth});
 for(const origin of ['https://evil.example','null',''])assert.equal((await handler(post({password:TEST_ENV.ANALYTICS_ADMIN_PASSWORD},{origin}))).status,403);
 assert.equal((await handler(post({password:TEST_ENV.ANALYTICS_ADMIN_PASSWORD},{'sec-fetch-site':'cross-site'}))).status,403);
 assert.equal((await handler(new Request(ORIGIN+'/api/analytics/auth',{method:'DELETE',headers:{origin:'https://evil.example'}}))).status,403);assert.equal(f.store.records.size,0);
});
test('login rejects invalid bodies and sanitizes unavailable storage without exposing credentials',async()=>{
 const f=authFixture();const logs=[];const handler=createAuthHandler({auth:f.auth,logger:{error:message=>logs.push(message)}});
 assert.equal((await handler(post({password:'wrong'}))).status,401);
 for(const body of [{},{password:4},{password:'x',extra:true}])assert.equal((await handler(post(body))).status,400);
 assert.equal((await handler(post({password:'x'.repeat(3000)}))).status,413);
 const broken=createAuthHandler({auth:{login:()=>{throw new Error(TEST_ENV.ANALYTICS_ADMIN_PASSWORD)}},logger:{error:message=>logs.push(message)}});
 const response=await broken(post({password:TEST_ENV.ANALYTICS_ADMIN_PASSWORD}));assert.equal(response.status,503);assert(!(await response.text()).includes(TEST_ENV.ANALYTICS_ADMIN_PASSWORD));assert(!JSON.stringify(logs).includes(TEST_ENV.ANALYTICS_ADMIN_PASSWORD));
});
test('logging in rotates any existing session, and cleanup touches only expired auth records',async()=>{
 const f=await signedIn();const next=await f.auth.login(TEST_ENV.ANALYTICS_ADMIN_PASSWORD,request(f.cookie));assert.equal(await f.auth.authenticate(request(f.cookie)),null);assert(await f.auth.authenticate(request(SESSION_COOKIE+'='+next.token)));
 const record=[...f.store.records.values()][0];f.store.records.set('sessions/'+'a'.repeat(64),{...record,expiresAt:0});f.store.records.set('unrelated-key',{expiresAt:0});
 assert.equal(await f.auth.removeExpired(),1);assert(f.store.records.has('unrelated-key'));assert(await f.auth.authenticate(request(SESSION_COOKIE+'='+next.token)));
});

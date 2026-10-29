import {createAdminAuth, SESSION_COOKIE} from '../../netlify/lib/analytics-auth.mjs';
export const TEST_ENV={ANALYTICS_ADMIN_PASSWORD:'correct-token',ANALYTICS_SESSION_SECRET:'test-only-session-secret-'.repeat(3)};
export function memorySessionStore(){
 const records=new Map();return{records,
 async get(key){return records.get(key)??null;},
 async set(key,data,{onlyIfNew}={}){if(onlyIfNew&&records.has(key))return{modified:false};records.set(key,JSON.parse(data));return{modified:true,etag:'etag'};},
 async delete(key){records.delete(key);},
 async*list(){yield{blobs:[...records.keys()].map(key=>({key})),directories:[]};}
 };
}
export function authFixture({env={...TEST_ENV},now=()=>new Date('2026-10-29T10:00:00.000Z')}={}){
 const store=memorySessionStore();const auth=createAdminAuth({env,store,now});return{auth,store,env};
}
export async function signedIn(fixture=authFixture()){
 const session=await fixture.auth.login(fixture.env.ANALYTICS_ADMIN_PASSWORD);
 return{...fixture,token:session.token,cookie:SESSION_COOKIE+'='+session.token};
}

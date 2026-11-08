import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createWhoop,recordsFromWhoop,encrypt,decrypt,equalSecret} from '../whoop.mjs';
import {createApp} from '../server.mjs';
import http from 'node:http';
test('tokens are authenticated ciphertext and wrong keys cannot decrypt',()=>{const k=Buffer.alloc(32,9),sealed=encrypt({access_token:'private-secret'},k);assert.ok(!sealed.toString().includes('private-secret'));assert.equal(decrypt(sealed,k).access_token,'private-secret');assert.throws(()=>decrypt(sealed,Buffer.alloc(32,8)));assert.equal(equalSecret('abc','abc'),true);assert.equal(equalSecret('abc','abcd'),false);});
test('WHOOP data joins recovery by sleep UUID, ignores naps and uses phone timezone',()=>{const sleeps=[{id:'sleep1',end:'2026-11-06T23:30:00Z',nap:false,score_state:'SCORED',score:{stage_summary:{total_light_sleep_time_milli:3*3600000,total_slow_wave_sleep_time_milli:2*3600000,total_rem_sleep_time_milli:3600000}}},{id:'nap',end:'2026-11-07T05:00:00Z',nap:true}];const r=recordsFromWhoop(sleeps,[{sleep_id:'sleep1',score_state:'SCORED',score:{recovery_score:0}}],[{id:'w1',sport_id:1,start:'2026-11-06T23:00:00Z',end:'2026-11-06T23:30:00Z'}],'Asia/Shanghai');assert.equal(r.length,1);assert.equal(r[0].date,'2026-11-07');assert.equal(r[0].score,0);assert.equal(r[0].sleepHours,6);assert.equal(r[0].workouts[0].minutes,30);});
test('OAuth state is single-use and refresh rotation is serialized across concurrent sync',async()=>{const dir=await mkdtemp(join(tmpdir(),'daily-motion-test-'));let calls=0,refreshes=0,pages=0;const conf={clientId:'id',clientSecret:'secret',redirectUri:'https://example.com/oauth/callback',encryptionKey:'a'.repeat(64),pairToken:'b'.repeat(64),privateDir:dir};const fetcher=async(url,init)=>{if(String(url).includes('/oauth/oauth2/token')){calls++;const p=new URLSearchParams(init.body);if(p.get('grant_type')==='refresh_token'){refreshes++;assert.equal(p.get('refresh_token'),'refresh1');}return Response.json({access_token:`access${calls}`,refresh_token:`refresh${calls}`,expires_in:calls===1?0:3600});}const u=new URL(url);if(u.pathname.endsWith('/sleep')){pages++;if(!u.searchParams.has('nextToken'))return Response.json({records:[],next_token:'page2'});assert.equal(u.searchParams.get('nextToken'),'page2');}return Response.json({records:[]});};const w=createWhoop(conf,{fetcher});const url=new URL(w.authorize().url),state=url.searchParams.get('state');assert.equal(state.length,8);assert.match(url.searchParams.get('scope'),/offline/);await assert.rejects(w.callback(new URLSearchParams({state:'bad',code:'x'})));await w.callback(new URLSearchParams({state,code:'x'}));await assert.rejects(w.callback(new URLSearchParams({state,code:'x'})));const [one,two]=await Promise.all([w.snapshot('Asia/Shanghai'),w.snapshot('Asia/Shanghai')]);assert.deepEqual(one,two);assert.equal(refreshes,1);assert.equal(pages,2);assert.ok(!(await readFile(join(dir,'whoop-token.enc'))).toString().includes('access'));await w.disconnect();});
test('HTTP API blocks unauthenticated calls and never serves private files',async t=>{let hits=0;const server=createApp({pairToken:'a'.repeat(32)},{whoop:{snapshot:async()=>{hits++;return {records:[]};},authorize:()=>({url:'https://api.prod.whoop.com/test'})}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(base+'/api/snapshot')).status,401);assert.equal(hits,0);assert.equal((await fetch(base+'/api/snapshot',{headers:{Authorization:`Bearer ${'a'.repeat(32)}`}})).status,200);assert.equal(hits,1);assert.equal((await fetch(base+'/private/whoop-token.enc')).status,404);assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/')).status,200);});
test('malformed request targets return 400 and leave the preview server running',async t=>{const server=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port;const status=await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:'//['},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(status,400);assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200);});
test('the lightweight voice and quick-entry module is served as JavaScript',async t=>{const server=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const response=await fetch(`http://127.0.0.1:${server.address().port}/quick-log.js`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.match(await response.text(),/export /);});

const statusConfig=privateDir=>({clientId:'local-fixture-client',clientSecret:'local-fixture-client-secret',redirectUri:'https://fitness.invalid/oauth/callback',encryptionKey:'a'.repeat(64),pairToken:'b'.repeat(64),privateDir});
const assertSafeStatus=(status,config)=>{
  assert.deepEqual(Object.keys(status).sort(),['configured','hasToken','tokenExpired','tokenState','checkedAt','apiVersion','upstreamVerified','message'].sort());
  assert.equal(status.apiVersion,'v2');assert.equal(status.upstreamVerified,false);assert.ok(Number.isFinite(Date.parse(status.checkedAt)));
  const json=JSON.stringify(status);for(const secret of [config.clientId,config.clientSecret,config.encryptionKey,config.pairToken,config.privateDir,'fixture-access-token','fixture-refresh-token'])assert.ok(!json.includes(secret));
};
test('local connection status distinguishes incomplete configuration and missing credentials without contacting WHOOP',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'daily-motion-status-')),config=statusConfig(dir);let requests=0;
  const fetcher=async()=>{requests++;throw Error('Status must not contact WHOOP');};
  const incomplete=await createWhoop({...config,clientSecret:''},{fetcher}).status();
  assert.equal(incomplete.configured,false);assert.equal(incomplete.hasToken,false);assert.equal(incomplete.tokenState,'not-checked');assert.equal(incomplete.tokenExpired,null);assertSafeStatus(incomplete,config);
  const missing=await createWhoop(config,{fetcher}).status();
  assert.equal(missing.configured,true);assert.equal(missing.hasToken,false);assert.equal(missing.tokenState,'missing');assert.equal(missing.tokenExpired,null);assertSafeStatus(missing,config);
  assert.equal(requests,0);assert.deepEqual(await readdir(dir),[]);
});
test('local connection status reports expiration without refresh or token-file mutations',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'daily-motion-status-')),config=statusConfig(dir),file=join(dir,'whoop-token.enc');let requests=0;
  const w=createWhoop(config,{fetcher:async()=>{requests++;throw Error('Status must not refresh');}});
  for(const expired of [false,true]){
    const bytes=encrypt({access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',expiresAt:Date.now()+(expired?-60000:3600000)},Buffer.from(config.encryptionKey,'hex'));
    await writeFile(file,bytes);const status=await w.status();
    assert.equal(status.configured,true);assert.equal(status.hasToken,true);assert.equal(status.tokenState,'readable');assert.equal(status.tokenExpired,expired);assertSafeStatus(status,config);
    assert.deepEqual(await readFile(file),bytes);
  }
  assert.equal(requests,0);
});
test('local connection status safely rejects corrupted ciphertext, wrong keys, and malformed token fields',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'daily-motion-status-')),config=statusConfig(dir),file=join(dir,'whoop-token.enc');let requests=0;
  const valid={access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',expiresAt:Date.now()+3600000};
  const malformed=[{...valid,expiresAt:undefined},{...valid,expiresAt:'9999999999999'},{...valid,expiresAt:Infinity},{...valid,expiresAt:9e15},{...valid,access_token:{}},{...valid,refresh_token:''}];
  const fixtures=[Buffer.from('not valid encrypted data'),encrypt(valid,Buffer.alloc(32,2)),...malformed.map(token=>encrypt(token,Buffer.from(config.encryptionKey,'hex')))];
  const w=createWhoop(config,{fetcher:async()=>{requests++;throw Error('Status must not contact WHOOP');}});
  for(const bytes of fixtures){await writeFile(file,bytes);const status=await w.status();assert.equal(status.configured,true);assert.equal(status.hasToken,false);assert.equal(status.tokenExpired,null);assert.equal(status.tokenState,'invalid');assertSafeStatus(status,config);assert.deepEqual(await readFile(file),bytes);}
  assert.equal(requests,0);
});
test('status HTTP route requires the personal key and does not expose configuration before authentication',async t=>{
  let inspections=0;const status={configured:true,hasToken:false,tokenExpired:null,tokenState:'missing',checkedAt:new Date().toISOString(),apiVersion:'v2',upstreamVerified:false,message:'尚未保存本地凭据'};
  const server=createApp({pairToken:'c'.repeat(32)},{whoop:{status:async()=>{inspections++;return status;}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const authorization of [undefined,'Bearer invalid']){const response=await fetch(base+'/api/status',{headers:authorization?{Authorization:authorization}:{}});assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'个人连接密钥无效'});}
  assert.equal(inspections,0);const response=await fetch(base+'/api/status',{headers:{Authorization:`Bearer ${'c'.repeat(32)}`}});assert.equal(response.status,200);assert.deepEqual(await response.json(),status);assert.equal(inspections,1);
  const unconfigured=createApp({clientSecret:'never-public'},{whoop:{status:async()=>{throw Error('Must not inspect without PAIR_TOKEN');}}});
  await new Promise(resolve=>unconfigured.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>unconfigured.close(resolve)));
  const blocked=await fetch(`http://127.0.0.1:${unconfigured.address().port}/api/status`);assert.equal(blocked.status,503);assert.deepEqual(await blocked.json(),{error:'WHOOP 同步服务尚未配置'});
});

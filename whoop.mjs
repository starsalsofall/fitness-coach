import {randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';

export function equalSecret(a,b){const x=Buffer.from(a??''),y=Buffer.from(b??'');return x.length===y.length&&timingSafeEqual(x,y);}
export function encrypt(value,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);}
export function decrypt(value,key){if(!Buffer.isBuffer(value)||value.length<29)throw Error('Invalid encrypted payload');const cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12),{authTagLength:16});cipher.setAuthTag(value.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8'));}
export function recordsFromWhoop(sleeps,recoveries,workouts,timezone){
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  const dayKey=value=>{const p=Object.fromEntries(formatter.formatToParts(new Date(value)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
  const days=new Map(),get=date=>{if(!days.has(date))days.set(date,{date,score:null,sleepHours:null,workouts:[]});return days.get(date);};
  const recoveryBySleep=new Map(recoveries.filter(r=>r.score_state==='SCORED').map(r=>[r.sleep_id,r]));
  // Sort oldest first so the most recent main sleep on a date wins. Naps do not overwrite it.
  for(const s of [...sleeps].filter(s=>!s.nap&&s.end).sort((a,b)=>Date.parse(a.end)-Date.parse(b.end))){const d=get(dayKey(s.end)),st=s.score?.stage_summary;d.sleepHours=s.score_state==='SCORED'&&st?(st.total_light_sleep_time_milli+st.total_slow_wave_sleep_time_milli+st.total_rem_sleep_time_milli)/3600000:null;d.score=recoveryBySleep.get(s.id)?.score?.recovery_score??null;}
  for(const w of workouts){if(!w.start||!w.end)continue;const d=get(dayKey(w.start));if(!d.workouts.some(x=>x.id===w.id))d.workouts.push({id:w.id,sportId:w.sport_id,start:w.start,minutes:(Date.parse(w.end)-Date.parse(w.start))/60000});}
  return [...days.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
export function createWhoop(config,{fetcher=fetch}={}) {
  const api='https://api.prod.whoop.com/developer/v2',tokenUrl='https://api.prod.whoop.com/oauth/oauth2/token';
  const pending=new Map(),cache=new Map();let queue=Promise.resolve();
  const serial=fn=>{const task=queue.then(fn,fn);queue=task.catch(()=>{});return task;};
  const key=()=>Buffer.from(config.encryptionKey??'','hex');
  const nonempty=value=>typeof value==='string'&&value.trim().length>0;
  const configured=()=>Boolean(nonempty(config.clientId)&&nonempty(config.clientSecret)&&nonempty(config.redirectUri)&&/^[\da-f]{64}$/i.test(config.encryptionKey??'')&&nonempty(config.pairToken)&&config.pairToken.length>=32);
  const ready=()=>{if(!configured())throw Error('WHOOP 服务尚未配置完整，请按 README 配置服务端环境变量');};
  const file=join(config.privateDir,'whoop-token.enc');
  const validToken=t=>Boolean(t&&typeof t==='object'&&!Array.isArray(t)&&
    typeof t.access_token==='string'&&t.access_token.trim()&&!/[\r\n\0]/.test(t.access_token)&&
    typeof t.refresh_token==='string'&&t.refresh_token.trim()&&!/[\r\n\0]/.test(t.refresh_token)&&
    typeof t.expiresAt==='number'&&Number.isFinite(t.expiresAt)&&t.expiresAt>0&&t.expiresAt<=8.64e15);
  const store=async t=>{await mkdir(config.privateDir,{recursive:true});await writeFile(file+'.tmp',encrypt(t,key()),{mode:0o600});await rename(file+'.tmp',file);};
  const load=async()=>{try{const t=decrypt(await readFile(file),key());if(!validToken(t))throw Error('Invalid stored token');return t;}catch(e){if(e.code==='ENOENT')throw Object.assign(Error('请先完成 WHOOP 授权'),{code:'TOKEN_MISSING'});throw Object.assign(Error('服务端令牌无法读取，请检查加密密钥'),{code:'TOKEN_INVALID'});}};
  const request=async(url,init={})=>fetcher(url,{...init,signal:AbortSignal.timeout(15000),redirect:'error'});
  async function token(parameters){const res=await request(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...parameters,client_id:config.clientId,client_secret:config.clientSecret})});if(!res.ok)throw Error('WHOOP 授权或刷新失败，请重新授权');const t=await res.json();if(!t.access_token||!t.refresh_token||!Number.isFinite(t.expires_in))throw Error('WHOOP 令牌响应无效');const saved={...t,expiresAt:Date.now()+t.expires_in*1000};await store(saved);return saved;}
  async function access(force=false){let t=await load();if(force||t.expiresAt<Date.now()+60000)t=await token({grant_type:'refresh_token',refresh_token:t.refresh_token,scope:'offline'});return t.access_token;}
  async function authRequest(path,method='GET'){let a=await access();let res=await request(api+path,{method,headers:{Authorization:`Bearer ${a}`}});if(res.status===401){a=await access(true);res=await request(api+path,{method,headers:{Authorization:`Bearer ${a}`}});}if(!res.ok)throw Error(res.status===429?'WHOOP 请求过于频繁，请稍后重试':`WHOOP 暂时无法返回数据（${res.status}）`);return res;}
  async function collect(path,start){let next,records=[];for(let page=0;page<50;page++){const q=new URLSearchParams({limit:'25',start});if(next)q.set('nextToken',next);const data=await(await authRequest(path+'?'+q)).json();if(!Array.isArray(data.records))throw Error('WHOOP 数据格式无效');records.push(...data.records);next=data.next_token;if(!next)return records;}throw Error('WHOOP 分页超出上限，请缩短同步范围');}
  return {
    // This check is local only: never refresh tokens, call WHOOP, or claim an
    // existing credential still grants access to the upstream account.
    async status(){
      const result={configured:configured(),hasToken:false,tokenExpired:null,tokenState:'not-checked',checkedAt:new Date().toISOString(),apiVersion:'v2',upstreamVerified:false,message:'服务已响应，但 WHOOP 配置尚未齐全；请先完成本机配置。'};
      if(!result.configured)return result;
      try{
        const t=await load();result.hasToken=true;result.tokenExpired=t.expiresAt<=Date.now();result.tokenState='readable';
        result.message=result.tokenExpired?'本地凭据可读取，访问令牌已到期；同步时可尝试刷新，仍需真实同步验证。':'本地配置与凭据可读取；尚未验证 WHOOP 授权是否仍有效，请同步真实数据确认。';
      }catch(e){
        result.tokenState=e.code==='TOKEN_MISSING'?'missing':'invalid';
        result.message=result.tokenState==='missing'?'本地配置齐备，尚未保存 WHOOP 凭据；请先完成本人授权，再同步验证。':'本地凭据无法使用；请检查原加密键或重新授权。检查不会修改已有凭据。';
      }
      return result;
    },
    authorize(){ready();for(const [s,t]of pending)if(t<Date.now())pending.delete(s);if(pending.size>=10)throw Error('待授权请求较多，请稍后重试');const state=randomBytes(6).toString('base64url');pending.set(state,Date.now()+10*60*1000);const url=new URL('https://api.prod.whoop.com/oauth/oauth2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:'offline read:recovery read:sleep read:workout',state}).toString();return {url:String(url)};},
    callback(query){return serial(async()=>{ready();const state=query.get('state'),expires=pending.get(state);pending.delete(state);if(!expires||expires<Date.now())throw Error('授权链接已失效，请从应用重新开始');if(query.get('error')||!query.get('code'))throw Error('WHOOP 授权未完成');await token({grant_type:'authorization_code',code:query.get('code'),redirect_uri:config.redirectUri});cache.clear();});},
    snapshot(timezone){return serial(async()=>{ready();try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw Error('时区无效');}const cached=cache.get(timezone);if(cached&&Date.now()-cached.time<60000)return cached.data;const start=new Date(Date.now()-31*86400000).toISOString();const sleeps=await collect('/activity/sleep',start),recoveries=await collect('/recovery',start),workouts=await collect('/activity/workout',start);const data={syncedAt:new Date().toISOString(),records:recordsFromWhoop(sleeps,recoveries,workouts,timezone)};cache.set(timezone,{time:Date.now(),data});return data;});},
    disconnect(){return serial(async()=>{ready();try{await load();}catch(e){if(e.message==='请先完成 WHOOP 授权'){cache.clear();pending.clear();return;}throw e;}await authRequest('/user/access','DELETE');await rm(file,{force:true});cache.clear();pending.clear();});}
  };
}

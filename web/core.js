export const VERSION = 2;
// All copied application state is JSON data; keep older WebViews usable without a clone SDK.
export function cloneData(value) {return typeof globalThis.structuredClone==='function'?globalThis.structuredClone(value):JSON.parse(JSON.stringify(value));}
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function offsetDate(key, delta) { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate()+delta); return dateKey(d); }
export function initialState() {
  return {version:VERSION, settings:{goal:'减脂，同时保持肌肉',calories:null,protein:null,carbMode:'fixed',carbs:null,trainingCarbs:null,restCarbs:null,reminders:false,trainingTime:'18:30',mealTime:'20:30',serverUrl:''}, plans:[], foods:[], days:{}, whoop:{records:[],syncedAt:null}, healthConnect:{records:[],syncedAt:null,source:'health-connect'}};
}
export function ensureDay(state, key) {
  if (!state.days[key]) {
    const weekday = new Date(`${key}T12:00:00`).getDay();
    state.days[key] = {tasks:state.plans.filter(p=>p.weekdays.includes(weekday)&&(!p.startDate||key>=p.startDate)).map(p=>({...cloneData(p),id:uid(),planId:p.id,status:'pending',sets:[],actualMinutes:null})), meals:[],foodNotes:[],foodComplete:false,recovery:null,weight:null,note:'',carbDayType:'auto'};
  }
  if (!state.days[key].foodNotes) state.days[key].foodNotes=[];
  if (state.days[key].carbDayType===undefined) state.days[key].carbDayType='auto';
  return state.days[key];
}
export function totals(day) {
  const sum=day.meals.reduce((t,m)=>({calories:t.calories+m.calories,protein:t.protein+m.protein,knownCarbs:t.knownCarbs+(typeof m.carbs==='number'&&Number.isFinite(m.carbs)?m.carbs:0),carbUnknownCount:t.carbUnknownCount+(typeof m.carbs==='number'&&Number.isFinite(m.carbs)?0:1)}),{calories:0,protein:0,knownCarbs:0,carbUnknownCount:0});
  sum.knownCarbs=Math.round(sum.knownCarbs*10)/10;
  return {...sum,carbs:sum.carbUnknownCount?null:sum.knownCarbs};
}
/** A training-day target follows the schedule, never whether a box has been checked. */
export function carbGoalFor(state,key) {
  const settings=state.settings,day=state.days[key],manual=day?.carbDayType;
  const overridden=manual==='training'||manual==='rest';
  let dayType=overridden?manual:'unplanned',basis=overridden?'manual':'unplanned';
  if(!overridden) {
    const existing=Array.isArray(day?.tasks),weekday=new Date(`${key}T12:00:00`).getDay();
    const tasks=existing?day.tasks:state.plans.filter(plan=>plan.weekdays.includes(weekday)&&(!plan.startDate||key>=plan.startDate));
    if(tasks.some(task=>task.category==='力量'||task.category==='有氧'))dayType='training';
    else if(tasks.length&&tasks.every(task=>task.category==='休息'||task.category==='拉伸'))dayType='rest';
    if(dayType!=='unplanned')basis=existing?'tasks':'templates';
  }
  const mode=settings.carbMode==='cycle'?'cycle':'fixed';
  const target=mode==='fixed'?settings.carbs:dayType==='training'?settings.trainingCarbs:dayType==='rest'?settings.restCarbs:null;
  return {mode,target:typeof target==='number'&&Number.isFinite(target)?target:null,dayType,basis:mode==='fixed'?'fixed':basis,overridden};
}
export function progress(day) {
  const active = day.tasks.filter(t=>t.status!=='skipped');
  return {done:active.filter(t=>t.status==='done').length,total:active.length,skipped:day.tasks.filter(t=>t.status==='skipped').length};
}
export function recoveryFor(state,key) {
  const candidates=[state.whoop,state.healthConnect].filter(Boolean).map(cache=>({record:cache.records.find(r=>r.date===key),time:Date.parse(cache.syncedAt)||0})).filter(item=>item.record).sort((a,b)=>b.time-a.time);
  const synced=candidates[0]?.record??null;
  // A manual sleep/recovery entry must not hide independently synchronized workouts.
  // Choose one source's workout list, rather than merging duplicate WHOOP / Health Connect entries.
  const workoutRecord=candidates.find(item=>item.record.workouts?.length)?.record??synced;
  const manual=state.days[key]?.recovery;
  if (!manual && !synced) return null;
  return {...synced,...manual,workouts:workoutRecord?.workouts??[],workoutSource:workoutRecord?.source??null};
}
export function feedback(state,key) {
  const day=ensureDay(state,key), p=progress(day), sum=totals(day), r=recoveryFor(state,key), out=[];
  if (!day.tasks.length) out.push({tone:'neutral',text:'今天还没有安排。添加运动，或把今天设为休息日。'});
  else if (p.total===0) out.push({tone:'neutral',text:'今天的项目已全部跳过，原因保留在记录中。'});
  else if (p.done===p.total) out.push({tone:'good',text:`已完成今天的 ${p.done} 项安排，给身体留出恢复时间。`});
  else out.push({tone:'neutral',text:`还有 ${p.total-p.done} 项安排。可以调整计划，也可以记录跳过原因。`});
  if (r?.score != null) out.push({tone:'neutral',text:`${r.source==='whoop'?'WHOOP':'手动记录'}恢复分数 ${r.score}%。结合自己的疲劳感决定训练强度；应用不会自动加量。`});
  else if(r?.sleepHours!=null) out.push({tone:'neutral',text:`手动记录睡眠 ${r.sleepHours} 小时；训练强度结合自己的感受调整。`});
  const pendingFoodNotes=day.foodNotes?.length??0, foodComplete=day.foodComplete&&!pendingFoodNotes;
  if (pendingFoodNotes) out.push({tone:'neutral',text:`还有 ${pendingFoodNotes} 条饮食备注待补全。未计算它们的热量，暂不判断全天摄入是否达标。`});
  else if (!foodComplete) out.push({tone:'neutral',text:'饮食尚未记全：目前只能汇总已录入部分，暂不判断全天摄入是否达标。'});
  else if (state.settings.calories) {
    const diff=Math.round(sum.calories-state.settings.calories);
    out.push({tone:'neutral',text:`饮食记录已标记完整。按你的热量目标，估算摄入${diff>=0?'高于':'低于'}目标 ${Math.abs(diff)} kcal。`});
  } else out.push({tone:'neutral',text:'饮食记录已完成。设置你自己的目标后，可以比较当天摄入。'});
  if (foodComplete && state.settings.protein && sum.protein<state.settings.protein) out.push({tone:'neutral',text:`按你的蛋白质目标，已记录摄入还差 ${(state.settings.protein-sum.protein).toFixed(1)} g。`});
  return out;
}
export function addMeal(day, food, grams, meal) {
  if (!Number.isFinite(grams)||grams<=0||grams>10000) throw Error('请输入有效份量');
  if(food.carbs!=null&&(!Number.isFinite(food.carbs)||food.carbs<0||food.carbs>100))throw Error('食物碳水资料无效，请先修改常吃食物');
  const entry={id:uid(),foodId:food.id,name:food.name,grams,meal,calories:Math.round(food.calories*grams/100*10)/10,protein:Math.round(food.protein*grams/100*10)/10,carbs:food.carbs==null?null:Math.round(food.carbs*grams/100*10)/10};
  day.meals.push(entry); day.foodComplete=false; return entry;
}
export function weekSummary(state,end) {
  return Array.from({length:7},(_,i)=>{const date=offsetDate(end,i-6),day=state.days[date];return {date, ...(day?progress(day):{done:0,total:0,skipped:0}), recorded:!!day, calories:day?totals(day).calories:0,foodComplete:!!day?.foodComplete&&!day?.foodNotes?.length,weight:day?.weight??null};});
}
// Only merge WHOOP measurements. WHOOP workouts are evidence, never proof that individual sets were performed.
function normalizeHealthRecords(payload,source) {
  if (!payload || !Array.isArray(payload.records)) throw Error('健康数据格式不正确');
  const records = payload.records.map(r=>{
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw Error('健康数据日期无效');
    if(source==='health-connect'&&r.score!=null)throw Error('Health Connect 不提供 WHOOP 恢复分数');
    const score = r.score == null ? null : Number(r.score);
    if(score!==null&&(!Number.isFinite(score)||score<0||score>100)) throw Error('恢复分数无效');
    const sleepHours=r.sleepHours==null?null:Number(r.sleepHours);
    if(sleepHours!==null&&(!Number.isFinite(sleepHours)||sleepHours<0||sleepHours>48)) throw Error('睡眠数据无效');
    const sleepSessionHours=r.sleepSessionHours==null?null:Number(r.sleepSessionHours);
    if(sleepSessionHours!==null&&(!Number.isFinite(sleepSessionHours)||sleepSessionHours<0||sleepSessionHours>48))throw Error('睡眠片段时长无效');
    if(r.workouts!=null&&!Array.isArray(r.workouts))throw Error('运动数据无效');
    const workouts=(r.workouts??[]).map(w=>{if(!w||typeof w.id!=='string'||w.id.length>500||!Number.isFinite(w.minutes)||w.minutes<0||!Number.isFinite(w.sportId)||w.start!=null&&(typeof w.start!=='string'||!Number.isFinite(Date.parse(w.start)))||w.name!=null&&(typeof w.name!=='string'||w.name.length>100))throw Error('运动数据无效');return {id:w.id,minutes:w.minutes,sportId:w.sportId,...(w.start!=null?{start:w.start}:{}),...(w.name!=null?{name:w.name}:{})};});
    if(r.sleepBasis!=null&&!['stages','session-only'].includes(r.sleepBasis))throw Error('睡眠来源无效');
    if(r.sleepBasis==='session-only'&&sleepHours!==null)throw Error('睡眠片段不能作为实际睡眠时长');
    return {date:r.date,score,sleepHours,source,workouts,...(r.sleepBasis!=null?{sleepBasis:r.sleepBasis}:{}),...(sleepSessionHours!==null?{sleepSessionHours}:{})};
  });
  const syncedAt=payload.syncedAt===null?null:payload.syncedAt??new Date().toISOString();
  if(syncedAt!==null&&!Number.isFinite(Date.parse(syncedAt)))throw Error('同步时间无效');
  return {records,syncedAt};
}
export function normalizeWhoop(payload) { return normalizeHealthRecords(payload,'whoop'); }
export function normalizeHealthConnect(payload) {
  if(payload?.sourcePackage!=null&&payload.sourcePackage!=='com.whoop.android')throw Error('Health Connect 数据来源不是 WHOOP');
  return {...normalizeHealthRecords(payload,'health-connect'),source:'health-connect',...(payload.sourcePackage?{sourcePackage:payload.sourcePackage}:{})};
}
export function validateState(input) {
  const fail=()=>{throw Error('备份格式或字段无效，原数据未更改');};
  const num=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
  const text=(x,n=500)=>typeof x==='string'&&x.length<=n;
  if(!input||![1,VERSION].includes(input.version))fail();
  let s;try{s=JSON.parse(JSON.stringify(input,(_key,value)=>{if(typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid number');return value;}));}catch{fail();}
  if (!s.settings||typeof s.settings!=='object'||Array.isArray(s.settings)||!Array.isArray(s.plans)||!Array.isArray(s.foods)||!s.days||typeof s.days!=='object'||Array.isArray(s.days)) fail();
  const cfg=s.settings;
  if(cfg.carbMode===undefined)cfg.carbMode='fixed';
  for(const key of ['carbs','trainingCarbs','restCarbs'])if(cfg[key]===undefined)cfg[key]=null;
  if(!['fixed','cycle'].includes(cfg.carbMode)||['carbs','trainingCarbs','restCarbs'].some(key=>cfg[key]!==null&&!num(cfg[key],0,5000)))fail();
  if(!text(cfg.goal)||!text(cfg.serverUrl,2048)||typeof cfg.reminders!=='boolean')fail();
  for(const k of ['trainingTime','mealTime'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg[k]))fail();
  for(const k of ['quietStart','quietEnd'])if(cfg[k]!==undefined&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg[k]))fail();
  if(cfg.reminderIntervalMinutes!==undefined&&(!Number.isInteger(cfg.reminderIntervalMinutes)||!num(cfg.reminderIntervalMinutes,15,180)))fail();
  if(cfg.reminderMaxCount!==undefined&&(!Number.isInteger(cfg.reminderMaxCount)||!num(cfg.reminderMaxCount,1,5)))fail();
  if(cfg.calories!==null&&!num(cfg.calories,1,20000)||cfg.protein!==null&&!num(cfg.protein,1,1000))fail();
  const checkTask=(t,template=false)=>{
    if(t?.instructions!==undefined&&!text(t.instructions,500))fail();
    if(t?.startDate!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(t.startDate)||dateKey(new Date(`${t.startDate}T12:00:00`))!==t.startDate))fail();
    if(!t||!text(t.id)||!text(t.name,100)||!['力量','有氧','拉伸','休息'].includes(t.category)||!num(t.minutes,0,1440)||!text(t.time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))fail();
    if(template){if(!Array.isArray(t.weekdays)||!t.weekdays.length||t.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))fail();}
    else {if(!['pending','done','skipped'].includes(t.status)||!Array.isArray(t.sets)||t.sets.some(v=>!v||!num(v.weight,0,2000)||!num(v.reps,1,10000)))fail();}
  };
  s.plans.forEach(t=>checkTask(t,true));
  for(const f of s.foods){
    if(!f||!text(f.id)||!text(f.name,100)||!num(f.calories,0,10000)||!num(f.protein,0,1000)||f.portionGrams!=null&&!num(f.portionGrams,0.1,10000))fail();
    if(f.carbs===undefined)f.carbs=null;
    if(f.carbs!==null&&!num(f.carbs,0,100))fail();
  }
  for(const [date,d]of Object.entries(s.days)) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!d||!Array.isArray(d.tasks)||!Array.isArray(d.meals)||typeof d.foodComplete!=='boolean'||!text(d.note,2000)||d.weight!==null&&!num(d.weight,1,500))fail();
    d.tasks.forEach(t=>checkTask(t));
    if(d.carbDayType===undefined)d.carbDayType='auto';
    if(!['auto','training','rest'].includes(d.carbDayType))fail();
    for(const m of d.meals){
      if(!m||!text(m.id)||!text(m.name,100)||!text(m.meal,20)||!num(m.grams,0.1,10000)||!num(m.calories,0,100000)||!num(m.protein,0,10000))fail();
      if(m.carbs===undefined)m.carbs=null;
      if(m.carbs!==null&&!num(m.carbs,0,10000))fail();
    }
    if(d.foodNotes!==undefined&&(!Array.isArray(d.foodNotes)||d.foodNotes.some(n=>!n||!text(n.id)||!text(n.text,2000)||!n.text.trim()||typeof n.createdAt!=='string'||!Number.isFinite(Date.parse(n.createdAt)))))fail();
    if(d.recovery!==null&&(!d.recovery||d.recovery.source!=='manual'||d.recovery.score!==null&&!num(d.recovery.score,0,100)||d.recovery.sleepHours!==null&&!num(d.recovery.sleepHours,0,48)))fail();
  }
  if(!s.whoop)fail();
  const whoop=normalizeWhoop(s.whoop),healthConnect=normalizeHealthConnect(s.healthConnect??{records:[],syncedAt:null});
  s.whoop=whoop;
  s.healthConnect=healthConnect;
  s.version=VERSION;
  return s;
}
// Explicit migration entry point for upgrades; invalid data never modifies the source object.
export function migrateState(input){return validateState(input);}

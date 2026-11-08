import {cloneData,dateKey,ensureDay,offsetDate,uid} from './core.js';

// This is a formatting example, not a prescribed training program.
export const EXAMPLE_WEEK = `周一
深蹲 3组×8次
平板支撑 3组×30秒
周二
快走 20分钟
周三
划船 3组×10次
俯卧撑 3组×8次
周四
休息
周五
深蹲 3组×8次
划船 3组×10次
周六
快走 20分钟
周日
休息`;

const CN='一二三四五六日天1234567';
const CN_HEADER=new RegExp(`^((?:周|星期|礼拜)[${CN}](?:\\s*(?:、|,|，|/|和|及|至|到|-|—)\\s*(?:(?:周|星期|礼拜)?[${CN}]))*)`);
const EN_TOKEN='(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)';
const EN_HEADER=new RegExp(`^(${EN_TOKEN}(?:\\s*[,/、，&]\\s*${EN_TOKEN})*)(?=\\s|[:：\\t]|$)`,'i');
const enDay={mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:0};
const norm=value=>String(value??'').trim().replace(/\s+/g,' ');
function cnDay(value){const index='一二三四五六'.indexOf(value);return index>=0?index+1:['日','天','7'].includes(value)?0:Number(value);}
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(`${value}T12:00:00`);return Number.isFinite(d.getTime())&&dateKey(d)===value;}
function weekdayPrefix(line){
  const chinese=line.match(CN_HEADER);
  if(chinese){
    const expression=chinese[1],tokens=Array.from(expression.matchAll(new RegExp(`(?:周|星期|礼拜)?([${CN}])`,'g'))),days=[];
    for(let i=0;i<tokens.length;i++){
      const day=cnDay(tokens[i][1]);
      if(i&&/[至到\-—]/.test(expression.slice(tokens[i-1].index+tokens[i-1][0].length,tokens[i].index))){
        let cursor=cnDay(tokens[i-1][1]);for(let count=0;cursor!==day&&count<7;count++){cursor=(cursor+1)%7;days.push(cursor);}
      }else days.push(day);
    }
    return {days:[...new Set(days)],rest:line.slice(expression.length).replace(/^\s*[:：|,，]\s*/,'').trim()};
  }
  const english=line.match(EN_HEADER);
  if(english)return {days:[...new Set(english[1].match(new RegExp(EN_TOKEN,'gi')).map(token=>enDay[token.slice(0,3).toLowerCase()]))],rest:line.slice(english[1].length).replace(/^\s*[:：|,，]\s*/,'').trim()};
  return null;
}
function categoryOf(text){
  if(/休息|休整|rest\b/i.test(text))return '休息';
  if(/拉伸|伸展|瑜伽|stretch|yoga/i.test(text))return '拉伸';
  if(/有氧|快走|慢走|步行|散步|跑步|慢跑|骑行|单车|游泳|椭圆|跳绳|cardio|walk|run|cycl|swim/i.test(text))return '有氧';
  return '力量';
}
function parseExercise(raw,days,lineNumber,errors){
  let text=norm(raw.replace(/^\s*(?:[-*•●]|\d+[.)、])\s*/,'')).replace(/(\d)：(?=\d)/g,'$1:');
  if(!text)return null;
  const category=categoryOf(text),timeMatches=[...text.matchAll(/(?:^|\s)([0-2]?\d:[0-5]\d)(?=\s|$)/g)];
  let time='18:30';
  if(timeMatches.length>1){errors.push(`第 ${lineNumber} 行有多个时间，请拆成单独项目。`);return null;}
  if(timeMatches.length){time=timeMatches[0][1].padStart(5,'0');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){errors.push(`第 ${lineNumber} 行时间无效。`);return null;}text=norm(text.replace(timeMatches[0][0],' '));}
  if(/\d{1,2}:\d{2}/.test(text)){errors.push(`第 ${lineNumber} 行时间无效或缺少空格，请使用“18:30”。`);return null;}
  let minutes=0;
  const durations=[...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:分钟|分鍾|mins?\b|minutes?\b)/gi)];
  // A duration per set (e.g. 3组×2分钟) is an instruction, not total workout minutes.
  const duration=durations.length===1&&!/(?:组|[x×*])\s*\d+(?:\.\d+)?\s*(?:分钟|分鍾|mins?\b|minutes?\b)/i.test(text)?durations[0]:null;
  if(duration){minutes=Number(duration[1]);if(minutes>1440){errors.push(`第 ${lineNumber} 行时长超过 1440 分钟。`);return null;}}
  text=text.replace(/^(?:力量|有氧|拉伸|休息)\s*[:：|]\s*/,'');
  const detailIndex=text.search(/\s+(?=\d)|(?=\d+(?:\.\d+)?\s*(?:组|次|分钟|分鍾|mins?\b|minutes?\b|kg\b|公斤|秒|[x×*]))|[（(]/i);
  let name=norm(detailIndex<0?text:text.slice(0,detailIndex));
  let instructions=detailIndex<0?'':norm(text.slice(detailIndex));
  if(duration)instructions=norm(instructions.replace(duration[0],''));
  name=name.replace(/[：:|,，]+$/,'').trim();
  if(!name||name.length>100||instructions.length>500){errors.push(`第 ${lineNumber} 行项目名称或要求过长/为空，请拆分后重试。`);return null;}
  return {name,category,time,minutes,weekdays:[...days],instructions};
}

/** Strict local parser. The caller must show this result before applying it. */
export function parseWeeklyPlan(input){
  const items=[],errors=[],warnings=[];
  if(typeof input!=='string'||!input.trim())return {items,errors:['请粘贴一周计划，每天使用“周一”等标题。'],warnings};
  if(input.length>30000)return {items,errors:['计划文字过长，请控制在 30000 字以内。'],warnings};
  let days=null;const seen=new Set(),filled=new Set();
  const lines=input.replace(/\r\n?/g,'\n').split('\n');
  for(let index=0;index<lines.length;index++){
    let line=lines[index].trim();if(!line)continue;
    if(/^\|?[\s:|\-]+\|?$/.test(line)&&line.includes('|'))continue;
    if(line.includes('|'))line=line.replace(/^\|\s*|\s*\|$/g,'').replace(/\s*\|\s*/g,'\t');
    line=line.replace(/^#{1,6}\s*/,'').replace(/^\s*(?:[-*•●]|\d+[.)、])\s*/,'');
    if(/^(?:星期|日期|周几|day|weekday)[\t|,，]/i.test(line)&&/项目|运动|动作|exercise|workout/i.test(line)){warnings.push(`第 ${index+1} 行表头已略过；每个表格行会作为一个独立项目。`);continue;}
    if(/^(?:每周|一周|本周|weekly|week\b).*(?:计划|安排|plan|schedule)/i.test(line)&&!weekdayPrefix(line)){warnings.push(`第 ${index+1} 行总标题已略过。`);continue;}
    const prefix=weekdayPrefix(line);
    if(prefix){days=prefix.days;days.forEach(day=>seen.add(day));line=prefix.rest;}
    if(!line)continue;
    if(!days){errors.push(`第 ${index+1} 行缺少星期，请先写“周一”等标题。`);continue;}
    // Do not quietly attach an unknown or malformed weekday to the preceding day.
    if(/^(?:周|星期|礼拜|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\S*/i.test(line)){errors.push(`第 ${index+1} 行星期无法识别，请使用“周一”至“周日”，多个星期用顿号分隔。`);continue;}
    if(/^[^\d;；\t]{1,16}[:：]$/.test(line)){warnings.push(`第 ${index+1} 行分组标题“${line}”已略过，请确认下方动作已列齐。`);continue;}
    // Tabs preserve pasted spreadsheet columns; semicolons divide separate exercises.
    for(const segment of line.replace(/\t+/g,' ').split(/[;；]/)){
      const item=parseExercise(segment,days,index+1,errors);
      if(item){items.push(item);days.forEach(day=>filled.add(day));}
    }
  }
  for(const day of seen)if(!filled.has(day))warnings.push(`周${'日一二三四五六'[day]}只有标题，没有项目；需要休息日请明确填写“休息”。`);
  if(items.length>200){errors.push('项目超过 200 项，请拆分计划。');items.length=0;}
  if(!items.length&&!errors.length)errors.push('没有识别到运动项目。请在星期标题下方每行填写一个项目。');
  return {items,errors,warnings};
}

function normalizeItem(item){
  if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>100||!['力量','有氧','拉伸','休息'].includes(item.category)||typeof item.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)||!Number.isFinite(item.minutes)||item.minutes<0||item.minutes>1440||!Array.isArray(item.weekdays)||!item.weekdays.length||item.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6)||item.instructions!=null&&(typeof item.instructions!=='string'||item.instructions.length>500))throw Error('计划项目无效，请重新预览后导入。');
  return {name:norm(item.name),category:item.category,time:item.time,minutes:item.minutes,weekdays:[...new Set(item.weekdays)],instructions:norm(item.instructions)};
}
function identity(item){return JSON.stringify([norm(item.name).toLowerCase(),item.category,item.time,item.minutes,norm(item.instructions).toLowerCase()]);}
function taskFrom(item,planId){return {...cloneData(item),id:uid(),...(planId?{planId}:{}),status:'pending',sets:[],actualMinutes:null};}

/** Additive and atomic: completed tasks, meals, and historical days are preserved. */
export function applyWeeklyPlan(state,input,{startDate,repeat=false,today=dateKey()}={}){
  if(!validDate(startDate)||new Date(`${startDate}T12:00:00`).getDay()!==1)throw Error('请选择有效的周一作为这一周的开始。');
  if(!validDate(today)||typeof repeat!=='boolean'||!Array.isArray(input)||!input.length||input.length>200)throw Error('计划或导入设置无效。');
  const items=input.map(normalizeItem),next=cloneData(state),dates=[];let added=0,duplicates=0;
  if(!Array.isArray(next.plans)||!next.days||typeof next.days!=='object')throw Error('本地计划数据无效。');
  const targets=Array.from({length:7},(_,i)=>offsetDate(startDate,i)).filter(day=>day>=today&&items.some(item=>item.weekdays.includes(new Date(`${day}T12:00:00`).getDay())));
  // Snapshot old templates first, so new templates do not auto-add tasks during this import.
  for(const date of targets)ensureDay(next,date);
  const plans=new Map();
  if(repeat)for(const item of items)for(const weekday of item.weekdays){
    const key=identity(item)+':'+weekday;let plan=plans.get(key)??next.plans.find(value=>identity(value)===identity(item)&&value.weekdays.includes(weekday));
    if(!plan){plan={...cloneData(item),id:uid(),weekdays:[weekday],startDate};next.plans.push(plan);}
    else if(plan.startDate&&plan.startDate>startDate)plan.startDate=startDate;
    plans.set(key,plan);
  }
  for(const date of targets){
    const weekday=new Date(`${date}T12:00:00`).getDay(),day=next.days[date];dates.push(date);
    for(const item of items.filter(value=>value.weekdays.includes(weekday))){
      if(day.tasks.some(value=>identity(value)===identity(item))){duplicates++;continue;}
      const plan=plans.get(identity(item)+':'+weekday);day.tasks.push(taskFrom(item,plan?.id));added++;
    }
  }
  // Commit only after every date and item has been processed successfully.
  state.plans=next.plans;state.days=next.days;
  return {added,duplicates,dates};
}

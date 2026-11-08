// Small deterministic helpers: no cloud model, no invented food nutrition or serving weights.
import {cloneData} from './core.js';
export function inferredMeal(hour=new Date().getHours()) {return hour<10?'早餐':hour<15?'午餐':hour<21?'晚餐':'加餐';}
export function isQuietTime(time,start,end) {
  const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
  const t=minutes(time),a=minutes(start),b=minutes(end);
  if(a===b)return false;
  return a>b?t>=a||t<b:t>=a&&t<b;
}
export function recentMeals(state,limit=6) {
  const seen=new Set(),items=[];
  for(const date of Object.keys(state.days).sort().reverse()) {
    for(const m of [...state.days[date].meals].reverse()) {
      const key=`${m.foodId??m.name}|${m.grams}`;
      if(seen.has(key))continue;seen.add(key);items.push({...m,previousDate:date});
      if(items.length>=limit)return items;
    }
  }
  return items;
}
function chineseNumber(value) {
  if(/^\d+(\.\d+)?$/.test(value))return Number(value);
  const digits={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  const [integer,decimal]=value.split('点');let total=0,current=0;
  for(const c of integer){if(c in digits)current=digits[c];else if(c==='十'){total+=(current||1)*10;current=0;}else if(c==='百'){total+=(current||1)*100;current=0;}else if(c==='千'){total+=(current||1)*1000;current=0;}else return NaN;}
  const fraction=decimal===undefined?'':Array.from(decimal).map(c=>digits[c]??(Number.isInteger(Number(c))?Number(c):'?')).join('');
  return total+current+(fraction?Number(`0.${fraction}`):0);
}
const numberPattern='(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千点]+)';
const unitPattern='(?:千克|公斤|kg|克|g|份|碗|个|杯|片|块|颗|只)';
const suffixQuantity=new RegExp(`^\\s*(${numberPattern})\\s*(${unitPattern})`,'i');
const prefixQuantity=new RegExp(`(${numberPattern})\\s*(${unitPattern})\\s*$`,'i');
function amount(match,food) {
  if(!match)return {grams:null,issue:'请补充份量'};
  const n=chineseNumber(match[1]),unit=match[2].toLowerCase();
  let grams=null;
  if(unit==='克'||unit==='g')grams=n;
  else if(unit==='千克'||unit==='公斤'||unit==='kg')grams=n*1000;
  else if(food.portionGrams&&unit==='份')grams=n*food.portionGrams;
  else return {grams:null,issue:`“${match[1]}${match[2]}”需要你确认克数`};
  if(!Number.isFinite(grams)||grams<=0||grams>10000)return {grams:null,issue:'请确认有效克数'};
  return {grams,issue:null};
}
export function parseMealSpeech(text,foods) {
  const raw=text.trim();let masked=raw;
  const meal=['早餐','午餐','晚餐','加餐'].find(m=>raw.includes(m))??inferredMeal();
  const hits=[];
  for(const food of [...foods].sort((a,b)=>b.name.length-a.name.length)) {
    let from=0;
    while(true){const index=masked.indexOf(food.name,from);if(index<0)break;hits.push({food,index,end:index+food.name.length});masked=masked.slice(0,index)+' '.repeat(food.name.length)+masked.slice(index+food.name.length);from=index+food.name.length;}
  }
  hits.sort((a,b)=>a.index-b.index);
  const consumed=[];
  const items=hits.map((hit,i)=>{
    const next=hits[i+1]?.index??raw.length,prevEnd=hits[i-1]?.end??0;
    const suffix=suffixQuantity.exec(raw.slice(hit.end,next));
    const prefix=suffix?null:prefixQuantity.exec(raw.slice(prevEnd,hit.index));
    const match=suffix??prefix;
    let start=hit.index,end=hit.end;
    if(suffix)end+=suffix[0].length;
    else if(prefix)start=hit.index-prefix[0].length;
    consumed.push([start,end]);
    return {foodId:hit.food.id,name:hit.food.name,...amount(match,hit.food)};
  });
  let rest=raw;
  for(const [start,end]of consumed.sort((a,b)=>b[0]-a[0]))rest=rest.slice(0,start)+' '.repeat(end-start)+rest.slice(end);
  rest=rest.replace(/早餐|午餐|晚餐|加餐|今天|吃了|吃的|吃|还有|以及|和|了|我|，|。|、|,|;|；|\s/g,'').trim();
  return {text:raw,meal,items,unmatched:rest,complete:items.length>0&&!rest&&items.every(x=>x.grams!==null)};
}
export function repeatMeal(day,entry,id) {
  // Copy the previous nutrition snapshot rather than silently recalculating an edited food.
  const copy={...cloneData(entry),id,meal:inferredMeal()};
  delete copy.previousDate;
  day.meals.push(copy);
  day.foodComplete=false;
}

import {dateKey,offsetDate} from './core.js';

const DAY=86_400_000;
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime())&&dateKey(parsed)===value;
}
function ordinal(date){return Date.parse(`${date}T00:00:00Z`)/DAY;}
function weightOf(value){return typeof value==='number'&&Number.isFinite(value)&&value>=1&&value<=500?value:null;}
const rounded=value=>Number(value.toFixed(2));
function average(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;}

/** Read only recorded weights; gaps never become zero or inferred measurements. */
export function weightTrend(state,end,range=7){
  if(!validDate(end))throw Error('请选择有效的体重记录日期');
  if(range!==7&&range!==30)throw Error('体重趋势仅支持近 7 天或 30 天');
  const start=offsetDate(end,1-range),days=state?.days??{};
  const read=date=>weightOf(days[date]?.weight);
  const points=Array.from({length:range},(_,index)=>{
    const date=offsetDate(start,index),window=[];
    for(let offset=-6;offset<=0;offset++){const value=read(offsetDate(date,offset));if(value!==null)window.push(value);}
    return {date,weight:read(date),average:window.length>=3?rounded(average(window)):null};
  });
  const recorded=points.filter(point=>point.weight!==null),recordedCount=recorded.length;
  const first=recordedCount?{date:recorded[0].date,weight:recorded[0].weight}:null;
  const last=recorded[recordedCount-1],latest=last?{date:last.date,weight:last.weight}:null;
  const change=recordedCount>=2?rounded(latest.weight-first.weight):null;
  let weeklyChangePercent=null;
  const advice=[];
  if(!recordedCount){
    advice.push({tone:'neutral',text:'所选区间还没有体重记录。记录后可查看走势，空白日期不会当成 0 kg。'});
  }else if(recordedCount===1){
    advice.push({tone:'neutral',text:'目前只有一次体重记录，继续记录后再比较变化。'});
  }else{
    const span=ordinal(latest.date)-ordinal(first.date)+1;
    const firstWindow=recorded.filter(point=>point.date<=offsetDate(first.date,6)).map(point=>point.weight);
    const lastWindow=recorded.filter(point=>point.date>=offsetDate(latest.date,-6)).map(point=>point.weight);
    if(span>=14&&recordedCount>=8&&firstWindow.length>=3&&lastWindow.length>=3){
      const earlier=average(firstWindow),recent=average(lastWindow);
      // The compared seven-day windows do not overlap. Normalize by their calendar midpoint distance.
      weeklyChangePercent=rounded((recent-earlier)/earlier*100*7/(span-7));
      const sign=weeklyChangePercent>0?'+':'';
      advice.push({tone:'neutral',text:`前后两组 7 日记录均值为 ${earlier.toFixed(2)} → ${recent.toFixed(2)} kg，折算每周变化 ${sign}${weeklyChangePercent.toFixed(2)}%。先核对称重条件和记录，再评估目标。`});
    }else{
      advice.push({tone:'neutral',text:`近 ${range} 天记录了 ${recordedCount} 次体重。当前记录不足以比较两组独立的 7 日均值，先看走势并继续记录。`});
    }
  }
  return {points,recordedCount,first,latest,change,weeklyChangePercent,advice};
}

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function dimension(value,fallback,min,max){return Number.isFinite(value)?Math.round(Math.max(min,Math.min(max,value))):fallback;}
function pathSegments(points,field,x,y){
  const segments=[];let segment=[],previous=null;
  const finish=()=>{if(segment.length>=2)segments.push(segment.map((point,index)=>`${index?'L':'M'}${x(point).toFixed(2)} ${y(point[field]).toFixed(2)}`).join(' '));segment=[];};
  for(const point of points){
    if(point[field]===null){finish();previous=null;continue;}
    if(previous&&ordinal(point.date)-ordinal(previous.date)!==1)finish();
    segment.push(point);previous=point;
  }
  finish();return segments;
}

/** Inline SVG with presentation attributes works with the packaged app's strict CSP. */
export function renderWeightChart(trend,{width=320,height=180}={}){
  const w=dimension(width,320,240,2000),h=dimension(height,180,120,1000);
  const points=(Array.isArray(trend?.points)?trend.points:[]).slice(0,366).filter(point=>validDate(point?.date)).map(point=>({date:point.date,weight:weightOf(point.weight),average:weightOf(point.average)}));
  const actual=points.filter(point=>point.weight!==null),values=points.flatMap(point=>[point.weight,point.average]).filter(value=>value!==null);
  const records=actual.map(point=>`${point.date} ${point.weight.toFixed(1)} kg`).join('；');
  const description=actual.length?`${records}。空白日期没有记录；7 日均值只在相应窗口至少有三次记录时显示。`:values.length?'当前区间没有实际体重记录；图中的 7 日均值包含区间前的真实记录，空白日期不会计为零。':'暂无体重记录，空白日期不会计为零。';
  const opening=`<svg class="weight-chart" xmlns="http://www.w3.org/2000/svg" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="体重趋势图"><title>体重记录与 7 日均值</title><desc>${escape(description)}</desc>`;
  if(!values.length)return opening+`<text x="${w/2}" y="${h/2}" text-anchor="middle" fill="#718079" font-size="13">记录体重后显示曲线</text></svg><p class="muted weight-chart-summary">暂无体重记录，缺失日期留空。</p>`;
  const padding=Math.max(0.5,(Math.max(...values)-Math.min(...values))*0.1);
  const minimum=Math.max(0,Math.min(...values)-padding),maximum=Math.max(...values)+padding;
  const left=46,right=w-16,top=18,bottom=h-40,firstDate=points[0].date,lastDate=points[points.length-1].date,span=ordinal(lastDate)-ordinal(firstDate);
  const x=point=>span?left+(ordinal(point.date)-ordinal(firstDate))/span*(right-left):(left+right)/2;
  const y=value=>bottom-(value-minimum)/(maximum-minimum)*(bottom-top);
  let svg=opening;
  for(let tick=0;tick<=2;tick++){
    const value=minimum+(maximum-minimum)*tick/2,position=y(value).toFixed(2);
    svg+=`<line x1="${left}" x2="${right}" y1="${position}" y2="${position}" stroke="#e4e9e1"/><text x="${left-7}" y="${Number(position)+4}" text-anchor="end" fill="#718079" font-size="10">${value.toFixed(1)}</text>`;
  }
  svg+=`<text x="${left}" y="11" fill="#718079" font-size="10">kg</text>`;
  for(const d of pathSegments(points,'weight',x,y))svg+=`<path class="weight-series" d="${d}" fill="none" stroke="#27604f" stroke-width="2"/>`;
  for(const d of pathSegments(points,'average',x,y))svg+=`<path class="weight-average" d="${d}" fill="none" stroke="#8a9e51" stroke-width="2" stroke-dasharray="5 4"/>`;
  for(const point of points){
    if(point.average!==null)svg+=`<circle class="weight-average-point" cx="${x(point).toFixed(2)}" cy="${y(point.average).toFixed(2)}" r="1.8" fill="#8a9e51"/>`;
    if(point.weight!==null)svg+=`<circle class="weight-observation" cx="${x(point).toFixed(2)}" cy="${y(point.weight).toFixed(2)}" r="3" fill="#27604f"/>`;
  }
  svg+=`<text x="${left}" y="${bottom+18}" fill="#718079" font-size="10">${firstDate.slice(5)}</text>`;
  if(span)svg+=`<text x="${right}" y="${bottom+18}" text-anchor="end" fill="#718079" font-size="10">${lastDate.slice(5)}</text>`;
  svg+=`<line x1="${left}" x2="${left+15}" y1="${h-7}" y2="${h-7}" stroke="#27604f" stroke-width="2"/><text x="${left+20}" y="${h-3}" fill="#718079" font-size="10">实际体重</text><line x1="${left+90}" x2="${left+105}" y1="${h-7}" y2="${h-7}" stroke="#8a9e51" stroke-width="2" stroke-dasharray="4 3"/><text x="${left+110}" y="${h-3}" fill="#718079" font-size="10">7 日均值</text></svg>`;
  return svg+`<p class="muted weight-chart-summary">${actual.length} 次实际记录；缺失日期留空。7 日均值至少需要窗口内 3 次记录。</p>`;
}

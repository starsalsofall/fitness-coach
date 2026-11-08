import {offsetDate,totals,carbGoalFor} from './core.js';

// Check marks describe recorded actions, not measured training load or calorie expenditure.
function recentTraining(state,key) {
  const days=[offsetDate(key,-2),offsetDate(key,-1)].map(date=>({date,day:state.days[date]}));
  const recorded=days.filter(entry=>entry.day);
  const tasks=recorded.flatMap(entry=>entry.day.tasks??[]).filter(task=>task.category!=='休息');
  return {
    recorded:recorded.length,
    done:tasks.filter(task=>task.status==='done').length,
    pending:tasks.filter(task=>task.status==='pending').length,
    skipped:tasks.filter(task=>task.status==='skipped').length,
    strengthDays:recorded.filter(entry=>entry.day.tasks?.some(task=>task.category==='力量'&&task.status==='done')).length
  };
}

/** Local, read-only feedback. Targets always come from the user's own settings. */
export function coachingFor(state,key) {
  const day=state.days[key],recent=recentTraining(state,key),out=[];
  if(recent.strengthDays===2) {
    out.push({tone:'neutral',text:'前两天都勾选了力量训练项目。今天开始前先确认疲劳和酸痛情况，需要时调整项目或安排休息。'});
  } else if(!recent.recorded) {
    out.push({tone:'neutral',text:'前两天还没有训练记录，暂不判断连续训练情况；未记录不等于没有运动。'});
  } else {
    const unknown=recent.recorded<2?'；另一天未记录，不算漏练':'';
    out.push({tone:'neutral',text:`前两天已记录 ${recent.recorded} 天：运动项目 ${recent.done} 项完成、${recent.pending} 项待确认、${recent.skipped} 项跳过${unknown}。这些勾选不代表训练强度。`});
  }
  if(!day)return out;
  const sum=totals(day),settings=state.settings,notes=day.foodNotes?.length??0,complete=day.foodComplete&&!notes;
  if(!complete) {
    const calories=`今天已记录 ${Math.round(sum.calories)} kcal、蛋白质 ${sum.protein.toFixed(1)} g`;
    let comparison='';
    if(settings.calories>0) {
      const difference=Math.round(sum.calories-settings.calories);
      comparison=difference>0?`；已记录热量高于你设置的目标 ${difference} kcal，先核对份量和是否重复记录`:`；距你设置的热量目标尚余 ${Math.abs(difference)} kcal`;
    }
    if(settings.protein>0)comparison+=`；蛋白质记录进度 ${sum.protein.toFixed(1)} / ${settings.protein} g`;
    out.push({tone:'neutral',text:`${calories}${comparison}。饮食尚未记全，只用于接下来记录时参考${notes?`，另有 ${notes} 条备注未计入`:''}。`});
  } else if(recent.strengthDays>0&&settings.protein>0&&sum.protein<settings.protein) {
    out.push({tone:'neutral',text:`前两天有力量训练完成记录；今天已记全的蛋白质比你设置的目标少 ${(settings.protein-sum.protein).toFixed(1)} g，可先核对是否漏记或份量有误。应用不会据此增加训练或改变饮食目标。`});
  }
  const carbGoal=carbGoalFor(state,key);
  if(carbGoal.mode==='cycle'&&carbGoal.dayType==='unplanned')out.push({tone:'neutral',text:'今天还没有可判断的训练安排，碳水目标暂未确定。可安排当天项目，或手动选择训练日／休息日。'});
  if(sum.carbUnknownCount)out.push({tone:'neutral',text:`碳水已知部分 ${sum.knownCarbs.toFixed(1)} g，另有 ${sum.carbUnknownCount} 条饮食缺少碳水资料；不按 0 计算，暂不比较全天碳水目标。`});
  else if(day.meals.length||carbGoal.target!==null){
    const label=carbGoal.mode==='fixed'?'每日固定':carbGoal.dayType==='training'?'训练日':'休息日';
    const target=carbGoal.target===null?'；尚未设置对应目标':` / 你设置的${label}目标 ${carbGoal.target} g`;
    out.push({tone:'neutral',text:`碳水记录进度 ${sum.carbs.toFixed(1)} g${target}。${complete?'饮食已标记记全，数值按已输入资料估算。':'饮食尚未记全，仅显示已记录进度。'}`});
  }
  return out;
}

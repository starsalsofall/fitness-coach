import {totals,carbGoalFor} from './core.js';
import {esc,decimal} from './ui-shared.js';

export function carbAmount(sum){return sum.carbs===null?`${decimal(sum.knownCarbs)} g 已知`:`${decimal(sum.carbs)} g`;}
export function foodCarbs(value){return value==null?'碳水待补全':`碳水 ${decimal(value)} g`;}
export function carbSummary(state,key,day){
  const sum=totals(day),goal=carbGoalFor(state,key),type={training:'训练日',rest:'休息日',unplanned:'未确认日类型'}[goal.dayType];
  return `<div class="carb-summary" id="carb-summary"><div class="section-head"><h3>碳水 · ${goal.mode==='cycle'?esc(type):'固定目标'}</h3><span class="badge">${goal.target===null?'未设目标':`目标 ${esc(goal.target)} g`}</span></div><div class="stat">${esc(carbAmount(sum))}</div>${sum.carbUnknownCount?`<p class="muted">${sum.carbUnknownCount} 项饮食缺少碳水资料，全天总量暂不确定。旧记录不会自动补成零。</p>`:''}${goal.mode==='cycle'?`<label class="muted" for="carb-day-type">今天按哪种目标记录</label><select id="carb-day-type" aria-label="今天的碳水日类型"><option value="auto" ${!day.carbDayType||day.carbDayType==='auto'?'selected':''}>自动 · 依据当天计划</option><option value="training" ${day.carbDayType==='training'?'selected':''}>手动指定训练日</option><option value="rest" ${day.carbDayType==='rest'?'selected':''}>手动指定休息日</option></select>${goal.dayType==='unplanned'?'<p class="muted">当天没有训练或休息安排，尚未自动选择目标；可手动指定。</p>':''}`:''}</div>`;
}
export function nutritionProgress(state,key,day){
  const sum=totals(day),goal=carbGoalFor(state,key);
  return `<div class="nutrition-grid"><div><small>热量 kcal</small><b>${Math.round(sum.calories)}</b><small>目标 ${state.settings.calories??'未设'}</small></div><div><small>蛋白质 g</small><b>${decimal(sum.protein)}</b><small>目标 ${state.settings.protein??'未设'}</small></div><div><small>碳水 g</small><b>${sum.carbs===null?'待补全':decimal(sum.carbs)}</b><small>目标 ${goal.target??'未设'}</small></div></div>${sum.carbUnknownCount?`<p class="muted">已知碳水 ${decimal(sum.knownCarbs)} g，另有 ${sum.carbUnknownCount} 项缺少资料。</p>`:''}`;
}
export function carbSettingsFields(settings){
  const cycle=settings.carbMode==='cycle';
  return `<fieldset class="nutrition-settings"><legend>碳水目标</legend><label for="carbMode">目标方式</label><select id="carbMode" name="carbMode"><option value="fixed" ${!cycle?'selected':''}>每天固定目标</option><option value="cycle" ${cycle?'selected':''}>训练日 / 休息日分别设置</option></select><div id="carb-fixed-fields" ${cycle?'hidden':''}><label for="carbs">每日碳水目标（g）</label><input id="carbs" name="carbs" type="number" min="0" max="5000" step="0.1" value="${settings.carbs??''}" placeholder="自行设置，可留空"></div><div id="carb-cycle-fields" class="fields" ${!cycle?'hidden':''}><div><label for="trainingCarbs">训练日碳水（g）</label><input id="trainingCarbs" name="trainingCarbs" type="number" min="0" max="5000" step="0.1" value="${settings.trainingCarbs??''}" placeholder="自行设置"></div><div><label for="restCarbs">休息日碳水（g）</label><input id="restCarbs" name="restCarbs" type="number" min="0" max="5000" step="0.1" value="${settings.restCarbs??''}" placeholder="自行设置"></div></div><p class="muted">训练日依据计划中的力量或有氧项目，完成勾选不会切换目标。没有安排时请确认日类型。这里不自动推荐碳循环数值。</p></fieldset>`;
}
export function updateCarbSettingsVisibility(){const mode=document.querySelector('#carbMode')?.value;if(!mode)return;for(const [selector,hidden]of [['#carb-fixed-fields',mode==='cycle'],['#carb-cycle-fields',mode!=='cycle']]){const section=document.querySelector(selector);section.hidden=hidden;section.querySelectorAll('input').forEach(input=>input.disabled=hidden);}}

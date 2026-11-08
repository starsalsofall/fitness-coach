import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,ensureDay,validateState} from '../web/core.js';
import {parseWeeklyPlan,applyWeeklyPlan,EXAMPLE_WEEK} from '../web/weekly-plan.js';

const monday='2026-11-09';
test('whole week parses each exercise independently and preserves sets without fabricated minutes',()=>{
  const result=parseWeeklyPlan('一周训练计划\n周一\n深蹲3组×8次 18:30\n卧推 3x12 50kg\n周二：快走30分钟；拉伸 10分钟\n周日：休息');
  assert.deepEqual(result.errors,[]);assert.equal(result.items.length,5);assert.equal(result.items[0].name,'深蹲');assert.equal(result.items[0].instructions,'3组×8次');assert.equal(result.items[0].minutes,0);assert.equal(result.items[1].instructions,'3x12 50kg');assert.equal(result.items[2].minutes,30);assert.equal(result.items[2].category,'有氧');assert.equal(result.items[3].category,'拉伸');assert.equal(result.items[4].category,'休息');
});
test('Chinese multiple weekdays/ranges, English headers and pasted spreadsheet rows are supported',()=>{
  const result=parseWeeklyPlan('星期\t训练项目\t组次\n周一、三、五\t深蹲\t3组×8次\nTuesday, Thursday: Walking 20min\n周六至周日：休息');
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.items[0].weekdays,[1,3,5]);assert.deepEqual(result.items[1].weekdays,[2,4]);assert.deepEqual(result.items[2].weekdays,[6,0]);assert.equal(result.items[0].instructions,'3组×8次');assert.equal(result.items[1].minutes,20);
});
test('unknown days and undated exercises are errors rather than silent reassignment',()=>{
  assert.match(parseWeeklyPlan('深蹲3组').errors.join(''),/缺少星期/);
  assert.match(parseWeeklyPlan('周一\n深蹲3组\n周八\n卧推3组').errors.join(''),/星期无法识别/);
  assert.match(parseWeeklyPlan('周一\n深蹲 29:10').errors.join(''),/时间无效/);
  assert.match(parseWeeklyPlan('周一\n跑步 1500分钟').errors.join(''),/1440/);
  assert.match(parseWeeklyPlan('周二').warnings.join(''),/没有项目/);
  assert.ok(parseWeeklyPlan(EXAMPLE_WEEK).items.length>7);
});
test('Markdown chat tables preserve one project per row and accept Chinese time punctuation',()=>{
  const result=parseWeeklyPlan('| 星期 | 训练项目 | 组次 | 时间 |\n| --- | --- | --- | --- |\n| 周一 | 深蹲 | 3组×8次 | 18：30 |\n| 周二 | 快走 | 20分钟 | 19:00 |');
  assert.deepEqual(result.errors,[]);assert.equal(result.items.length,2);assert.equal(result.items[0].name,'深蹲');assert.equal(result.items[0].time,'18:30');assert.equal(result.items[1].minutes,20);
  assert.match(parseWeeklyPlan('周一 周三：深蹲3组').errors.join(''),/多个星期用顿号/);
});
test('per-set time stays an instruction and is never converted into total exercise minutes',()=>{
  const result=parseWeeklyPlan('周一\n平板支撑 3组×2分钟\n深蹲 4组×10次');assert.deepEqual(result.errors,[]);assert.equal(result.items[0].minutes,0);assert.equal(result.items[0].instructions,'3组×2分钟');
});
test('one-time week preserves completed checkmarks and meals and does not create recurring plans',()=>{
  const state=initialState(),day=ensureDay(state,monday);day.tasks=[{id:'done',name:'深蹲',category:'力量',time:'18:30',minutes:0,instructions:'3组×8次',status:'done',sets:[{weight:50,reps:8}],actualMinutes:15}];day.meals=[{id:'meal',name:'午饭',meal:'午餐',grams:100,calories:500,protein:30}];day.foodComplete=true;
  const items=parseWeeklyPlan('周一\n深蹲3组×8次\n卧推3组×10次\n周二\n快走20分钟').items;
  const result=applyWeeklyPlan(state,items,{startDate:monday,today:monday,repeat:false});
  assert.equal(result.added,2);assert.equal(result.duplicates,1);assert.equal(state.plans.length,0);assert.equal(state.days[monday].tasks[0].status,'done');assert.equal(state.days[monday].tasks[0].sets[0].weight,50);assert.equal(state.days[monday].meals[0].calories,500);assert.equal(state.days[monday].foodComplete,true);assert.equal(ensureDay(state,'2026-11-16').tasks.length,0);assert.doesNotThrow(()=>validateState(state));
});
test('repeating import is idempotent and updates only selected week today onward',()=>{
  const state=initialState();ensureDay(state,'2026-11-09').note='历史记录';const historical=JSON.stringify(state.days['2026-11-09']);
  const items=parseWeeklyPlan('周一、三：深蹲3组×8次\n周五：快走20分钟').items;
  const first=applyWeeklyPlan(state,items,{startDate:monday,today:'2026-11-11',repeat:true});assert.equal(first.added,2);assert.equal(state.plans.length,3);assert.equal(JSON.stringify(state.days['2026-11-09']),historical);assert.equal(state.plans[0].startDate,monday);
  const second=applyWeeklyPlan(state,items,{startDate:monday,today:'2026-11-11',repeat:true});assert.equal(second.added,0);assert.equal(second.duplicates,2);assert.equal(state.plans.length,3);assert.equal(ensureDay(state,'2026-11-16').tasks.length,1);
});
test('invalid imports are atomic and a week must begin on Monday',()=>{
  const state=initialState(),before=JSON.stringify(state),items=parseWeeklyPlan('周一：深蹲3组').items;
  assert.throws(()=>applyWeeklyPlan(state,items,{startDate:'2026-11-10',today:monday}));assert.equal(JSON.stringify(state),before);
  assert.throws(()=>applyWeeklyPlan(state,[...items,{...items[0],name:'',weekdays:[9]}],{startDate:monday,today:monday,repeat:true}));assert.equal(JSON.stringify(state),before);
  assert.throws(()=>applyWeeklyPlan(state,items,{startDate:'2026-02-30',today:monday}));assert.equal(JSON.stringify(state),before);
});

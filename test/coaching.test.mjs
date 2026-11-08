import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,ensureDay,addMeal} from '../web/core.js';
import {coachingFor} from '../web/coaching.js';

const key='2026-11-08';
const text=state=>coachingFor(state,key).map(item=>item.text).join('\n');
const task=(category,status='done')=>({category,status});

test('missing recent records remain unknown and coaching never creates days',()=>{
  const state=initialState(),before=JSON.stringify(state);
  assert.match(text(state),/未记录不等于没有运动/);
  assert.equal(JSON.stringify(state),before);
});

test('two recorded strength days prompt a fatigue check without changing the plan',()=>{
  const state=initialState();
  ensureDay(state,'2026-11-06').tasks=[task('力量'),task('力量')];
  ensureDay(state,'2026-11-07').tasks=[task('力量')];
  const today=ensureDay(state,key);today.tasks=[task('力量','pending')];
  const before=JSON.stringify(state);
  assert.match(text(state),/前两天都勾选了力量训练/);
  assert.match(text(state),/疲劳和酸痛/);
  assert.equal(JSON.stringify(state),before);
});

test('skipped, pending and rest check marks never count as completed exercise',()=>{
  const state=initialState();
  ensureDay(state,'2026-11-07').tasks=[task('力量','skipped'),task('力量','pending'),task('休息'),task('有氧')];
  const output=text(state);
  assert.match(output,/1 项完成、1 项待确认、1 项跳过/);
  assert.match(output,/另一天未记录，不算漏练/);
  assert.doesNotMatch(output,/前两天都勾选了力量/);
});

test('an incomplete diary shows a remaining budget without claiming under-eating',()=>{
  const state=initialState(),day=ensureDay(state,key);
  Object.assign(state.settings,{calories:2000,protein:100});
  addMeal(day,{id:'food',name:'测试餐',calories:400,protein:20},100,'午餐');
  const output=text(state);
  assert.match(output,/尚余 1600 kcal/);
  assert.match(output,/20.0 \/ 100 g/);
  assert.match(output,/饮食尚未记全/);
  assert.doesNotMatch(output,/摄入不足|低于目标|还差|少 80/);
});

test('recorded calories over a chosen target are factual even before the diary is complete',()=>{
  const state=initialState(),day=ensureDay(state,key);
  state.settings.calories=500;
  addMeal(day,{id:'food',name:'测试餐',calories:600,protein:20},100,'午餐');
  day.foodNotes=[{id:'n',text:'其他食物'}];day.foodComplete=true;
  const output=text(state);
  assert.match(output,/已记录热量高于你设置的目标 100 kcal/);
  assert.match(output,/1 条备注未计入/);
  assert.match(output,/饮食尚未记全/);
  assert.doesNotMatch(output,/补偿|消耗掉|加练/);
});

test('completed diary combines protein target progress with recorded strength days',()=>{
  const state=initialState(),day=ensureDay(state,key);
  state.settings.protein=100;
  ensureDay(state,'2026-11-07').tasks=[task('力量')];
  addMeal(day,{id:'food',name:'测试餐',calories:400,protein:40},100,'午餐');day.foodComplete=true;
  const output=text(state);
  assert.match(output,/前两天有力量训练完成记录/);
  assert.match(output,/少 60.0 g/);
  assert.doesNotMatch(output,/尚余 .* kcal/);
});

test('today and older sessions are excluded from the previous two days',()=>{
  const state=initialState();
  ensureDay(state,'2026-11-05').tasks=[task('力量')];
  ensureDay(state,key).tasks=[task('力量')];
  assert.match(text(state),/前两天还没有训练记录/);
});

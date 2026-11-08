import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION,initialState,ensureDay,addMeal,totals,carbGoalFor,migrateState,validateState} from '../web/core.js';
import {repeatMeal} from '../web/quick-log.js';
import {coachingFor} from '../web/coaching.js';

const key='2026-11-09';
const food={id:'f',name:'测试食物',calories:200,protein:10,carbs:35,portionGrams:150};
const task=(category,status='pending')=>({id:'t',name:'测试项目',category,status,time:'18:30',minutes:20,sets:[],actualMinutes:null});
const output=state=>coachingFor(state,key).map(item=>item.text).join('\n');
function cycle(state){Object.assign(state.settings,{carbMode:'cycle',trainingCarbs:250,restCarbs:150});return state;}

test('nutrition targets start unset and never assume body weight or a carb cycle',()=>{
  const state=initialState();assert.equal(VERSION,2);assert.equal(state.version,2);
  assert.equal(state.settings.carbMode,'fixed');for(const field of ['carbs','trainingCarbs','restCarbs'])assert.equal(state.settings[field],null);
  assert.deepEqual(totals(ensureDay(state,key)),{calories:0,protein:0,carbs:0,knownCarbs:0,carbUnknownCount:0});
});

test('v1 migration preserves diary history, completed tasks and independent caches without modifying input',()=>{
  const old=initialState();old.version=1;for(const field of ['carbMode','carbs','trainingCarbs','restCarbs'])delete old.settings[field];
  old.foods=[{id:'f',name:'测试食物',calories:200,protein:10,portionGrams:150}];
  const day=ensureDay(old,key);delete day.carbDayType;day.tasks=[{...task('力量','done'),sets:[{weight:30,reps:8}]}];
  day.meals=[{id:'m',foodId:'f',name:'测试食物',grams:150,calories:300,protein:15,meal:'午餐'}];day.foodComplete=true;day.weight=80.2;day.note='历史感受';day.recovery={source:'manual',score:70,sleepHours:7};day.foodNotes=[{id:'n',text:'历史备注',createdAt:'2026-11-09T12:00:00Z'}];
  old.whoop={records:[{date:key,score:0,sleepHours:6,source:'whoop',workouts:[]}],syncedAt:'2026-11-09T12:00:00Z'};
  const before=JSON.stringify(old),restored=migrateState(old);
  assert.equal(JSON.stringify(old),before);assert.notEqual(restored,old);assert.notEqual(restored.days,old.days);assert.equal(restored.version,2);
  assert.deepEqual(restored.days[key].tasks,day.tasks);assert.equal(restored.days[key].weight,80.2);assert.equal(restored.days[key].note,day.note);assert.equal(restored.days[key].foodComplete,true);assert.deepEqual(restored.days[key].foodNotes,day.foodNotes);assert.deepEqual(restored.days[key].recovery,day.recovery);
  assert.equal(restored.whoop.records[0].score,0);assert.deepEqual(restored.healthConnect,old.healthConnect);assert.equal(restored.foods[0].carbs,null);assert.equal(restored.days[key].meals[0].carbs,null);assert.equal(restored.days[key].carbDayType,'auto');
});

test('invalid and future-version backups fail atomically instead of coercing or discarding fields',()=>{
  for(const mutate of [state=>state.version=99,state=>state.version='1',state=>delete state.version,state=>state.settings.carbs='100',state=>state.foods=[{...food,carbs:-1}],state=>ensureDay(state,key).carbDayType='high']){
    const state=initialState();mutate(state);const before=JSON.stringify(state);assert.throws(()=>migrateState(state));assert.equal(JSON.stringify(state),before);
  }
});

test('non-finite JSON numbers are rejected even when an older WebView lacks structuredClone',()=>{
  const original=globalThis.structuredClone;try{
    globalThis.structuredClone=undefined;
    for(const value of [Infinity,-Infinity,NaN]){const state=initialState();state.settings.carbs=value;assert.throws(()=>validateState(state));assert.ok(Object.is(state.settings.carbs,value));}
    const state=initialState();state.foods=[{...food,carbs:Infinity}];assert.throws(()=>validateState(state));
  }finally{globalThis.structuredClone=original;}
});

test('migration is repeatable and old meal carb snapshots are never inferred from an edited food',()=>{
  const state=initialState();state.version=1;state.foods=[{...food,carbs:80}];
  ensureDay(state,key).meals=[{id:'m',foodId:'f',name:'旧记录',grams:100,calories:200,protein:10,meal:'午餐'}];
  const restored=validateState(state);assert.equal(restored.days[key].meals[0].carbs,null);assert.deepEqual(migrateState(restored),restored);
});

test('mixed known and unknown carbs show a known subtotal instead of a false complete total',()=>{
  const day=ensureDay(initialState(),key);addMeal(day,food,150,'午餐');addMeal(day,{...food,carbs:null},100,'晚餐');
  assert.deepEqual(totals(day),{calories:500,protein:25,carbs:null,knownCarbs:52.5,carbUnknownCount:1});
  addMeal(day,{...food,carbs:0},100,'加餐');assert.equal(totals(day).carbUnknownCount,1);assert.equal(totals(day).knownCarbs,52.5);
});

test('carb snapshots keep their original portion and copying an old record keeps carbs unknown',()=>{
  const day=ensureDay(initialState(),key),f={...food};const entry=addMeal(day,f,150,'午餐');assert.equal(entry.carbs,52.5);f.carbs=99;assert.equal(entry.carbs,52.5);
  repeatMeal(day,{...entry,carbs:undefined},'old-copy');assert.equal(day.meals[1].carbs,null);
  repeatMeal(day,entry,'new-copy');assert.equal(day.meals[2].carbs,52.5);
  const before=JSON.stringify(day);for(const invalid of [-1,101,'35',NaN])assert.throws(()=>addMeal(day,{...food,carbs:invalid},100,'午餐'));assert.equal(JSON.stringify(day),before);
});

test('training-day goals follow planned exercise even before completion or when skipped',()=>{
  const state=cycle(initialState()),day=ensureDay(state,key);
  for(const status of ['pending','done','skipped']){day.tasks=[task('力量',status)];const goal=carbGoalFor(state,key);assert.equal(goal.dayType,'training');assert.equal(goal.target,250);assert.equal(goal.basis,'tasks');assert.equal(goal.overridden,false);}
  day.tasks=[task('有氧')];assert.equal(carbGoalFor(state,key).target,250);
});

test('explicit rest or stretching days use the rest target while an empty day stays unplanned',()=>{
  const state=cycle(initialState()),day=ensureDay(state,key);day.tasks=[task('休息'),task('拉伸')];assert.equal(carbGoalFor(state,key).dayType,'rest');assert.equal(carbGoalFor(state,key).target,150);
  day.tasks=[];assert.equal(carbGoalFor(state,key).dayType,'unplanned');assert.equal(carbGoalFor(state,key).target,null);
});

test('unopened days use applicable weekly templates without creating records or using future plans early',()=>{
  const state=cycle(initialState());state.plans=[{...task('力量'),weekdays:[1],startDate:'2026-11-16'}];
  const before=JSON.stringify(state);assert.equal(carbGoalFor(state,key).target,null);assert.equal(carbGoalFor(state,'2026-11-16').target,250);assert.equal(carbGoalFor(state,'2026-11-16').basis,'templates');assert.equal(JSON.stringify(state),before);
});

test('manual day choice overrides the schedule and fixed targets work even when no workout is planned',()=>{
  const state=cycle(initialState()),day=ensureDay(state,key);day.tasks=[task('力量')];day.carbDayType='rest';
  assert.deepEqual(carbGoalFor(state,key),{mode:'cycle',target:150,dayType:'rest',basis:'manual',overridden:true});
  day.carbDayType='auto';assert.equal(carbGoalFor(state,key).target,250);day.tasks=[];day.carbDayType='training';assert.equal(carbGoalFor(state,key).target,250);
  state.settings.carbMode='fixed';state.settings.carbs=0;assert.equal(carbGoalFor(state,key).target,0);assert.equal(carbGoalFor(state,key).basis,'fixed');
});

test('new carb fields validate genuine zero values and reject malformed goals, food data and snapshots',()=>{
  const valid=initialState();valid.settings.carbs=0;valid.foods=[{...food,carbs:0}];addMeal(ensureDay(valid,key),valid.foods[0],100,'午餐');assert.doesNotThrow(()=>validateState(valid));
  for(const [section,name,value] of [['settings','carbMode','high'],['settings','trainingCarbs',-1],['settings','restCarbs',5001],['food','carbs',101],['meal','carbs','10'],['day','carbDayType',null]]){
    const state=structuredClone(valid),target=section==='settings'?state.settings:section==='food'?state.foods[0]:section==='meal'?state.days[key].meals[0]:state.days[key];target[name]=value;assert.throws(()=>validateState(state));
  }
});

test('carb coaching distinguishes unknown historical nutrition from a complete-day target comparison',()=>{
  const state=cycle(initialState()),day=ensureDay(state,key);day.tasks=[task('力量')];addMeal(day,{...food,carbs:null},100,'午餐');day.foodComplete=true;
  assert.match(output(state),/1 条饮食缺少碳水资料/);assert.match(output(state),/不按 0 计算/);assert.doesNotMatch(output(state),/训练日目标 250/);
  day.meals[0].carbs=35;day.foodComplete=false;const before=JSON.stringify(state);assert.match(output(state),/35.0 g.*训练日目标 250 g/);assert.match(output(state),/仅显示已记录进度/);assert.doesNotMatch(output(state),/碳水不足|少吃|加餐/);assert.equal(JSON.stringify(state),before);
});

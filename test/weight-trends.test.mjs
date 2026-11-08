import test from 'node:test';
import assert from 'node:assert/strict';
import {offsetDate} from '../web/core.js';
import {weightTrend,renderWeightChart} from '../web/weight-trends.js';

function stateWith(records){return {days:Object.fromEntries(Object.entries(records).map(([date,weight])=>[date,{weight}]))};}

test('missing records remain gaps and trend inspection does not create or alter days',()=>{
  const state=stateWith({'2026-11-02':null,'2026-11-04':0,'2026-11-06':'72'}),before=JSON.stringify(state);
  const trend=weightTrend(state,'2026-11-08');
  assert.equal(trend.points.length,7);assert.equal(trend.recordedCount,0);assert.equal(trend.first,null);assert.equal(trend.latest,null);assert.equal(trend.change,null);assert.equal(trend.weeklyChangePercent,null);
  assert.ok(trend.points.every(point=>point.weight===null&&point.average===null));assert.match(trend.advice[0].text,/不会当成 0/);assert.equal(JSON.stringify(state),before);
  const svg=renderWeightChart(trend);assert.match(svg,/role="img"/);assert.match(svg,/<desc>/);assert.doesNotMatch(svg,/weight-observation/);assert.match(svg,/记录体重后/);
});

test('a single observation renders a marker but does not claim a weight change',()=>{
  const trend=weightTrend(stateWith({'2026-11-08':72}),'2026-11-08');
  assert.equal(trend.recordedCount,1);assert.deepEqual(trend.first,{date:'2026-11-08',weight:72});assert.deepEqual(trend.latest,trend.first);assert.equal(trend.change,null);assert.equal(trend.weeklyChangePercent,null);
  const svg=renderWeightChart(trend);assert.equal((svg.match(/class="weight-observation"/g)??[]).length,1);assert.doesNotMatch(svg,/class="weight-series"/);assert.doesNotMatch(svg,/NaN|Infinity/);
});

test('seven-day averages use at least three real records including days before the visible chart',()=>{
  const state=stateWith({'2026-11-01':72,'2026-11-03':71.8,'2026-11-05':71.6});
  const trend=weightTrend(state,'2026-11-10');
  assert.equal(trend.points[0].date,'2026-11-04');assert.equal(trend.points[0].average,null);
  assert.equal(trend.points[1].date,'2026-11-05');assert.equal(trend.points[1].average,71.8);
  assert.equal(trend.points[2].weight,null);assert.equal(trend.points[2].average,71.8);
  assert.equal(trend.points[4].average,null,'once the oldest weight leaves the seven-day window only two remain');
  assert.equal(trend.recordedCount,1,'records before chart start inform averages but not visible record counts');
});

test('actual and average series are broken across absent dates rather than interpolated',()=>{
  const trend=weightTrend(stateWith({'2026-11-02':72,'2026-11-03':71.9,'2026-11-05':71.8,'2026-11-06':71.7}),'2026-11-08');
  const svg=renderWeightChart(trend);
  assert.equal((svg.match(/class="weight-series"/g)??[]).length,2,'each pair of consecutive actual measurements stays separate across the missing fourth');
  assert.equal((svg.match(/class="weight-observation"/g)??[]).length,4);
  assert.match(svg,/缺失日期留空/);assert.equal(trend.change,-0.3);
});

test('sufficient fourteen-day coverage compares independent weekly means without changing targets',()=>{
  const records={};for(let i=0;i<14;i++)records[offsetDate('2026-10-26',i)]=72-i*0.1;
  const state=stateWith(records);state.settings={calories:2000};const before=JSON.stringify(state);
  const trend=weightTrend(state,'2026-11-08',30);
  assert.equal(trend.recordedCount,14);assert.equal(trend.first.date,'2026-10-26');assert.equal(trend.latest.date,'2026-11-08');assert.equal(trend.change,-1.3);
  assert.equal(trend.weeklyChangePercent,-0.98);assert.match(trend.advice[0].text,/71.70 → 71.00/);assert.doesNotMatch(trend.advice[0].text,/少吃|多吃|加餐|减少热量|增加热量/);assert.equal(JSON.stringify(state),before);
  const onlySeven=weightTrend(state,'2026-11-08',7);assert.equal(onlySeven.weeklyChangePercent,null);
});

test('sparse or short records never produce a long-term weight judgment',()=>{
  const records={};for(const i of [0,1,2,11,12,13,14])records[offsetDate('2026-10-25',i)]=72-i*0.05;
  assert.equal(weightTrend(stateWith(records),'2026-11-08',30).weeklyChangePercent,null,'seven scattered weights are insufficient');
  records['2026-11-03']=71.5;assert.notEqual(weightTrend(stateWith(records),'2026-11-08',30).weeklyChangePercent,null,'eight weights with enough per-window coverage can be compared');
  const short={};for(let i=0;i<10;i++)short[offsetDate('2026-10-30',i)]=72;
  assert.equal(weightTrend(stateWith(short),'2026-11-08',30).weeklyChangePercent,null);
});

test('local calendar ranges cross years and reject impossible dates and unsupported ranges',()=>{
  const trend=weightTrend(stateWith({'2026-12-31':72,'2027-01-01':71.9,'2027-01-03':71.8}),'2027-01-03');
  assert.equal(trend.points[0].date,'2026-12-28');assert.equal(trend.points[6].date,'2027-01-03');assert.equal(trend.points[6].average,71.9);
  assert.throws(()=>weightTrend({},'2026-02-30'));assert.throws(()=>weightTrend({},'2027-01-03',14));
});

test('chart output only renders valid dates and numbers and handles malformed dimensions',()=>{
  const svg=renderWeightChart({points:[{date:'2026-11-08',weight:72,average:71.8},{date:'<script>alert(1)</script>',weight:73,average:72}]},{width:NaN,height:Infinity});
  assert.match(svg,/viewBox="0 0 320 180"/);assert.doesNotMatch(svg,/<script|onload=|NaN|Infinity/);
  assert.match(svg,/2026-11-08 72.0 kg/);
});

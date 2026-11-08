// Nutrition, upgrade and weight UI checks use isolated browser storage and labeled test data.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {initialState,ensureDay,offsetDate} from '../web/core.js';

const server=createApp();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,results=[];
let browser;
const task=(id,name,status='pending')=>({id,name,category:'力量',time:'18:30',minutes:0,instructions:'3组×8次',status,sets:[],actualMinutes:null});
async function today(page){return page.locator('#day').inputValue();}
async function stored(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('daily-motion-v1')));}
async function rawStored(page){return page.evaluate(()=>localStorage.getItem('daily-motion-v1'));}
async function navigate(page,tab){await page.locator(`[data-tab=${tab}]`).click();await page.waitForFunction(value=>document.querySelector(`[data-tab="${value}"]`)?.classList.contains('active'),tab);}
async function seed(page,data){await page.evaluate(value=>localStorage.setItem('daily-motion-v1',JSON.stringify(value)),data);await page.reload();await page.locator('#home-food').waitFor();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'412px page must not overflow horizontally');if(await page.locator('#modal[open]').count())assert.equal(await page.locator('#modal').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'nutrition modal must not overflow horizontally');}
async function screenshot(page,path){await page.evaluate(()=>{const note=document.createElement('p');note.className='note';note.textContent='自动化测试示例 · 以下运动、饮食与体重均为测试数据，不是本人健康记录或饮食建议';document.querySelector('#app').prepend(note);document.querySelector('#toast').classList.remove('show');});await noOverflow(page);await mkdir('artifacts',{recursive:true});await page.screenshot({path,fullPage:true});}
async function createFood(page,{name='测试食物',calories='120',protein='10',carbs='30',portion='150'}={}){
  await navigate(page,'food');await page.locator('[data-action=add-food]').click();
  await page.locator('#foodName').fill(name);await page.locator('#foodCalories').fill(calories);await page.locator('#foodProtein').fill(protein);await page.locator('#foodCarbs').fill(carbs);await page.locator('#portionGrams').fill(portion);
  await noOverflow(page);await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal').waitFor({state:'hidden'});
}
async function configureCycle(page,{training='250',rest='150'}={}){await navigate(page,'settings');await page.locator('#carbMode').selectOption('cycle');await page.locator('#trainingCarbs').fill(training);await page.locator('#restCarbs').fill(rest);await page.locator('#settings-form button[type=submit]').click();}
async function setStorageFailure(page,enabled){await page.evaluate(flag=>{if(!window.nutritionOriginalSetItem)window.nutritionOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=flag?function(key,value){if(key==='daily-motion-v1')throw new DOMException('Nutrition test quota failure','QuotaExceededError');return window.nutritionOriginalSetItem.call(this,key,value);}:window.nutritionOriginalSetItem;},enabled);}
async function run(name,check,{initialize=null}={}){
  const page=await browser.newPage({viewport:{width:412,height:915},deviceScaleFactor:1,isMobile:true,timezoneId:'Asia/Shanghai'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  try{if(initialize)await initialize(page);await page.goto(base+'/#today');await page.locator('#home-food').waitFor();await check(page);await noOverflow(page);assert.deepEqual(errors,[],'unexpected JavaScript exceptions');results.push({name,ok:true});console.log(`PASS: ${name}`);}
  catch(error){results.push({name,ok:false,error:error.message});console.error(`FAIL: ${name}\n${error.stack??error.message}`);}
  finally{await page.close();}
}

try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});

  await run('a genuine v1 diary migrates in the existing storage key without losing history or inventing carbs',async page=>{
    const current=await today(page),past=offsetDate(current,-4),old=initialState();old.version=1;
    for(const field of ['carbMode','carbs','trainingCarbs','restCarbs'])delete old.settings[field];
    old.foods=[{id:'old-food',name:'旧版测试食物',calories:120,protein:10,portionGrams:150}];
    const day=ensureDay(old,current);delete day.carbDayType;day.tasks=[task('old-task','旧版已完成项目','done')];day.meals=[{id:'old-meal',foodId:'old-food',name:'旧版测试食物',grams:150,meal:'午餐',calories:180,protein:15}];day.foodComplete=true;day.weight=79.8;day.note='旧版日志测试';
    const previous=ensureDay(old,past);delete previous.carbDayType;previous.weight=80.2;previous.foodNotes=[{id:'old-note',text:'旧版待补录测试',createdAt:`${past}T12:00:00Z`}];
    old.whoop={records:[{date:past,score:70,sleepHours:7,workouts:[],source:'whoop'}],syncedAt:`${past}T12:00:00Z`};
    await seed(page,old);const data=await stored(page);
    assert.equal(data.version,2);assert.equal(data.settings.carbMode,'fixed');assert.equal(data.settings.carbs,null);assert.equal(data.foods[0].carbs,null);assert.equal(data.days[current].meals[0].carbs,null);
    assert.deepEqual(data.days[current].tasks,old.days[current].tasks);assert.equal(data.days[current].weight,79.8);assert.equal(data.days[current].note,'旧版日志测试');assert.equal(data.days[current].foodComplete,true);assert.equal(data.days[past].weight,80.2);assert.deepEqual(data.days[past].foodNotes,old.days[past].foodNotes);assert.deepEqual(data.whoop,old.whoop);
    assert.match(await page.locator('#home-food').innerText(),/待补全/);await page.reload();await page.locator('#home-food').waitFor();assert.equal((await stored(page)).days[current].tasks[0].status,'done');
  });

  await run('home one-tap food logging saves the default portion and all three nutrient snapshots immediately',async page=>{
    const current=await today(page),state=initialState(),day=ensureDay(state,current);day.tasks=[task('a','测试深蹲'),task('b','测试划船')];Object.assign(state.settings,{calories:2000,protein:100,carbs:200});await seed(page,state);
    await createFood(page);await navigate(page,'today');assert.equal(await page.locator('#today-feedback details').getAttribute('open'),null);
    await page.locator('#home-food [data-action=quick-food]').click();const data=await stored(page),meal=data.days[current].meals[0];
    assert.equal(data.days[current].meals.length,1);assert.equal(meal.grams,150);assert.equal(meal.calories,180);assert.equal(meal.protein,15);assert.equal(meal.carbs,45);assert.equal(data.days[current].foodComplete,false);assert.equal(await page.locator('#modal').isVisible(),false);
    assert.match(await page.locator('#home-food .nutrition-grid').innerText(),/180/);assert.match(await page.locator('#home-food .nutrition-grid').innerText(),/45/);
    await screenshot(page,'artifacts/mobile-v030-home.png');
  });

  await run('cycle targets follow scheduled training before and after check-in and allow a saved manual override',async page=>{
    const current=await today(page),state=initialState();ensureDay(state,current).tasks=[task('training','测试深蹲')];await seed(page,state);await configureCycle(page);
    assert.equal((await stored(page)).settings.trainingCarbs,250);await navigate(page,'food');assert.match(await page.locator('#carb-summary').innerText(),/训练日/);assert.match(await page.locator('#carb-summary').innerText(),/目标 250 g/);
    await navigate(page,'today');await page.getByRole('checkbox',{name:'完成测试深蹲',exact:true}).click();await navigate(page,'food');assert.match(await page.locator('#carb-summary').innerText(),/目标 250 g/);
    await page.locator('#carb-day-type').selectOption('rest');assert.match(await page.locator('#carb-summary').innerText(),/休息日/);assert.match(await page.locator('#carb-summary').innerText(),/目标 150 g/);assert.equal((await stored(page)).days[current].carbDayType,'rest');
    await page.reload();await page.locator('#carb-summary').waitFor();assert.equal(await page.locator('#carb-day-type').inputValue(),'rest');await page.locator('#carb-day-type').selectOption('auto');assert.match(await page.locator('#carb-summary').innerText(),/目标 250 g/);
  });

  await run('an unscheduled day has no automatic cycle target and an explicit zero rest target remains zero',async page=>{
    const current=await today(page);await configureCycle(page,{training:'220',rest:'0'});await navigate(page,'food');
    assert.match(await page.locator('#carb-summary').innerText(),/未确认日类型/);assert.match(await page.locator('#carb-summary').innerText(),/未设目标/);assert.match(await page.locator('#carb-summary').innerText(),/没有训练或休息安排/);
    await page.locator('#carb-day-type').selectOption('rest');assert.match(await page.locator('#carb-summary').innerText(),/目标 0 g/);assert.equal((await stored(page)).days[current].carbDayType,'rest');
    await page.locator('#carb-day-type').selectOption('training');assert.match(await page.locator('#carb-summary').innerText(),/目标 220 g/);
  });

  await run('switching carb modes preserves saved targets, ignores inactive validation and restores unsaved mode drafts',async page=>{
    await configureCycle(page);let data=await stored(page);assert.equal(data.settings.trainingCarbs,250);assert.equal(data.settings.restCarbs,150);
    await page.locator('#carbMode').selectOption('fixed');assert.equal(await page.locator('#carbs').isDisabled(),false);assert.equal(await page.locator('#trainingCarbs').isDisabled(),true);assert.equal(await page.locator('#restCarbs').isDisabled(),true);
    await page.locator('#carbs').fill('200');await page.locator('#settings-form button[type=submit]').click();data=await stored(page);assert.equal(data.settings.carbMode,'fixed');assert.equal(data.settings.carbs,200);assert.equal(data.settings.trainingCarbs,250);assert.equal(data.settings.restCarbs,150);
    await page.locator('#carbMode').selectOption('cycle');assert.equal(await page.locator('#trainingCarbs').inputValue(),'250');assert.equal(await page.locator('#restCarbs').inputValue(),'150');assert.equal(await page.locator('#carbs').isDisabled(),true);
    await page.locator('#trainingCarbs').fill('5001');await page.locator('#restCarbs').fill('-1');assert.equal(await page.locator('#settings-form').evaluate(form=>form.checkValidity()),false);
    await page.locator('#carbMode').selectOption('fixed');assert.equal(await page.locator('#settings-form').evaluate(form=>form.checkValidity()),true,'disabled cycle values cannot block the active fixed mode');await page.locator('#settings-form button[type=submit]').click();data=await stored(page);assert.equal(data.settings.trainingCarbs,250);assert.equal(data.settings.restCarbs,150);assert.equal(data.settings.carbs,200);
    await page.locator('#carbs').fill('5001');assert.equal(await page.locator('#carbs').evaluate(input=>input.checkValidity()),false);await page.locator('#carbMode').selectOption('cycle');assert.equal(await page.locator('#carbs').isDisabled(),true);assert.equal(await page.locator('#settings-form').evaluate(form=>form.checkValidity()),true,'disabled fixed value cannot block the active cycle mode');await page.locator('#settings-form button[type=submit]').click();data=await stored(page);assert.equal(data.settings.carbMode,'cycle');assert.equal(data.settings.carbs,200);assert.equal(data.settings.trainingCarbs,250);assert.equal(data.settings.restCarbs,150);
    await page.locator('#carbMode').selectOption('fixed');assert.equal(await page.locator('#carbs').inputValue(),'200');await page.locator('#carbs').fill('210');await page.locator('#carbMode').selectOption('cycle');await page.locator('#trainingCarbs').fill('260');await page.locator('#restCarbs').fill('160');
    await navigate(page,'food');await navigate(page,'settings');assert.equal(await page.locator('#carbMode').inputValue(),'cycle');assert.equal(await page.locator('#trainingCarbs').inputValue(),'260');assert.equal(await page.locator('#restCarbs').inputValue(),'160');assert.equal(await page.locator('#carbs').inputValue(),'210');assert.equal(await page.locator('#carbs').isDisabled(),true);assert.equal(await page.locator('#trainingCarbs').isDisabled(),false);
    await page.locator('#carbMode').selectOption('fixed');assert.equal(await page.locator('#carbs').isDisabled(),false);assert.equal(await page.locator('#carbs').inputValue(),'210');assert.equal(await page.locator('#trainingCarbs').isDisabled(),true);assert.equal((await stored(page)).settings.carbs,200,'unsaved drafts must not alter the saved targets');
  });

  await run('editing food nutrition changes future servings while keeping old meal snapshots intact',async page=>{
    const current=await today(page);await createFood(page);await navigate(page,'today');await page.locator('#home-food [data-action=quick-food]').click();const original=(await stored(page)).days[current].meals[0];
    await navigate(page,'food');await page.locator('[data-action=edit-food]').click();await page.locator('#foodCalories').fill('200');await page.locator('#foodProtein').fill('20');await page.locator('#foodCarbs').fill('60');await page.locator('#modal-form button[type=submit]').click();
    assert.deepEqual((await stored(page)).days[current].meals[0],original);
    await navigate(page,'today');await page.locator('#home-food [data-action=quick-food]').click();const meals=(await stored(page)).days[current].meals;
    assert.equal(meals.length,2);assert.deepEqual(meals[0],original);assert.equal(meals[1].calories,300);assert.equal(meals[1].protein,30);assert.equal(meals[1].carbs,90);assert.notEqual(meals[0].id,meals[1].id);
  });

  await run('a blank carb value stays unknown and does not masquerade as a complete zero-carb total',async page=>{
    const current=await today(page);await createFood(page,{carbs:''});await navigate(page,'today');await page.locator('#home-food [data-action=quick-food]').click();assert.equal((await stored(page)).days[current].meals[0].carbs,null);
    assert.match(await page.locator('#home-food .nutrition-grid').innerText(),/待补全/);await navigate(page,'food');const summary=await page.locator('#carb-summary').innerText();assert.match(summary,/1 项饮食缺少碳水资料/);assert.match(summary,/全天总量暂不确定/);assert.match(await page.locator('#carb-summary .stat').innerText(),/已知/);
    await createFood(page,{name:'测试明确零碳水',carbs:'0'});await navigate(page,'today');await page.locator('#home-food [data-action=quick-food]').filter({hasText:'测试明确零碳水'}).click();const meals=(await stored(page)).days[current].meals;assert.equal(meals.length,2);assert.equal(meals[0].carbs,null);assert.equal(meals[1].carbs,0);
    await navigate(page,'food');assert.match(await page.locator('#carb-summary').innerText(),/1 项饮食缺少碳水资料/);
  });

  await run('quick weight entry and 7/30-day charts use only real recorded weights and preserve blank dates',async page=>{
    const current=await today(page),state=initialState();ensureDay(state,current);for(const [offset,weight] of [[-29,81],[-6,80.5],[-3,80.1],[-1,79.9]])ensureDay(state,offsetDate(current,offset)).weight=weight;await seed(page,state);
    await page.locator('[data-action=quick-weight]').click();await page.locator('#quickWeight').fill('79.8');await page.locator('#modal-form button[type=submit]').click();assert.equal((await stored(page)).days[current].weight,79.8);
    const before=await rawStored(page);await navigate(page,'trends');await page.locator('#weight-trends').waitFor();assert.equal(await page.locator('#weight-trends .weight-observation').count(),4);assert.match(await page.locator('#weight-trends .weight-summary').innerText(),/79.8 kg/);
    await page.locator('[data-action=weight-range][data-id="30"]').click();assert.equal(await page.locator('#weight-trends .weight-observation').count(),5);assert.equal(await rawStored(page),before,'viewing weight ranges must not generate extra diary records');
    await screenshot(page,'artifacts/mobile-v030-weight.png');await page.locator('[data-action=weight-range][data-id="7"]').click();assert.equal(await page.locator('#weight-trends .weight-observation').count(),4);assert.equal(await rawStored(page),before);
  });

  await run('a weight dialog opened before midnight saves to its original date after the daily rollover',async page=>{
    const originalDate='2026-11-08',nextDate='2026-11-09';assert.equal(await today(page),originalDate);
    await page.locator('[data-action=quick-weight]').click();assert.match(await page.locator('#modal-body').innerText(),new RegExp(originalDate));
    await page.clock.fastForward(60000);assert.equal(await today(page),nextDate,'the running app must actually roll over its selected date');assert.equal(await page.locator('#modal').isVisible(),true);
    assert.match(await page.locator('#modal-body').innerText(),new RegExp(originalDate));assert.doesNotMatch(await page.locator('#modal-body').innerText(),new RegExp(nextDate));
    await page.locator('#quickWeight').fill('79.7');await page.locator('#modal-form button[type=submit]').click();const data=await stored(page);
    assert.equal(data.days[originalDate].weight,79.7);assert.equal(data.days[nextDate].weight,null,'a late confirmation must not write the measurement into the new day');assert.equal(await today(page),nextDate);
  },{initialize:page=>page.clock.install({time:new Date('2026-11-08T15:59:45Z')})});

  await run('a failed one-tap save rolls back nutrients and a retry records one serving only',async page=>{
    const current=await today(page);await createFood(page);await navigate(page,'today');const before=await rawStored(page);await setStorageFailure(page,true);
    await page.locator('#home-food [data-action=quick-food]').click();assert.equal(await rawStored(page),before);assert.match(await page.locator('#toast').innerText(),/保存失败/);assert.equal((await stored(page)).days[current].meals.length,0);
    await setStorageFailure(page,false);await page.locator('#home-food [data-action=quick-food]').click();let data=await stored(page);assert.equal(data.days[current].meals.length,1);assert.equal(data.days[current].meals[0].carbs,45);assert.equal(data.days[current].meals[0].calories,180);
    await page.reload();await page.locator('#home-food').waitFor();data=await stored(page);assert.equal(data.days[current].meals.length,1);
  });
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
const failed=results.filter(result=>!result.ok);console.log(`Nutrition UI: ${results.length-failed.length}/${results.length} passed; all records are isolated test data.`);if(failed.length)process.exitCode=1;

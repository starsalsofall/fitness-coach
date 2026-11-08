// Weekly-plan UI checks in isolated browser contexts. All screenshots use labeled test data.
// Uses the locally installed Chrome; does not connect to accounts or health services.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {initialState,ensureDay,offsetDate} from '../web/core.js';

const server=createApp();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const results=[];let browser;
const weekdays='一二三四五六日';
function mondayOf(date){const weekday=new Date(`${date}T12:00:00`).getDay();return offsetDate(date,-(weekday+6)%7);}
async function today(page){return page.evaluate(()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;});}
async function stored(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('daily-motion-v1')));}
async function rawStored(page){return page.evaluate(()=>localStorage.getItem('daily-motion-v1'));}
async function navigate(page,tab){await page.locator(`[data-tab=${tab}]`).click();await page.waitForFunction(value=>document.querySelector(`[data-tab="${value}"]`)?.classList.contains('active'),tab);}
async function seed(page,state){await page.evaluate(data=>localStorage.setItem('daily-motion-v1',JSON.stringify(data)),state);await page.reload();await page.locator('#weekly-planner').waitFor();}
async function preview(page,text,{startDate,repeat=true}={}){
  await page.locator('[data-action=import-week]').first().click();
  await page.locator('#weekly-text').fill(text);
  await page.locator('#week-start').fill(startDate);
  await page.locator('#week-repeat').setChecked(repeat);
  await page.locator('#weekly-text-form button[type=submit]').click();
}
async function confirmImport(page){await page.locator('#weekly-review-form button[type=submit]').click();await page.locator('#weekly-review-form').waitFor({state:'hidden'});await page.locator('#weekly-planner').waitFor();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'412px viewport must not overflow horizontally');if(await page.locator('#modal[open]').count())assert.equal(await page.locator('#modal').evaluate(element=>element.scrollWidth>element.clientWidth+1),false,'import dialog must not overflow horizontally');}
async function labelScreenshot(page,target,path){
  await page.evaluate(selector=>{const note=document.createElement('p');note.className='note';note.textContent='自动化测试格式示例 · 以下动作仅演示导入与打卡，不是个人训练建议';document.querySelector(selector).prepend(note);document.querySelector('#toast').classList.remove('show');},target);
  await noOverflow(page);await mkdir('artifacts',{recursive:true});await page.screenshot({path,fullPage:true});
}
async function setStorageFailure(page,enabled){await page.evaluate(flag=>{if(!window.weeklyOriginalSetItem)window.weeklyOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=flag?function(key,value){if(key==='daily-motion-v1')throw new DOMException('Weekly UI test quota failure','QuotaExceededError');return window.weeklyOriginalSetItem.call(this,key,value);}:window.weeklyOriginalSetItem;},enabled);}
async function run(name,check){
  const page=await browser.newPage({viewport:{width:412,height:915},deviceScaleFactor:1,isMobile:true,timezoneId:'Asia/Shanghai'});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  try{await page.goto(base+'/#training');await page.locator('#weekly-planner').waitFor();await check(page);assert.deepEqual(errors,[],'unexpected JavaScript exceptions');results.push({name,ok:true});console.log(`PASS: ${name}`);}
  catch(error){results.push({name,ok:false,error:error.message});console.error(`FAIL: ${name}\n${error.stack??error.message}`);}
  finally{await page.close();}
}

try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});

  await run('chat Markdown previews separate exercises with sets and imports selected items for one week only',async page=>{
    const current=await today(page),nextMonday=offsetDate(mondayOf(current),7),before=await rawStored(page);
    const text='一周计划（自动化测试格式示例）\n**周一：胸+肩**\n1. **卧推** 4×10\n2. 侧平举 3×12\n__周二（背部训练）__\n划船4×10\n周三：休息\n周四：快走20分钟\n周五（腿部）\n深蹲3组×8次\n周六：拉伸10分钟\n周日：休息';
    await preview(page,text,{startDate:nextMonday,repeat:false});await page.locator('#weekly-review-form').waitFor();
    assert.equal(await page.locator('#weekly-preview [name=item]').count(),8);assert.match(await page.locator('#weekly-preview').innerText(),/卧推[\s\S]*4×10/);assert.doesNotMatch(await page.locator('#weekly-preview').innerText(),/· 胸\+肩|· 腿部/);assert.equal(await rawStored(page),before,'preview cannot persist training data');
    await page.locator('#weekly-preview [name=item]').nth(1).uncheck();
    await labelScreenshot(page,'#modal-body','artifacts/mobile-weekly-import.png');
    await confirmImport(page);const state=await stored(page);
    assert.equal(state.plans.length,0,'one-time import must not create weekly templates');assert.equal(state.days[nextMonday].tasks.length,1);assert.equal(state.days[nextMonday].tasks[0].name,'卧推');assert.equal(state.days[nextMonday].tasks[0].instructions,'4×10');assert.equal(state.days[nextMonday].tasks[0].minutes,0);assert.equal(state.days[offsetDate(nextMonday,1)].tasks[0].name,'划船');assert.equal(state.days[offsetDate(nextMonday,6)].tasks[0].category,'休息');
    assert.equal(Array.from({length:7},(_,i)=>state.days[offsetDate(nextMonday,i)].tasks.length).reduce((a,b)=>a+b,0),7);
    await labelScreenshot(page,'#app','artifacts/mobile-weekly-plan.png');
    await page.reload();await page.locator('#weekly-planner').waitFor();assert.equal((await stored(page)).days[nextMonday].tasks[0].instructions,'4×10');await noOverflow(page);
  });

  await run('today exercises check independently and repeated import preserves completion and meals without duplication',async page=>{
    const current=await today(page),state=initialState(),day=ensureDay(state,current);
    day.tasks=[{id:'keep-completed',name:'已有测试快走',category:'有氧',time:'18:30',minutes:20,status:'done',sets:[],actualMinutes:21}];day.meals=[{id:'keep-meal',name:'测试午饭',meal:'午餐',grams:100,calories:500,protein:30}];day.foodComplete=true;
    await seed(page,state);const text=Array.from(weekdays,day=>`周${day}\n测试动作A 3×12\n测试动作B 4×10`).join('\n');
    await preview(page,text,{startDate:mondayOf(current),repeat:false});await confirmImport(page);
    let data=await stored(page);assert.equal(data.days[current].tasks.length,3);assert.equal(data.days[current].tasks[0].status,'done');assert.equal(data.days[current].meals[0].calories,500);assert.equal(data.days[current].foodComplete,true);
    await navigate(page,'today');await page.getByRole('checkbox',{name:'完成测试动作A',exact:true}).click();
    data=await stored(page);assert.equal(data.days[current].tasks.find(task=>task.name==='测试动作A').status,'done');assert.equal(data.days[current].tasks.find(task=>task.name==='测试动作B').status,'pending');assert.equal(data.days[current].tasks[0].status,'done');
    await page.getByRole('checkbox',{name:'撤销测试动作A',exact:true}).click();assert.equal((await stored(page)).days[current].tasks.find(task=>task.name==='测试动作A').status,'pending');
    await preview(page,text,{startDate:mondayOf(current),repeat:false});await confirmImport(page);data=await stored(page);assert.equal(data.days[current].tasks.length,3);assert.equal(data.days[current].meals.length,1);assert.equal(data.days[current].tasks[0].actualMinutes,21);await noOverflow(page);
  });

  await run('unknown weekdays block preview and leave persisted records unchanged',async page=>{
    const current=await today(page),before=await rawStored(page);
    await preview(page,'周一\n卧推4×10\n周八\n快走20分钟',{startDate:offsetDate(mondayOf(current),7),repeat:true});
    assert.equal(await page.locator('#weekly-review-form').count(),0);assert.match(await page.locator('#weekly-error').innerText(),/星期无法识别/);assert.equal(await rawStored(page),before);await noOverflow(page);
  });

  await run('weekly repeating import also fills future dates that were already previewed',async page=>{
    const current=await today(page),nextMonday=offsetDate(mondayOf(current),7),futureMonday=offsetDate(nextMonday,7);
    await page.locator('[data-action=week-next]').click();await page.locator('[data-action=week-next]').click();await page.locator(`[data-action=week-day][data-id="${futureMonday}"]`).click();
    assert.equal(await page.locator('[data-action=toggle]').count(),0);
    await preview(page,'周一\n测试每周动作 3组×8次',{startDate:nextMonday,repeat:true});await confirmImport(page);
    const state=await stored(page);assert.equal(state.plans.length,1);assert.equal(state.plans[0].startDate,nextMonday);assert.equal(state.days[nextMonday].tasks.length,1);assert.equal(state.days[futureMonday].tasks.length,1);assert.equal(state.days[futureMonday].tasks[0].instructions,'3组×8次');
    await page.locator('[data-action=week-next]').click();assert.match(await page.locator('#app').innerText(),/测试每周动作/);await page.locator('[data-action=toggle]').click();assert.match(await page.locator('#toast').innerText(),/当天再打卡/);assert.equal((await stored(page)).days[futureMonday].tasks[0].status,'pending');await noOverflow(page);
  });

  await run('failed plan import rolls back and can be retried from the same preview',async page=>{
    const current=await today(page),nextMonday=offsetDate(mondayOf(current),7),before=await rawStored(page);
    await preview(page,'周一\n测试重试动作 3×12',{startDate:nextMonday,repeat:true});await page.locator('#weekly-review-form').waitFor();
    await setStorageFailure(page,true);await page.locator('#weekly-review-form button[type=submit]').click();assert.equal(await rawStored(page),before);assert.match(await page.locator('#weekly-error').innerText(),/保存失败/);assert.equal(await page.locator('#weekly-preview [name=item]:checked').count(),1);
    await setStorageFailure(page,false);await confirmImport(page);const state=await stored(page);assert.equal(state.plans.length,1);assert.equal(state.days[nextMonday].tasks.length,1);assert.equal(state.days[nextMonday].tasks[0].name,'测试重试动作');await noOverflow(page);
  });
}finally{
  if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
if(results.some(result=>!result.ok))process.exitCode=1;
console.log(JSON.stringify({passed:results.filter(result=>result.ok).length,total:results.length}));

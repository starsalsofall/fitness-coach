// Application audit: isolated Chrome contexts; only mobile-food-quick.png is generated.
// Usage: npm ci; node test/ui-audit.mjs
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';

const server=createApp();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const results=[];
let browser;

async function navigate(page,tab) {
  await page.locator(`[data-tab=${tab}]`).click();
  await page.waitForFunction(value=>document.querySelector(`[data-tab="${value}"]`)?.classList.contains('active'),tab);
}
async function stored(page) {
  return page.evaluate(()=>JSON.parse(localStorage.getItem('daily-motion-v1')));
}
function currentDay(state) {return state.days[Object.keys(state.days).sort().at(-1)];}
async function createFood(page) {
  await navigate(page,'food');
  await page.locator('[data-action=add-food]').click();
  await page.locator('[name=name]').fill('测试食物');
  await page.locator('[name=calories]').fill('120');
  await page.locator('[name=protein]').fill('10');
  await page.locator('[name=portionGrams]').fill('150');
  await page.locator('#modal-form button[type=submit]').click();
  await page.locator('[data-action=quick-food]').waitFor();
}
async function textDraft(page,text) {
  await page.locator('[data-action=meal-text]').click();
  await page.locator('#mealSpeechText').fill(text);
  await page.locator('#speech-text-form button[type=submit]').click();
  await page.locator('#speech-review-form').waitFor();
}
async function setStorageFailure(page,enabled) {
  await page.evaluate(flag=>{
    if(!window.auditOriginalStorageSetItem)window.auditOriginalStorageSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=flag?function(key,value){if(key==='daily-motion-v1')throw new DOMException('Audit quota failure','QuotaExceededError');return window.auditOriginalStorageSetItem.call(this,key,value);}:window.auditOriginalStorageSetItem;
  },enabled);
}
async function run(name,check) {
  const page=await browser.newPage({viewport:{width:412,height:915},isMobile:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  try {
    await page.goto(base);
    await page.locator('[data-action=add-task]').waitFor();
    await check(page);
    assert.deepEqual(errors,[],'unexpected JavaScript exceptions');
    results.push({name,ok:true});
    console.log(`PASS: ${name}`);
  }catch(error){
    results.push({name,ok:false,error:error.message});
    console.error(`FAIL: ${name}\n${error.stack??error.message}`);
  }finally{await page.close();}
}

try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});

  await run('one-click food portions and recent-meal reuse keep nutrition snapshots',async page=>{
    await createFood(page);
    await page.locator('[data-action=quick-food]').click();
    let data=await stored(page),day=currentDay(data);
    assert.equal(day.meals.length,1);assert.equal(day.meals[0].grams,150);assert.equal(day.meals[0].calories,180);assert.equal(day.meals[0].protein,15);
    await page.locator('[data-action=repeat-meal]').click();
    data=await stored(page);day=currentDay(data);
    assert.equal(day.meals.length,2);assert.notEqual(day.meals[0].id,day.meals[1].id);
    assert.equal(day.meals.reduce((sum,entry)=>sum+entry.calories,0),360);
    assert.equal(day.foodComplete,false);
    await page.evaluate(()=>{
      const banner=document.createElement('p');banner.className='note';banner.textContent='自动化测试示例 · 以下食物与数值不是个人健康记录';
      document.querySelector('#app').prepend(banner);document.querySelector('#toast').classList.remove('show');
    });
    await mkdir('artifacts',{recursive:true});
    await page.screenshot({path:'artifacts/mobile-food-quick.png',fullPage:true});
  });

  await run('spoken-meal text matches known food and requires explicit confirmation',async page=>{
    await createFood(page);
    await textDraft(page,'午餐测试食物150克');
    assert.equal(await page.locator('[name=grams-0]').inputValue(),'150');
    assert.equal(await page.locator('[name=meal]').inputValue(),'午餐');
    assert.equal(currentDay(await stored(page)).meals.length,0,'draft must not save before confirmation');
    await page.locator('#speech-review-form button[type=submit]').click();
    const day=currentDay(await stored(page));
    assert.equal(day.meals.length,1);assert.equal(day.meals[0].name,'测试食物');assert.equal(day.meals[0].grams,150);assert.equal(day.meals[0].calories,180);
  });

  await run('unknown spoken food stays a pending note and blocks complete-day status',async page=>{
    await createFood(page);
    await page.locator('[data-action=quick-food]').click();
    await textDraft(page,'午餐神秘炒面一碗');
    assert.equal(await page.locator('#speech-review-form button[type=submit]').isDisabled(),true);
    await page.locator('[data-action=save-food-note]').click();
    let day=currentDay(await stored(page));
    assert.equal(day.foodNotes.length,1);assert.equal(day.foodNotes[0].text,'午餐神秘炒面一碗');assert.equal(day.meals.length,1);
    await page.locator('[data-action=food-complete]').click();
    day=currentDay(await stored(page));assert.equal(day.foodComplete,false);
    assert.match(await page.locator('#toast').innerText(),/待补全/);
  });

  await run('weekly plan can be applied today once and stays deduplicated after reload',async page=>{
    await navigate(page,'training');
    await page.locator('[data-action=add-plan]').click();
    await page.locator('[name=name]').fill('测试周计划');
    await page.locator('[name=category]').selectOption('有氧');
    await page.locator('[name=minutes]').fill('20');
    for(const checkbox of await page.locator('[name=weekday]').all())await checkbox.check();
    await page.locator('#modal-form button[type=submit]').click();
    await page.locator('[data-action=apply-plan]').click();
    let data=await stored(page),day=currentDay(data);
    assert.equal(data.plans.length,1);assert.equal(day.tasks.length,1);assert.equal(day.tasks[0].planId,data.plans[0].id);
    await page.locator('[data-action=apply-plan]').click();
    assert.equal(currentDay(await stored(page)).tasks.length,1);
    await page.reload();await page.locator('[data-action=apply-plan]').waitFor();
    assert.equal(currentDay(await stored(page)).tasks.length,1);
  });

  await run('failed storage writes roll back quick-entry and modal changes without duplication',async page=>{
    await createFood(page);
    await page.locator('[data-action=quick-food]').click();
    await setStorageFailure(page,true);
    await page.locator('[data-action=quick-food]').click();
    assert.equal(currentDay(await stored(page)).meals.length,1);
    assert.match(await page.locator('#toast').innerText(),/保存失败/);
    await setStorageFailure(page,false);
    await page.locator('[data-action=quick-food]').click();
    assert.equal(currentDay(await stored(page)).meals.length,2);
    await navigate(page,'training');
    await setStorageFailure(page,true);
    await page.locator('[data-action=add-task]').click();await page.locator('[name=name]').fill('保存失败测试动作');
    await page.locator('#modal-form button[type=submit]').click();
    assert.equal(currentDay(await stored(page)).tasks.length,0);
    await setStorageFailure(page,false);
    await page.locator('[data-action=add-task]').click();await page.locator('[name=name]').fill('保存失败测试动作');
    await page.locator('#modal-form button[type=submit]').click();
    assert.equal(currentDay(await stored(page)).tasks.length,1);
  });

  await run('backup restoration clears imported server addresses and existing pairing secrets',async page=>{
    await navigate(page,'settings');
    // Credentials can remain from an older version even while the connection UI is paused.
    await page.evaluate(()=>sessionStorage.setItem('motion-pair-token','existing-personal-pair-secret'));
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('motion-pair-token')),'existing-personal-pair-secret');
    const backup=await stored(page);backup.settings.serverUrl='https://backup-import.example';
    await page.evaluate(raw=>window.restoreBackup(raw),JSON.stringify(backup));
    assert.equal((await stored(page)).settings.serverUrl,'');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('motion-pair-token')),null);
    assert.equal(await page.locator('[name=serverUrl]').count(),0);
  });

  const failed=results.filter(result=>!result.ok);
  console.log(`UI audit: ${results.length-failed.length}/${results.length} passed; only mobile-food-quick.png generated.`);
  if(failed.length)process.exitCode=1;
}finally{
  if(browser)await browser.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}

// UI readiness regression checks. Uses isolated mock-native/browser contexts only.
// No notifications, microphones, WHOOP accounts or screenshot artifacts are used.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {initialState,offsetDate} from '../web/core.js';

const server=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const results=[];let browser;

async function installNative(page) {
  await page.addInitScript(()=>{
    window.auditNative={
      calls:{testReminder:0,healthSnapshot:0},requests:[],
      notificationMessage:'测试：通知权限已允许',
      speech:{available:true,message:'测试：系统语音服务可用'},
      reminder:{ok:true,message:'测试通知已交给系统，请在通知栏检查声音和振动'}
    };
    window.Android={
      read:()=>localStorage.getItem('daily-motion-v1')??'',
      save:json=>{localStorage.setItem('daily-motion-v1',json);return true;},
      getPairToken:()=>sessionStorage.getItem('motion-pair-token')??'',
      setPairToken:value=>{if(value)sessionStorage.setItem('motion-pair-token',value);else sessionStorage.removeItem('motion-pair-token');},
      notificationStatus:()=>window.auditNative.notificationMessage,
      speechStatus:()=>JSON.stringify(window.auditNative.speech),
      testReminder:()=>{window.auditNative.calls.testReminder++;return JSON.stringify(window.auditNative.reminder);},
      requestNotifications:()=>{},requestExactAlarms:()=>{},openNotificationSettings:()=>{},
      healthSnapshot:()=>{window.auditNative.calls.healthSnapshot++;},
      api:(id,host,path,method)=>{
        window.auditNative.requests.push({id,host,path,method});
        queueMicrotask(()=>window.nativeApiResult(id,true,{records:[],syncedAt:new Date().toISOString()}));
      }
    };
  });
}
async function navigate(page,tab) {
  await page.locator(`[data-tab=${tab}]`).click();
  await page.waitForFunction(value=>document.querySelector(`[data-tab="${value}"]`)?.classList.contains('active'),tab);
}
async function stored(page) {return page.evaluate(()=>localStorage.getItem('daily-motion-v1'));}
async function run(name,check,{native=false,initialize=null,route='#settings'}={}) {
  const page=await browser.newPage({viewport:{width:412,height:915},isMobile:true});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  try {
    if(native)await installNative(page);
    if(initialize)await initialize(page);
    await page.goto(base+'/'+route);
    await page.locator(route==='#settings'?'#readiness':'#app h1').waitFor();
    await check(page);assert.deepEqual(errors,[],'unexpected JavaScript exceptions');
    results.push({name,ok:true});console.log(`PASS: ${name}`);
  }catch(error){results.push({name,ok:false,error:error.message});console.error(`FAIL: ${name}\n${error.stack??error.message}`);}
  finally{await page.close();}
}

try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});

  await run('browser readiness clearly reports native notification and speech limitations',async page=>{
    const before=await stored(page);
    await page.locator('[data-action=test-reminder]').click();
    assert.match(await page.locator('#test-reminder-feedback').innerText(),/浏览器.*无法.*通知/);
    assert.match(await page.locator('#speech-service-status').innerText(),/浏览器|安装版/);
    assert.equal(await stored(page),before,'testing reminders must not alter stored daily goals');
  });

  await run('mock native reminder success and blocked-permission results do not change daily state',async page=>{
    const before=await stored(page);
    assert.match(await page.locator('#speech-service-status').innerText(),/系统语音服务可用/);
    await page.locator('[data-action=test-reminder]').click();
    assert.match(await page.locator('#test-reminder-feedback').innerText(),/交给系统.*通知栏/);
    assert.equal(await page.evaluate(()=>window.auditNative.calls.testReminder),1);
    assert.equal(await stored(page),before);
    await page.evaluate(()=>{window.auditNative.reminder={ok:false,code:'NOTIFICATIONS_DISABLED',message:'测试：通知未开启，请到系统允许通知'};window.auditNative.speech={available:false,message:'测试：系统语音服务不可用，可使用键盘语音输入'};window.nativeStatusUpdated();});
    await page.locator('[data-action=test-reminder]').click();
    assert.match(await page.locator('#test-reminder-feedback').innerText(),/通知未开启/);
    assert.match(await page.locator('#speech-service-status').innerText(),/语音服务不可用/);
    assert.equal(await stored(page),before);
  },{native:true});

  await run('returning from native settings preserves unsaved goals and input focus',async page=>{
    await page.locator('[name=calories]').fill('1850');await page.locator('[name=protein]').fill('115');
    await page.evaluate(()=>{window.auditNative.notificationMessage='测试：已返回系统设置，通知仍允许';window.nativeStatusUpdated();});
    assert.equal(await page.locator('[name=calories]').inputValue(),'1850');assert.equal(await page.locator('[name=protein]').inputValue(),'115');
    assert.equal(await page.evaluate(()=>document.activeElement?.name),'protein');
    assert.match(await page.locator('#notification-status').innerText(),/已返回系统设置/);
    const persisted=JSON.parse(await stored(page));assert.equal(persisted.settings.calories,null);assert.equal(persisted.settings.protein,null);
  },{native:true});

  await run('unsaved goals survive navigation and a native status callback preserves journal text caret',async page=>{
    await page.locator('[name=calories]').fill('1850');await page.locator('[name=protein]').fill('115');
    await navigate(page,'trends');await page.locator('[name=note]').fill('unfinished-journal-audit');
    await page.locator('[name=note]').evaluate(input=>input.setSelectionRange(4,9));
    await page.evaluate(()=>window.nativeStatusUpdated());
    assert.deepEqual(await page.locator('[name=note]').evaluate(input=>({focused:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd})),{focused:true,start:4,end:9});
    await navigate(page,'settings');assert.equal(await page.locator('[name=calories]').inputValue(),'1850');assert.equal(await page.locator('[name=protein]').inputValue(),'115');
    assert.equal(JSON.parse(await stored(page)).settings.calories,null);assert.ok(!(await stored(page)).includes('unfinished-journal-audit'));
    await navigate(page,'trends');assert.equal(await page.locator('[name=note]').inputValue(),'unfinished-journal-audit');
  },{native:true});

  await run('paused sync makes no native requests and preserves existing WHOOP and Health Connect caches',async page=>{
    const before=JSON.parse(await stored(page));assert.equal(before.settings.serverUrl,'https://legacy-sync.example');
    assert.match(await page.locator('#sync-paused').innerText(),/WHOOP 同步已暂停/);
    assert.equal(await page.locator('#connection-form,[name=serverUrl],[name=pairToken],[data-action^="whoop-"],[data-action^="health-"]').count(),0);
    for(const tab of ['today','training','food','trends','settings'])await navigate(page,tab);
    await page.clock.fastForward(16*60*1000);
    assert.equal(await page.evaluate(()=>window.auditNative.requests.length),0);
    assert.equal(await page.evaluate(()=>window.auditNative.calls.healthSnapshot),0);
    const after=JSON.parse(await stored(page));assert.deepEqual(after.whoop,before.whoop);assert.deepEqual(after.healthConnect,before.healthConnect);
    assert.equal(after.settings.serverUrl,before.settings.serverUrl);
  },{native:true,initialize:async page=>{
    await page.clock.install();
    const state=initialState();state.settings.serverUrl='https://legacy-sync.example';
    state.whoop={records:[{date:'2026-11-07',score:75,sleepHours:7,source:'whoop',workouts:[]}],syncedAt:'2026-11-07T01:00:00Z'};
    state.healthConnect={records:[{date:'2026-11-07',score:null,sleepHours:6.5,source:'health-connect',workouts:[]}],syncedAt:'2026-11-07T01:30:00Z',source:'health-connect',sourcePackage:'com.whoop.android'};
    await page.addInitScript(data=>{localStorage.setItem('daily-motion-v1',JSON.stringify(data));sessionStorage.setItem('motion-pair-token','legacy-audit-token');},state);
  }});

  await run('journal drafts remain separate by date and save only the selected day',async page=>{
    await navigate(page,'trends');const today=await page.locator('#day').inputValue(),previous=offsetDate(today,-1);
    await page.locator('[name=weight]').fill('80.5');await page.locator('[name=note]').fill('today-unsaved-audit');
    await page.locator('#day').fill(previous);await page.waitForFunction(date=>document.querySelector('#journal-form')?.dataset.recordDate===date,previous);
    await page.locator('[name=weight]').fill('79.5');await page.locator('[name=note]').fill('previous-unsaved-audit');
    await page.locator('#day').fill(today);await page.waitForFunction(date=>document.querySelector('#journal-form')?.dataset.recordDate===date,today);
    assert.equal(await page.locator('[name=weight]').inputValue(),'80.5');assert.equal(await page.locator('[name=note]').inputValue(),'today-unsaved-audit');
    assert.ok(!(await stored(page)).includes('today-unsaved-audit'));
    await page.locator('#journal-form button[type=submit]').click();assert.equal(JSON.parse(await stored(page)).days[today].weight,80.5);
    await page.locator('#day').fill(previous);await page.waitForFunction(date=>document.querySelector('#journal-form')?.dataset.recordDate===date,previous);
    assert.equal(await page.locator('[name=weight]').inputValue(),'79.5');assert.equal(await page.locator('[name=note]').inputValue(),'previous-unsaved-audit');
  });

  await run('successful save clears the saved draft while backup restore clears all drafts',async page=>{
    await page.locator('[name=calories]').fill('1850');await page.locator('#settings-form button[type=submit]').click();
    assert.equal(JSON.parse(await stored(page)).settings.calories,1850);
    await page.locator('[name=calories]').fill('1950');await page.locator('[name=protein]').fill('115');
    await navigate(page,'trends');await page.locator('[name=note]').fill('unsaved-restore-journal');await navigate(page,'settings');
    const backup=JSON.parse(await stored(page));backup.settings.calories=1700;backup.settings.protein=100;
    await page.evaluate(raw=>window.restoreBackup(raw),JSON.stringify(backup));
    assert.equal(await page.locator('[name=calories]').inputValue(),'1700');assert.equal(await page.locator('[name=protein]').inputValue(),'100');
    await page.evaluate(()=>window.nativeStatusUpdated());assert.equal(await page.locator('[name=calories]').inputValue(),'1700');
    await navigate(page,'trends');assert.equal(await page.locator('[name=note]').inputValue(),'');
  });

  await run('older WebView feature simulation starts plans and supports fallback dialogs and reuse',async page=>{
    assert.match(await page.locator('#app').innerText(),/兼容测试计划/);
    await page.locator('[data-action=add-task]').click();assert.equal(await page.locator('#modal').getAttribute('open'),'');
    assert.equal(await page.locator('#modal-backdrop').isVisible(),true);await page.locator('#close-dialog').click();assert.equal(await page.locator('#modal').isVisible(),false);
    await navigate(page,'food');await page.locator('[data-action=add-food]').click();await page.locator('[name=name]').fill('兼容测试食物');
    await page.locator('[name=calories]').fill('120');await page.locator('[name=protein]').fill('10');await page.locator('[name=portionGrams]').fill('150');await page.locator('#modal-form button[type=submit]').click();
    assert.equal(await page.locator('#modal').isVisible(),false);await page.locator('[data-action=quick-food]').click();await page.locator('[data-action=repeat-meal]').click();
    const state=JSON.parse(await stored(page)),days=Object.values(state.days);assert.equal(days[0].meals.length,2);assert.equal(days[0].meals[1].calories,180);
    await page.locator('[data-action=meal-text]').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#modal').isVisible(),false);
  },{route:'',initialize:async page=>{
    const state=initialState();state.plans=[{id:'compat-plan',name:'兼容测试计划',category:'有氧',minutes:20,time:'18:30',weekdays:[0,1,2,3,4,5,6]}];
    await page.addInitScript(data=>{localStorage.setItem('daily-motion-v1',JSON.stringify(data));window.structuredClone=undefined;Array.prototype.at=undefined;Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:undefined,configurable:true});Object.defineProperty(HTMLDialogElement.prototype,'close',{value:undefined,configurable:true});},state);
  }});

  const failed=results.filter(result=>!result.ok);console.log(`UI readiness: ${results.length-failed.length}/${results.length} passed; no real native services or artifacts used.`);
  if(failed.length)process.exitCode=1;
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

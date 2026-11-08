// npm ci, then node test/ui-smoke.mjs. Uses installed Chrome, no browser download.
import {chromium} from 'playwright-core';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
const server=createApp();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915},deviceScaleFactor:1,isMobile:true});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('[data-action=add-task]').waitFor();
  await page.locator('[data-action=add-task]').click();await page.locator('[name=name]').fill('测试快走');await page.locator('[name=category]').selectOption('有氧');await page.locator('[name=minutes]').fill('25');await page.locator('#modal-form button[type=submit]').click();
  assert.match(await page.locator('body').innerText(),/测试快走/);
  await page.locator('[data-action=toggle]').click();assert.match(await page.locator('body').innerText(),/已完成今天的 1 项安排/);
  await page.locator('[data-tab=food]').click();await page.locator('[data-action=add-food]').click();await page.locator('[name=name]').fill('测试食物');await page.locator('[name=calories]').fill('120');await page.locator('[name=protein]').fill('10');await page.locator('#modal-form button[type=submit]').click();
  await page.locator('[data-action=add-meal]').click();await page.locator('[name=grams]').fill('150');await page.locator('#modal-form button[type=submit]').click();assert.match(await page.locator('body').innerText(),/180/);assert.match(await page.locator('body').innerText(),/15.0/);
  await page.locator('[data-action=food-complete]').click();await page.reload();await page.locator('[data-action=food-complete]').waitFor();assert.match(await page.locator('body').innerText(),/重新标为未记全/);
  await page.locator('[data-tab=training]').click();await page.locator('[data-action=sets]').click();await page.locator('[name=actualMinutes]').fill('25');await page.locator('[name=sets]').fill('20,12\n20,10');await page.locator('#modal-form button[type=submit]').click();assert.match(await page.locator('body').innerText(),/2 组/);
  await page.locator('[data-tab=settings]').click();await page.locator('[name=calories]').fill('2000');await page.locator('[name=protein]').fill('100');await page.locator('#settings-form button[type=submit]').click();
  await page.locator('[data-tab=today]').click();await page.locator('h1').filter({hasText:'把健康'}).waitFor();assert.match(await page.locator('body').innerText(),/低于目标 1820/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/mobile-preview.png',fullPage:true});
  await page.evaluate(()=>localStorage.clear());await page.reload();await page.locator('[data-action=add-task]').waitFor();await page.screenshot({path:'artifacts/mobile-empty.png',fullPage:true});
  console.log('PASS: mobile check-in, food portions, completeness, persistence, set logs, settings and feedback; no overflow or JS exceptions');
} finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

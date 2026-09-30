const {chromium} = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert=require('node:assert/strict');
const base = process.env.BUILDER_URL || 'http://127.0.0.1:8765/';
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const context=await browser.newContext();
    await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/,r=>r.abort());
    const page=await context.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'tests/static-site/');
    await page.waitForFunction(()=>typeof clients!=='undefined' && clients.length>=2 && cur);
    assert.equal(await page.evaluate(()=>diskAvailable),false);
    const alpha=await page.evaluate(()=>clients.find(c=>c.name==='QA Alpha renamed').id);
    await page.locator('#client-select').selectOption(alpha);
    await page.waitForFunction(()=>cur?.config.client.name==='QA Alpha renamed');
    assert.equal(await page.evaluate(()=>cur.config.downloads[0].attachments[0].name),'instructions.pdf');
    await page.locator('#arrange-cards').uncheck();
    await page.waitForFunction(()=>!frontFrame.contentDocument?.querySelector('.admin-card-tools'));
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(400);
    assert(await page.locator('#new-client').isVisible());
    await page.screenshot({path:__dirname+'/artifacts/mobile-editor.png',fullPage:true});
    await page.goto(`${base}tests/static-site/clients/${alpha}/index.html`);
    assert.equal(await page.locator('.admin-card-tools,[draggable=true],#client-select').count(),0);
    assert.equal(await page.locator('#downloads .card').first().locator('h3').innerText(),'Patient instructions');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Client output should fit a phone viewport');
    await page.screenshot({path:__dirname+'/artifacts/mobile-client.png',fullPage:true});
    // Exercise the extracted individual ZIP as an actual hosted page too.
    assert.deepEqual(errors,[]);
    const invalid=await context.request.post(base+'local.php?action=save',{
      headers:{'X-Brand-Builder':'local'},data:{project:{id:'../../invalid',config:{client:{name:'test'}}},html:'<!doctype html><html></html>'}
    });
    assert.equal(invalid.status(),400);
    const foreign=await context.request.post(base+'local.php?action=save',{
      headers:{'X-Brand-Builder':'local',Origin:'https://example.com'},data:{}
    });
    assert.equal(foreign.status(),403);
    console.log('PASS: static GitHub-ready package restores dropdown/projects/assets without PHP; client output fits phone; arrange toggle removes admin controls; invalid save paths/origins rejected.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

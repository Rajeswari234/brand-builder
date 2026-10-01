const {chromium}=require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const context=await browser.newContext({viewport:{width:1500,height:980}});
  await context.route(/fonts.googleapis.com|fonts.gstatic.com/,r=>r.abort());
  // Keep this test isolated from real client projects on disk.
  await context.route('**/local.php?*',r=>r.fulfill({status:503,body:'{"error":"Test browser drafts"}'}));
  await context.route('**/projects/index.json',r=>r.fulfill({contentType:'application/json',body:'[]'}));
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BUILDER_URL || 'http://127.0.0.1:8765/');
  await page.waitForFunction(()=>typeof db!=='undefined' && db);
  await page.locator('#new-client').click();
  await page.locator('input[name=clientName]').fill('Appearance QA');
  await page.getByRole('button',{name:'Create client',exact:true}).click();
  await page.waitForFunction(()=>typeof cur!=='undefined' && cur);
  await page.locator('.background-presets').waitFor();
  assert.equal(await page.locator('.background-presets button').count(),3);
  for(const mode of ['aurora','midnight','brand']) {
   await page.locator('.background-presets [data-v="'+mode+'"]').click();
   await page.waitForFunction(mode=>cur.config.hero.bg===mode,mode);
   await page.waitForFunction(mode=>frontFrame.contentWindow.__BRAND__?.hero.bg===mode,mode);
   assert(await page.evaluate(()=>!!frontFrame.contentDocument.querySelector('.hero-main').getBoundingClientRect().height));
  }
  const picker=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Upload background image',exact:true}).click();
  await (await picker).setFiles({name:'background.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  await page.waitForFunction(()=>cur.config.hero.bg==='image' && cur.config.hero.image && !uploading.size);
  await page.waitForFunction(()=>frontFrame.contentDocument.querySelector('.hero-main').style.background.includes('url('));
  await page.locator('#arrange-cards').uncheck();
  await page.locator('#edit-headings').check();
  await page.waitForFunction(()=>frontFrame.contentDocument.querySelector('#brand h2')?.tabIndex===0);
  await page.frameLocator('iframe:not(.back)').locator('#brand h2').click();
  await page.locator('input[name=heading]').fill('Our purpose <safe>');
  await page.getByRole('button',{name:'Save heading',exact:true}).click();
  await page.waitForFunction(()=>frontFrame.contentDocument.querySelector('#brand h2')?.textContent==='Our purpose <safe>');
  await page.frameLocator('iframe:not(.back)').locator('[data-heading-key="nav:brand"]').click();
  await page.locator('input[name=heading]').fill('Our brand');
  await page.getByRole('button',{name:'Save heading',exact:true}).click();
  await page.waitForFunction(()=>frontFrame.contentDocument.querySelector('[data-heading-key="nav:brand"]')?.textContent==='Our brand');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(()=>typeof cur!=='undefined' && cur?.config.hero.image);
  await page.waitForFunction(()=>frontFrame.contentDocument?.querySelector('#brand h2')?.textContent==='Our purpose <safe>');
  const html=await page.evaluate(async()=>{
   const packed=await packedProject(cur.id,cur.config);
   const restored=await hydrateConfig(packed.config);
   return dashboardDoc(toBrand(restored,ref=>ref ? assetUrl(ref) : ''));
  });
  const client=await context.newPage();
  client.on('pageerror',e=>errors.push(e.message));
  await client.setContent(html);
  assert.equal(await client.locator('#brand h2').textContent(),'Our purpose <safe>');
  assert.equal(await client.locator('#brand h2 safe').count(),0);
  assert.equal(await client.locator('[data-heading-key="nav:brand"]').textContent(),'Our brand');
  assert.equal(await client.locator('.admin-card-tools,#edit-headings,dialog').count(),0);
  await client.setViewportSize({width:390,height:844});
  assert(await client.locator('[data-heading-key="nav:brand"]').isVisible());
  assert(await client.locator('.hero-main').evaluate(n=>n.style.background.includes('url(')));
  await page.locator('#edit-headings').check();
  await page.waitForFunction(()=>frontFrame.contentDocument.querySelector('#brand h2')?.tabIndex===0);
  await page.frameLocator('iframe:not(.back)').locator('#brand h2').click();
  await page.getByRole('button',{name:'Restore default',exact:true}).click();
  await page.waitForFunction(()=>frontFrame.contentDocument.querySelector('#brand h2')?.textContent==='What we stand for');
  await page.setViewportSize({width:390,height:844});
  assert(await page.locator('.background-presets').evaluate(n=>n.getBoundingClientRect().right<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS: three presets, image upload, independent heading edit mode, safe text, restore default, reload and project round-trip, client output, mobile controls.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

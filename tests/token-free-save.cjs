const {chromium}=require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext();
  await context.route(/fonts.googleapis.com|fonts.gstatic.com/,r=>r.abort());
  await context.route('**/local.php?*',r=>r.fulfill({status:503,body:'{"error":"Hosted mode"}'}));
  await context.route('**/projects/index.json',r=>r.fulfill({contentType:'application/json',body:'[]'}));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BUILDER_URL || 'http://127.0.0.1:8765/');
  await page.waitForFunction(()=>typeof db!=='undefined' && db);
  await page.locator('#new-client').click();
  await page.locator('input[name=clientName]').fill('No token client');
  await page.getByRole('button',{name:'Create client',exact:true}).click();
  await page.locator('.background-presets').waitFor();
  await page.locator('[data-path="client.idea"]').fill('Saved without credentials');
  assert.equal(await page.locator('#save-page').textContent(),'Save draft');
  await page.locator('#save-page').click();
  await page.waitForFunction(()=>!projectBusy && document.getElementById('publish-status').textContent.startsWith('Draft saved on this device'));
  assert.equal(await page.locator('.github-dialog').count(),0);
  assert.equal(await page.evaluate(()=>githubReady()),false);
  assert.equal(await page.evaluate(()=>pageSaved(cur.id)),false,'Browser save does not claim to publish');
  assert((await page.locator('#workflow-state').textContent()).includes('Unpublished changes'));
  await page.reload();
  await page.waitForFunction(()=>typeof cur!=='undefined' && cur?.config.client.idea==='Saved without credentials');
  // A failed write must not show the success toast or claim success.
  const failure=await page.evaluate(async()=>{
    const original=db.doc;
    db.doc=path=>({...original(path),set:async()=>{throw Object.assign(new Error('Denied'),{code:'permission_denied'});}});
    try{return await saveClientPage();}finally{db.doc=original;}
  });
  assert.equal(failure,false);
  assert((await page.locator('#publish-status').textContent()).startsWith('Draft not saved:'));
  assert.equal(await page.locator('.github-dialog').count(),0);
  await page.locator('#save-page').click();
  await page.waitForFunction(()=>!projectBusy && !dirty);
  assert.equal(await page.locator('#save-page').textContent(),'Save draft');
  assert.deepEqual(errors,[]);
  console.log('PASS: token-free explicit save, reload persistence, honest unpublished status, storage failure handling, retry without token dialog.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

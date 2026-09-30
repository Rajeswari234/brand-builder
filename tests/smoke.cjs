const {chromium} = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.BUILDER_URL || 'http://127.0.0.1:8765/';
(async () => {
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  const context = await browser.newContext({viewport:{width:1500,height:980},acceptDownloads:true});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  // Fonts are not necessary for functional tests, and should not delay them offline.
  await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, route=>route.abort());
  const created = [];
  try {
    await page.goto(base);
    console.log('Browser loaded');
    await page.waitForFunction(()=>typeof db !== 'undefined' && db && diskAvailable);
    await page.locator('#new-client').click();
    await page.locator('dialog input[name=clientName]').fill('QA Alpha');
    await page.getByRole('button',{name:'Create client',exact:true}).click();
    await page.waitForFunction(()=>typeof cur !== 'undefined' && cur && publishedClients.has(cur.id) && !projectBusy);
    console.log('Client saved');
    const alpha = await page.evaluate(()=>cur.id); created.push(alpha);
    assert.equal(await page.locator('#client-select option:checked').innerText(),'QA Alpha');
    await page.waitForFunction(()=>frontFrame.contentDocument?.querySelector('.admin-card-tools'));
    // Upload actual bytes through the existing attachment pipeline.
    await page.evaluate(async()=>{
      addResourceCard();
      const i=cur.config.downloads.length-1;
      cur.config.downloads[i].title='Patient instructions';
      cur.config.downloads[i].url='https://drive.google.com/file/d/example/view';
      changed(); renderPanel();
      const transfer = new DataTransfer();
      transfer.items.add(new File(['%PDF-1.4\nQA content\n%%EOF'],'instructions.pdf',{type:'application/pdf'}));
      document.querySelector(`[data-drop="dl:${i}"]`).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    });
    await page.waitForFunction(()=>uploading.size===0);
    // Exercise actual drag handlers in the admin iframe.
    let front = page.frameLocator('iframe:not(.back)');
    await front.locator('[data-card-list="logos"][data-card-index="0"] .admin-card-tools').dragTo(front.locator('[data-card-list="logos"][data-card-index="2"]'));
    await page.waitForFunction(()=>cur.config.logos[2].kind==='primary');
    await page.waitForFunction(()=>frontFrame.contentDocument?.querySelector('[data-layout-grid="logo:1"] .admin-card-tools'));
    front=page.frameLocator('iframe:not(.back)');
    await front.locator('[data-layout-grid="logo:1"] > [data-layout-card="0"] .admin-card-tools button[title="Move later"]').click();
    await page.waitForFunction(()=>cur.config.gridOrders?.['logo:1']?.[0]===1);
    await page.evaluate(()=>moveCard('downloads',cur.config.downloads.length-1,0));
    await page.locator('#save-page').click();
    await page.waitForFunction(()=>!projectBusy && document.getElementById('publish-status').textContent.startsWith('Saved QA Alpha'));
    await page.reload();
    await page.waitForFunction(()=>typeof cur!=='undefined' && cur && cur.config.client.name==='QA Alpha');
    assert.equal(await page.evaluate(()=>cur.config.downloads[0].title),'Patient instructions');
    assert.equal(await page.evaluate(()=>cur.config.logos[2].kind),'primary');
    console.log('Upload and drag persisted');
    const client = await context.newPage();
    client.on('pageerror',e=>errors.push(e.message));
    await client.goto(base+`clients/${alpha}/index.html`);
    assert.equal(await client.locator('.admin-card-tools, #client-select, #save-page, [draggable="true"]').count(),0);
    assert.equal(await client.locator('#downloads .card').first().locator('h3').innerText(),'Patient instructions');
    assert.equal(await client.locator('a[href="https://drive.google.com/file/d/example/view"]').count(),1);
    const downloadPromise=client.waitForEvent('download');
    await client.locator('#downloads .card').first().getByRole('link',{name:'Download',exact:true}).click();
    const download=await downloadPromise;
    assert.equal(download.suggestedFilename(),'instructions.pdf');
    assert.match(fs.readFileSync(await download.path(),'utf8'),/QA content/);
    assert.deepEqual(await client.locator('#main > section').evaluateAll(els=>els.map(e=>e.id).slice(0,4)),['welcome','brand','logo','downloads']);
    assert.deepEqual(await client.locator('[data-layout-grid="logo:1"] > [data-layout-card]').evaluateAll(els=>els.map(e=>e.dataset.layoutCard)),['1','0','2']);
    await client.close();
    console.log('Client PDF downloaded');
    // Rename preserves URL and creates no duplicate client.
    await page.locator('[data-path="client.name"]').fill('QA Alpha renamed');
    await page.locator('#save-page').click();
    await page.waitForFunction(()=>!projectBusy);
    assert.equal(await page.evaluate(()=>cur.id),alpha);
    await page.locator('#new-client').click();
    await page.locator('dialog input').fill('QA Beta');
    await page.getByRole('button',{name:'Create client',exact:true}).click();
    await page.waitForFunction(()=>cur?.config.client.name==='QA Beta' && publishedClients.has(cur.id) && !projectBusy);
    const beta=await page.evaluate(()=>cur.id); created.push(beta);
    await page.locator('#client-select').selectOption(alpha);
    await page.waitForFunction(()=>cur?.config.client.name==='QA Alpha renamed');
    // Validate portable exports using the actual Save file dialog.
    const output=path.join(__dirname,'artifacts'); fs.mkdirSync(output,{recursive:true});
    for(const [action,name] of [['exportHtml','client.html'],['exportZip','client.zip'],['exportAllPages','all-pages.zip']]) {
      await page.evaluate(async action=>{ await window[action](); },action);
      await page.locator('#save-dialog').waitFor({state:'visible',timeout:5000});
      const event=page.waitForEvent('download');
      await page.locator('#save-link').click();
      const file=await event;
      await file.saveAs(path.join(output,name));
      await page.waitForTimeout(350);
    }
    const exported=fs.readFileSync(path.join(output,'client.html'),'utf8');
    assert(!exported.includes('admin-card-tools'));
    assert(exported.includes('data:application/pdf;base64,'));
    // Fresh browser restores all saved clients and attachment data from local files.
    const fresh=await browser.newContext();
    await fresh.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/,r=>r.abort());
    const other=await fresh.newPage(); await other.goto(base);
    await other.waitForFunction(()=>typeof clients!=='undefined' && clients.length>=2);
    await other.locator('#client-select').selectOption(alpha);
    await other.waitForFunction(()=>cur?.config.client.name==='QA Alpha renamed');
    assert.equal(await other.evaluate(()=>cur.config.downloads[0].attachments[0].name),'instructions.pdf');
    await fresh.close();
    await page.screenshot({path:path.join(output,'editor.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: named clients, disk save/reload, drag reorder, PDF download, Drive link, rename, client isolation, HTML/ZIP/all-page exports, fresh-browser restore.');
  } finally {
    for(const id of created) await context.request.post(base+'local.php?action=delete',{headers:{'X-Brand-Builder':'local'},data:{id}});
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});

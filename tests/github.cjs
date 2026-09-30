// GitHub publishing against an in-memory fake of the GitHub API and GitHub Pages. No real repository is used.
const {chromium} = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const base = process.env.BUILDER_URL || 'http://127.0.0.1:8765/';
const REPO = 'tester/brand-builder', TOKEN = 'test-token-not-real', SITE = 'https://tester.github.io/brand-builder/';

function fakeGithub() {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const stats = {commits: 0, blobUploads: 0};
  const id = () => crypto.randomBytes(20).toString('hex');
  const blobSha = bytes => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
  const addBlob = bytes => { const sha = blobSha(bytes); blobs.set(sha, bytes); return sha; };
  const rootTree = id(); trees.set(rootTree, new Map([['README.md', addBlob(Buffer.from('# test'))]]));
  let head = id(); commits.set(head, {tree: rootTree});
  const files = () => trees.get(commits.get(head).tree);
  const read = path => files().has(path) ? blobs.get(files().get(path)).toString('utf8') : null;
  async function handle(route) {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (status, body) => route.fulfill({status, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify(body)});
    if (method === 'OPTIONS') return route.fulfill({status: 204, headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'}});
    if (request.headers().authorization !== `Bearer ${TOKEN}`) return json(401, {message: 'Bad credentials'});
    const path = url.pathname.replace(`/repos/${REPO}`, '');
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    let m;
    if (path === '' && method === 'GET') return json(200, {full_name: REPO, private: false, permissions: {push: true}});
    if (path === '/git/ref/heads/main') return json(200, {object: {sha: head}});
    if ((m = path.match(/^\/git\/commits\/(\w+)$/))) return json(200, {sha: m[1], tree: {sha: commits.get(m[1]).tree}});
    if ((m = path.match(/^\/git\/trees\/(\w+)$/))) return json(200, {tree: [...trees.get(m[1])].map(([p, sha]) => ({path: p, type: 'blob', sha}))});
    if ((m = path.match(/^\/git\/blobs\/(\w+)$/))) return json(200, {content: blobs.get(m[1]).toString('base64')});
    if (path === '/git/blobs' && method === 'POST') { stats.blobUploads++; return json(201, {sha: addBlob(Buffer.from(body.content, 'base64'))}); }
    if (path === '/git/trees' && method === 'POST') {
      const tree = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) entry.sha === null ? tree.delete(entry.path) : tree.set(entry.path, entry.sha);
      const sha = id(); trees.set(sha, tree); return json(201, {sha});
    }
    if (path === '/git/commits' && method === 'POST') { const sha = id(); commits.set(sha, {tree: body.tree, parent: body.parents[0]}); return json(201, {sha}); }
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      if (commits.get(body.sha).parent !== head) return json(422, {message: 'Update is not a fast forward'});
      head = body.sha; stats.commits++; return json(200, {object: {sha: head}});
    }
    if ((m = path.match(/^\/contents\/(.+)$/))) {
      const file = decodeURIComponent(m[1]);
      return files().has(file) ? json(200, {sha: files().get(file), content: blobs.get(files().get(file)).toString('base64')}) : json(404, {message: 'Not Found'});
    }
    return json(404, {message: 'Unhandled ' + method + ' ' + path});
  }
  // GitHub Pages serves the current branch.
  async function pages(route) {
    let file = new URL(route.request().url()).pathname.replace('/brand-builder/', '');
    if (!file || file.endsWith('/')) file += 'index.html';
    const text = read(file);
    return text === null ? route.fulfill({status: 404, headers: {'Access-Control-Allow-Origin': '*'}, body: 'Not found'})
      : route.fulfill({status: 200, headers: {'Access-Control-Allow-Origin': '*'}, contentType: file.endsWith('.json') ? 'application/json' : 'text/html', body: text});
  }
  return {handle, pages, files, read, stats};
}

(async () => {
  const gh = fakeGithub();
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  let clientId;
  const newContext = async () => {
    const context = await browser.newContext({viewport: {width: 1500, height: 980}, permissions: ['clipboard-read', 'clipboard-write']});
    await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, route => route.abort());
    await context.route('https://api.github.com/**', gh.handle);
    await context.route(SITE + '**', gh.pages);
    return context;
  };
  try {
    const context = await newContext();
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => typeof db !== 'undefined' && db && diskAvailable);
    await page.locator('#new-client').click();
    await page.locator('dialog input[name=clientName]').fill('QA GitHub');
    await page.getByRole('button', {name: 'Create client', exact: true}).click();
    await page.waitForFunction(() => cur && publishedClients.has(cur.id) && !projectBusy);
    clientId = await page.evaluate(() => cur.id);
    assert.equal(gh.stats.commits, 0, 'Nothing is published before GitHub is connected');

    // A wrong token is rejected and not stored.
    await page.locator('#github-settings').click();
    await page.locator('dialog input[name=repo]').fill(REPO);
    await page.locator('dialog input[name=token]').fill('wrong-token');
    await page.getByRole('button', {name: 'Connect', exact: true}).click();
    await page.locator('.github-result', {hasText: 'rejected the access token'}).waitFor();
    assert.equal(await page.evaluate(() => githubReady()), false);
    await page.locator('dialog input[name=token]').fill(TOKEN);
    await page.getByRole('button', {name: 'Connect', exact: true}).click();
    await page.waitForFunction(() => githubReady() && !document.querySelector('.github-dialog'));
    assert.match(await page.locator('#github-settings').innerText(), /GitHub · brand-builder/);
    assert.equal(await page.locator('#save-page').innerText(), 'Save & publish');
    assert(await page.locator('#save-page.needs-save').count() === 1, 'An unpublished client is marked');

    // Publish: one commit with the page, the project, the index, and the editor files.
    await page.locator('#save-page').click();
    await page.waitForFunction(() => !projectBusy && document.getElementById('publish-status').textContent.startsWith('Saved QA GitHub · published'));
    assert.equal(gh.stats.commits, 1);
    for (const file of [`projects/${clientId}.json`, `clients/${clientId}/index.html`, 'projects/index.json', 'index.html', 'builder.js', 'builder.css', 'github.js', '.nojekyll'])
      assert(gh.files().has(file), `Published ${file}`);
    assert.deepEqual(JSON.parse(gh.read('projects/index.json')).map(e => e.name), ['QA GitHub']);
    for (const [file] of gh.files()) assert(!gh.read(file).includes(TOKEN), `The token must never be committed (${file})`);
    assert(!gh.read(`clients/${clientId}/index.html`).includes('github.js'), 'Client pages do not load the editor');

    // Pages "deploys", the live link appears, and Copy page link copies it.
    await page.waitForFunction(() => document.getElementById('publish-status').textContent === 'Live page up to date', null, {timeout: 20000});
    const live = `${SITE}clients/${clientId}/`;
    assert.equal(await page.locator('#live-link').getAttribute('href'), live);
    await page.locator('#copy-page').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), live);

    // An edit marks the page, and republishing uploads only what changed.
    await page.locator('[data-path="client.name"]').fill('QA GitHub edited');
    await page.waitForFunction(() => document.querySelector('#save-page.needs-save'));
    const uploads = gh.stats.blobUploads;
    await page.locator('#save-page').click();
    await page.waitForFunction(() => !projectBusy && document.getElementById('publish-status').textContent.startsWith('Saved QA GitHub edited'));
    assert.equal(gh.stats.commits, 2);
    assert.equal(gh.stats.blobUploads - uploads, 3, 'Only the project, page, and index change');
    // The hosted editor is already current, so updating it makes no commit.
    await page.locator('#github-settings').click();
    await page.getByRole('button', {name: 'Update hosted editor'}).click();
    await page.locator('.github-result', {hasText: 'already up to date'}).waitFor();
    assert.equal(gh.stats.commits, 2);
    await context.close();

    // Another browser with no drafts and no local copy restores the client from GitHub.
    await (await browser.newContext()).request.post(base + 'local.php?action=delete', {headers: {'X-Brand-Builder': 'local'}, data: {id: clientId}});
    const fresh = await newContext();
    await fresh.addInitScript(([repo, token]) => localStorage.setItem('bb-github', JSON.stringify({repo, branch: 'main', token})), [REPO, TOKEN]);
    const other = await fresh.newPage();
    other.on('pageerror', e => errors.push(e.message));
    await other.goto(base);
    await other.waitForFunction(id => typeof clients !== 'undefined' && clients.some(c => c.id === id), clientId);
    await other.locator('#client-select').selectOption(clientId);
    await other.waitForFunction(() => cur?.config.client.name === 'QA GitHub edited');
    assert.equal(await other.locator('#live-link').getAttribute('href'), live);

    // Deleting the client removes it from the repository too.
    await other.evaluate(async () => { await deleteClient(); await deleteClient(); });
    await other.waitForFunction(id => !clients.some(c => c.id === id), clientId);
    assert(!gh.files().has(`projects/${clientId}.json`) && !gh.files().has(`clients/${clientId}/index.html`));
    assert.deepEqual(JSON.parse(gh.read('projects/index.json')), []);
    clientId = null;
    assert.deepEqual(errors, []);
    console.log('PASS: connect (bad token rejected), publish in one commit, token never committed, live link + copy, changed-files-only republish, restore from GitHub in a fresh browser, delete removes from repo.');
  } finally {
    if (clientId) await (await browser.newContext()).request.post(base + 'local.php?action=delete', {headers: {'X-Brand-Builder': 'local'}, data: {id: clientId}});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

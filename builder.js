/* Local editor tools. This file is never included in a client HTML export. */
let diskAvailable = false;
let projectBusy = false;
const publishedClients = new Set();
// Clients whose browser draft has edits that are not in the saved client page yet.
const stalePages = new Set();
let editGeneration = 0;
// Clients committed to GitHub whose Pages deploy has not been seen live yet.
const deployingPages = new Set();
let arrangeCards = true;
let editHeadings = false;

function initializeBuilderTools() {
  const tools = document.createElement('div');
  tools.className = 'builder-tools';
  tools.innerHTML = `<button type="button" class="btn primary" id="save-page">Save client page</button>
    <button type="button" class="btn" id="open-page">View client page</button>
    <button type="button" class="btn" id="copy-page">Copy page link</button>
    <button type="button" class="btn" id="export-site">Export all pages (.zip)</button>
    <button type="button" class="btn" id="github-settings">Connect GitHub</button>
    <label><input type="checkbox" id="arrange-cards" checked> Arrange cards</label>
    <label><input type="checkbox" id="edit-headings"> Edit headings</label>
    <a id="live-link" class="page-link" target="_blank" rel="noopener" hidden></a>
    <small id="publish-status">Browser drafts · checking local project storage…</small>`;
  document.querySelector('.top').after(tools);
  document.getElementById('save-page').onclick = () => saveClientPage();
  document.getElementById('open-page').onclick = () => openClientPage();
  document.getElementById('copy-page').onclick = () => copyClientPage();
  document.getElementById('export-site').onclick = () => exportAllPages();
  document.getElementById('github-settings').onclick = () => requestGithubSettings();
  refreshGithubControls();
  document.getElementById('edit-headings').onchange = e => { editHeadings = e.target.checked; refreshPreview(); };
  document.getElementById('arrange-cards').onchange = e => {
    arrangeCards = e.target.checked;
    refreshPreview();
  };
  initializeWorkflow();
}

function markPageStale() {
  if (!cur) return;
  editGeneration++;
  stalePages.add(cur.id);
  updatePageState();
  updateWorkflowStatus();
}

// With GitHub connected, "saved" means published to the repository; otherwise saved on disk.
const pageSaved = id => githubReady() ? livePages.has(id) : publishedClients.has(id);

function updatePageState() {
  updateWorkflowStatus();
  const button = document.getElementById('save-page');
  const link = document.getElementById('live-link');
  if (link) {
    const live = cur && githubReady() && livePages.has(cur.id);
    link.hidden = !live;
    if (live) { link.href = liveClientUrl(cur.id); link.textContent = liveClientUrl(cur.id); link.title = 'Live client link'; }
  }
  if (!(diskAvailable || githubReady()) || !cur || !button || projectBusy) return;
  const saved = pageSaved(cur.id);
  const stale = !saved || stalePages.has(cur.id);
  const where = githubReady() ? 'published' : 'saved';
  button.classList.toggle('needs-save', stale);
  button.title = stale ? 'The client page does not include your latest changes yet' : 'The client page is up to date';
  projectStatus(!saved ? `Client page not ${where} yet · drafts autosave in this browser`
    : stale ? `Changes not ${where} yet · ${githubReady() ? 'Save & publish' : 'Save client page'} to update the page`
    : deployingPages.has(cur.id) ? 'Published · GitHub Pages is updating the live page (usually 1–2 minutes)…'
    : githubReady() ? 'Live page up to date' : `Client page up to date · clients/${cur.id}/`);
}

function projectStatus(message) {
  updateWorkflowStatus();
  const el = document.getElementById('publish-status');
  if (el) el.textContent = message;
}

async function localRequest(action, body) {
  const response = await fetch(`local.php?action=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-Brand-Builder': 'local' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Local save failed.');
  return result;
}

async function loadSavedProjects() {
  let projects = [];
  const onLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (onLocalHost) {
    try {
      const result = await localRequest('list');
      diskAvailable = true;
      projects = result.projects;
    } catch (error) {
      projectStatus('Browser drafts only · local file storage unavailable');
    }
  }
  // A GitHub-ready package has the same projects in static JSON, with no backend.
  if (!diskAvailable && location.protocol !== 'file:') {
    try {
      const response = await fetch('projects/index.json', { cache: 'no-store' });
      if (response.ok) {
        const entries = await response.json();
        for (const entry of entries) {
          if (!/^c[a-z0-9]+$/.test(entry.id)) continue;
          const res = await fetch(`projects/${entry.id}.json`, { cache: 'no-store' });
          if (res.ok) projects.push(await res.json());
        }
      }
    } catch { projectStatus('Saved repository projects could not be loaded'); }
  }
  if (githubReady()) {
    try {
      // The repository is the shared copy; the newest version of each client wins.
      const newest = new Map(projects.map(project => [project.id, project]));
      for (const project of await githubProjects()) {
        const other = newest.get(project.id);
        if (other && String(other.updatedAt) > String(project.updatedAt)) stalePages.add(project.id);
        if (!other || String(project.updatedAt) > String(other.updatedAt)) newest.set(project.id, project);
      }
      projects = [...newest.values()];
    } catch (error) {
      projectStatus('GitHub projects could not be loaded · ' + error.message);
    }
  }
  for (const project of projects) {
    if (!/^c[a-z0-9]+$/.test(project.id) || !project.config) continue;
    if (diskAvailable || !githubReady()) publishedClients.add(project.id);
    const existing = await db.doc('clients/' + project.id).get();
    if (existing.exists && String(existing.data().updatedAt) >= String(project.updatedAt)) {
      // A newer browser draft is kept; flag it so it is not mistaken for the saved page.
      if (String(existing.data().updatedAt) > String(project.updatedAt)) stalePages.add(project.id);
      continue;
    }
    const cfg = await hydrateConfig(project.config);
    await db.doc('clients/' + project.id).set({
      name: cfg.client.name, config: cfg, updatedAt: project.updatedAt, rev: project.rev
    });
  }
  projectStatus(githubReady() ? `Drafts autosave in browser · Save & publish updates ${github.repo}`
    : diskAvailable ? 'Drafts autosave in browser · Save client page writes local files'
    : 'Browser drafts · Connect GitHub to publish client pages');
  updatePageState();
}

async function hydrateConfig(config) {
  return mapRefs(normalize(clone(config)), async ref => {
    if (!ref.data) return ref;
    const response = await fetch(ref.data);
    const blob = await response.blob();
    return uploadBlob(new File([blob], ref.name || 'file', { type: ref.type || blob.type }));
  });
}

async function packedProject(id, config, updatedAt) {
  const cfg = await mapRefs(clone(config), async ref => ({
    name: ref.name, type: ref.type, size: ref.size,
    data: ref.data || await toDataUrl(assetUrl(ref))
  }));
  return { kind: 'brand-builder-project', version: 1, id,
    name: cfg.client.name, updatedAt: updatedAt || new Date().toISOString(),
    rev: crypto.randomUUID(), config: cfg };
}

function projectHtml(project) {
  return dashboardDoc(toBrand(project.config, ref => ref ? ref.data || '' : ''));
}

async function saveClientPage() {
  if (!cur) { toast('Create a client first'); return false; }
  if (projectBusy || workflowBusy || uploading.size) { toast('Please wait for the current save or upload to finish'); return false; }
  if (!diskAvailable && !githubReady()) {
    await saveSoon.flush();
    toast('Draft saved in this browser. Connect GitHub to publish the client page.', 5000);
    requestGithubSettings();
    return false;
  }
  projectBusy = true;
  updateWorkflowStatus();
  const id = cur.id, config = clone(cur.config), generation = editGeneration;
  const button = document.getElementById('save-page');
  button.disabled = true; button.textContent = 'Saving page…';
  let savedLocally = false;
  try {
    await saveSoon.flush();
    const project = await packedProject(id, config);
    const html = projectHtml(project);
    if (diskAvailable) {
      await localRequest('save', { project, html });
      publishedClients.add(id);
      savedLocally = true;
    }
    if (githubReady()) {
      button.textContent = 'Publishing…';
      projectStatus(`Publishing ${project.name} to ${github.repo}…`);
      await publishClientToGithub(project, html);
      deployingPages.add(id);
      watchUntilLive(project).then(() => { deployingPages.delete(id); updatePageState(); });
    }
    // Edits made while saving are not in this page, so they keep the client marked.
    if (editGeneration === generation) stalePages.delete(id);
    projectStatus(githubReady() ? `Saved ${project.name} · published, GitHub Pages is updating the live page…`
      : `Saved ${project.name} · clients/${id}/`);
    document.getElementById('save-page').classList.toggle('needs-save', stalePages.has(id));
    toast(githubReady() ? 'Published to GitHub. The live link updates in about a minute.' : 'Client project and page saved on this computer', 5000);
    await saveVersion(id, config, githubReady() ? 'Published page' : 'Saved client page').catch(() => toast('Page saved, but a history checkpoint could not be stored.'));
    return true;
  } catch (error) {
    const message = savedLocally ? 'Saved on this computer, but not published · ' + error.message : 'Page not saved · ' + error.message;
    projectStatus(message);
    toast(message, 7000);
    return false;
  } finally {
    projectBusy = false;
    updateWorkflowStatus();
    button.disabled = false;
    refreshGithubControls();
    const link = document.getElementById('live-link');
    if (link && cur) { const live = githubReady() && livePages.has(cur.id); link.hidden = !live; if (live) { link.href = link.textContent = liveClientUrl(cur.id); } }
  }
}

// The live GitHub Pages link once published; otherwise the page saved on this computer.
function clientPageUrl() {
  if (!cur) return '';
  if (githubReady() && livePages.has(cur.id)) return liveClientUrl(cur.id);
  return new URL(`clients/${cur.id}/index.html`, location.href).href;
}
function openClientPage() {
  if (!cur || !(publishedClients.has(cur.id) || livePages.has(cur.id))) { toast('Save this client page first'); return; }
  window.open(clientPageUrl(), '_blank', 'noopener');
}
async function copyClientPage() {
  if (!cur || !(publishedClients.has(cur.id) || livePages.has(cur.id))) { toast('Save this client page first'); return; }
  const url = clientPageUrl();
  const live = url.startsWith(githubSiteUrl() || '-');
  try {
    await navigator.clipboard.writeText(url);
    toast(live ? (deployingPages.has(cur.id) ? 'Live link copied. The latest changes appear there within a minute or two.' : 'Live client link copied. You can send it to the client.')
      : diskAvailable ? 'Local preview link copied. Connect GitHub to get a link clients can open.' : 'Client page link copied', 5000);
  } catch { window.prompt('Copy this client page link', url); }
}

function requestNewClient(template = null) {
  if (workflowBusy) { toast("Wait for the current operation to finish"); return; }
  if (projectBusy || uploading.size) { toast('Please wait for the current save or upload'); return; }
  const dialog = document.createElement('dialog');
  dialog.className = 'local-dialog';
  dialog.innerHTML = `<form><h2>New client</h2><p>Each client has its own files, layout, and permanent page address.</p>
    <label>Client name<input name="clientName" required maxlength="120" autocomplete="off" placeholder="e.g. Acme Healthcare"></label>
    <footer><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Create client</button></footer></form>`;
  document.body.append(dialog);
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const name = dialog.querySelector('input').value.trim();
    if (!name) return;
    const submit = dialog.querySelector('[type=submit]');
    submit.disabled = true; workflowBusy = true;
    let created = false;
    try {
      const cfg = template ? await hydrateConfig(template.config) : defaultConfig();
      if (!dialog.open) return;
      cfg.client.name = name; cfg.client.fullName = name;
      cfg.client.slug = safe(name).toUpperCase() || 'CLIENT';
      if (!template) cfg.resourcePlacement = 'after-logo';
      else { cfg.client.deliveredOn = defaultConfig().client.deliveredOn; cfg.client.version = 'v1.0'; }
      await createClient(cfg);
      created = true; dialog.close();
    } catch(error) { toast('Client could not be created: ' + error.message); }
    finally { workflowBusy = false; submit.disabled = false; updateWorkflowStatus(); }
    if (created && githubReady()) showPublishChecklist(true);
    else if (created && diskAvailable) await saveClientPage();
  };
  dialog.showModal(); dialog.querySelector('input').focus();
}

const CARD_LISTS = ['logos', 'backgrounds', 'templates', 'downloads'];
const CARD_SIZES = [['', 'Normal'], ['2', 'Wide'], ['full', 'Full row']];

function sizeSelect(value) {
  return `<select title="Card size" aria-label="Card size" draggable="false">${CARD_SIZES.map(([v, label]) =>
    `<option value="${v}"${v === (value || '') ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
}

// List cards keep their size on the item, so it follows the card when it moves.
function setCardSize(list, index, size) {
  const item = cur?.config[list]?.[index];
  if (!item || projectBusy || uploading.size) return;
  if (size) item.span = size; else delete item.span;
  changed();
}

// Fixed cards (examples, info) are keyed by grid and original position, like gridOrders.
function setLayoutSize(key, size) {
  if (!cur || projectBusy || uploading.size) return;
  cur.config.cardSizes ||= {};
  if (size) cur.config.cardSizes[key] = size; else delete cur.config.cardSizes[key];
  changed();
}

// Default logos stay; custom logos and every background card can be removed.
const removableCard = (list, item) => list === 'backgrounds' || (list === 'logos' && item?.kind === 'custom');

function addCard(list) {
  if (!cur || projectBusy || uploading.size) { toast('Wait for uploads and saves before adding cards'); return; }
  cur.config[list].push(NEW_ITEMS[list]());
  renderPanel(); changed();
  // Show the new card's fields in the editor panel.
  document.querySelector(`#s-logo [data-act="add"][data-list="${list}"]`)?.scrollIntoView({ block: 'center' });
}

function removeCard(list, index) {
  if (!cur || projectBusy || uploading.size) { toast('Wait for uploads and saves before removing cards'); return; }
  if (!removableCard(list, cur.config[list][index])) return;
  cur.config[list].splice(index, 1);
  renderPanel(); changed();
}

function moveCard(list, from, to) {
  if (!cur || projectBusy || uploading.size) { toast('Wait for uploads and saves before moving cards'); return; }
  const cards = cur.config[list];
  if (!CARD_LISTS.includes(list) || !Array.isArray(cards) || from === to || from < 0 || to < 0 || to >= cards.length) return;
  cards.splice(to, 0, cards.splice(from, 1)[0]);
  renderPanel(); changed();
}

function addResourceCard() {
  if (!cur || uploading.size) return;
  const suffix = crypto.randomUUID().slice(0, 8);
  cur.config.downloads.push({ kind: 'other', folder: `09_Resources-${suffix}`, title: 'New resource',
    desc: '', formats: [], files: 0, url: '', hidden: false, attachments: [] });
  renderPanel(); changed();
  document.querySelector('#s-downloads .card:last-of-type')?.scrollIntoView({ block:'center' });
}

function enhancePanel() {
  const section = document.getElementById('s-downloads');
  if (!section || !cur) return;
  const note = document.createElement('div');
  note.className = 'arrange-note';
  note.innerHTML = `<b>Files and resource cards</b><p>Drop PDFs, templates, or other files into a card, or paste a shared Drive link. Drag cards in the right preview to reorder them. Clients receive only the finished page.</p>
    <label>Show downloads <select id="resource-placement"><option value="after-logo">After Logo</option><option value="downloads">Near the end</option></select></label>
    <button class="btn" type="button" id="add-resource">+ Add resource card</button>`;
  section.querySelector('header').after(note);
  const select = note.querySelector('select');
  select.value = cur.config.resourcePlacement || 'downloads';
  select.onchange = () => { cur.config.resourcePlacement = select.value; changed(); };
  note.querySelector('button').onclick = addResourceCard;
  section.querySelectorAll(':scope > .card').forEach((card, i) => {
    const bar = document.createElement('div');
    bar.className = 'resource-controls';
    bar.innerHTML = `<button class="btn" type="button" ${i === 0 ? 'disabled' : ''}>↑ Move up</button><button class="btn" type="button" ${i === cur.config.downloads.length-1 ? 'disabled' : ''}>↓ Move down</button><button class="btn" type="button">Duplicate</button><button class="btn" type="button">${cur.config.downloads[i].kind === 'other' ? 'Remove' : 'Hide'}</button>`;
    const buttons = bar.querySelectorAll('button');
    buttons[0].onclick = () => moveCard('downloads', i, i - 1);
    buttons[1].onclick = () => moveCard('downloads', i, i + 1);
    buttons[2].onclick = () => {
      const copy = clone(cur.config.downloads[i]);
      copy.kind = 'other'; copy.title += ' copy'; copy.folder = '09_Resources-' + crypto.randomUUID().slice(0,8);
      cur.config.downloads.splice(i+1, 0, copy); renderPanel(); changed();
    };
    buttons[3].onclick = () => {
      if (uploading.size) { toast('Wait for uploads to finish'); return; }
      if (cur.config.downloads[i].kind === 'other') cur.config.downloads.splice(i, 1);
      else cur.config.downloads[i].hidden = true;
      renderPanel(); changed();
    };
    card.prepend(bar);
  });
}

function enhancePreview(frame) {
  const previewDoc = frame.contentDocument;
  if (previewDoc && !previewDoc._workflowKeys) { previewDoc._workflowKeys = true; previewDoc.addEventListener('keydown', workflowShortcut); }
  if (clientView) return;
  enhanceHeadingEditor(frame);
  if (!arrangeCards) return;
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('.admin-card-tools,.admin-add-card,style[data-admin-style]').forEach(node=>node.remove());
  const style = doc.createElement('style');
  style.dataset.adminStyle = 'true';
  style.textContent = `.admin-card-tools{display:flex;gap:6px;align-items:center;padding:7px 9px;background:#fff4e8;color:#9a3412;font:12px system-ui;border-bottom:1px dashed #fdba74;cursor:grab}.admin-card-tools button{font:inherit;padding:3px 7px;cursor:pointer;background:white;border:1px solid #fdba74;border-radius:4px;color:#9a3412}.admin-card-tools span{margin-right:auto;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.admin-card-tools select{font:inherit;padding:2px 4px;background:white;border:1px solid #fdba74;border-radius:4px;color:#9a3412;cursor:pointer}[data-card-list].drop-target{outline:3px solid #f97316;outline-offset:3px}.admin-add-card{margin:14px 0;padding:10px;background:#fff4e8;border:1px dashed #f97316;border-radius:8px;color:#9a3412;cursor:pointer}`;
  doc.head.append(style);
  let dragging = null;
  doc.querySelectorAll('[data-card-list]').forEach(card => {
    const list = card.dataset.cardList, index = Number(card.dataset.cardIndex);
    const item = cur.config[list]?.[index];
    const bar = doc.createElement('div');
    bar.className = 'admin-card-tools'; bar.draggable = true;
    bar.innerHTML = `<span>⠿ Drag to move</span>${sizeSelect(item?.span)}<button type="button" title="Move earlier" ${index === 0 ? 'disabled' : ''}>←</button><button type="button" title="Move later" ${index === cur.config[list].length-1 ? 'disabled' : ''}>→</button>${removableCard(list, item) ? '<button type="button" title="Remove card" data-remove>×</button>' : ''}`;
    bar.querySelectorAll('button')[0].onclick = () => moveCard(list,index,index-1);
    bar.querySelectorAll('button')[1].onclick = () => moveCard(list,index,index+1);
    bar.querySelector('select').onchange = e => setCardSize(list, index, e.target.value);
    const remove = bar.querySelector('[data-remove]');
    if (remove) remove.onclick = () => removeCard(list, index);
    bar.addEventListener('dragstart', e => {
      dragging = {list,index}; e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-brand-card', JSON.stringify(dragging));
    });
    bar.addEventListener('dragend', () => { dragging=null; doc.querySelectorAll('.drop-target').forEach(n=>n.classList.remove('drop-target')); });
    card.addEventListener('dragover', e => { if(dragging?.list===list) { e.preventDefault(); card.classList.add('drop-target'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', e => {
      if (dragging?.list !== list) return;
      e.preventDefault(); e.stopPropagation(); moveCard(list,dragging.index,index); dragging=null;
    });
    card.prepend(bar);
  });
  doc.querySelectorAll('[data-layout-grid]').forEach(grid => {
    const cards = [...grid.children];
    const move = (from, to) => {
      if (to < 0 || to >= cards.length || from === to || projectBusy || uploading.size) return;
      const order = cards.map(card=>Number(card.dataset.layoutCard));
      order.splice(to, 0, order.splice(from, 1)[0]);
      cur.config.gridOrders ||= {};
      cur.config.gridOrders[grid.dataset.layoutGrid] = order;
      changed();
    };
    let sourceIndex = null;
    cards.forEach((card,index) => {
      const bar = doc.createElement('div'); bar.className='admin-card-tools'; bar.draggable=true;
      const sizeKey = grid.dataset.layoutGrid + ':' + card.dataset.layoutCard;
      bar.innerHTML=`<span>⠿ Drag to move</span>${sizeSelect(cur.config.cardSizes?.[sizeKey])}<button type="button" title="Move earlier" ${index===0?'disabled':''}>←</button><button type="button" title="Move later" ${index===cards.length-1?'disabled':''}>→</button>`;
      bar.querySelectorAll('button')[0].onclick=()=>move(index,index-1);
      bar.querySelectorAll('button')[1].onclick=()=>move(index,index+1);
      bar.querySelector('select').onchange=e=>setLayoutSize(sizeKey, e.target.value);
      bar.ondragstart=e=>{sourceIndex=index;e.dataTransfer.setData('text/plain','Move card');};
      bar.ondragend=()=>{sourceIndex=null;};
      card.ondragover=e=>{if(sourceIndex!==null)e.preventDefault();};
      card.ondrop=e=>{if(sourceIndex!==null){e.preventDefault();e.stopPropagation();move(sourceIndex,index);sourceIndex=null;}};
      card.prepend(bar);
    });
  });
  if (!doc._adminFilterHook) {
    doc._adminFilterHook = true;
    doc.addEventListener('click',event=>{
      if (event.target.closest('#tpl-filter button')) setTimeout(()=>enhancePreview(frame),0);
    });
  }
  for (const [list, label] of [['logos', '+ Add logo card'], ['backgrounds', '+ Add background card']]) {
    const grid = doc.querySelector(`[data-card-list="${list}"]`)?.parentElement;
    if (!grid) continue;
    const add = doc.createElement('button');
    add.className = 'admin-add-card'; add.textContent = label; add.type = 'button';
    add.onclick = () => addCard(list); grid.after(add);
  }
  const downloadsSection = doc.getElementById('downloads');
  if (downloadsSection) {
    const add = doc.createElement('button');
    add.className = 'admin-add-card'; add.textContent = '+ Add resource card'; add.type = 'button';
    add.onclick = addResourceCard; downloadsSection.append(add);
  }
}

async function exportAllPages() {
  if (!db || projectBusy || uploading.size) { toast('Wait for saves and uploads to finish'); return; }
  projectBusy = true;
  try {
    await saveSoon.flush();
    const zip = new ZipWriter();
    const entries = [];
    for (const client of [...clients]) {
      const snap = await db.doc('clients/' + client.id).get();
      if (!snap.exists) continue;
      const body = snap.data();
      const project = await packedProject(client.id, body.config, body.updatedAt);
      entries.push({id:project.id,name:project.name,updatedAt:project.updatedAt});
      zip.file(`projects/${project.id}.json`, JSON.stringify(project));
      zip.file(`clients/${project.id}/index.html`, projectHtml(project));
    }
    if (!entries.length) throw new Error('Create a client before exporting.');
    zip.file('projects/index.json', JSON.stringify(entries,null,2));
    for (const file of EDITOR_FILES) {
      const response = await fetch(file);
      if (!response.ok) throw new Error('Open the builder using localhost to export the complete site.');
      zip.file(file, await response.text());
    }
    zip.file('.nojekyll','');
    zip.file('README.txt', `Brand Builder — ${entries.length} client pages\n\nUpload this folder to your GitHub repository and enable Pages for the branch/root.\nOpen index.html for the editor. Client pages live at clients/<client-id>/index.html.\nProjects include editable content and embedded uploaded files. Only publish content appropriate for a public repository/site.\nThere are no credentials or local PHP endpoints in this export.\nUse Connect GitHub in the editor to publish each client page to this repository when you save it.\nDrive links still require their sharing permissions and an internet connection.\nKeep a copy of this package as a portable project backup.\n`);
    await saveFile('Brand-Builder-All-Clients.zip', await zip.toBlob());
    projectStatus(`${entries.length} client pages packaged · ready to upload to GitHub`);
  } catch(error) { toast(error.message,5000); }
  finally { projectBusy=false; }
}

// Controls live only in the admin preview; exported pages contain text overrides only.
function enhanceHeadingEditor(frame) {
  const doc = frame.contentDocument;
  if (!doc || !editHeadings) return;
  const style = doc.createElement('style');
  style.textContent = '[data-heading-key]{outline:1px dashed #f97316;outline-offset:3px;cursor:pointer!important}[data-heading-key]:hover,[data-heading-key]:focus{outline:2px solid #f97316}';
  doc.head.append(style);
  doc.querySelectorAll('[data-heading-key]').forEach(node => {
    node.tabIndex = 0;
    node.title = 'Click to rename this heading';
    const open = e => { e.preventDefault(); e.stopPropagation(); editHeading(node); };
    node.addEventListener('click', open);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  });
}

function editHeading(node) {
  if (!cur || projectBusy || uploading.size) { toast('Wait for saves and uploads to finish'); return; }
  const client = cur;
  const key = node.dataset.headingKey;
  const dialog = document.createElement('dialog');
  dialog.className = 'local-dialog';
  dialog.setAttribute('aria-labelledby', 'heading-dialog-title');
  dialog.innerHTML = '<form><h2 id="heading-dialog-title">Rename heading</h2><label class="f"><span>Heading text</span><input name="heading" required maxlength="240"></label><p class="hint">Applies to this client. Save the client page to publish the change.</p><div class="actions"><button type="button" class="btn" data-reset>Restore default</button><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Save heading</button></div></form>';
  const input = dialog.querySelector('input');
  input.value = node.textContent.trim();
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  const save = reset => {
    if (cur !== client || projectBusy || uploading.size) { dialog.close(); return; }
    const value = input.value.trim();
    if (!reset && !value) { input.setCustomValidity('Enter a heading.'); input.reportValidity(); return; }
    client.config.headingOverrides ||= {};
    if (reset) delete client.config.headingOverrides[key];
    else client.config.headingOverrides[key] = value;
    dialog.close();
    changed();
  };
  input.oninput = () => input.setCustomValidity('');
  dialog.querySelector('[data-reset]').onclick = () => save(true);
  dialog.querySelector('form').onsubmit = e => { e.preventDefault(); save(false); };
  dialog.showModal();
  input.focus(); input.select();
}

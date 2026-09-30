/* Local editor tools. This file is never included in a client HTML export. */
let diskAvailable = false;
let projectBusy = false;
const publishedClients = new Set();
let arrangeCards = true;

function initializeBuilderTools() {
  const tools = document.createElement('div');
  tools.className = 'builder-tools';
  tools.innerHTML = `<button type="button" class="btn primary" id="save-page">Save client page</button>
    <button type="button" class="btn" id="open-page">View client page</button>
    <button type="button" class="btn" id="copy-page">Copy page link</button>
    <button type="button" class="btn" id="export-site">Export all pages (.zip)</button>
    <label><input type="checkbox" id="arrange-cards" checked> Arrange cards</label>
    <small id="publish-status">Browser drafts · checking local project storage…</small>`;
  document.querySelector('.top').after(tools);
  document.getElementById('save-page').onclick = () => saveClientPage();
  document.getElementById('open-page').onclick = () => openClientPage();
  document.getElementById('copy-page').onclick = () => copyClientPage();
  document.getElementById('export-site').onclick = () => exportAllPages();
  document.getElementById('arrange-cards').onchange = e => {
    arrangeCards = e.target.checked;
    refreshPreview();
  };
}

function projectStatus(message) {
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
  for (const project of projects) {
    if (!/^c[a-z0-9]+$/.test(project.id) || !project.config) continue;
    publishedClients.add(project.id);
    const existing = await db.doc('clients/' + project.id).get();
    if (existing.exists && String(existing.data().updatedAt) >= String(project.updatedAt)) continue;
    const cfg = await hydrateConfig(project.config);
    await db.doc('clients/' + project.id).set({
      name: cfg.client.name, config: cfg, updatedAt: project.updatedAt, rev: project.rev
    });
  }
  projectStatus(diskAvailable ? 'Drafts autosave in browser · Save client page writes local files' : 'Browser drafts · export all pages to publish on GitHub');
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
  if (projectBusy || uploading.size) { toast('Please wait for the current save or upload to finish'); return false; }
  if (!diskAvailable) {
    toast('Draft saved in this browser. Use Export all pages to publish, or open the editor through localhost.', 5000);
    await saveSoon.flush();
    return false;
  }
  projectBusy = true;
  const id = cur.id, config = clone(cur.config);
  const button = document.getElementById('save-page');
  button.disabled = true; button.textContent = 'Saving page…';
  try {
    await saveSoon.flush();
    const project = await packedProject(id, config);
    await localRequest('save', { project, html: projectHtml(project) });
    publishedClients.add(id);
    projectStatus(`Saved ${project.name} · clients/${id}/`);
    toast('Client project and page saved on this computer');
    return true;
  } catch (error) {
    projectStatus('Page not saved · ' + error.message);
    toast(error.message, 5000);
    return false;
  } finally {
    projectBusy = false;
    button.disabled = false; button.textContent = 'Save client page';
  }
}

function clientPageUrl() {
  return cur ? new URL(`clients/${cur.id}/index.html`, location.href).href : '';
}
function openClientPage() {
  if (!cur || !publishedClients.has(cur.id)) { toast('Save this client page first'); return; }
  window.open(clientPageUrl(), '_blank', 'noopener');
}
async function copyClientPage() {
  if (!cur || !publishedClients.has(cur.id)) { toast('Save this client page first'); return; }
  const url = clientPageUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast(diskAvailable ? 'Local preview link copied. Export and publish for an external client link.' : 'Client page link copied', 5000);
  } catch { window.prompt('Copy this client page link', url); }
}

function requestNewClient() {
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
    dialog.querySelector('[type=submit]').disabled = true;
    const cfg = defaultConfig();
    cfg.client.name = name; cfg.client.fullName = name;
    cfg.client.slug = safe(name).toUpperCase() || 'CLIENT';
    cfg.resourcePlacement = 'after-logo';
    await createClient(cfg);
    dialog.close();
    if (diskAvailable) await saveClientPage();
  };
  dialog.showModal(); dialog.querySelector('input').focus();
}

function moveCard(list, from, to) {
  if (!cur || projectBusy || uploading.size) { toast('Wait for uploads and saves before moving cards'); return; }
  const cards = cur.config[list];
  if (!['logos','templates','downloads'].includes(list) || !Array.isArray(cards) || from === to || from < 0 || to < 0 || to >= cards.length) return;
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
  if (!arrangeCards) return;
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('.admin-card-tools,.admin-add-card,style[data-admin-style]').forEach(node=>node.remove());
  const style = doc.createElement('style');
  style.dataset.adminStyle = 'true';
  style.textContent = `.admin-card-tools{display:flex;gap:6px;align-items:center;padding:7px 9px;background:#fff4e8;color:#9a3412;font:12px system-ui;border-bottom:1px dashed #fdba74;cursor:grab}.admin-card-tools button{font:inherit;padding:3px 7px;cursor:pointer;background:white;border:1px solid #fdba74;border-radius:4px;color:#9a3412}.admin-card-tools span{margin-right:auto}[data-card-list].drop-target{outline:3px solid #f97316;outline-offset:3px}.admin-add-card{margin:14px 0;padding:10px;background:#fff4e8;border:1px dashed #f97316;border-radius:8px;color:#9a3412;cursor:pointer}`;
  doc.head.append(style);
  let dragging = null;
  doc.querySelectorAll('[data-card-list]').forEach(card => {
    const list = card.dataset.cardList, index = Number(card.dataset.cardIndex);
    const bar = doc.createElement('div');
    bar.className = 'admin-card-tools'; bar.draggable = true;
    bar.innerHTML = `<span>⠿ Drag to move</span><button type="button" title="Move earlier" ${index === 0 ? 'disabled' : ''}>←</button><button type="button" title="Move later" ${index === cur.config[list].length-1 ? 'disabled' : ''}>→</button>`;
    bar.querySelectorAll('button')[0].onclick = () => moveCard(list,index,index-1);
    bar.querySelectorAll('button')[1].onclick = () => moveCard(list,index,index+1);
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
      bar.innerHTML=`<span>⠿ Drag to move</span><button type="button" title="Move earlier" ${index===0?'disabled':''}>←</button><button type="button" title="Move later" ${index===cards.length-1?'disabled':''}>→</button>`;
      bar.querySelectorAll('button')[0].onclick=()=>move(index,index-1);
      bar.querySelectorAll('button')[1].onclick=()=>move(index,index+1);
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
    for (const file of ['index.html','builder.js','builder.css']) {
      const response = await fetch(file);
      if (!response.ok) throw new Error('Open the builder using localhost to export the complete site.');
      zip.file(file, await response.text());
    }
    zip.file('.nojekyll','');
    zip.file('README.txt', `Brand Builder — ${entries.length} client pages\n\nUpload this folder to your GitHub repository and enable Pages for the branch/root.\nOpen index.html for the editor. Client pages live at clients/<client-id>/index.html.\nProjects include editable content and embedded uploaded files. Only publish content appropriate for a public repository/site.\nThere are no credentials or local PHP endpoints in this export.\nOn static hosting, edits autosave in that browser. Export and commit again to update published pages; automatic GitHub sync is not connected yet.\nDrive links still require their sharing permissions and an internet connection.\nKeep a copy of this package as a portable project backup.\n`);
    await saveFile('Brand-Builder-All-Clients.zip', await zip.toBlob());
    projectStatus(`${entries.length} client pages packaged · ready to upload to GitHub`);
  } catch(error) { toast(error.message,5000); }
  finally { projectBusy=false; }
}

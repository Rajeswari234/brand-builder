/* Admin workflow tools. Never included in generated client pages. */
let clientView = false;
const undoStates = new Map();
let replayingEdit = false;
let workflowBusy = false;
let workflowDBPromise;
let versionQueue = Promise.resolve();

function workflowDB() {
  if (!workflowDBPromise) workflowDBPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('brand-builder-workflow-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('versions');
      request.result.createObjectStore('templates');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { workflowDBPromise = null; reject(request.error); };
  });
  return workflowDBPromise;
}
async function workflowStore(storeName, mode, operation) {
  const database = await workflowDB();
  return tx(database, storeName, mode, operation);
}
function workflowReady() {
  if (!cur) { toast('Create a client first'); return false; }
  if (projectBusy || workflowBusy || uploading.size) { toast('Wait for the current save or upload to finish'); return false; }
  return true;
}
function seedUndo(reset = false) {
  if (!cur) return;
  if (reset || !undoStates.has(cur.id)) undoStates.set(cur.id, {
    current: clone(cur.config), past: [], future: [], group: '', time: 0
  });
  updateUndoButtons();
}
function recordEdit() {
  if (!cur || replayingEdit) return;
  const state = undoStates.get(cur.id);
  if (!state) { seedUndo(); return; }
  const next = clone(cur.config);
  if (JSON.stringify(next) === JSON.stringify(state.current)) return;
  const group = document.activeElement?.dataset.path || '';
  const now = Date.now();
  if (!group || group !== state.group || now - state.time > 900) {
    state.past.push(state.current);
    if (state.past.length > 50) state.past.shift();
  }
  state.current = next; state.future = []; state.group = group; state.time = now;
  updateUndoButtons();
}
function updateUndoButtons() {
  const state = cur && undoStates.get(cur.id);
  const unavailable = !cur || projectBusy || workflowBusy || uploading.size > 0;
  const undo = document.getElementById('undo-edit'), redo = document.getElementById('redo-edit');
  if (undo) undo.disabled = unavailable || !state?.past.length;
  if (redo) redo.disabled = unavailable || !state?.future.length;
}
function travelEdit(direction) {
  if (!workflowReady()) return;
  const state = undoStates.get(cur.id);
  const from = direction === 'undo' ? state?.past : state?.future;
  if (!from?.length) return;
  (direction === 'undo' ? state.future : state.past).push(clone(cur.config));
  cur.config = normalize(clone(from.pop()));
  state.current = clone(cur.config); state.group = ''; state.time = 0;
  replayingEdit = true;
  changed();
  replayingEdit = false;
  renderPanel(); renderClientSelect(); loadFontSamples(); updateUndoButtons();
  toast(direction === 'undo' ? 'Change undone' : 'Change redone');
}
function updateWorkflowStatus() {
  const badge = document.getElementById('workflow-state');
  if (!badge) return;
  updateUndoButtons();
  const draft = document.getElementById('status')?.dataset.s;
  const unsaved = cur && (!pageSaved(cur.id) || stalePages.has(cur.id));
  let state = 'draft', message = 'Choose or create a client';
  if (cur) {
    if (draft === 'error') { state = 'error'; message = 'Draft not saved — check browser storage'; }
    else if (projectBusy) { state = 'saving'; message = githubReady() ? 'Saving / publishing…' : 'Saving client page…'; }
    else if (dirty || draft === 'saving') { state = 'saving'; message = 'Saving draft…'; }
    else if (unsaved) { state = 'draft'; message = 'Draft saved · Unpublished changes'; }
    else if (deployingPages.has(cur.id)) { state = 'saving'; message = 'Published · Site updating'; }
    else { state = 'published'; message = githubReady() ? 'Published · Up to date' : 'Draft saved · Client page saved locally'; }
  }
  badge.dataset.state = state; badge.textContent = message;
}
function workflowDialog(title, content) {
  const dialog = document.createElement('dialog');
  dialog.className = 'local-dialog workflow-dialog';
  const heading = document.createElement('h2');
  heading.id = 'workflow-title-' + crypto.randomUUID(); heading.textContent = title;
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.append(heading);
  const body = document.createElement('div'); body.innerHTML = content; dialog.append(body);
  const close = document.createElement('button'); close.className = 'btn workflow-close'; close.type = 'button'; close.textContent = 'Close';
  close.onclick = () => dialog.close(); dialog.append(close);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog); dialog.showModal();
  return dialog;
}
function setClientView(enabled) {
  clientView = enabled;
  if(enabled) { pendingJump = null; document.getElementById("pnote").hidden = true; }
  document.getElementById('work').classList.toggle('client-view', enabled);
  const button = document.getElementById('client-view');
  button.setAttribute('aria-pressed', enabled);
  button.textContent = enabled ? 'Back to editor' : 'Client view';
  for (const id of ['arrange-cards', 'edit-headings']) document.getElementById(id).disabled = enabled;
  document.querySelector('.pbar .follow').hidden = enabled;
  refreshPreview();
}
function showEditorSearch() {
  if (!cur) { toast('Create a client first'); return; }
  const dialog = workflowDialog('Find a setting', '<label>Search settings<input type="search" id="settings-query" placeholder="Try logo, heading, background or font" autocomplete="off"></label><div id="settings-results" class="workflow-list" aria-live="polite"></div>');
  const entries = [
    {label:'Background image, crop and focal point', step:'welcome', selector:'.background-presets'},
    {label:'Rename headings and sidebar labels', action:()=>{ document.getElementById('edit-headings').checked=true; editHeadings=true; refreshPreview(); toast('Click an outlined heading in the preview'); }},
    ...BUILD_STEPS.map(([id,label])=>({label:label+' settings',step:id,selector:'#s-'+id}))
  ];
  document.querySelectorAll('#panel [data-path]').forEach(node => {
    const path = node.dataset.path;
    if (entries.some(entry=>entry.path===path)) return;
    const label = node.closest('label')?.querySelector('span')?.textContent || node.getAttribute('aria-label') || path;
    const step = node.closest('.sec')?.dataset.sec;
    entries.push({label:label.trim(),step,path});
  });
  const results = dialog.querySelector('#settings-results');
  function search() {
    const words = dialog.querySelector('input').value.toLowerCase().trim().split(/\s+/);
    const hits = entries.filter(item=>words.every(word=>(item.label+' '+(item.path||'')+' '+(item.step||'')).toLowerCase().includes(word))).slice(0,30);
    results.replaceChildren();
    for (const item of hits) {
      const button=document.createElement('button'); button.className='btn search-result'; button.type='button';
      button.textContent=item.label+(item.step ? ' — '+(BUILD_STEPS.find(s=>s[0]===item.step)?.[1] || item.step) : '');
      button.onclick=()=>{
        dialog.close(); if(clientView) setClientView(false);
        if(item.action) return item.action();
        setActiveStep(item.step,true);
        const target=item.path ? [...document.querySelectorAll('#panel [data-path]')].find(n=>n.dataset.path===item.path) : document.querySelector(item.selector);
        target?.scrollIntoView({block:'center'}); target?.focus({preventScroll:true});
        target?.classList.add('setting-found'); setTimeout(()=>target?.classList.remove('setting-found'),1800);
      };
      results.append(button);
    }
    if(!hits.length) results.textContent='No matching settings. Try a shorter search.';
  }
  dialog.querySelector('input').oninput=search; search(); dialog.querySelector('input').focus();
}
// The latest 20 checkpoints retain references to the original files in this browser.
function saveVersion(id, config, label, force = false) {
  const snapshot = clone(config);
  const task = versionQueue.catch(()=>{}).then(async()=>{
    const versions = await workflowStore('versions','readonly',s=>s.get(id)) || [];
    if (!force && versions[0] && JSON.stringify(versions[0].config) === JSON.stringify(snapshot)) return;
    versions.unshift({id:crypto.randomUUID(),date:new Date().toISOString(),label,config:snapshot});
    await workflowStore('versions','readwrite',s=>s.put(versions.slice(0,20),id));
  });
  versionQueue = task;
  return task;
}
function beginWorkflowClient(reset = false) {
  const prior = cur && undoStates.get(cur.id);
  seedUndo(reset || (prior && JSON.stringify(prior.current) !== JSON.stringify(cur.config))); updateWorkflowStatus();
  if(cur && db) {
    const id=cur.id, config=clone(cur.config);
    saveVersion(id,config,'Opened draft').catch(()=>toast('Version history is unavailable in this browser. Your draft is unaffected.'));
  }
}
async function showVersionHistory() {
  if(!workflowReady()) return;
  const client=cur;
  const dialog=workflowDialog('Version history','<p>The latest 20 checkpoints are kept in this browser. Restoring changes the draft; publish when ready.</p><form id="version-form"><label>Checkpoint name<input name="label" maxlength="100" placeholder="Before changing the layout"></label><button class="btn" type="submit">Save version</button></form><div class="workflow-list" id="version-list">Loading versions…</div>');
  async function render() {
    await versionQueue.catch(()=>{});
    const versions=await workflowStore('versions','readonly',s=>s.get(client.id)) || [];
    const list=dialog.querySelector('#version-list'); list.replaceChildren();
    if(!versions.length) list.textContent='No checkpoints yet. Save your first version above.';
    for(const version of versions) {
      const row=document.createElement('div'); row.className='workflow-row';
      const text=document.createElement('span'); text.textContent=version.label+' · '+new Date(version.date).toLocaleString();
      const restore=document.createElement('button'); restore.className='btn'; restore.type='button'; restore.textContent='Restore';
      restore.onclick=async()=>{
        if(cur!==client || !workflowReady()) return;
        workflowBusy=true; restore.disabled=true;
        try {
          await saveVersion(client.id,client.config,'Before restoring '+version.label,true);
          client.config=normalize(clone(version.config)); changed(); renderPanel(); renderClientSelect(); loadFontSamples();
          dialog.close(); toast('Version restored to draft. Undo is available.');
        } catch(error) { toast('Could not restore version: '+error.message); }
        finally {workflowBusy=false;updateWorkflowStatus();restore.disabled=false;}
      };
      row.append(text,restore);list.append(row);
    }
  }
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault(); if(cur!==client || !workflowReady())return;
    const button=event.submitter; button.disabled=true; workflowBusy=true;
    try {await saveVersion(client.id,client.config,dialog.querySelector('input').value.trim() || 'Saved version',true);await render();}
    catch(error){toast('Version could not be saved: '+error.message);}
    finally{button.disabled=false;workflowBusy=false;updateWorkflowStatus();}
  };
  try{await render();}catch(error){dialog.querySelector('#version-list').textContent='History unavailable: '+error.message;}
}
async function showBrandTemplates() {
  if(projectBusy || workflowBusy || uploading.size) { toast('Wait for the current operation to finish'); return; }
  const dialog=workflowDialog('Brand templates','<p>Save a reusable copy of this client’s design, content and uploads. Templates are stored in this browser. New clients get their own name and page.</p><form id="template-form"><label>Template name<input name="templateName" required maxlength="100" placeholder="Healthcare starter"></label><button class="btn" type="submit">Save as template</button></form><div id="template-list" class="workflow-list">Loading templates…</div>');
  dialog.querySelector('#template-form').hidden = !cur;
  async function render(){
    const templates=await workflowStore('templates','readonly',s=>s.getAll());
    const list=dialog.querySelector('#template-list');list.replaceChildren();
    if(!templates.length)list.textContent='No templates yet. Save your first template above.';
    for(const template of templates.sort((a,b)=>a.name.localeCompare(b.name))){
      const row=document.createElement('div');row.className='workflow-row';
      const title=document.createElement('span');title.textContent=template.name;
      const use=document.createElement('button');use.className='btn';use.type='button';use.textContent='New client';
      use.onclick=()=>{dialog.close();requestNewClient(template);};
      const remove=document.createElement('button');remove.className='btn';remove.type='button';remove.textContent='Delete';
      remove.onclick=async()=>{
        if(remove.dataset.armed!=='yes'){remove.dataset.armed='yes';remove.textContent='Confirm delete';return;}
        remove.disabled=true;
        try{await workflowStore('templates','readwrite',s=>s.delete(template.id));await render();}catch(error){toast(error.message);remove.disabled=false;}
      };
      row.append(title,use,remove);list.append(row);
    }
  }
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();if(!workflowReady())return;
    const name=dialog.querySelector('input').value.trim();if(!name)return;
    workflowBusy=true;const button=event.submitter;button.disabled=true;
    try{
      const packed=await packedProject(cur.id,cur.config);
      const template={id:crypto.randomUUID(),name,date:new Date().toISOString(),config:packed.config};
      await workflowStore('templates','readwrite',s=>s.put(template,template.id));
      dialog.querySelector('input').value='';await render();toast('Template saved in this browser');
    }catch(error){toast('Template could not be saved: '+error.message);}
    finally{workflowBusy=false;button.disabled=false;updateWorkflowStatus();}
  };
  try{await render();}catch(error){dialog.querySelector('#template-list').textContent='Templates unavailable: '+error.message;}
}
function showPublishChecklist(publish = false) {
  if(!workflowReady())return;
  const dialog=workflowDialog('Publish checklist','<p>Review missing assets, placeholder text, links and readability before sharing.</p>'+reviewHTML()+(publish ? '<button type="button" class="btn primary" id="publish-reviewed">Publish current draft</button>' : ''));
  dialog.querySelectorAll('[data-jump]').forEach(button=>button.addEventListener('click',()=>{dialog.close();if(clientView)setClientView(false);}));
  dialog.querySelector('#publish-reviewed')?.addEventListener('click',()=>{dialog.close();saveClientPage();});
}
function initializeWorkflow() {
  const tools=document.querySelector('.builder-tools');
  const row=document.createElement('div');row.className='workflow-tools';
  row.innerHTML='<div class="workflow-actions"><button class="btn" type="button" id="undo-edit" disabled title="Undo (Ctrl/Cmd+Z)">Undo</button><button class="btn" type="button" id="redo-edit" disabled title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button><button class="btn" type="button" id="search-settings">Find settings</button><button class="btn" type="button" id="brand-templates">Brand templates</button><button class="btn" type="button" id="version-history">Version history</button><button class="btn" type="button" id="publish-checklist">Publish checklist</button><button class="btn" type="button" id="client-view" aria-pressed="false">Client view</button></div><span id="workflow-state" role="status" aria-live="polite"></span>';
  tools.append(row);
  document.getElementById('undo-edit').onclick=()=>travelEdit('undo');
  document.getElementById('redo-edit').onclick=()=>travelEdit('redo');
  document.getElementById('search-settings').onclick=showEditorSearch;
  document.getElementById('brand-templates').onclick=showBrandTemplates;
  document.getElementById('version-history').onclick=showVersionHistory;
  document.getElementById('publish-checklist').onclick=()=>showPublishChecklist(githubReady());
  document.getElementById('client-view').onclick=()=>setClientView(!clientView);
  document.getElementById('save-page').onclick=()=>githubReady()?showPublishChecklist(true):saveClientPage();
  document.addEventListener('keydown',workflowShortcut);
  updateWorkflowStatus();
}

function workflowShortcut(event) {
    if(event.key==='Escape' && clientView && !document.querySelector('dialog[open]'))setClientView(false);
    if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
    if(event.key.toLowerCase()==='k'){event.preventDefault();if(!document.querySelector('dialog[open]'))showEditorSearch();return;}
    if(event.target.closest('input,textarea,select,[contenteditable=true],dialog'))return;
    if(event.key.toLowerCase()==='z'||event.key.toLowerCase()==='y'){
      event.preventDefault();travelEdit(event.shiftKey||event.key.toLowerCase()==='y'?'redo':'undo');
    }
}

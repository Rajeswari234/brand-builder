/* GitHub publishing for the editor. Client pages never include this file.
   The access token stays in this browser's storage. It is never written to a project,
   a client page, an export, or the repository. */
const GITHUB_STORE = 'bb-github';
const EDITOR_FILES = ['index.html', 'builder.js', 'builder.css', 'github.js', 'workflow.js'];
let github = readGithubSettings();
const livePages = new Set();

function readGithubSettings() {
  for (const storage of ['localStorage', 'sessionStorage']) {
    try {
      const value = JSON.parse(window[storage].getItem(GITHUB_STORE) || 'null');
      if (value?.repo && value?.token) return { ...value, remember: storage === 'localStorage' };
    } catch {}
  }
  return null;
}

function writeGithubSettings(settings) {
  for (const storage of ['localStorage', 'sessionStorage']) {
    try { window[storage].removeItem(GITHUB_STORE); } catch {}
  }
  github = settings;
  if (!settings) return;
  const { remember, ...stored } = settings;
  try { window[remember ? 'localStorage' : 'sessionStorage'].setItem(GITHUB_STORE, JSON.stringify(stored)); } catch {}
}

const githubReady = () => Boolean(github?.repo && github?.token);

// An editor opened from owner.github.io/repo/ suggests that repository.
function suggestedRepository() {
  const match = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!match) return '';
  const first = location.pathname.split('/').filter(Boolean)[0];
  return `${match[1]}/${first && !first.includes('.') ? first : match[1] + '.github.io'}`;
}

function githubSiteUrl(settings = github) {
  if (!settings?.repo) return '';
  if (settings.siteUrl) return settings.siteUrl.replace(/\/?$/, '/');
  const [owner, repo] = settings.repo.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return repo.toLowerCase() === host ? `https://${host}/` : `https://${host}/${repo}/`;
}

const liveClientUrl = id => `${githubSiteUrl()}clients/${id}/`;

class GithubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function githubApi(path, { method = 'GET', body, settings = github } = {}) {
  const response = await fetch(`https://api.github.com/repos/${settings.repo}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.ok) return response.status === 204 ? null : response.json();
  let detail = '';
  try { detail = (await response.json()).message || ''; } catch {}
  const messages = {
    401: 'GitHub rejected the access token. It may be expired; reconnect GitHub with a new token.',
    403: 'This token cannot write to the repository. Give it Contents: Read and write access.',
    404: 'Repository or branch not found, or the token has no access to it.'
  };
  throw new GithubError(messages[response.status] || `GitHub error ${response.status}${detail ? ': ' + detail : ''}`, response.status);
}

function bytesToBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function base64ToText(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

// Git's own blob hash, so unchanged files are skipped without uploading them.
async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header); data.set(bytes, header.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* One commit per publish. build(readText) returns { files: {path: text}, remove: [paths] }.
   If the branch moves while committing, the change is rebuilt on the new head. */
async function githubCommit(message, build) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await githubApi(`/git/ref/heads/${encodeURIComponent(github.branch)}`);
    const head = ref.object.sha;
    const commit = await githubApi(`/git/commits/${head}`);
    const tree = await githubApi(`/git/trees/${commit.tree.sha}?recursive=1`);
    const existing = new Map(tree.tree.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.sha]));
    const readText = async path => existing.has(path)
      ? base64ToText((await githubApi(`/git/blobs/${existing.get(path)}`)).content) : null;
    const { files = {}, remove = [] } = await build(readText);
    const entries = [];
    for (const [path, text] of Object.entries(files)) {
      const bytes = new TextEncoder().encode(text);
      if (existing.get(path) === await gitBlobSha(bytes)) continue;
      const blob = await githubApi('/git/blobs', { method: 'POST', body: { content: bytesToBase64(bytes), encoding: 'base64' } });
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const path of remove) if (existing.has(path)) entries.push({ path, mode: '100644', type: 'blob', sha: null });
    if (!entries.length) return { unchanged: true };
    const newTree = await githubApi('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree: entries } });
    const newCommit = await githubApi('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [head] } });
    try {
      await githubApi(`/git/refs/heads/${encodeURIComponent(github.branch)}`, { method: 'PATCH', body: { sha: newCommit.sha, force: false } });
      return { commit: newCommit.sha };
    } catch (error) {
      if (error.status !== 422) throw error;
    }
  }
  throw new Error('The GitHub branch kept changing while publishing. Try again.');
}

async function readProjectIndex(readText) {
  try {
    const list = JSON.parse(await readText('projects/index.json') || '[]');
    return Array.isArray(list) ? list.filter(entry => /^c[a-z0-9]+$/.test(entry?.id)) : [];
  } catch { return []; }
}

// The editor files travel with each publish, so the hosted editor matches this one.
async function editorFiles() {
  const files = { '.nojekyll': '' };
  for (const file of EDITOR_FILES) {
    const response = await fetch(file, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not read ${file} to publish the editor.`);
    files[file] = await response.text();
  }
  return files;
}

async function publishClientToGithub(project, html) {
  const shared = await editorFiles();
  const result = await githubCommit(`Publish ${project.name} client page`, async readText => {
    const index = (await readProjectIndex(readText)).filter(entry => entry.id !== project.id);
    index.push({ id: project.id, name: project.name, updatedAt: project.updatedAt });
    index.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { files: {
      ...shared,
      [`projects/${project.id}.json`]: JSON.stringify(project),
      [`clients/${project.id}/index.html`]: html,
      'projects/index.json': JSON.stringify(index, null, 2)
    } };
  });
  livePages.add(project.id);
  return result;
}

// Pushes only the editor files, so the hosted editor gets this version without publishing a client.
async function publishEditorToGithub() {
  const files = await editorFiles();
  return githubCommit('Update Brand Builder editor', async () => ({ files }));
}

async function unpublishClientFromGithub(id) {
  await githubCommit(`Remove client ${id}`, async readText => ({
    files: { 'projects/index.json': JSON.stringify((await readProjectIndex(readText)).filter(entry => entry.id !== id), null, 2) },
    remove: [`projects/${id}.json`, `clients/${id}/index.html`]
  }));
  livePages.delete(id);
}

// Projects in the repository, read through the API so they are current even before Pages redeploys.
async function githubProjects() {
  const projects = [];
  let index = [];
  try {
    const file = await githubApi(`/contents/projects/index.json?ref=${encodeURIComponent(github.branch)}`);
    index = JSON.parse(base64ToText(file.content));
  } catch (error) {
    if (error.status === 404) return projects;
    throw error;
  }
  for (const entry of Array.isArray(index) ? index : []) {
    if (!/^c[a-z0-9]+$/.test(entry?.id)) continue;
    try {
      const file = await githubApi(`/contents/projects/${entry.id}.json?ref=${encodeURIComponent(github.branch)}`);
      // Large files come back without inline content; fetch their blob instead.
      const text = file.content ? base64ToText(file.content)
        : base64ToText((await githubApi(`/git/blobs/${file.sha}`)).content);
      projects.push(JSON.parse(text));
      livePages.add(entry.id);
    } catch {}
  }
  return projects;
}

// GitHub Pages redeploys after each commit, usually within a minute or two.
let liveWatch = 0;
async function watchUntilLive(project) {
  const watch = ++liveWatch;
  for (let i = 0; i < 40 && watch === liveWatch; i++) {
    await new Promise(resolve => setTimeout(resolve, i ? 8000 : 4000));
    try {
      const response = await fetch(`${githubSiteUrl()}projects/${project.id}.json?check=${Date.now()}`, { cache: 'no-store' });
      if (response.ok && (await response.json()).rev === project.rev) {
        if (watch === liveWatch && cur?.id === project.id) {
          updatePageState();
          toast('Client page is live. Copy page link to share it.', 5000);
        }
        return true;
      }
    } catch {}
  }
  return false;
}

function requestGithubSettings() {
  const dialog = document.createElement('dialog');
  dialog.className = 'local-dialog github-dialog';
  const current = github || {};
  const sharedOrigin = /\.github\.io$/i.test(location.hostname);
  dialog.innerHTML = `<form><h2>Publish to GitHub</h2>
    <p>Save client page will commit the client's page and project to this repository. GitHub Pages then serves the live link you share with the client.</p>
    <label>Repository<input name="repo" required placeholder="owner/repository" autocomplete="off" pattern="[A-Za-z0-9-]+/[A-Za-z0-9._-]+"></label>
    <label>Branch<input name="branch" required value="main" autocomplete="off"></label>
    <label>Access token<input name="token" type="password" autocomplete="off" placeholder="${current.token ? 'Saved · leave empty to keep it' : 'github_pat_…'}"></label>
    <p class="hint">Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a> with access to only this repository and <b>Contents: Read and write</b>. Paste it here, never into chat or a file. It is stored only in this browser and is never included in pages or exports.</p>
    <label class="check"><input type="checkbox" name="remember"> Remember the token on this device</label>
    ${sharedOrigin ? '<p class="hint">On github.io, pages of your other repositories share this browser storage. Leave “Remember” off on shared computers.</p>' : ''}
    <p class="github-result" role="status"></p>
    <footer>${current.token ? '<button class="btn" type="button" data-disconnect>Disconnect</button>' : ''}${current.token && !sharedOrigin ? '<button class="btn" type="button" data-editor title="Publish this version of the editor to the GitHub Pages site">Update hosted editor</button>' : ''}<span></span>
      <button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Connect</button></footer></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), result = dialog.querySelector('.github-result');
  form.repo.value = current.repo || suggestedRepository();
  form.branch.value = current.branch || 'main';
  form.remember.checked = current.token ? Boolean(current.remember) : true;
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  const disconnect = dialog.querySelector('[data-disconnect]');
  if (disconnect) disconnect.onclick = () => {
    writeGithubSettings(null); livePages.clear();
    refreshGithubControls(); updatePageState(); dialog.close();
    toast('GitHub disconnected. The token was removed from this browser.');
  };
  const updateEditor = dialog.querySelector('[data-editor]');
  if (updateEditor) updateEditor.onclick = async () => {
    updateEditor.disabled = true; result.textContent = 'Publishing the editor…';
    try {
      const done = await publishEditorToGithub();
      result.textContent = done.unchanged ? 'The hosted editor is already up to date.'
        : `Editor published. ${githubSiteUrl()} updates within a minute or two.`;
    } catch (error) { result.textContent = error.message; }
    finally { updateEditor.disabled = false; }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const settings = { repo: form.repo.value.trim(), branch: form.branch.value.trim(),
      token: form.token.value.trim() || current.token, remember: form.remember.checked };
    if (!settings.token) { result.textContent = 'Paste an access token to connect.'; return; }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; result.textContent = 'Checking access…';
    try {
      const repo = await githubApi('', { settings });
      if (!repo.permissions?.push) throw new Error('This token can read but not write the repository. Give it Contents: Read and write.');
      await githubApi(`/git/ref/heads/${encodeURIComponent(settings.branch)}`, { settings });
      writeGithubSettings({ ...settings, repo: repo.full_name });
      refreshGithubControls();
      updatePageState();
      dialog.close();
      toast(repo.private ? 'GitHub connected. Save client page will publish.'
        : 'GitHub connected. This repository is public: published pages and uploaded files can be seen by anyone with the link.', 7000);
      await loadSavedProjects();
      updatePageState();
    } catch (error) {
      result.textContent = error.message;
    } finally { submit.disabled = false; }
  };
  dialog.showModal();
  (form.repo.value ? form.token : form.repo).focus();
}

function refreshGithubControls() {
  const button = document.getElementById('github-settings');
  if (button) {
    button.textContent = githubReady() ? `GitHub · ${github.repo.split('/')[1]}` : 'Connect GitHub';
    button.classList.toggle('connected', githubReady());
  }
  const save = document.getElementById('save-page');
  if (save && !projectBusy) save.textContent = githubReady() ? 'Save & publish' : 'Save client page';
}

# Local Brand Builder

Double-click **Start Dashboard.cmd** in this folder. It starts a local PHP server and opens **http://127.0.0.1:8765/**. Apache does not need to be running. The launcher uses the installed XAMPP PHP executable.

The entire project lives in **Downloads/Brand Builder**, separate from the inventory application. The original Downloads HTML is unchanged. This dashboard does not use the inventory database.

## Editing and saving

- Create a named client using **New client**. Clients appear in the dropdown.
- Draft changes and uploads autosave in this browser's IndexedDB.
- A dot on **Save client page** (and the status beside the toolbar) means the draft has changes the client page does not include yet. This is remembered after reloading.
- **Save client page** writes an editable JSON project to `projects/` and a self-contained client page to `clients/<permanent-client-id>/index.html`.
- Opening the editor in another browser on this computer loads the saved disk projects. Unsaved browser drafts do not sync between browsers.
- Renaming a client preserves its ID and page URL. Save the page again to publish changes locally.
- **View client page** opens the saved client output. **Copy page link** copies its local URL; localhost links are usable only on this computer until the site is published.
- Existing clients from the original Downloads file can be moved using **More → Back up this client** in the original, then **More → Restore a client from backup** here.

## Files and layout

- Use the Downloads step to attach PDFs, templates, images, and other files or add an HTTPS Google Drive link.
- Add, duplicate, hide, or remove resource cards. Default resource cards can be hidden.
- With **Arrange cards** enabled, drag the orange handle on logo, template, download, background, and information cards in the right preview. Cards move within their group. Arrow controls are also available.
- Each card's orange bar has a size menu: **Normal**, **Wide** (two columns where two fit) or **Full row**. Sizes are saved and appear on the client page; on phones every card is full width.
- **+ Add logo card** and **+ Add background card** appear under those grids in the preview, and also as buttons in the Logo step. Added logos and all background cards have a × to remove them; the four standard logos stay. In the Logo step, set each background's color (brand, dark, accent, white or a custom color), which logo it shows, and which logo version (full color, white, or mono dark).
- Downloads can appear immediately after Logo or near the end. Order is saved in the project and exports.
- The admin controls are injected only into the editor preview. Published/exported client pages have no editor, client dropdown, upload controls, or reorder handlers.
- Drive links remain external links. Check Drive sharing permissions before sending to clients.

## Publishing to GitHub

1. Create a **fine-grained token** at github.com → Settings → Developer settings → Personal access tokens → Fine-grained. Repository access: only this repository. Permissions: **Contents: Read and write**. Never paste it into chat or a file.
2. In the dashboard, click **Connect GitHub**, enter `owner/repository` (for example `Rajeswari234/brand-builder`), the branch (`main`) and the token, then **Connect**. The token is stored only in that browser. Untick **Remember** on shared computers, and use **Disconnect** to remove it.
3. **Save & publish** makes one commit containing the client page (`clients/<id>/index.html`), its editable project (`projects/<id>.json`), the client list (`projects/index.json`) and the editor files. Unchanged files are skipped.
4. GitHub Pages redeploys in about a minute. The status then shows **Live page up to date** and the green link in the toolbar is the client's live link: `https://OWNER.github.io/REPOSITORY/clients/<id>/`. **Copy page link** copies it. The link never changes for that client.
5. Any browser that connects to the same repository loads every published client into the dropdown, including the github.io editor. Unpublished browser drafts stay in the browser where they were made.
6. Deleting a client while connected also removes its page and project from the repository.
7. **Update hosted editor** (in the Connect GitHub dialog on the local dashboard) publishes only the editor files. Use it once after updating the local code so the github.io editor gets the new version.

The dashboard commits through the GitHub API, not local git. After publishing, run `git pull` before committing in this folder.

**Privacy:** in a public repository, anyone with a link can open client pages, and the project JSON files contain every uploaded file. Only publish content that may be public, or use a private repository with a GitHub plan that supports private Pages.

## Export

- **Export → Handoff package**: one client's HTML with files in folders.
- **Export → Client dashboard only**: one HTML file with uploaded files embedded.
- **Export all pages**: all client pages, editable projects and the static editor in a ZIP, as an offline backup or for manual upload.
- There is no shared login or real-time collaboration. The PHP file service only accepts requests from this computer and is never used by the hosted site.

Use Drive links for large files. Local Save accepts up to 64 MiB per request, including duplicated base64 data in the editable project and rendered page.

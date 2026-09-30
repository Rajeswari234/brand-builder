# Local Brand Builder

Double-click **Start Dashboard.cmd** in this folder. It starts a local PHP server and opens **http://127.0.0.1:8765/**. Apache does not need to be running. The launcher uses the installed XAMPP PHP executable.

The entire project lives in **Downloads/Brand Builder**, separate from the inventory application. The original Downloads HTML is unchanged. This dashboard does not use the inventory database.

## Editing and saving

- Create a named client using **New client**. Clients appear in the dropdown.
- Draft changes and uploads autosave in this browser's IndexedDB.
- **Save client page** writes an editable JSON project to `projects/` and a self-contained client page to `clients/<permanent-client-id>/index.html`.
- Opening the editor in another browser on this computer loads the saved disk projects. Unsaved browser drafts do not sync between browsers.
- Renaming a client preserves its ID and page URL. Save the page again to publish changes locally.
- **View client page** opens the saved client output. **Copy page link** copies its local URL; localhost links are usable only on this computer until the site is published.
- Existing clients from the original Downloads file can be moved using **More → Back up this client** in the original, then **More → Restore a client from backup** here.

## Files and layout

- Use the Downloads step to attach PDFs, templates, images, and other files or add an HTTPS Google Drive link.
- Add, duplicate, hide, or remove resource cards. Default resource cards can be hidden.
- With **Arrange cards** enabled, drag the orange handle on logo, template, download, background, and information cards in the right preview. Cards move within their group. Arrow controls are also available.
- Downloads can appear immediately after Logo or near the end. Order is saved in the project and exports.
- The admin controls are injected only into the editor preview. Published/exported client pages have no editor, client dropdown, upload controls, or reorder handlers.
- Drive links remain external links. Check Drive sharing permissions before sending to clients.

## Export and GitHub preparation

- **Export → Handoff package**: one client's HTML with files in folders.
- **Export → Client dashboard only**: one HTML file with uploaded files embedded.
- **Export all pages**: all client pages, editable project JSON, and the static editor in a GitHub Pages-ready ZIP. Uploaded files are embedded in projects and client pages. No local PHP endpoint or credentials are included.
- Unzip into a repository and enable Pages for its branch/root. The page link becomes `https://ACCOUNT.github.io/REPOSITORY/clients/CLIENT-ID/index.html`.
- Editable projects and all exported client files will be public if deployed publicly. The static editor can only change its visitor's browser drafts; it has no credentials to modify the repository.
- Automatic GitHub commits/publishing is not connected yet. Until repository setup is supplied, export and commit the package to update hosted pages. Saving a draft on GitHub Pages does not update the live site.
- There is no shared login or real-time collaboration in this local version. The PHP file service only accepts loopback requests. Keep it local; deployment uses only the static export.

Use Drive links for large files. Local Save accepts up to 64 MiB per request, including duplicated base64 data in the editable project and rendered page.

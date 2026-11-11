# Spoke Studio

A local browser tool for binary segmentation of polar-projected Saturn images.

From the workspace root, start:

```sh
venv/bin/python spoke_tool/server.py
```

Open http://127.0.0.1:8765 in your browser. Stop the server with Ctrl+C.
Only the Python dependencies in `../requirements.txt` are required; there is no frontend installation.

## Cloudflare R2 storage

New projects are mirrored to the `spoke-studio` Cloudflare R2 bucket. Creating a project
creates `<project-name>/images/` and `<project-name>/masks/` (zero-byte folder placeholder
objects). Image imports and successful mask saves upload a PNG to the corresponding folder;
local files are retained as the primary working copy. Independently imported sequences are
also uploaded when their import is finalized. The existing `temp-project` and `more masks`
projects are provisioned at startup; any local images/masks missing from R2 are then
uploaded. Startup does not re-upload existing objects.
Renaming a project does not move its R2 folder. Deleting a project first moves its R2 objects
to `recently_deleted/<project-name>/<unique-deletion-id>/`; if that remote operation fails,
the local project is not deleted. Local images and masks always remain on disk.

The server permanently deletes objects from `recently_deleted/` when their move timestamp is
at least 30 days old. Cleanup runs at startup and every 24 hours while the server is running.
The supplied object-read/write token does not permit R2 lifecycle management, so this uses
ordinary object operations instead. If the server is stopped for more than 30 days, expired
objects are cleaned at its next launch. Restore a deleted remote project by copying its
objects back before cleanup; local files are preserved in either case.


The server reads `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`
from the process environment or `../.env`. Do not commit real secret keys. `R2_BUCKET` is
optional and defaults to `spoke-studio`. The `pub-….r2.dev` URL is for public HTTP reads,
not authenticated uploads; uploads use the account's R2 S3-compatible API. Use a token
with object read/write access restricted to this bucket.

Each R2 project folder must be unique. Repeated project names, missing credentials, and
upload/API failures are rejected rather than silently reporting a successful sync. A file
saved locally before a remote failure remains on disk; retry the edit/import after resolving
the connection problem. Run with `--no-r2` only when intentionally using local storage alone.

## Users and attribution

The local server requires email-based login before project, image, or mask access. Signing up
assigns a permanent UUID and a user-selected username (1–40 characters). `../users.json`
stores user IDs, normalized email addresses, usernames, and creation timestamps; passwords
are intentionally not used or stored. Email matching is case-insensitive. This is attribution,
not authentication suitable for an untrusted/public deployment. Keep the server on localhost.
Sessions last 30 days but are held in memory, so restarting the server requires logging in again.

Projects record their creator. Each project also has an `attribution.json` in its local project
directory containing the uploader of every imported image and the most recent editor of every
mask, with UUID, username, and timestamp. Existing media without attribution remains unowned.
For R2-synced projects, this file is mirrored to `<project-name>/attribution.json`. The
current user and per-frame attribution appear in the interface; frame lists do not expose emails.

The app opens on **Your projects**. Enter a name and choose **Create project**, then
import the project's images. Use **Projects** to return to the dashboard (the current
mask is saved first). Project cards show image and saved-mask counts; search by name
and choose **Open project** to resume. A saved mask counts as annotated even if it is
entirely black; this count does not indicate scientific review or completion.

Each project card has a **⋯** options menu with **Rename** and **Delete**.
Deletion asks for confirmation and removes the project from the dashboard, preserving
its image and mask files on disk. Deleted project records are retained internally so
startup migration does not bring them back. Renames and deletions persist after restart.

Project records persist in `spoke_projects/projects.json`. New projects have independent
mask directories in `spoke_projects/<id>/masks/`, even when they contain identical images.
The startup dataset and previously imported sequences are included automatically, using
their existing masks. Imported PNG copies remain in `imported_images/`.
Keep these directories when moving/backing up the workspace; records contain absolute paths.
Importing images into an empty project fills that project. Importing another sequence
while a populated project is open creates a separate saved project and preserves the old one.

Use **Import folder** to choose a PNG sequence, or **Import images** to select multiple PNG files.
Folder import uses the browser's dedicated directory picker when available, with an
unfiltered directory-input fallback. PNG filtering happens after the folder is chosen.
If your browser cannot select folders, use **Import images** inside the desired folder.
The tool saves your current mask before switching and sorts the new sequence by filename.
Folder selection includes PNGs in subfolders; duplicate filenames are rejected.
Each PNG may be up to 50 MB. Files are copied into `imported_images/` in this workspace.
Imported datasets save masks in `spoke_masks_imports/<dataset fingerprint>/` (or alongside
your custom mask directory with an `_imports` suffix). Different image contents stay separate,
even when filenames match. Reimporting the same files restores their saved masks, including
after restarting the server for automatically created import projects. Named projects keep
their masks independent; open their project card to resume without reimporting images.
You can start with an empty image directory and import through the interface.

Use **Import masks** to select one or more PNG masks for the loaded sequence.
`image.png` and `image_mask.png` both match the source `image.png`, ignoring case.
A single unmatched filename can be assigned to the current frame after confirmation.
For multiple masks, every filename must match a frame; duplicate matches are rejected.
All dimensions are checked before any masks are imported. Confirm the import and any
replacement of existing masks in the dialog. Visible nonzero RGB pixels become 255;
black or fully transparent pixels become 0. Imported masks use the normal dataset mask
storage and are immediately editable. Network/save failures can leave a partial import;
the error reports how many masks were saved, and retrying the selection is supported.
Label Studio's task-based names need renaming to their corresponding source image names
for batch import; no frame mapping is inferred from task numbers.

Use `--images PATH --masks PATH --port 8765` for a different dataset, output directory, or port.
Frames are sorted by filename, following the existing movie script's convention.

- Left/right arrows navigate; Space starts/stops playback. Viewing settings, pixel scale, and pan persist between frames.
- B selects brush, E eraser, P polygon. Click polygon vertices and press Enter to fill; Escape cancels.
- Scroll zooms around the pointer; middle/right drag pans; F fits the current frame.
- A floating toolbar at the right of the image provides brush, eraser, pixel inspection,
  pan, zoom in/out, fit, and polygon tools. Its vertical brush-size slider stays synchronized
  with the sidebar control and bracket shortcuts. H selects pan (left-drag); V selects
  pixel inspection (source RGB values, pixel coordinates, and binary mask value).
  Plus/minus zoom around the center of the viewport.
- Brackets change brush diameter in source pixels. M hides/shows the overlay.
- Ctrl/Cmd+Z undoes; Shift+Ctrl/Cmd+Z redoes. History applies to the current frame.
- Masks autosave after strokes, polygon fills, undo/redo, and before navigating. S explicitly saves.
- Masks are stored in `spoke_masks/`, named exactly like their source PNGs, as single-channel PNGs with values 0 (background) and 255 (spoke). They reload when you return to a frame or restart.
- Download mask exports the current binary mask to your browser's downloads directory.

Brightness, contrast, gamma, and black/white levels affect display only. Original PNGs remain intact.
The previous/next-frame overlay uses raw pixel coordinates. The source images have varying heights;
this viewer does not infer alignment or physical radial/azimuthal coordinates.

Existing Label Studio masks in `labels/` are not automatically imported because their filenames
do not establish a reliable mapping to source frames.

The server binds to localhost. This first version has no multi-user collaboration, automatic segmentation,
or Label Studio project integration. Avoid opening the same dataset in multiple editing tabs.

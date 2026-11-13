# Spoke Studio: Deployment and Maintenance

**Author**: Kimi K3.1

Spoke Studio runs as a **Cloudflare Worker** at [spoke-studio.keshavgulati785.workers.dev](https://spoke-studio.keshavgulati785.workers.dev/). For user-facing instructions, see [README.md](README.md).

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Deploy](#deploy)
- [Run locally](#run-locally)
- [One-time migration from the legacy app](#one-time-migration-from-the-legacy-app)
- [Storage and collaboration model](#storage-and-collaboration-model)
- [Frames, masks, and display controls](#frames-masks-and-display-controls)
- [Validation and logs](#validation-and-logs)
- [Configuration changes](#configuration-changes)

## Architecture

The deployed application does not read the legacy local project folders:

| Resource | Purpose |
| --- | --- |
| `public/` | Browser interface and image-scale calculations. Keep new frontend dependencies in this directory as static JavaScript modules. |
| `src/api.js` | Login/session handling, project routes, R2 image/mask handling, imports, deletion, and cleanup. |
| `src/state.js` | Updates to shared users, projects, image manifests, and attribution. |
| `src/index.js` | Worker entry point, Durable Object class, and scheduled-event handler. |
| `MetadataCoordinator` | Single Durable Object instance that serializes metadata writes. Media is uploaded directly to R2; it is not stored in the Durable Object. |
| `BUCKET` | R2 binding for the `spoke-studio` bucket. |
| `upng-js` | Worker-compatible PNG decoder/encoder. `pngjs` is used for test validation only, not by the deployed runtime. |

Worker schedules run in UTC. The configured Cron Trigger (`0 3 * * *`) runs daily at 03:00 UTC and expires recycle-bin objects 30 days after they are moved there.

## Prerequisites

- A recent Node.js LTS release with npm.
- Wrangler (installed by `npm ci`) and permission to manage this Cloudflare Worker, its Durable Object, and the bound R2 bucket.
- A Cloudflare R2 bucket named `spoke-studio`. If this name changes, update `wrangler.jsonc`.
- For legacy migration only: a Python environment with **Pillow** and **boto3**, plus the R2 S3 credentials described below.

**Do not commit credentials.** `.env`, `.dev.vars`, `.wrangler/`, `node_modules/`, and `dist/` are ignored. The Worker does not use the R2 S3 access keys directly; it uses the R2 binding.

Authenticate locally with:

```sh
npx wrangler login
```

For CI/GitHub deployments, configure the appropriate `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets/environment variables through Cloudflare Workers Builds. The S3-compatible R2 access key is not a substitute for the Cloudflare API token used to deploy Workers.

## Deploy

Run everything in the repository root (`spoke_studio/`):

```sh
npm ci
npm test
npm run check
npm run deploy
```

The name in `wrangler.jsonc` determines the deployed Worker. Ensure it matches the intended production Worker before deploying.

For Cloudflare Workers Builds connected to GitHub, use:

- Dependencies/build preparation: `npm ci`
- Deploy command: `npx wrangler deploy` or `npm run deploy`

A local deployment or GitHub action can upload a Worker version even if a build was not actively run on the current machine; verify the deployed URL after deployment. Do not deploy unreviewed changes directly over the shared production application.

## Run locally

```sh
npm ci
npx wrangler dev --local --port 8787
```

Open **http://127.0.0.1:8787**. Stop with **Ctrl+C**.

Local mode uses Wrangler-managed local bindings, not the production R2 data. You can sign up with a test email and create test projects without changing the shared bucket. Its state may persist under `.wrangler/`.

To connect to live resources, authenticate Wrangler and run:

```sh
npx wrangler dev --remote --port 8787
```

Remote development reads and writes the shared bucket, including user and project data. Image imports, mask saves, and deletions therefore affect real projects. Use local mode for isolated tests.

The old `spoke_tool/server.py` is a separate legacy local application, not the backend for this Worker deployment.

## One-time migration from the legacy app

Before importing real users/collaborators into the Worker, migrate the legacy registry, images, masks, users, and attribution into R2:

```sh
../venv/bin/python spoke_tool/migrate_to_r2.py
```

Adjust the Python executable if your environment is elsewhere. The local root `.env` must contain:

```dotenv
CLOUDFLARE_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
```

`R2_BUCKET` is optional and defaults to `spoke-studio`.

The migration:

- Adds R2 metadata required by the Worker, including image manifests and project attribution.
- Preserves existing account UUIDs and project/R2 prefixes.
- Skips matching objects and refuses to overwrite different existing content.
- Leaves local images, masks, registries, and user files unchanged as backups.
- Is resumable after interruption with `--resume`.

Run `--resume` only when continuing this migration after its registry had already been uploaded; do not use it to overwrite newer collaborative project metadata. Keep local backups until the live application has been verified.

## Storage and collaboration model

- `users.json` stores UUIDs, emails, usernames, and account creation times. No password is used.
- Browser sessions last 30 days. R2 stores SHA-256 hashes of session tokens, not the raw tokens.
- `projects.json` indexes shared projects, owner UUIDs, and immutable R2 prefixes.
- `_system/projects/<project-id>/images.json` records ordered frame metadata and saved-mask status.
- `_system/attribution/<project-id>.json` records image uploaders and the latest mask editor. A public project copy is written to `<project-name>/attribution.json`.
- `_system/imports/` holds active import sessions; `_system/sessions/` holds login sessions.
- Imported images are staged in R2 and finalized into `<project-name>/images/`. Mask saves directly update `<project-name>/masks/` with lossless binary 0/255 PNGs.

Everyone signed in sees all projects. There is **one shared mask per image**; later saves overwrite previous versions and update the editor attribution. Old media without attribution remains unowned. Project deletion moves cloud objects into `recently_deleted/<project-name>/<deletion-id>/`; scheduled cleanup permanently removes them after 30 days.

Account creation is for identifying contributions in a trusted group, not secure authentication. Email addresses are not verified, so accounts can be impersonated.

**Disable the bucket’s public R2 development URL before inviting collaborators.** The Worker does not need the old `pub-….r2.dev` endpoint. If the bucket is public, users and projects may be accessible outside the app’s login routes. The S3 object credentials cannot change this dashboard setting.

## Frames, masks, and display controls

`src/api.js` serves original frames from R2 and creates a black mask with matching dimensions when no saved mask exists. The `env.IMAGES` integration can optionally provide lossy WebP display copies; for exact source PNG pixels use `/frame/<project-id>/<index>?original=1`. When this binding is enabled in `wrangler.jsonc`, use the `cache` binding/config and immutable cache headers to avoid repeated transformations. Cloudflare Images transformations may incur charges.

`public/viewer-scales.js` implements the display-only scale menu and automatic levels. It does not change stored images or masks. Supported modes are linear, log, power, sqrt, squared, asinh, sinh, and histogram equalization, with min/max and ZScale controls. Frontend changes must also update the testable scale functions where appropriate.

## Validation and logs

```sh
npm test
npm run check
```

`npm test` uses an in-memory R2/mock binding for end-to-end login, project, image import, shared-mask, deletion, retention, binary-PNG, and display-scale checks. It does not write to the real bucket.

`npm run check` produces a local Worker bundle and validates the configured bindings without deploying. To validate actual local request handling, additionally run `npx wrangler dev --local --port 8787` and import a real PNG sequence through the browser.

Observability is enabled in `wrangler.jsonc`. Use the Worker’s Cloudflare logs and scheduled-event history to investigate failed uploads or missed cleanup runs. For live traffic investigations, watch for failed R2 operations, PNG errors, or Durable Object errors rather than only checking the HTTP status.

## Configuration changes

The Durable Object migration for `MetadataCoordinator` is declared in `wrangler.jsonc`. Preserve its class and binding names when changing metadata code; unrelated script deployments must not rebind production to a different bucket or namespace.

After changing shared metadata structures, add migration/compatibility handling before deployment. Do not assume `projects.json` or image manifests can be regenerated from the public project files without losing ownership information.

# QuickWA on Cloudflare Workers

Address: https://quickwa.muamer-arifi.workers.dev (auto-deploys from this repo).

- `public/` is the PWA, served as static assets (free, never runs the Worker).
- `src/worker.js` is a tiny sync API on `/api/sync/<id>`. It stores only end-to-end encrypted blobs
  (AES-GCM, key derived from the sync code + PIN on the device). The server never sees contacts or the PIN.
- Storage: the existing `doselog-data` KV namespace, keys prefixed `quickwa:` — no extra Cloudflare resource.
- `public/sw.js` caches the app as `/` (not `/index.html`, which Cloudflare redirects) so it opens offline.

## Deploy

`npm install` then `npx wrangler deploy` (or just push to `main`).

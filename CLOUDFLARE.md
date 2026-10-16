# QuickWA on Cloudflare Workers

QuickWA, moved from Vercel (quickwa-vercel.vercel.app) to Cloudflare Workers.

It is a fully static, offline PWA: no server code, no database, no secrets. Everything runs on the device.

- `public/` holds the app's files, byte-identical to the Vercel version on 11 Oct 2026, and served by Workers Static Assets (free, no request limit).
- `public/_headers` carries over the headers from the old `vercel.json`.
- `html_handling: auto-trailing-slash` matches Vercel's `cleanUrls: true` (`/index.html` redirects to `/`, as before).

## Deploy

Run `npm install` then `npx wrangler deploy`. It deploys to the existing `quickwa` Worker, so the address stays the same.

Address: https://quickwa.muamer-arifi.workers.dev

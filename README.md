# QuickWA — Direct & Bulk WhatsApp

Open a WhatsApp chat with any number without saving the contact: direct chat, a bulk queue,
message templates and history. A fully static, offline PWA. Everything runs on the device, with no
server code, no database and no secrets.

**Live:** https://quickwa.muamer-arifi.workers.dev

## Deploying

This repo **is** the live app. Every push to `main` is built and deployed automatically by Cloudflare
Workers Builds (`npx wrangler deploy`) to the address above.

- Keep `"name": "quickwa"` in `wrangler.jsonc`; that keeps the same address.
- History and templates are stored in each device's browser, so a deploy never touches them.
- Manual deploy, if ever needed: `npm install` then `npx wrangler deploy`.

After changing files in `public/`, bump the cache version in `public/sw.js` so installed apps pick up
the change.

## Layout

- `public/`: the app (`index.html`, `app.js`, `styles.css`, `countries.js`, `qrcode.js`, `sw.js`,
  `manifest.webmanifest`, `icons/`), served by Workers Static Assets
- `public/_headers`: security and cache headers
- `CLOUDFLARE.md`: notes on the move from Vercel

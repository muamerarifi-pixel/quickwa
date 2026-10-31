/* QuickWA sync API. Stores only encrypted blobs: the server never sees contacts or the PIN.
   Everything else (the app itself) is served as static assets and never runs this code. */
const JSON_H = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_H });
const MAX = 4 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/sync\/([a-f0-9]{64})$/);
    if (url.pathname === '/api/ping') return reply({ ok: true, t: Date.now() });
    if (!m) {
      if (url.pathname.startsWith('/api/')) return reply({ error: 'not found' }, 404);
      return env.ASSETS.fetch(request);
    }
    const key = 'quickwa:sync:' + m[1];

    if (request.method === 'GET') {
      const rec = await env.KV.get(key, { type: 'json' });
      return rec ? reply(rec) : reply({ error: 'none' }, 404);
    }
    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX) return reply({ error: 'too large' }, 413);
      let body;
      try { body = JSON.parse(text); } catch (e) { return reply({ error: 'bad json' }, 400); }
      if (!body || typeof body.data !== 'string' || !body.data) return reply({ error: 'bad body' }, 400);
      const cur = await env.KV.get(key, { type: 'json' });
      const curV = cur ? cur.v : 0;
      if ((body.base | 0) !== curV) return reply({ error: 'conflict', v: curV }, 409);
      const rec = { v: curV + 1, at: Date.now(), data: body.data };
      await env.KV.put(key, JSON.stringify(rec));
      return reply({ v: rec.v, at: rec.at });
    }
    if (request.method === 'DELETE') {
      await env.KV.delete(key);
      return reply({ ok: true });
    }
    return reply({ error: 'method' }, 405);
  }
};

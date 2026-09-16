// Shared helpers for the ask-Anton relay (Vercel serverless, Node 18+).
// Storage: Upstash Redis over REST — two env vars, free tier is plenty.

const env = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };

const redis = {
  async cmd(...parts) {
    const url = `${env('UPSTASH_REDIS_REST_URL')}/${parts.map(encodeURIComponent).join('/')}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${env('UPSTASH_REDIS_REST_TOKEN')}` } });
    if (!r.ok) throw new Error(`redis ${r.status}`);
    return (await r.json()).result;
  },
  async get(key) { const v = await this.cmd('get', key); return v ? JSON.parse(v) : null; },
  async set(key, value, ttlSec) { return this.cmd('set', key, JSON.stringify(value), 'EX', String(ttlSec)); },
  async incr(key, ttlSec) { const n = await this.cmd('incr', key); if (n === 1) await this.cmd('expire', key, String(ttlSec)); return n; },
};

const json = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };

// CORS: ALLOWED_ORIGIN = "https://nodesign.webflow.io" (or "*" while testing). Returns true when the request was a preflight.
const cors = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
};

const readJson = (req) => new Promise((resolve) => {
  if (req.body && typeof req.body === 'object') return resolve(req.body);
  let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
});

const telegram = async (method, payload) => {
  const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`telegram: ${data.description}`);
  return data.result;
};

module.exports = { env, redis, json, cors, readJson, telegram };

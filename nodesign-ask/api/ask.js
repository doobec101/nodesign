// POST /api/ask  { question, lang }  → { id }        the question goes to Anton's Telegram
// GET  /api/ask?id=…                 → { status, answer }   status: sent | answered
const { env, redis, json, cors, readJson, telegram } = require('./_lib');

const TTL = 24 * 60 * 60;            // a question lives for a day
const MAX_LEN = 500;
const RATE = { limit: 5, windowSec: 10 * 60 };   // per IP

module.exports = async (req, res) => {
  if (cors(req, res)) return;

  if (req.method === 'GET') {
    const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
    if (!/^[a-f0-9-]{8,64}$/i.test(id)) return json(res, 400, { error: 'bad id' });
    const rec = await redis.get(`ask:${id}`);
    if (!rec) return json(res, 404, { error: 'unknown' });
    return json(res, 200, { status: rec.status, answer: rec.answer });
  }

  if (req.method === 'POST') {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if ((await redis.incr(`rate:${ip}`, RATE.windowSec)) > RATE.limit) return json(res, 429, { error: 'slow down' });

    const body = await readJson(req);
    const question = String(body.question || '').trim().slice(0, MAX_LEN);
    const lang = body.lang === 'ru' ? 'ru' : 'en';
    if (!question) return json(res, 400, { error: 'empty' });

    const id = require('crypto').randomUUID();
    const msg = await telegram('sendMessage', {
      chat_id: env('TELEGRAM_CHAT_ID'),
      text: `❓ ${question}\n\n#${id.slice(0, 8)} · ${lang} — reply to this message and the answer goes to the site.`,
    });
    await redis.set(`ask:${id}`, { question, lang, status: 'sent', answer: null, ts: Date.now() }, TTL);
    await redis.set(`msg:${msg.message_id}`, id, TTL);   // reply → question lookup
    return json(res, 200, { id });
  }

  res.statusCode = 405; res.end();
};

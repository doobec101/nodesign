// Telegram webhook: when Anton replies (Telegram "Reply") to a forwarded question, the reply becomes the answer.
const { env, redis, json, telegram } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  if (req.headers['x-telegram-bot-api-secret-token'] !== env('TELEGRAM_WEBHOOK_SECRET')) { res.statusCode = 401; return res.end(); }

  let update = req.body;
  if (!update || typeof update !== 'object') { let raw = ''; for await (const c of req) raw += c; try { update = JSON.parse(raw); } catch (e) { update = {}; } }

  const m = update.message;
  if (m && String(m.chat.id) === String(env('TELEGRAM_CHAT_ID')) && m.reply_to_message && m.text) {
    const id = await redis.get(`msg:${m.reply_to_message.message_id}`);
    const rec = id && await redis.get(`ask:${id}`);
    if (rec) {
      await redis.set(`ask:${id}`, { ...rec, status: 'answered', answer: m.text.trim(), answeredAt: Date.now() }, 24 * 60 * 60);
      await telegram('sendMessage', { chat_id: m.chat.id, reply_to_message_id: m.message_id, text: '✓ Published on the site.' });
    }
  }
  json(res, 200, { ok: true });   // always 200 so Telegram does not retry
};

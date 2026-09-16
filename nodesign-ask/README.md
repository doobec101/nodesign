# nodesign-ask — реле «Спросить у Антона»

Маленький бэкенд для кнопки **Спросить у Антона** на `nodesign.html`: вопрос с сайта уходит тебе в Telegram, твой ответ (обычный Reply на сообщение бота) публикуется в чате на сайте. Две serverless-функции для Vercel + Upstash Redis для хранения (бесплатных тарифов достаточно).

## Как поднять (≈ 15 минут)

1. **Бот.** В Telegram открой [@BotFather](https://t.me/BotFather) → `/newbot` → сохрани токен.
   Напиши своему боту `/start` (иначе он не сможет писать тебе первым).
2. **Свой chat_id.** Открой в браузере `https://api.telegram.org/bot<ТОКЕН>/getUpdates` после `/start` — в ответе будет `"chat":{"id":123456789,…}`. Это `TELEGRAM_CHAT_ID`.
3. **Redis.** На [upstash.com](https://upstash.com) создай базу Redis → скопируй `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`.
4. **Деплой.** Из этой папки: `npx vercel` (или импортируй папку как проект на vercel.com). В настройках проекта добавь переменные окружения:

   | Переменная | Значение |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | токен от BotFather |
   | `TELEGRAM_CHAT_ID` | твой chat_id |
   | `TELEGRAM_WEBHOOK_SECRET` | любая длинная случайная строка |
   | `UPSTASH_REDIS_REST_URL` | из Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | из Upstash |
   | `ALLOWED_ORIGIN` | домен сайта, например `https://nodesign.webflow.io` (`*` на время тестов) |

5. **Вебхук.** Один раз выполни (подставь свои значения):
   ```bash
   curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://<проект>.vercel.app/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
6. **Сайт.** В `nodesign.html` впиши адрес реле: `const ASK_ENDPOINT = 'https://<проект>.vercel.app/api/ask';`

## Как это работает

- `POST /api/ask` `{question, lang}` → бот присылает тебе `❓ вопрос` с коротким id → сайт получает `{id}` и показывает статус «Антон получил сообщение / думает над ответом / печатает».
- Ты отвечаешь **Reply** на это сообщение — вебхук `/api/telegram` сохраняет текст как ответ, бот подтверждает «✓ Published on the site».
- Сайт каждые 4 с спрашивает `GET /api/ask?id=…`; как только `status: answered`, ответ появляется в чате. Через 15 минут без ответа сайт предлагает написать в Telegram напрямую.
- Защита: не больше 5 вопросов за 10 минут с одного IP, вопрос до 500 символов, вебхук принимает только твой chat_id и только с секретом.

Пока `ASK_ENDPOINT` пустой, кнопка «Спросить у Антона» просто открывает Telegram с вопросом в черновике — сайт работает и без реле.

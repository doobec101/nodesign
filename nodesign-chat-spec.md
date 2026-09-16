# nodesign — поведение чата (спецификация для воспроизведения)

Источник: [`nodesign.html`](./nodesign.html). Все значения ниже — из токенов этого файла, а не из `tokens.css` TR DS.

---

## 0. Токены, которые участвуют

```
--ease-standard: cubic-bezier(.4, 0, .2, 1)
--ease-out:      cubic-bezier(0, 0, .2, 1)
--dur-quiet:  .15s   hover / meta
--dur-arrow:  .2s    появление строки (msg, branch)
--dur-reveal: .28s   затухание hero-copy и футера
--dur-panel:  .3s    переезд композера (FLIP), рост textarea

--color-ink        основной текст (ответ, активный branch, точки typing)
--color-ink-muted  вопрос, неактивный branch, плейсхолдер
--color-ink-faint  meta (время + copy), заголовок «Conversation»
--color-hover      hover любого интерактива (#FA4616)

--text-label 13px (16px < 768)   текст сообщений, branch, textarea
--text-caption 10px (12px < 768) meta, cap
--tracking-wider .05em

--dot 3.2px  --dot-gap 4px        точки typing
--header-h 62px  --page-gutter 20px  --container-media 506px
--ui-scale 1.25 (1 на < 768) — body zoom; учитывать при FLIP
```

---

## 1. Структура DOM

```
main.hero
  .hero-inner                       (flex column, center, gap 23px, max-width 762)
    .hero-copy                      заголовок + лид; в чате уходит
    .thread#thread                  role="log" aria-live="polite" — лента сообщений
    .plate-wrap                     композер (form.plate → textarea + placeholder + tools)
aside.branches#branches             список всех вопросов (левый гаттер, ≥ 1200px)
  .cap  "Conversation"
  button.branch …
```

Состояние чата — один класс: `body.is-chat`. Всё остальное реагирует на него через CSS.

---

## 2. Вход в чат (первый submit)

Триггер: submit формы с непустым `value.trim()`. Enter отправляет, Shift+Enter — перенос.

Порядок в обработчике submit — строго такой:

1. `q = ta.value.trim()`; если пусто — выход.
2. Очистить поле, `sync()` (send-кнопка гаснет, плейсхолдер возвращается, высота 36px), `ta.focus()`.
3. `enterChat()` — см. ниже. Идемпотентен: если `is-chat` уже есть, ничего не делает.
4. Добавить вопрос `addMsg('msg-q', q, asText=true)`.
5. Добавить branch на этот вопрос.
6. Добавить индикатор набора `addMsg('msg-a typing', '<i></i><i></i><i></i>')`.
7. `scrollToEnd()`.
8. Через **650 мс** (0 при reduced-motion): удалить typing → `addAnswer(answer(q))` → `scrollToEnd()`.

### enterChat()

```js
const from = plateWrap.getBoundingClientRect();   // ДО смены класса
document.body.classList.add('is-chat');
fitComposer();                                    // --composer-h = plateWrap.offsetHeight
if (!reduced.matches) {
  const to = plateWrap.getBoundingClientRect();   // ПОСЛЕ
  const scale = --ui-scale;                       // body zoom, иначе смещение будет ×1.25
  plateWrap.style.transition = 'none';
  plateWrap.style.translate = `${(from.left - to.left) / scale}px ${(from.top - to.top) / scale}px`;
  plateWrap.getBoundingClientRect();              // force reflow
  plateWrap.style.transition = 'translate var(--dur-panel) var(--ease-out)';
  plateWrap.style.translate = '0 0';
  // cleanup: transitionend {once} + setTimeout 400 (если вкладка скрыта, transitionend не придёт)
}
```

Что делает `body.is-chat` в CSS:

| Элемент | Было | Стало |
|---|---|---|
| `.hero` | `min-height: 100lvh/scale`, центр | `min-height: 0; align-items: flex-start; padding-top: header-h + 20; padding-bottom: composer-h + gutter×2` |
| `.hero-copy` | в потоке | `position: absolute; inset: 0 auto auto 0; opacity: 0; pointer-events: none` — уходит из потока, чтобы thread не прыгал. Затухание: `opacity var(--dur-reveal) var(--ease-out)` |
| `.plate-wrap` | в потоке под лидом | `position: fixed; left/right: gutter; bottom: gutter; margin: 0 auto; z-index: 40` (max-width 506 сохраняется) |
| `.site-footer` | виден | `opacity: 0; pointer-events: none` (тот же `--dur-reveal`) |
| `.thread` | `display: none` | `display: flex` |
| `.branches` | `display: none` | `display: flex` **только ≥ 1200px** |

`--composer-h` держится актуальным через `ResizeObserver` на `.plate-wrap` (композер растёт вместе с textarea → низ ленты и низ branches сдвигаются).

---

## 3. Лента `.thread`

```css
.thread { width: 100%; max-width: var(--container-media); display: flex; flex-direction: column; gap: 18px;
          font-size: var(--text-label); line-height: 1.4; }
.msg    { animation: chat-line-in var(--dur-arrow) var(--ease-out) both;
          scroll-margin-top: calc(var(--header-h) + 20px); }   /* чтобы branch-скролл не прятал вопрос под шапку */
@keyframes chat-line-in { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
```

Лента — в потоке документа: скроллится вся страница, не внутренний контейнер.
`scrollToEnd()` = `scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' | 'auto' })`.

### 3.1 Вопрос `.msg.msg-q`

- Вставляется через `textContent` (никакого HTML от пользователя).
- `color: var(--color-ink-muted)`. Без пузыря, без выравнивания вправо, без времени.

### 3.2 Typing `.msg.msg-a.typing`

```css
.typing   { display: flex; gap: var(--dot-gap); padding: 6px 0; }
.typing i { width: var(--dot); height: var(--dot); border-radius: 50%;
            background: var(--color-ink); opacity: .35;
            animation: chat-typing-dot 1s ease-in-out infinite; }
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes chat-typing-dot { 0%, 60%, 100% { opacity: .35; } 30% { opacity: 1; } }
```

Живёт ровно 650 мс, затем `remove()` и на его место приходит ответ (ответ тоже играет `chat-line-in`).

### 3.3 Ответ `.msg.msg-a`

```html
<div class="msg msg-a">
  <div class="text">…html…</div>                    <!-- innerHTML: можно <a>; \n → перенос через pre-line -->
  <div class="meta">
    <span class="time">HH:MM</span>                  <!-- toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) -->
    <button type="button" class="copy quiet">[svg 11×11]<span>copy</span></button>
  </div>
</div>
```

```css
.msg-a        { color: var(--color-ink); }
.msg-a .text  { white-space: pre-line; }
.msg-a a      { text-decoration: underline; text-underline-offset: 2px; }
.meta { display: flex; align-items: center; gap: 10px; margin-top: 8px;
        font-size: var(--text-caption); line-height: .9; letter-spacing: var(--tracking-wider);
        color: var(--color-ink-faint);
        opacity: 0; transition: opacity var(--dur-quiet) var(--ease-standard); }
.msg-a:hover .meta, .msg-a:focus-within .meta { opacity: 1; }
@media (hover: none) { .meta { opacity: 1; } }        /* на тач всегда видно */
.copy { display: inline-flex; align-items: center; gap: 4px; color: inherit; text-transform: lowercase; }
```

**Copy:**
1. `navigator.clipboard.writeText(text.innerText)` → label `copied`.
2. Если clipboard заблокирован → выделить содержимое `.text` через `Range` → label `selected` (⌘C сработает).
3. Через **1500 мс** label обратно `copy`.
4. Hover на кнопке — `--color-hover` (класс `.quiet`).

### 3.4 Откуда ответ

`answer(q)`: массив `KB = [[regex, html], …]`, **первое совпадение побеждает**, порядок важен (специфичные паттерны выше общих). Нет совпадения → фиксированная фраза `NOT_IN_CV`. Никакой сети, задержка 650 мс — чисто ритмическая.

---

## 4. Branches — оглавление разговора

```css
.branches { position: fixed; left: var(--page-gutter);
            top: calc(var(--header-h) + 20px);
            bottom: calc(var(--composer-h, 50px) + var(--page-gutter) * 2);
            width: 180px; z-index: 40; overflow-y: auto; scrollbar-width: none;
            display: none; flex-direction: column; align-items: flex-start; gap: 12px; }
@media (min-width: 1200px) { body.is-chat .branches { display: flex; } }
.branches .cap { font-size: var(--text-caption); letter-spacing: var(--tracking-wider);
                 text-transform: uppercase; color: var(--color-ink-faint); margin-bottom: 2px; }
.branch { max-width: 100%; text-align: left; font-size: var(--text-label); line-height: 1.2;
          color: var(--color-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          animation: chat-line-in var(--dur-arrow) var(--ease-out) both;
          transition: color var(--dur-quiet) var(--ease-standard); }
.branch.is-active { color: var(--color-ink); }
.branch:hover     { color: var(--color-hover); }
```

`addBranch(q, qEl)`:
- снять `is-active` со всех, создать `button.branch.quiet.is-active` с `textContent = title = q`;
- click → сделать активным только его и `qEl.scrollIntoView({ behavior: smooth|auto, block: 'start' })` (упирается в `scroll-margin-top` вопроса);
- после append — `branches.scrollTop = branches.scrollHeight` (список сам докручивается к последнему).

Активный = последний заданный вопрос, либо тот, по которому кликнули.

---

## 5. Выход из чата

`Escape` при **пустом** textarea и `body.is-chat`:

```js
document.body.classList.remove('is-chat');
thread.textContent = '';
branches.querySelectorAll('.branch').forEach(b => b.remove());   // .cap остаётся
scrollTo(0, 0);
```

История не сохраняется. Обратного FLIP нет: композер просто возвращается в поток, hero-copy и футер проявляются через свой `opacity`-transition (`--dur-reveal`). Если в поле есть текст, Escape ничего не делает.

---

## 6. Композер (то, что влияет на чат)

- **Enter** → `form.requestSubmit()`; **Shift+Enter** → перенос строки.
- **Tab** → принять подсказку из плейсхолдера (пустое поле — целиком; частично набранное, если подсказка начинается с введённого). Иначе Tab отдаётся браузеру.
- Автовысота: `height = clamp(36, scrollHeight, 144)`, transition `height var(--dur-panel)`; класс `is-multiline` при `\n` или переполнении (переключает `white-space: pre → pre-wrap`).
- Send: `opacity: .3; pointer-events: none` → `.is-ready { opacity: 1 }` при непустом `trim()`; `aria-disabled` и `tabindex` синхронно.
- Плейсхолдер: цикл из `scenarios[]`, каждая фраза — анимация `hero-placeholder` 3.4s (blur 6px + translateY ±.9em на входе/выходе), на `animationend` элемент клонируется и заменяется следующей фразой. Скрывается (`hidden`) как только `value.length > 0`.

---

## 7. `prefers-reduced-motion: reduce`

```css
.msg, .branch, .typing i { animation: none; opacity: 1; }
.hero-copy, .site-footer, .plate-wrap { transition: none; }
```

В JS: FLIP пропускается, typing-задержка 0 мс, все `scroll*` — `behavior: 'auto'`.

---

## 8. Чек-лист воспроизведения

- [ ] Один класс состояния `body.is-chat`; всё поведение — CSS-реакция на него + 4 JS-функции (`enterChat`, `exitChat`, `addMsg`/`addAnswer`, `addBranch`).
- [ ] hero-copy уходит через `position: absolute + opacity`, а не `display: none` — чтобы был fade и не прыгала лента.
- [ ] Композер: FLIP с делением на `--ui-scale`, cleanup по `transitionend` + таймаут 400.
- [ ] Порядок при submit: очистить поле → enterChat → вопрос → branch → typing → scroll → 650 мс → ответ → scroll.
- [ ] Каждая строка (вопрос, typing, ответ, branch) — `chat-line-in` 200 мс ease-out, 4px снизу.
- [ ] Meta ответа скрыта, появляется на hover/focus-within за 150 мс; на тач видна всегда.
- [ ] Copy → `copied` / `selected` → через 1.5 с назад `copy`.
- [ ] Branches только ≥ 1200px, активный — последний или кликнутый, клик скроллит к вопросу с учётом шапки.
- [ ] Esc на пустом поле — полный сброс, без анимации возврата композера.
- [ ] `--composer-h` живёт через ResizeObserver: низ ленты и низ branches всегда над композером.

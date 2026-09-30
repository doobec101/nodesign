#!/usr/bin/env node
/* Pre-deploy QA for nodesign: opens the built page (dist/, served the way Vercel serves it) in Chromium, WebKit and
   Firefox under bad conditions — slow or blocked Google Fonts / jsDelivr, Slow 4G, a phone, dark theme, reduced motion,
   an auto-translating browser, file:// — measures when the content and the table loop appear, collects errors, and
   saves screenshots plus contact sheets to qa-report/ for review.

   npm run qa                                   build + full run (exit 1 on any FAIL)
   node scripts/qa.mjs --url https://www.antond.xyz --only desktop,slow-3p     smoke-test production
   node scripts/qa.mjs --browsers chromium,chrome,yandex --only translated     real Chrome / Yandex Browser too */

import { chromium, webkit, firefox } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Playwright waits for document.fonts.ready before every screenshot; we want what the visitor sees while fonts are still on the way
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa-report');

/* ═══ Options ═══ */
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i < 0 ? fallback : argv[i + 1]; };
const list = (s) => s ? s.split(',').map(x => x.trim()).filter(Boolean) : null;
const TARGET_URL = opt('url', null);
const ONLY = list(opt('only', null));
const BROWSERS = list(opt('browsers', 'chromium,webkit,firefox'));

/* ═══ Budgets (ms from navigation) ═══ */
const BUDGET = {
  hero: 3000,          // headline + lede visible
  loop: 6000,          // table loop booted (window.ready inside the iframe)
  heroSlowNet: 6000,   // same on Slow 4G, where the page itself takes a while
  loopSlowNet: 15000,
  cap: 30000,          // stop waiting and screenshot whatever is there
};
const THIRD_PARTY = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net/;

/* ═══ Browsers ═══ */
const ENGINES = {
  chromium: { type: chromium, launch: {} },
  webkit:   { type: webkit,   launch: {} },
  firefox:  { type: firefox,  launch: {} },
  chrome:   { type: chromium, launch: { channel: 'chrome' } },
  yandex:   { type: chromium, launch: { executablePath: '/Applications/Yandex.app/Contents/MacOS/Yandex' } },
};
const isChromium = (b) => ENGINES[b].type === chromium;

/* ═══ Scenarios ═══ */
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };   // 13" MacBook default
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
const SCENARIOS = [
  { id: 'desktop',     note: '1440×900, normal network', context: DESKTOP },
  { id: 'phone',       note: '390×844 touch', context: PHONE },
  { id: 'tablet',      note: '820×1180', context: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 } },
  { id: 'dark',        note: '?theme=dark', context: DESKTOP, query: '?theme=dark' },
  { id: 'reduced',     note: 'prefers-reduced-motion', context: { ...DESKTOP, reducedMotion: 'reduce' } },
  { id: 'slow-3p',     note: 'Google Fonts + jsDelivr answer after 8 s (common from Russia)', context: DESKTOP, thirdParty: 'slow' },
  { id: 'blocked-3p',  note: 'Google Fonts + jsDelivr unreachable', context: DESKTOP, thirdParty: 'blocked' },
  { id: 'slow-net',    note: 'Slow 4G + 4× CPU (Chromium only)', context: DESKTOP, slowNet: true, only: isChromium },
  { id: 'translated',  note: 'browser auto-translate to Russian (simulated)', context: DESKTOP, translate: true },
  { id: 'file',        note: 'opened from disk, file:// (Chromium only)', context: DESKTOP, file: true, only: isChromium },
];

/* ═══ Static server for dist/ (Vercel: cleanUrls, / → index.html) ═══ */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.flac': 'audio/flac', '.woff2': 'font/woff2' };
function serve(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.join(dir, p);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

/* ═══ In-page probes ═══ */
// A translator rewrites text nodes word by word and skips translate="no" / .notranslate / <meta name="google" content="notranslate">.
// Russian runs ~25 % longer than English; unknown words are transliterated and stretched to match.
function pseudoTranslate() {
  const doc = document;
  if (doc.documentElement.getAttribute('translate') === 'no' || doc.querySelector('meta[name="google"][content~="notranslate"]')) return 0;
  const DICT = { from: 'от', to: 'для', atoms: 'атомы', products: 'продукты', new: 'новые', instruments: 'инструменты', price: 'цена',
    change: 'изменение', volume: 'объём', buy: 'купить', sell: 'продать', design: 'дизайн', system: 'система', and: 'и', the: '',
    in: 'в', just: 'всего', months: 'месяцев', speed: 'скорость', more: 'больше', than: 'чем', what: 'что', does: 'делает' };
  const LAT = 'abcdefghijklmnopqrstuvwxyz', CYR = ['а','б','к','д','е','ф','г','х','и','дж','к','л','м','н','о','п','к','р','с','т','у','в','в','кс','й','з'];
  const word = (w) => {
    const lower = w.toLowerCase();
    let out = DICT[lower] ?? [...lower].map(c => { const i = LAT.indexOf(c); return i < 0 ? c : CYR[i]; }).join('') + (w.length > 3 ? 'ов' : '');
    return w[0] === w[0].toUpperCase() && out ? out[0].toUpperCase() + out.slice(1) : out;
  };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let changed = 0;
  for (let n; (n = walker.nextNode());) {
    const el = n.parentElement;
    if (!el || el.closest('script, style, [translate="no"], .notranslate') || !/[A-Za-z]/.test(n.data)) continue;
    n.data = n.data.replace(/[A-Za-z]+/g, word);
    changed++;
  }
  return changed;
}
const loadedFamilies = () => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''));
// Runs in the page and in the iframe from the first byte: wall-clock stamps of the hero reveal and of the loop's window.ready
function stamp() {
  const qa = window.__qa = {};
  const t0 = Date.now();
  const tick = () => {
    const r = document.querySelector('.hero .reveal');
    if (!qa.hero && r && /shown|settled/.test(r.getAttribute('data-reveal') || '')) {
      qa.hero = Date.now();
      qa.heroFonts = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''));
    }
    if (!qa.ready && window.ready === true) qa.ready = Date.now();
    if (Date.now() - t0 < 60000) setTimeout(tick, 50);
  };
  tick();
}

/* ═══ One scenario in one browser ═══ */
async function runScenario(browser, engine, sc, baseUrl) {
  const res = { browser: engine, scenario: sc.id, note: sc.note, checks: [], shots: {}, metrics: {} };
  const fail = (msg) => res.checks.push({ level: 'FAIL', msg });
  const warn = (msg) => res.checks.push({ level: 'WARN', msg });
  const shotDir = path.join(OUT, engine);
  fs.mkdirSync(shotDir, { recursive: true });

  const ctxOpts = { ...sc.context };
  if (engine === 'firefox') { delete ctxOpts.isMobile; }
  const context = await browser.newContext(ctxOpts);
  const errors = [], consoleErrors = [], failed = [];
  if (sc.thirdParty) {
    await context.route(THIRD_PARTY, async (route) => {
      if (sc.thirdParty === 'blocked') return route.abort('blockedbyclient');
      await new Promise(r => setTimeout(r, 8000));
      return route.continue().catch(() => {});
    });
  }
  await context.addInitScript(stamp);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`));
  if (sc.slowNet) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }

  const url = sc.file ? pathToFileURL(path.join(ROOT, 'nodesign.html')).href : baseUrl + (sc.query || '');
  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const shot = async (name) => {
    const file = path.join(shotDir, `${sc.id}-${name}.png`);
    await page.screenshot({ path: file, timeout: 10000 }).catch(() => warn(`screenshot "${name}" timed out — the page did not paint within 10 s`));
    res.shots[name] = path.relative(OUT, file);
  };

  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 30000 });

    // 1 · first impression: what a visitor sees after 2.5 s
    await page.waitForTimeout(2500);
    await shot('2s');

    // 2 · hero revealed (fonts.ready → data-reveal="shown"); timings come from the in-page stamps, not from our waits
    const navStart = await page.evaluate(() => performance.timeOrigin).catch(() => t0);
    const heroBudget = sc.slowNet ? BUDGET.heroSlowNet : BUDGET.hero;
    const heroAt = await page.waitForFunction(() => window.__qa && window.__qa.hero, null,
      { timeout: Math.max(1, BUDGET.cap - since()), polling: 100 }).then(h => h.jsonValue(), () => null);
    res.metrics.heroMs = heroAt ? Math.round(heroAt - navStart) : null;
    if (!heroAt) fail(`hero never appeared (${BUDGET.cap / 1000} s)`);
    else if (res.metrics.heroMs > heroBudget) fail(`hero appeared after ${sec(res.metrics.heroMs)} (budget ${heroBudget / 1000} s) — only the dot grid until then`);
    res.metrics.heroFonts = heroAt ? await page.evaluate(() => window.__qa.heroFonts).catch(() => []) : [];
    if (heroAt && !sc.thirdParty && !sc.slowNet && !res.metrics.heroFonts.includes('Doto')) {
      warn('hero revealed before Doto loaded — the headline flashes the fallback font on a normal connection');
    }
    await page.waitForTimeout(800);
    res.metrics.mainFonts = await page.evaluate(loadedFamilies).catch(() => []);
    await shot('hero');

    // 3 · second screen: scroll to the table loop, wait for it to boot
    await page.evaluate(() => document.querySelector('.work-media')?.scrollIntoView({ block: 'center' })).catch(() => {});
    const loopBudget = sc.slowNet ? BUDGET.loopSlowNet : BUDGET.loop;
    let frame = null, loopAt = null;
    while (since() < BUDGET.cap) {
      frame = page.frames().find(f => f.url().includes('table-loop.html'));
      if (frame && (loopAt = await frame.evaluate(() => window.__qa && window.__qa.ready).catch(() => null))) break;
      await page.waitForTimeout(150);
    }
    const loopReady = !!loopAt;
    res.metrics.loopMs = loopReady ? Math.round(loopAt - navStart) : null;
    if (!loopReady) fail('table loop never started (grey card)');
    else if (res.metrics.loopMs > loopBudget) fail(`table loop started after ${sec(res.metrics.loopMs)} (budget ${loopBudget / 1000} s) — grey card until then`);
    if (loopReady) {
      res.metrics.loopFonts = await frame.evaluate(loadedFamilies).catch(() => []);
      const fontOk = await frame.evaluate(() => window.fontOk).catch(() => null);
      if (fontOk === false) warn('table loop laid out with a fallback font (Inter missing)');
    }
    await page.waitForTimeout(2500);
    await shot('loop');

    // 4 · auto-translate
    if (sc.translate) {
      // the site is English-only on purpose: translation is switched off on <html> of the page and of the loop
      const pageChanged = await page.evaluate(pseudoTranslate);
      const loopChanged = frame ? await frame.evaluate(pseudoTranslate).catch(() => 0) : 0;
      res.metrics.translated = { page: pageChanged, loop: loopChanged };
      if (pageChanged) fail(`auto-translate rewrites ${pageChanged} text nodes on the page — translate="no" on <html> is missing`);
      if (loopChanged) fail(`auto-translate rewrites ${loopChanged} labels inside the table loop, whose layout is measured in English — add translate="no"`);
      await page.waitForTimeout(1500);
      await shot('translated');
    }

    // 5 · layout sanity
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth).catch(() => 0);
    if (overflow > 1) fail(`horizontal scroll: page is ${overflow}px wider than the viewport`);
    if (!sc.thirdParty) {
      const want = ['Doto', 'Roboto Flex'].filter(f => !res.metrics.mainFonts.includes(f));
      if (want.length) warn(`page fonts not loaded: ${want.join(', ')}`);
    } else if (res.metrics.heroMs && !res.metrics.mainFonts.includes('Doto')) {
      warn('headline shown in the fallback monospace (Doto not loaded yet)');
    }
  } catch (e) {
    fail(`run crashed: ${e.message.split('\n')[0]}`);
  }

  // 6 · errors (third-party failures are the point of the *-3p scenarios)
  const expected = (s) => sc.thirdParty && THIRD_PARTY.test(s) || sc.thirdParty === 'blocked' && /Failed to load resource/.test(s);
  errors.forEach(m => fail(`JS error: ${m.slice(0, 200)}`));
  consoleErrors.filter(m => !expected(m)).forEach(m => fail(`console error: ${m.slice(0, 200)}`));
  failed.filter(m => !expected(m) && !/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(m)).forEach(m => warn(`request failed: ${m}`));

  await context.close();
  return res;
}

/* ═══ Report ═══ */
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sec = (ms) => ms == null ? '—' : (ms / 1000).toFixed(1) + ' s';
function reportHtml(results, { scenario, browser, compact } = {}) {
  const rows = results.filter(r => (!scenario || r.scenario === scenario) && (!browser || r.browser === browser));
  const shotNames = ['2s', 'hero', 'loop', 'translated'];
  const body = rows.map(r => `
    <section>
      <h2>${esc(r.scenario)} · ${esc(r.browser)} <small>${esc(r.note)} · hero ${sec(r.metrics.heroMs)} · loop ${sec(r.metrics.loopMs)}</small></h2>
      ${r.checks.map(c => `<div class="${c.level}">${c.level} ${esc(c.msg)}</div>`).join('') || '<div class="OK">OK</div>'}
      <div class="shots">${shotNames.filter(n => r.shots[n]).map(n => `<figure><img src="${esc(r.shots[n])}"><figcaption>${n}</figcaption></figure>`).join('')}</div>
    </section>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>nodesign QA</title><style>
    body { font: 13px/1.4 -apple-system, system-ui, sans-serif; margin: 16px; background: #fff; color: #111; ${compact ? 'width: 1560px;' : ''} }
    h2 { font-size: 14px; margin: 18px 0 4px; } small { font-weight: 400; color: #666; }
    .FAIL { color: #c00; } .WARN { color: #a60; } .OK { color: #070; }
    .shots { display: flex; gap: 8px; margin-top: 6px; } figure { margin: 0; flex: 1; min-width: 0; }
    img { width: 100%; border: 1px solid #ccc; display: block; } figcaption { color: #666; }
  </style><h1>nodesign QA · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</h1>${body}`;
}

/* ═══ Main ═══ */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let server = null, baseUrl = TARGET_URL;
if (!baseUrl) {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/ is missing — run `npm run build` first (npm run qa does it)'); process.exit(2); }
  server = await serve(dist);
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
}
console.log(`QA target: ${baseUrl}\n`);

const results = [];
await Promise.all(BROWSERS.map(async (engine) => {
  const spec = ENGINES[engine];
  if (!spec) { console.log(`skip ${engine}: unknown browser`); return; }
  let browser;
  try { browser = await spec.type.launch(spec.launch); }
  catch (e) { results.push({ browser: engine, scenario: 'launch', note: '', checks: [{ level: 'WARN', msg: `could not launch: ${e.message.split('\n')[0]}` }], shots: {}, metrics: {} }); return; }
  for (const sc of SCENARIOS) {
    if (ONLY && !ONLY.includes(sc.id)) continue;
    if (sc.only && !sc.only(engine)) continue;
    if (sc.file && TARGET_URL) continue;
    const r = await runScenario(browser, engine, sc, baseUrl);
    const fails = r.checks.filter(c => c.level === 'FAIL').length, warns = r.checks.length - fails;
    console.log(`${fails ? 'FAIL' : warns ? 'warn' : ' ok '}  ${engine.padEnd(8)} ${sc.id.padEnd(11)} hero ${sec(r.metrics.heroMs).padStart(6)}  loop ${sec(r.metrics.loopMs).padStart(6)}`);
    results.push(r);
  }
  await browser.close();
}));
server?.close();

const order = (r) => [SCENARIOS.findIndex(s => s.id === r.scenario), BROWSERS.indexOf(r.browser)];
results.sort((a, b) => { const [x, y] = [order(a), order(b)]; return x[0] - y[0] || x[1] - y[1]; });
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(OUT, 'index.html'), reportHtml(results));

// contact sheets for the quick visual pass: one PNG per scenario, browsers stacked; portrait scenarios get one PNG per browser
const sheetBrowser = await chromium.launch();
const sheetPage = await sheetBrowser.newPage({ viewport: { width: 1600, height: 900 } });
fs.mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
const sheets = [];
for (const id of [...new Set(results.map(r => r.scenario))]) {
  const { viewport } = SCENARIOS.find(s => s.id === id)?.context || {};
  if (viewport && viewport.height > viewport.width) results.filter(r => r.scenario === id).forEach(r => sheets.push({ scenario: id, browser: r.browser, name: `${id}-${r.browser}` }));
  else sheets.push({ scenario: id, name: id });
}
for (const s of sheets) {
  const file = path.join(OUT, `sheet-${s.name}.html`);
  fs.writeFileSync(file, reportHtml(results, { ...s, compact: true }));
  await sheetPage.goto(pathToFileURL(file).href);
  await sheetPage.screenshot({ path: path.join(OUT, 'sheets', `${s.name}.png`), fullPage: true });
  fs.rmSync(file);
}
await sheetBrowser.close();

console.log('');
for (const r of results) for (const c of r.checks) console.log(`${c.level}  ${r.browser}/${r.scenario}: ${c.msg}`);
const failCount = results.reduce((n, r) => n + r.checks.filter(c => c.level === 'FAIL').length, 0);
console.log(`\n${failCount ? `${failCount} FAIL` : 'all checks passed'} · report: ${path.relative(process.cwd(), path.join(OUT, 'index.html'))} · sheets: qa-report/sheets/`);
process.exit(failCount ? 1 : 0);

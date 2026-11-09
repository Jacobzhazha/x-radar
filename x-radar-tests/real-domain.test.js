// 真实域名验证（请求拦截版）：本环境无法直连 x.com，改用 CDP Fetch 拦截——
// 地址栏 URL 是真实的 https://x.com / https://twitter.com，响应体由本地提供。
// 加载的是正式版 x-radar/（manifest 未做任何改动），验证 matches 与注入链路。
// 运行：node x-radar-tests/real-domain.test.js
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const WORKSPACE = path.resolve(__dirname, '..');
const EXT_REAL = path.join(WORKSPACE, 'x-radar');
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const DEBUG_PORT = 9223;
const BASE = `http://127.0.0.1:${DEBUG_PORT}`;
const PROFILE = '/tmp/x-radar-real-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 自包含模拟帖子页（内联脚本，避免子资源拦截）
const MOCK_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>mock x</title></head>
<body><div id="stream"></div><script>
const NOW = Date.now();
function makePost(id, ageMin, viewsText) {
  const a = document.createElement('article');
  a.setAttribute('data-testid', 'tweet'); a.id = id;
  a.innerHTML = '<div><a href="/u/status/' + id + '"><time datetime="' + new Date(NOW - ageMin * 60000).toISOString() + '">t</time></a></div>' +
    '<p>content ' + id + '</p><div><a href="/u/status/' + id + '/analytics"><span>' + viewsText + '</span></a></div>';
  return a;
}
document.getElementById('stream').appendChild(makePost('p1', 37.5, '1.2万'));
document.getElementById('stream').appendChild(makePost('p2', 20.5, '12K'));
</script></body></html>`;

class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.handlers = {}; this.exceptions = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(m.params.exceptionDetails);
      } else if (m.method && this.handlers[m.method]) {
        this.handlers[m.method](m.params);
      }
    });
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new CDP(ws);
  }
  on(method, fn) { this.handlers[method] = fn; }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.seq;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function newTab() {
  const r = await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' });
  const t = await r.json();
  const cdp = await CDP.connect(t.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return cdp;
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE}`, `--load-extension=${EXT_REAL}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  await sleep(3000);

  let failures = 0;
  let extId = null;
  for (const url of ['https://x.com/home', 'https://twitter.com/home']) {
    const host = new URL(url).hostname;
    const tab = await newTab();
    await tab.send('Fetch.enable', { patterns: [{ urlPattern: `https://${host}/*`, requestStage: 'Request' }] });
    tab.on('Fetch.requestPaused', (p) => {
      tab.send('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(MOCK_HTML).toString('base64'),
      }).catch(() => {});
    });
    await tab.send('Page.navigate', { url });

    let st = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      try {
        st = await tab.eval(`({
          url: location.href,
          marker: document.documentElement.getAttribute('data-x-radar'),
          tag: document.querySelector('#p1 .x-radar-tag')?.textContent ?? null,
          hot: document.querySelectorAll('article.x-radar-hot').length,
        })`);
        if (st.marker && st.tag) break;
      } catch {}
    }
    const pass = st && st.url.startsWith(`https://${host}/`) && /^[a-p]{32}$/.test(st.marker || '')
      && st.tag === '发出 37 分钟 · 1.2 万浏览 · 每分钟 324' && st.hot === 2;
    if (pass) { extId = st.marker; console.log(`PASS ${url} → 注入成功，标签/描边正确（${JSON.stringify(st)}）`); }
    else { failures++; console.log(`FAIL ${url} → ${JSON.stringify(st)}`); }
    console.log(`  未捕获异常数: ${tab.exceptions.length}`);
    if (tab.exceptions.length) failures++;
    tab.close();
  }

  if (extId) {
    const popup = await newTab();
    await popup.send('Page.navigate', { url: `chrome-extension://${extId}/popup.html` });
    await sleep(1500);
    const st = await popup.eval(`({
      view: document.getElementById('viewThreshold')?.value,
      minute: document.getElementById('minuteThreshold')?.value,
      enabled: document.getElementById('enabled')?.checked,
    })`);
    const pass = st.view === '5000' && st.minute === '60' && st.enabled === true && popup.exceptions.length === 0;
    console.log(`${pass ? 'PASS' : 'FAIL'} 正式版设置面板默认值 ${JSON.stringify(st)}，异常数 ${popup.exceptions.length}`);
    if (!pass) failures++;
    popup.close();
  }

  chrome.kill('SIGTERM');
  await sleep(1000);
  if (chrome.exitCode == null) chrome.kill('SIGKILL');
  console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
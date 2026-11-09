// 端到端测试：真实 Chrome + 测试版扩展（仅 manifest 的 matches 换成 localhost，代码与正式版完全一致）
// 运行：node x-radar-tests/e2e.js
// 覆盖：注入、标签文案、描边阈值、无浏览数跳过、滚动加载、浏览数上涨、去重、
//       设置面板读写、总开关、描边计数消息、持久化（含重启浏览器）、异常输入
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer } = require('./serve.js');

const WORKSPACE = path.resolve(__dirname, '..');
const EXT_SRC = path.join(WORKSPACE, 'x-radar');
const EXT_TEST = path.join(__dirname, 'test-extension');
// 品牌版 Chrome 137+ 忽略 --load-extension，测试用 Chrome for Testing（Chromium 系均支持）
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('找不到可用的 Chrome/Chromium，可用 CHROME_BIN 环境变量指定');
const DEBUG_PORT = 9222;
const HTTP_PORT = 8899;
const PROFILE = '/tmp/x-radar-e2e-profile';
const BASE = `http://127.0.0.1:${DEBUG_PORT}`;
const MOCK_URL = `http://127.0.0.1:${HTTP_PORT}/x-radar-tests/mock.html`;
const SHOTS = path.join(__dirname, 'shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// ---- 测试版扩展：复制正式版代码，仅改 matches ----
function buildTestExtension() {
  fs.mkdirSync(EXT_TEST, { recursive: true });
  for (const f of ['radar-core.js', 'content.js', 'content.css', 'popup.html', 'popup.css', 'popup.js']) {
    fs.copyFileSync(path.join(EXT_SRC, f), path.join(EXT_TEST, f));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_SRC, 'manifest.json'), 'utf8'));
  manifest.content_scripts[0].matches = ['http://localhost/*', 'http://127.0.0.1/*'];
  manifest.name = 'X 起量雷达（测试版）';
  fs.writeFileSync(path.join(EXT_TEST, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// ---- Chrome 生命周期 ----
function launchChrome() {
  return spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--load-extension=${EXT_TEST}`,
    '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
}
async function waitDebugPort(up) {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    try {
      const r = await fetch(`${BASE}/json/version`);
      if (up && r.ok) return;
      if (!up && !r.ok) return;
    } catch { if (!up) return; }
    await sleep(300);
  }
  if (up) throw new Error('Chrome 调试端口未就绪');
}
async function killChrome(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await sleep(1200);
  if (child.exitCode == null) child.kill('SIGKILL');
  await waitDebugPort(false);
}

// ---- 极简 CDP 客户端（Node 内置 WebSocket，无第三方依赖）----
class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.exceptions = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(m.params.exceptionDetails);
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
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.seq;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('页面内执行出错: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }
  close() { try { this.ws.close(); } catch {} }
}
async function newTab(url) {
  const r = await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error('新建标签页失败: ' + r.status);
  const target = await r.json();
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  return cdp;
}
async function waitFor(cdp, expr, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await cdp.eval(expr)) return;
    await sleep(200);
  }
  throw new Error('等待超时: ' + expr);
}

// ---- 页面状态读取 ----
const stateExpr = `(() => {
  const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
  return {
    marker: document.documentElement.getAttribute('data-x-radar'),
    tags: arts.map(a => ({ id: a.id, tag: a.querySelector('.x-radar-tag')?.textContent ?? null,
      tagCount: a.querySelectorAll('.x-radar-tag').length, hot: a.classList.contains('x-radar-hot') })),
  };
})()`;

let chromeProc = null;
let httpServer = null;
async function cleanup() {
  await killChrome(chromeProc);
  if (httpServer) { httpServer.close(); httpServer = null; }
}

async function main() {
  buildTestExtension();
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    await fetch(`${BASE}/json/version`);
    throw new Error(`端口 ${DEBUG_PORT} 已被占用，请先退出残留的测试 Chrome`);
  } catch (e) {
    if (e.message.includes('已被占用')) throw e;
  }
  httpServer = await startServer(HTTP_PORT);
  fs.rmSync(PROFILE, { recursive: true, force: true }); // 测试专用临时配置，每次从干净状态开始
  chromeProc = launchChrome();
  let chrome = chromeProc;
  await waitDebugPort(true);

  // ========== 阶段 1：注入与初始标签/描边 ==========
  console.log('\n[1] 注入与初始渲染');
  const mock = await newTab(MOCK_URL);
  await waitFor(mock, `!!document.documentElement.getAttribute('data-x-radar')`);
  await waitFor(mock, `document.querySelector('#p1 .x-radar-tag') != null`);
  let s = await mock.eval(stateExpr);
  const extId = s.marker;
  ok('内容脚本自动注入 localhost 测试页', !!extId);
  ok('扩展 ID 合法', /^[a-p]{32}$/.test(extId || ''), extId);

  const byId = Object.fromEntries(s.tags.map((t) => [t.id, t]));
  const expectTag = (id, text) => ok(`${id} 标签文案`, byId[id]?.tag === text, `实际: ${byId[id]?.tag}`);
  expectTag('p1', '发出 37 分钟 · 1.2 万浏览 · 每分钟 324');
  expectTag('p2', '发出 20 分钟 · 1.2 万浏览 · 每分钟 600');
  expectTag('p3', '发出 10 分钟 · 3,014浏览 · 每分钟 301');
  expectTag('p4', '发出 2 小时 5 分 · 1.6 亿浏览 · 每分钟 1,280,000');
  expectTag('p6', '发出 3 天 · 500浏览 · 每分钟 0');
  expectTag('p7', '发出 59 分钟 · 5,000浏览 · 每分钟 84');
  expectTag('p8', '发出 1 小时 · 9.9 万浏览 · 每分钟 1,650');
  expectTag('p9', '发出 5 分钟 · 4,999浏览 · 每分钟 999');
  expectTag('p10', '发出 不到 1 分钟 · 100浏览 · 每分钟 100');
  ok('广告帖 p5 无标签', byId.p5?.tag === null);
  ok('每条帖子最多一个标签', s.tags.every((t) => t.tagCount <= 1));
  const hotIds = s.tags.filter((t) => t.hot).map((t) => t.id).sort();
  ok('初始描边 = p1/p2/p7', JSON.stringify(hotIds) === JSON.stringify(['p1', 'p2', 'p7']), hotIds.join(','));
  await mock.screenshot(path.join(SHOTS, 'mock-initial.png'));

  // ========== 阶段 2：滚动加载 + 浏览数上涨 + 去重 ==========
  console.log('\n[2] 动态更新');
  await mock.eval(`window.addMockPost('p11', 2.5, '20K', 20000)`);
  await waitFor(mock, `document.querySelector('#p11 .x-radar-tag') != null`);
  s = await mock.eval(stateExpr);
  let p11 = s.tags.find((t) => t.id === 'p11');
  ok('新加载帖子自动加标签并描边', p11?.hot === true && p11.tag === '发出 2 分钟 · 2 万浏览 · 每分钟 10,000', p11?.tag);

  await mock.eval(`document.querySelector('#p3 a[href*="/analytics"] span').textContent = '8,000'`);
  await waitFor(mock, `document.querySelector('#p3 .x-radar-tag')?.textContent.includes('8,000浏览')`);
  s = await mock.eval(stateExpr);
  const p3 = s.tags.find((t) => t.id === 'p3');
  ok('浏览数上涨后标签更新且变为描边', p3?.hot === true && p3.tag === '发出 10 分钟 · 8,000浏览 · 每分钟 800', p3?.tag);
  ok('反复处理后仍无重复标签', s.tags.every((t) => t.tagCount <= 1));
  ok('当前描边 5 条', s.tags.filter((t) => t.hot).length === 5);

  // ========== 阶段 3：设置面板 ==========
  console.log('\n[3] 设置面板与消息');
  const popup = await newTab(`chrome-extension://${extId}/popup.html`);
  await waitFor(popup, `!!document.getElementById('viewThreshold') && document.getElementById('viewThreshold').value !== ''`);
  ok('面板默认值 5000/60/开', await popup.eval(
    `document.getElementById('viewThreshold').value === '5000' &&
     document.getElementById('minuteThreshold').value === '60' &&
     document.getElementById('enabled').checked`));

  // 面板作为普通标签页打开时，活动标签是它自己 → 应优雅提示而不是报错
  await sleep(300);
  ok('非 X 页面优雅提示', (await popup.eval(`document.getElementById('count').textContent`)).includes('不是 X'));

  // 关键验证：只有 storage 权限时，扩展页面能否给内容脚本发消息
  const msgResp = await popup.eval(`(async () => {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      try {
        const r = await chrome.tabs.sendMessage(t.id, { type: 'x-radar:get-count' });
        if (r) return r;
      } catch (e) {}
    }
    return null;
  })()`);
  ok('storage 权限即可查询描边数', msgResp && msgResp.count === 5 && msgResp.enabled === true, JSON.stringify(msgResp));

  // 改浏览数阈值 5000 → 10000
  await popup.eval(`(() => { const i = document.getElementById('viewThreshold'); i.value = '10000'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(600);
  s = await mock.eval(stateExpr);
  const hotAfter10000 = s.tags.filter((t) => t.hot).map((t) => t.id).sort();
  ok('阈值 10000 后描边 = p1/p2/p11', JSON.stringify(hotAfter10000) === JSON.stringify(['p1', 'p11', 'p2']), hotAfter10000.join(','));
  ok('设置已写入 storage', await popup.eval(
    `chrome.storage.local.get('viewThreshold').then(r => r.viewThreshold === 10000)`));
  ok('保存提示出现', await popup.eval(`document.getElementById('saved').textContent === '已保存'`));

  // 改分钟阈值 60 → 15
  await popup.eval(`(() => { const i = document.getElementById('minuteThreshold'); i.value = '15'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(600);
  s = await mock.eval(stateExpr);
  ok('分钟阈值 15 后只剩 p11 描边', s.tags.filter((t) => t.hot).map((t) => t.id).join(',') === 'p11');
  await popup.eval(`(() => { const i = document.getElementById('minuteThreshold'); i.value = '60'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(600);

  // 异常输入：空串回退默认 5000？当前阈值是 10000，空串应回退到默认 5000
  await popup.eval(`(() => { const i = document.getElementById('viewThreshold'); i.value = ''; i.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  ok('空输入回退默认 5000', await popup.eval(
    `document.getElementById('viewThreshold').value === '5000' &&
     chrome.storage.local.get('viewThreshold').then(r => r.viewThreshold === 5000)`));

  // ========== 阶段 4：总开关 ==========
  console.log('\n[4] 总开关');
  await popup.eval(`document.getElementById('enabled').click()`);
  await sleep(600);
  s = await mock.eval(stateExpr);
  ok('关闭后标签全部移除', s.tags.every((t) => t.tag === null));
  ok('关闭后描边全部移除', s.tags.every((t) => !t.hot));
  await popup.eval(`document.getElementById('enabled').click()`);
  await sleep(600);
  s = await mock.eval(stateExpr);
  ok('重新打开后标签恢复（10 条）', s.tags.filter((t) => t.tag !== null).length === 10);
  ok('重新打开后描边恢复（5 条）', s.tags.filter((t) => t.hot).length === 5);
  await popup.screenshot(path.join(SHOTS, 'popup.png'));
  await mock.screenshot(path.join(SHOTS, 'mock-tagged.png'));

  // ========== 阶段 5：刷新持久化 ==========
  console.log('\n[5] 刷新持久化');
  await popup.eval(`(() => { const i = document.getElementById('viewThreshold'); i.value = '10000'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  await mock.send('Page.navigate', { url: MOCK_URL });
  await waitFor(mock, `document.querySelector('#p1 .x-radar-tag') != null`);
  s = await mock.eval(stateExpr);
  ok('刷新后按已存阈值 10000 描边（p1/p2）',
    JSON.stringify(s.tags.filter((t) => t.hot).map((t) => t.id).sort()) === JSON.stringify(['p1', 'p2']));
  ok('刷新后 p5 仍无标签', s.tags.find((t) => t.id === 'p5')?.tag === null);

  // ========== 阶段 6：重启浏览器持久化 ==========
  console.log('\n[6] 重启浏览器持久化');
  await popup.eval(`(() => { const i = document.getElementById('viewThreshold'); i.value = '8000'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  mock.close(); popup.close();
  await killChrome(chrome);
  chrome = launchChrome();
  chromeProc = chrome;
  await waitDebugPort(true);
  const popup2 = await newTab(`chrome-extension://${extId}/popup.html`);
  await waitFor(popup2, `!!document.getElementById('viewThreshold') && document.getElementById('viewThreshold').value !== ''`);
  ok('重启后阈值仍是 8000', await popup2.eval(`document.getElementById('viewThreshold').value === '8000'`));
  const mock2 = await newTab(MOCK_URL);
  await waitFor(mock2, `document.querySelector('#p1 .x-radar-tag') != null`);
  s = await mock2.eval(stateExpr);
  ok('重启后按 8000 描边（p1/p2）',
    JSON.stringify(s.tags.filter((t) => t.hot).map((t) => t.id).sort()) === JSON.stringify(['p1', 'p2']));

  // ========== 异常收集 ==========
  ok('测试页无未捕获异常', mock2.exceptions.length === 0, JSON.stringify(mock2.exceptions[0] || null));
  ok('设置页无未捕获异常', popup2.exceptions.length === 0, JSON.stringify(popup2.exceptions[0] || null));

  mock2.close(); popup2.close();
  await cleanup();
  console.log(`\n===== ${passed} passed, ${failed} failed =====`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('E2E 运行失败:', e); await cleanup(); process.exit(1); });
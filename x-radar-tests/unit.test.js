// 纯逻辑单元测试：node x-radar-tests/unit.test.js
const assert = require('node:assert');
const R = require('../x-radar/radar-core.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}

// ---- parseViews：中文界面 ----
t('parseViews 1.2万', () => assert.strictEqual(R.parseViews('1.2万'), 12000));
t('parseViews 1.6亿', () => assert.strictEqual(R.parseViews('1.6亿'), 160000000));
t('parseViews 3,014', () => assert.strictEqual(R.parseViews('3,014'), 3014));
t('parseViews 999', () => assert.strictEqual(R.parseViews('999'), 999));
t('parseViews 5万', () => assert.strictEqual(R.parseViews('5万'), 50000));
t('parseViews 带空白', () => assert.strictEqual(R.parseViews(' 1.2 万 '), 12000));

// ---- parseViews：英文界面 ----
t('parseViews 12K', () => assert.strictEqual(R.parseViews('12K'), 12000));
t('parseViews 1.2M', () => assert.strictEqual(R.parseViews('1.2M'), 1200000));
t('parseViews 2B', () => assert.strictEqual(R.parseViews('2B'), 2000000000));
t('parseViews 小写k', () => assert.strictEqual(R.parseViews('12k'), 12000));
t('parseViews 英文逗号', () => assert.strictEqual(R.parseViews('3,014'), 3014));
t('parseViews aria-label', () => assert.strictEqual(R.parseViews('12,345 views'), 12345));

// ---- parseViews：无浏览数 ----
t('parseViews 空串', () => assert.strictEqual(R.parseViews(''), null));
t('parseViews null', () => assert.strictEqual(R.parseViews(null), null));
t('parseViews 纯文字', () => assert.strictEqual(R.parseViews('Views'), null));
t('parseViews 0', () => assert.strictEqual(R.parseViews('0'), 0));

// ---- formatAge ----
t('formatAge 30秒', () => assert.strictEqual(R.formatAge(0.5), '不到 1 分钟'));
t('formatAge 37分', () => assert.strictEqual(R.formatAge(37.5), '37 分钟'));
t('formatAge 59分', () => assert.strictEqual(R.formatAge(59.9), '59 分钟'));
t('formatAge 65分', () => assert.strictEqual(R.formatAge(65), '1 小时 5 分'));
t('formatAge 125分', () => assert.strictEqual(R.formatAge(125), '2 小时 5 分'));
t('formatAge 整2小时', () => assert.strictEqual(R.formatAge(120), '2 小时'));
t('formatAge 25小时', () => assert.strictEqual(R.formatAge(1500), '1 天'));
t('formatAge 3天', () => assert.strictEqual(R.formatAge(3 * 1440 + 60), '3 天'));

// ---- formatViews ----
t('formatViews 12000', () => assert.strictEqual(R.formatViews(12000), '1.2 万'));
t('formatViews 1.6亿', () => assert.strictEqual(R.formatViews(160000000), '1.6 亿'));
t('formatViews 3014', () => assert.strictEqual(R.formatViews(3014), '3,014'));
t('formatViews 10000整', () => assert.strictEqual(R.formatViews(10000), '1 万'));
t('formatViews 5000', () => assert.strictEqual(R.formatViews(5000), '5,000'));

// ---- viewsPerMinute / buildLabel ----
t('增速 12000/37', () => assert.strictEqual(R.viewsPerMinute(12000, 37), 324));
t('增速 不足1分钟按1计', () => assert.strictEqual(R.viewsPerMinute(500, 0.3), 500));
t('增速 向下取整', () => assert.strictEqual(R.viewsPerMinute(100, 3), 33));
t('标签全文 示例', () => assert.strictEqual(
  R.buildLabel(12000, 37), '发出 37 分钟 · 1.2 万浏览 · 每分钟 324'));
t('标签全文 小时', () => assert.strictEqual(
  R.buildLabel(160000000, 125), '发出 2 小时 5 分 · 1.6 亿浏览 · 每分钟 1,280,000'));
t('标签全文 天', () => assert.strictEqual(
  R.buildLabel(3014, 3 * 1440), '发出 3 天 · 3,014浏览 · 每分钟 0'));

// ---- isHot 边界 ----
t('isHot 5000/59 默认阈值', () => assert.strictEqual(R.isHot(5000, 59.9, 5000, 60), true));
t('isHot 4999 不达标', () => assert.strictEqual(R.isHot(4999, 10, 5000, 60), false));
t('isHot 60分钟整 不描边', () => assert.strictEqual(R.isHot(99999, 60, 5000, 60), false));
t('isHot 自定义阈值', () => assert.strictEqual(R.isHot(8000, 45, 10000, 60), false));
t('isHot 自定义分钟阈值', () => assert.strictEqual(R.isHot(8000, 45, 5000, 30), false));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
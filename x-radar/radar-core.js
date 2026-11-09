/*
 * X 起量雷达：纯逻辑函数，不依赖 chrome/DOM，可在 Node 中直接单元测试。
 * 在浏览器内容脚本中作为全局常量 XRadar 使用；在 Node 中通过 module.exports 导出。
 */
const XRadar = (() => {
  // 解析浏览数文本：中文 "1.2万" "1.6亿" "3,014"，英文 "12K" "1.2M" "2B" "3,014"
  function parseViews(text) {
    if (text == null) return null;
    const m = String(text).replace(/\s+/g, '').match(/(\d[\d.,]*)([万亿KMB]?)/i);
    if (!m) return null;
    const num = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(num)) return null;
    const unit = m[2] ? m[2].toUpperCase() : '';
    const mult = { '万': 1e4, '亿': 1e8, K: 1e3, M: 1e6, B: 1e9 }[unit] || 1;
    return Math.round(num * mult);
  }

  // 发出时长文案：不足 1 分钟 / 37 分钟 / 2 小时 5 分 / 3 天
  function formatAge(minutes) {
    if (!Number.isFinite(minutes) || minutes < 1) return '不到 1 分钟';
    if (minutes < 60) return `${Math.floor(minutes)} 分钟`;
    if (minutes < 60 * 24) {
      const h = Math.floor(minutes / 60);
      const m = Math.floor(minutes % 60);
      return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
    }
    return `${Math.floor(minutes / (60 * 24))} 天`;
  }

  // 浏览数统一按中文习惯格式化：1.2 万 / 1.6 亿 / 3,014
  function formatViews(n) {
    const trim1 = (x) => String(Math.round(x * 10) / 10);
    if (n >= 1e8) return `${trim1(n / 1e8)} 亿`;
    if (n >= 1e4) return `${trim1(n / 1e4)} 万`;
    return n.toLocaleString('en-US');
  }

  // 每分钟增速 = 浏览数 ÷ 发出的分钟数（向下取整，分钟数至少按 1 计）
  function viewsPerMinute(views, elapsedMinutes) {
    const mins = Math.max(1, Math.floor(elapsedMinutes));
    return Math.floor(views / mins);
  }

  // 标签全文，例如：发出 37 分钟 · 1.2 万浏览 · 每分钟 324
  function buildLabel(views, elapsedMinutes) {
    const rate = viewsPerMinute(views, elapsedMinutes).toLocaleString('en-US');
    return `发出 ${formatAge(elapsedMinutes)} · ${formatViews(views)}浏览 · 每分钟 ${rate}`;
  }

  // 描边条件：浏览数 ≥ 阈值 且 发出分钟数 < 阈值
  function isHot(views, elapsedMinutes, viewThreshold, minuteThreshold) {
    return views >= viewThreshold && elapsedMinutes < minuteThreshold;
  }

  return { parseViews, formatAge, formatViews, viewsPerMinute, buildLabel, isHot };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = XRadar;
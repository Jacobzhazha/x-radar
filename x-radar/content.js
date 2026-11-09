/*
 * X 起量雷达内容脚本：只读页面数据，仅向页面插入标签和描边样式。
 * 不发起网络请求，不模拟任何点击/点赞/回复等操作。
 */
(() => {
  const DEFAULTS = { enabled: true, viewThreshold: 5000, minuteThreshold: 60 };
  const TAG_CLASS = 'x-radar-tag';
  const HOT_CLASS = 'x-radar-hot';
  const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';

  let settings = { ...DEFAULTS };
  let hotCount = 0;
  let debounceTimer = null;

  function findTag(article) {
    return article.querySelector('.' + TAG_CLASS);
  }

  function clearArticle(article) {
    const tag = findTag(article);
    if (tag) tag.remove();
    article.classList.remove(HOT_CLASS);
  }

  function clearAll() {
    document.querySelectorAll('.' + TAG_CLASS).forEach((t) => t.remove());
    document.querySelectorAll('.' + HOT_CLASS).forEach((a) => a.classList.remove(HOT_CLASS));
    hotCount = 0;
  }

  // 返回该帖子当前是否被描边
  function processArticle(article) {
    const time = article.querySelector('time[datetime]');
    const viewsLink = article.querySelector('a[href*="/analytics"]');
    const postedAt = time ? Date.parse(time.getAttribute('datetime')) : NaN;
    const views = viewsLink
      ? (XRadar.parseViews(viewsLink.textContent) ?? XRadar.parseViews(viewsLink.getAttribute('aria-label')))
      : null;

    // 广告、无浏览数或无法读出发帖时间的帖子：不加标签，不报错
    if (views == null || !Number.isFinite(postedAt)) {
      clearArticle(article);
      return false;
    }

    const elapsedMinutes = Math.max(0, (Date.now() - postedAt) / 60000);
    const hot = XRadar.isHot(views, elapsedMinutes, settings.viewThreshold, settings.minuteThreshold);
    const text = XRadar.buildLabel(views, elapsedMinutes);

    let tag = findTag(article);
    if (!tag) {
      tag = document.createElement('span');
      tag.className = TAG_CLASS;
      time.insertAdjacentElement('afterend', tag);
    }
    // 文本没变就不写 DOM，避免触发 MutationObserver 造成循环
    if (tag.textContent !== text) tag.textContent = text;
    tag.classList.toggle('x-radar-tag-hot', hot);
    article.classList.toggle(HOT_CLASS, hot);
    return hot;
  }

  function processAll() {
    if (!settings.enabled) return;
    let count = 0;
    document.querySelectorAll(ARTICLE_SELECTOR).forEach((article) => {
      if (processArticle(article)) count++;
    });
    hotCount = count;
  }

  function scheduleProcess() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processAll, 250);
  }

  async function init() {
    // 供排查/自检用：控制台里能看到这个属性即说明脚本已注入
    document.documentElement.setAttribute('data-x-radar', chrome.runtime.id);

    const stored = await chrome.storage.local.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
    if (settings.enabled) processAll();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const key of Object.keys(DEFAULTS)) {
        if (changes[key]) settings[key] = changes[key].newValue ?? DEFAULTS[key];
      }
      if (settings.enabled) processAll();
      else clearAll();
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'x-radar:get-count') {
        sendResponse({ count: hotCount, enabled: settings.enabled });
      }
    });

    // 滚动加载、浏览数上涨、React 重渲染都会触发这里
    const observer = new MutationObserver(scheduleProcess);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // 时间本身在流逝：定期重算，让超过阈值的帖子自动取消描边
    setInterval(processAll, 30000);
  }

  init();
})();
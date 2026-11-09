// 构造逼近真实 X 结构的帖子 DOM：article[data-testid=tweet] + time[datetime] + /analytics 链接
// 发帖时间相对页面加载时刻计算，保证测试时年龄稳定在预期区间
(() => {
  const NOW = Date.now();
  const stream = document.getElementById('stream');

  function makePost(id, ageMin, viewsText, viewsExact) {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    article.id = id;
    const dt = new Date(NOW - ageMin * 60000).toISOString();
    const viewsLink = viewsText == null
      ? ''
      : `<a href="/u/status/${id}/analytics" aria-label="${viewsExact} views"><span>${viewsText}</span></a>`;
    article.innerHTML =
      `<div><b>用户_${id}</b> <a href="/u/status/${id}"><time datetime="${dt}">${Math.floor(ageMin)}m</time></a></div>` +
      `<p>这是 ${id} 的帖子内容，用于测试起量雷达。</p>` +
      `<div class="actions"><span>回复</span><span>转发</span><span>喜欢</span>${viewsLink}<span>分享</span></div>`;
    return article;
  }

  const posts = [
    ['p1', 37.5, '1.2万', 12000],   // 热：中文万
    ['p2', 20.5, '12K', 12000],     // 热：英文K
    ['p3', 10.5, '3,014', 3014],    // 不热：浏览数不足
    ['p4', 125, '1.6亿', 160000000],// 不热：超过60分钟（中文亿）
    ['p5', 15, null, null],         // 广告：无浏览数，不应有标签
    ['p6', 4350, '500', 500],       // 不热：3 天前
    ['p7', 59.2, '5,000', 5000],    // 热：双阈值边界内
    ['p8', 60.5, '99K', 99000],     // 不热：刚超 60 分钟
    ['p9', 5.5, '4,999', 4999],     // 不热：浏览数差 1
    ['p10', 0.3, '100', 100],       // 不到 1 分钟
  ];
  for (const [id, age, text, exact] of posts) stream.appendChild(makePost(id, age, text, exact));

  // 供测试脚本模拟“滚动加载更多”
  window.addMockPost = (id, ageMin, viewsText, viewsExact) => {
    stream.appendChild(makePost(id, ageMin, viewsText, viewsExact));
  };
})();
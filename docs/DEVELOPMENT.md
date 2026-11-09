# 开发

插件使用原生 JavaScript、HTML 和 CSS，没有构建步骤。

| 文件 | 作用 |
| --- | --- |
| `x-radar/manifest.json` | Manifest V3 清单、站点匹配和权限 |
| `x-radar/radar-core.js` | 浏览量解析、格式化、平均浏览量和阈值判断 |
| `x-radar/content.js` | 查找帖子、插入标签、更新描边和响应设置 |
| `x-radar/content.css` | 标签和描边样式 |
| `x-radar/popup.html`、`popup.css`、`popup.js` | 设置面板与本地存储 |

内容脚本读取 `article[data-testid="tweet"]`、`time[datetime]` 和 `/analytics` 链接。页面内容变化后延迟 250ms 重新处理，每 30 秒更新帖子时长。

## 逻辑测试

在仓库根目录运行：

```bash
node x-radar-tests/unit.test.js
```

## 浏览器测试

使用 Node.js 22+，通过 `CHROME_BIN` 指定 Chrome for Testing 或 Chromium 的可执行文件路径：

```bash
CHROME_BIN="/path/to/chrome" node x-radar-tests/e2e.js
CHROME_BIN="/path/to/chrome" node x-radar-tests/real-domain.test.js
```

`e2e.js` 在本地模拟时间线上加载测试扩展，覆盖标签、阈值、滚动加载、设置、开关和持久化。`real-domain.test.js` 将本地模拟页面作为 `x.com`、`twitter.com` 的响应，检查正式 manifest 的站点匹配和脚本注入。

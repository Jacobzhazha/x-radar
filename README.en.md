# X Radar

[简体中文](README.md) · English

A small Chrome extension for browsing X. It adds a label beside each post's timestamp showing **post age, views, and average views per minute**, and outlines posts that meet your view and age thresholds.

**[Download](https://github.com/Jacobzhazha/x-radar/releases/latest/download/x-radar-v1.0.0.zip)** · [Installation](#installation) · [Settings](#settings)

## Preview

![Labels and outlines on X](docs/screenshot.jpg)

The extension UI is in Chinese. A label such as `发出 37 分钟 · 1.2 万浏览 · 每分钟 324` means “37 minutes old · 12,000 views · 324 views per minute.”

By default, a post is outlined when it has **at least 5,000 views** and is **less than 60 minutes old**. Posts without a readable view count or timestamp are skipped.

## Installation

1. Download the extension ZIP above and extract the `x-radar` folder.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the `x-radar` folder containing `manifest.json`.
4. Open or refresh X. Labels are added automatically as posts load.

Alternatively, choose **Code → Download ZIP**, extract the source archive, and load its `x-radar` subfolder. No Node.js, build step, or API key is needed.

Keep the loaded folder in place. To update, replace its files, reload the extension on the Extensions page, and refresh X.

## Settings

Pin the extension from Chrome's puzzle-piece menu, then click its toolbar icon.

<img src="docs/popup.png" alt="X Radar settings" width="288">

| Setting | Default | Behavior |
| --- | --- | --- |
| Enabled | On | Show or remove labels and outlines |
| View threshold | 5,000 | Minimum view count for an outline |
| Age threshold | 60 minutes | Post age must be below this value |

Changes are saved locally. The popup also shows the number of outlined posts on the current page.

## How the numbers work

View counts come from the values displayed by X, including Chinese and English abbreviations such as `1.2万`, `1.6亿`, `12K`, `1.2M`, `2B`, and `3,014`.

The per-minute value is the current view count divided by elapsed whole minutes, rounded down. Posts younger than one minute use one minute. Rounded counts displayed by X produce approximate results.

Post ages are recalculated every 30 seconds. Newly loaded or updated page content is also processed; view counts follow the values displayed by X.

## Source

- `x-radar/`: the extension, ready to load.
- `x-radar-tests/`: logic and browser test scripts.
- [Development guide](docs/DEVELOPMENT.md): file structure and test commands.

The extension uses Manifest V3 and requests only `storage`. It runs on `x.com` and `twitter.com`, saves settings in `chrome.storage.local`, has no background script, and makes no network requests.

## Article

[The story behind this extension (Chinese)](https://x.com/leppppp1/status/2119623917241598320)

## License

[MIT](LICENSE)

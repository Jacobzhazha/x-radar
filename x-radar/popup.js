/* X 起量雷达设置面板：读写 chrome.storage.local，向当前标签页询问描边数量 */
const DEFAULTS = { enabled: true, viewThreshold: 5000, minuteThreshold: 60 };
const enabledInput = document.getElementById('enabled');
const viewInput = document.getElementById('viewThreshold');
const minuteInput = document.getElementById('minuteThreshold');
const countEl = document.getElementById('count');
const savedEl = document.getElementById('saved');

let settings = { ...DEFAULTS };
let savedTimer = null;

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  settings = { ...DEFAULTS, ...stored };
  enabledInput.checked = settings.enabled;
  viewInput.value = settings.viewThreshold;
  minuteInput.value = settings.minuteThreshold;
}

function flashSaved() {
  savedEl.textContent = '已保存';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { savedEl.textContent = ''; }, 1500);
}

async function save() {
  await chrome.storage.local.set(settings);
  flashSaved();
}

enabledInput.addEventListener('change', () => {
  settings.enabled = enabledInput.checked;
  save();
});

viewInput.addEventListener('change', () => {
  const raw = viewInput.value.trim();
  const v = raw === '' ? NaN : Math.floor(Number(raw));
  settings.viewThreshold = Number.isFinite(v) && v >= 0 ? v : DEFAULTS.viewThreshold;
  viewInput.value = settings.viewThreshold;
  save();
});

minuteInput.addEventListener('change', () => {
  const raw = minuteInput.value.trim();
  const v = raw === '' ? NaN : Math.floor(Number(raw));
  settings.minuteThreshold = Number.isFinite(v) && v >= 1 ? v : DEFAULTS.minuteThreshold;
  minuteInput.value = settings.minuteThreshold;
  save();
});

async function refreshCount() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('no tab');
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'x-radar:get-count' });
    countEl.textContent = resp.enabled
      ? `当前页面描边：${resp.count} 条`
      : '当前页面描边：0 条（总开关已关闭）';
  } catch (e) {
    countEl.textContent = '当前页面不是 X，或页面尚未加载完成';
  }
}

loadSettings().then(refreshCount);
setInterval(refreshCount, 2000);
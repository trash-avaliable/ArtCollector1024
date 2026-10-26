'use strict';

const DEFAULTS = { port: 47821, token: '' };

async function readCfg() {
  try {
    const s = await chrome.storage.local.get(DEFAULTS);
    return { port: s.port || DEFAULTS.port, token: s.token || '' };
  } catch {
    return { ...DEFAULTS };
  }
}

async function post(path, body) {
  const { port, token } = await readCfg();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, token })
  });
  return res.json();
}

let badgeTimer = null;
function badge(text, color) {
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2800);
  } catch { }
}

function fileName(url) {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return base.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'web';
  } catch { return 'web'; }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'rc-collect',
    title: '存进 RefCollector',
    contexts: ['image']
  });
  chrome.contextMenus.create({
    id: 'rc-page',
    title: '收集本页图片到 RefCollector（最多 30 张）',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'rc-collect' && info.srcUrl) {
    try {
      const r = await post('/collect', {
        url: info.srcUrl,
        pageUrl: info.pageUrl || (tab && tab.url) || '',
        name: fileName(info.srcUrl)
      });
      if (r.ok) badge('+1', '#1a1c17');
      else if (r.dup) badge('DUP', '#6f746a');
      else badge('ERR', '#c73b3b');
    } catch {
      badge('OFF', '#c73b3b');
    }
    return;
  }

  if (info.menuItemId === 'rc-page' && tab && tab.id) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const out = [];
          const seen = new Set();
          const push = (u) => {
            if (!u || !/^https?:/i.test(u) || seen.has(u)) return;
            seen.add(u);
            out.push(u);
          };
          document.querySelectorAll('img').forEach((im) => {
            push(im.currentSrc || im.src);
            if (im.srcset) {
              im.srcset.split(',').forEach((part) => push(part.trim().split(/\s+/)[0]));
            }
          });
          return out.slice(0, 30);
        }
      });
      const urls = (res && res.result) || [];
      let ok = 0, dup = 0;
      for (const u of urls) {
        try {
          const r = await post('/collect', { url: u, pageUrl: tab.url || '', name: fileName(u) });
          if (r.ok) ok++;
          else if (r.dup) dup++;
        } catch { }
      }
      badge(ok ? '+' + ok : dup ? 'DUP' : '0', ok ? '#1a1c17' : '#6f746a');
    } catch {
      badge('ERR', '#c73b3b');
    }
  }
});

// 点图标直接开设置，省得用户去扩展管理页翻
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

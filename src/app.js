/* 应用主逻辑：选关 ↔ 游戏两页路由、进度统计、全局快捷键。 */

import * as store from './storage.js';
import { $, toast } from './ui/dom.js';
import { createLevelBrowser, nextInOrder } from './ui/browser.js';
import { createPlayView } from './ui/play.js';
import { VERSION_STRING, VERSION_FULL } from './version.js';

const state = {
  manifest: null,
  browser: null,
  play: null,
  currentFile: null,
  /** 左侧关卡列表抽屉是否展开 */
  drawerOpen: false,
  /** 当前是否已经载入某一关 */
  levelLoaded: false,
};

function totalProgress() {
  // 只统计**游戏内可玩**的关卡（manifest.playGroups，28 个地点组共 1225 关）。
  // 另有 12 关（Data 示例 + 教程）游戏里不显示，不计入。
  let done = 0;
  let total = 0;
  const src = state.manifest.playGroups?.length ? state.manifest.playGroups : state.manifest.groups;
  for (const g of src) {
    for (const p of g.puzzles) {
      total++;
      if (store.isDone(p.file)) done++;
    }
  }
  return { done, total };
}

function refreshProgressChip() {
  const { done, total } = totalProgress();
  $('#progress-text').textContent = `${done} / ${total}`;
  $('#progress-chip').title = `已通关 ${done} / ${total} 关（${total ? Math.round((done / total) * 100) : 0}%）`;
}

/* ---------------- 左侧抽屉 ---------------- */
function setDrawer(open) {
  state.drawerOpen = !!open;
  $('#drawer').classList.toggle('closed', !state.drawerOpen);
  $('#drawer-overlay').classList.toggle('closed', !state.drawerOpen);
  $('#btn-home').classList.toggle('active', state.drawerOpen);
  if (state.drawerOpen) {
    state.browser?.refresh();
    // 展开后把焦点给输入框，方便直接敲 ID 跳转
    setTimeout(() => $('#jump-input')?.focus(), 60);
  }
}

function setLevelLoaded(on) {
  state.levelLoaded = !!on;
  $('#play-grid').classList.toggle('hidden', !on);
  $('#play-empty').classList.toggle('hidden', on);
  $('#bottombar').classList.toggle('hidden', !on);
}

async function boot() {
  // 版本号（右下角），便于确认页面是否为最新版本
  const badge = document.getElementById('version-badge');
  if (badge) {
    badge.textContent = `v${VERSION_STRING}`;
    badge.title = `当前页面版本 ${VERSION_FULL}\n（若与最新版本不符，请按 Ctrl+Shift+R 强制刷新）`;
  }
  console.info(`[taog] v${VERSION_STRING} (${VERSION_FULL})`);

  try {
    const res = await fetch('data/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.manifest = await res.json();
  } catch (err) {
    document.getElementById('level-browser').innerHTML =
      `<div class="group"><div class="group-head"><div><div class="name">无法读取关卡清单</div>` +
      `<div class="rules">${err.message}</div></div></div>` +
      `<p class="hint">请在本目录下起一个静态服务器再打开，例如：<br>` +
      `<code>python -m http.server 8000</code><br>然后访问 <code>http://localhost:8000/</code></p></div>`;
    return;
  }

  state.browser = createLevelBrowser({
    manifest: state.manifest,
    store,
    onPick: (p) => openLevel(p),
  });

  state.play = createPlayView({
    store,
    onContinue: (p) => goNext(p),
    onSolved: () => {
      state.browser.refresh();
      refreshProgressChip();
    },
  });
  state.play.wire();

  $('#btn-home').onclick = () => setDrawer(!state.drawerOpen);
  $('#drawer-close').onclick = () => setDrawer(false);
  $('#drawer-overlay').onclick = () => setDrawer(false);

  // 快捷跳转：输入关卡 ID 回车
  const jumpInput = $('#jump-input');
  const doJump = () => {
    const raw = jumpInput.value;
    if (!raw.trim()) return;
    const hit = state.browser.jumpTo(raw);
    if (hit) {
      jumpInput.classList.remove('bad');
      toast(`跳转到 ${hit.id}`, 'ok');
    } else {
      jumpInput.classList.add('bad');
      toast(`找不到关卡「${raw.trim()}」`, 'bad');
    }
  };
  jumpInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); doJump(); }
    ev.stopPropagation();
  });
  jumpInput.addEventListener('input', () => jumpInput.classList.remove('bad'));
  $('#jump-btn').onclick = doJump;

  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    if (ev.key === 'Escape') { setDrawer(!state.drawerOpen); return; }
    if (!state.levelLoaded) return;
    const k = ev.key.toLowerCase();
    if (k === 'z') { ev.preventDefault(); state.play.undo(); }
    else if (k === 'r') { ev.preventDefault(); state.play.restart(); }
    else if (ev.key === ' ') { ev.preventDefault(); state.play.submit(); }
  });

  setLevelLoaded(false);
  state.browser.show();
  setDrawer(true);
  // 顶栏进度：boot 里没有 showView() 可调，得自己刷一次，
  // 否则会一直显示 HTML 里的占位 `0 / 0`
  refreshProgressChip();

  // 恢复上次关卡
  const last = store.getLast();
  if (last) {
    const found = findPuzzle(last);
    if (found) openLevel(found, { silent: true, keepDrawer: true });
  }
}

function findPuzzle(file) {
  for (const g of state.manifest.playGroups ?? state.manifest.groups) {
    const p = g.puzzles.find((x) => x.file === file);
    if (p) return p;
  }
  return null;
}

/**
 * 「继续」：按抽屉里显示的顺序取下一关（组内下一关 → 下一组第一关）。
 * 顺序逻辑在 `browser.js` 的 `nextInOrder()`，那里有对应的单元测试。
 */
async function goNext(p) {
  const nx = nextInOrder(state.manifest, p.file);
  if (!nx) {
    toast('已经是最后一关 🎉', 'ok');
    return;
  }
  toast(`下一关：${nx.id}`, 'ok');
  await openLevel(nx, { silent: true });
}

async function openLevel(p, { silent = false, keepDrawer = false } = {}) {
  try {
    const res = await fetch(p.file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    Object.assign(data, {
      file: p.file,
      zone: p.zone,
      zoneTitle: p.zoneTitle,
      folder: p.folder,
      id: p.id,
    });
    state.currentFile = p.file;
    store.setLast(p.file);
    state.browser.setZone(p.zone);
    state.browser.setCurrent(p.file);
    state.play.load(data);
    setLevelLoaded(true);
    if (!keepDrawer) setDrawer(false);
    state.browser.refresh();
  } catch (err) {
    if (!silent) toast(`关卡加载失败：${err.message}`, 'bad');
  }
}

boot();

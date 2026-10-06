/* 进度存档：用 localStorage 记住每关是否通关、以及当前进度。 */

const KEY_DONE = 'taog.done.v1';
const KEY_LAST = 'taog.last.v1';

function readSet() {
  try {
    const raw = localStorage.getItem(KEY_DONE);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

let done = readSet();

export function isDone(id) {
  return done.has(id);
}

export function markDone(id) {
  done.add(id);
  persist();
}

export function unmarkDone(id) {
  done.delete(id);
  persist();
}

export function doneCount() {
  return done.size;
}

export function allDone() {
  return new Set(done);
}

function persist() {
  try {
    localStorage.setItem(KEY_DONE, JSON.stringify([...done]));
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

export function setLast(file) {
  try {
    localStorage.setItem(KEY_LAST, file);
  } catch {
    /* 忽略 */
  }
}

export function getLast() {
  try {
    return localStorage.getItem(KEY_LAST);
  } catch {
    return null;
  }
}

export function resetAll() {
  done = new Set();
  persist();
  try { localStorage.removeItem(KEY_PROG); } catch { /* 忽略 */ }
}

/* ---------------- 每关的分区进度（可继续） ---------------- */

const KEY_PROG = 'taog.progress.v1';
/** 存档格式版本：棋盘模型或区域号语义变化时提升，旧存档自动丢弃 */
const PROG_SCHEMA = 3;

function readProgress() {
  try {
    const raw = localStorage.getItem(KEY_PROG);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // 旧格式（没有 schema 或版本不符）直接丢弃，避免把过期的涂色当成当前进度载入
    if (!parsed || parsed.schema !== PROG_SCHEMA) {
      localStorage.removeItem(KEY_PROG);
      return {};
    }
    return parsed.data ?? {};
  } catch {
    return {};
  }
}

let progress = readProgress();

export function getProgress(file) {
  return progress[file]?.grid ?? null;
}

export function setProgress(file, grid) {
  progress[file] = { grid, at: Date.now() };
  // 只保留最近 80 关，避免 localStorage 膨胀
  const keys = Object.keys(progress);
  if (keys.length > 80) {
    keys.sort((a, b) => (progress[a].at ?? 0) - (progress[b].at ?? 0));
    for (const k of keys.slice(0, keys.length - 80)) delete progress[k];
  }
  persistProgress();
}

export function clearProgress(file) {
  delete progress[file];
  persistProgress();
}

/** 清掉所有关卡的分区进度（通关记录保留） */
export function clearAllProgress() {
  progress = {};
  persistProgress();
}

/* ---------------- 每关的涂鸦（纯批注，和谜题进度分开存） ---------------- */

const KEY_DOODLE = 'taog.doodle.v1';

function readDoodles() {
  try {
    const raw = localStorage.getItem(KEY_DOODLE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let doodles = readDoodles();

export function getDoodle(file) {
  return doodles[file]?.s ?? null;
}

export function setDoodle(file, strokes) {
  if (Array.isArray(strokes) && strokes.length) {
    doodles[file] = { s: strokes, at: Date.now() };
  } else {
    delete doodles[file];
  }
  // 只留最近 60 关，避免 localStorage 膨胀（笔迹比进度占地方）
  const keys = Object.keys(doodles);
  if (keys.length > 60) {
    keys.sort((a, b) => (doodles[a].at ?? 0) - (doodles[b].at ?? 0));
    for (const k of keys.slice(0, keys.length - 60)) delete doodles[k];
  }
  persistDoodles();
}

export function clearDoodle(file) {
  delete doodles[file];
  persistDoodles();
}

function persistDoodles() {
  try {
    localStorage.setItem(KEY_DOODLE, JSON.stringify(doodles));
  } catch {
    /* 写不下就算了：涂鸦丢一点不影响玩 */
  }
}

function persistProgress() {
  try {
    localStorage.setItem(KEY_PROG, JSON.stringify({ schema: PROG_SCHEMA, data: progress }));
  } catch {
    /* 忽略写入失败 */
  }
}

/* ---------------- 选关抽屉的浏览状态（上次看的是哪一区 / 哪些组展开 / 滚到哪） ---------------- */

const KEY_VIEW = 'taog.browserview.v1';

/**
 * 读回上次的抽屉状态。
 * @returns {{zone?:string, collapsed?:string[], scrollTop?:number}}
 */
export function getBrowserView() {
  try {
    const raw = localStorage.getItem(KEY_VIEW);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** 保存抽屉状态；字段都做一次类型收敛，坏数据不会让下次打开崩掉。 */
export function setBrowserView(v) {
  try {
    localStorage.setItem(KEY_VIEW, JSON.stringify({
      zone: typeof v?.zone === 'string' ? v.zone : null,
      collapsed: Array.isArray(v?.collapsed) ? v.collapsed.filter((k) => typeof k === 'string') : [],
      scrollTop: Number.isFinite(v?.scrollTop) ? Math.max(0, Math.round(v.scrollTop)) : 0,
    }));
  } catch {
    /* 忽略 */
  }
}

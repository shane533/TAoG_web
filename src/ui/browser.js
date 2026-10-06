/* 左侧抽屉里的关卡列表：按**游戏内的地点组**纵向列出（第一区 / 第二区 / 第三区）。
 *
 * 分组来源：`data/play_groups.json`（由 tools/play_groups.py 从主关卡地图的放置顺序
 * 精确切分而来，28 组共 1225 关，与游戏一致）。`Data` 区（开发用示例关）不展示。
 *
 * 组内顺序 = 难度升序，同难度按存档解锁顺序（见 tools/play_groups.py）。
 */

const STAR = '★';

/** 不展示的区：`Data` 是开发用的示例关卡（14xx / default / test*），不是正式内容。 */
const HIDDEN_ZONES = new Set(['Data']);

/**
 * 按**抽屉里显示的顺序**取下一关。
 *
 * 顺序 = `playGroups` 的组顺序，组内按 `puzzles` 数组
 * （难度 ↑，同难度按存档解锁顺序，见 tools/play_groups.py）。
 * 走到组尾就进下一组的第一关；走到最后一关返回 null。
 *
 * @param {object} manifest
 * @param {string} file 当前关卡的路径
 * @returns {object|null} 下一关，或 null（已是最后一关）
 */
export function nextInOrder(manifest, file) {
  const groups = (manifest?.playGroups ?? []).filter((g) => g.puzzles?.length);
  for (let gi = 0; gi < groups.length; gi++) {
    const list = groups[gi].puzzles;
    const i = list.findIndex((x) => x.file === file);
    if (i < 0) continue;
    if (i + 1 < list.length) return list[i + 1];
    return groups[gi + 1]?.puzzles?.[0] ?? null;
  }
  return null;
}

export function createLevelBrowser({ onPick, store, manifest }) {
  const tabsEl = document.getElementById('zone-tabs');
  const boxEl = document.getElementById('level-browser');
  let currentFile = null;

  const playZones = (manifest.playZones ?? []).filter((z) => !HIDDEN_ZONES.has(z.key));
  const playGroups = manifest.playGroups ?? [];
  const groupByKey = new Map(playGroups.map((g) => [g.key, g]));

  /* ---------------- 浏览状态：跨「收起抽屉 / 刷新页面」都要记住 ----------------
   * 记住三件事：看的是哪一区、哪些组是展开的、列表滚到哪。
   * 以前每次打开抽屉都从第一区第一组、滚到顶部开始，找过的位置全丢了。 */
  const saved = store.getBrowserView?.() ?? {};
  let zone = playZones.some((z) => z.key === saved.zone) ? saved.zone : (playZones[0]?.key ?? null);
  /** 被折叠起来的组 key */
  const collapsed = new Set(
    (Array.isArray(saved.collapsed) ? saved.collapsed : [])
      .filter((k) => groupByKey.has(k)),
  );
  let scrollTop = Number.isFinite(saved.scrollTop) ? saved.scrollTop : 0;
  /** 首次进入（没有任何存档）时才套用「第一组展开、其余收起」的默认 */
  let restored = Array.isArray(saved.collapsed) && saved.collapsed.length > 0;

  function persistView() {
    store.setBrowserView?.({ zone, collapsed: [...collapsed], scrollTop });
  }

  /** 记录当前滚动位置（renderList 会重建 DOM，把 scrollTop 冲掉） */
  function captureScroll() {
    if (boxEl.scrollTop) scrollTop = boxEl.scrollTop;
  }

  function applyScroll() {
    boxEl.scrollTop = scrollTop;
  }

  function zoneProgress(key) {
    const z = playZones.find((v) => v.key === key);
    let done = 0;
    let total = 0;
    for (const gk of z?.groups ?? []) {
      for (const p of groupByKey.get(gk)?.puzzles ?? []) {
        total++;
        if (store.isDone(p.file)) done++;
      }
    }
    return { done, total };
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const z of playZones) {
      const { done, total } = zoneProgress(z.key);
      const b = document.createElement('button');
      b.className = z.key === zone ? 'active' : '';
      b.textContent = `${z.title} ${done}/${total}`;
      b.title = `${z.title}　完成 ${total ? Math.round((done / total) * 100) : 0}%`;
      b.onclick = () => {
        if (z.key === zone) return;          // 点当前区：什么都不做，别把展开状态冲掉
        captureScroll();
        zone = z.key;
        resetCollapse();
        scrollTop = 0;
        persistView();
        renderTabs();
        renderList();
      };
      tabsEl.appendChild(b);
    }
  }

  /** 切到**新**区时重置折叠状态：第一组展开，其余收起 */
  function resetCollapse() {
    collapsed.clear();
    const z = playZones.find((v) => v.key === zone);
    (z?.groups ?? []).forEach((k, i) => { if (i > 0) collapsed.add(k); });
    restored = true;
  }

  function renderList() {
    captureScroll();
    boxEl.innerHTML = '';
    const z = playZones.find((v) => v.key === zone);
    // 没有任何存档时，才给一个「第一组展开、其余收起」的初始形态
    if (!restored) {
      (z?.groups ?? []).forEach((k, i) => { if (i > 0) collapsed.add(k); });
      restored = true;
    }
    for (const gk of z?.groups ?? []) {
      const g = groupByKey.get(gk);
      if (!g) continue;
      const doneN = g.puzzles.filter((p) => store.isDone(p.file)).length;
      const wrap = document.createElement('div');
      wrap.className = 'group' + (collapsed.has(gk) ? ' collapsed' : '');

      const head = document.createElement('div');
      head.className = 'group-head';
      head.innerHTML =
        `<div><div class="name"><span class="caret">▶</span><span class="gname"></span></div>` +
        `<div class="rules"></div></div>` +
        `<div class="count">${doneN}/${g.count}</div>`;
      head.querySelector('.gname').textContent = g.title;
      head.querySelector('.rules').textContent = g.en;
      head.onclick = () => {
        if (collapsed.has(gk)) collapsed.delete(gk);
        else collapsed.add(gk);
        renderList();
        applyScroll();
        persistView();
      };
      wrap.appendChild(head);

      const list = document.createElement('div');
      list.className = 'levels';
      for (const p of g.puzzles) {
        const el = document.createElement('div');
        el.className = 'level';
        if (store.isDone(p.file)) el.classList.add('done');
        if (p.file === currentFile) el.classList.add('current');
        el.innerHTML = `<span class="lid"></span><span class="diff"></span>`;
        el.querySelector('.lid').textContent = p.id;
        el.querySelector('.diff').textContent =
          p.difficulty > 0 ? STAR.repeat(Math.min(6, p.difficulty)) : '';
        el.title = `${p.id}　难度 ${p.difficulty}　${p.cols}×${p.rows}` +
          (p.regions ? `　${p.regions} 个区域` : '') +
          (store.isDone(p.file) ? '　（已通关）' : '');
        el.onclick = () => onPick(p);
        list.appendChild(el);
      }
      wrap.appendChild(list);
      boxEl.appendChild(wrap);
    }
    // 重建 DOM 会把 scrollTop 冲成 0，这里放回去；并顺手把状态写盘
    applyScroll();
    persistView();
  }

  /** 找到某个 ID 对应的关卡（大小写不敏感，接受 "96" / "0096" / "0067B"） */
  function findById(raw) {
    const q = String(raw ?? '').trim().toLowerCase();
    if (!q) return null;
    const pool = [];
    for (const g of playGroups) for (const p of g.puzzles) pool.push(p);
    const exact = pool.find((p) => p.id.toLowerCase() === q);
    if (exact) return exact;
    const padded = /^\d+$/.test(q) ? q.padStart(4, '0') : null;
    if (padded) {
      const hit = pool.find((p) => p.id.toLowerCase() === padded);
      if (hit) return hit;
    }
    // 唯一前缀匹配
    const pref = pool.filter((p) => p.id.toLowerCase().startsWith(q));
    return pref.length === 1 ? pref[0] : null;
  }

  /** 跳到指定 ID 的关卡；成功返回该关卡，失败返回 null */
  function jumpTo(raw) {
    const p = findById(raw);
    if (!p) return null;
    selectZoneOf(p);
    revealGroupOf(p);
    currentFile = p.file;
    renderList();
    // 把目标那条滚进视野
    const el = [...boxEl.querySelectorAll('.level')]
      .find((n) => n.querySelector('.lid')?.textContent === p.id);
    el?.scrollIntoView({ block: 'center' });
    persistView();
    onPick(p);
    return p;
  }

  function selectZoneOf(p) {
    const z = playZones.find((v) => v.key === p.zone);
    if (!z) return;
    if (zone !== z.key) {
      zone = z.key;
      resetCollapse();
      renderTabs();
    }
  }

  function revealGroupOf(p) {
    const g = playGroups.find((x) => x.puzzles.some((q) => q.file === p.file));
    if (g) collapsed.delete(g.key);
  }

  function show() {
    if (!zone) zone = playZones[0]?.key ?? null;
    renderTabs();
    renderList();
    applyScroll();
  }

  /** 重画并保住滚动位置。列表面板上的滚动事件也会回写 scrollTop。 */
  function refresh() {
    renderTabs();
    renderList();
    applyScroll();
    persistView();
  }

  boxEl.addEventListener('scroll', () => {
    scrollTop = boxEl.scrollTop;
    persistView();
  }, { passive: true });

  return {
    show,
    refresh,
    /**
     * 切到某一区。
     * ⚠️ 只有**真的换区**才重置折叠状态 —— 打开关卡时也会走这里，
     * 若每次都重置，用户刚展开的组和滚动位置就会被冲掉。
     */
    setZone: (k) => {
      if (!k || k === zone || !playZones.some((z) => z.key === k)) return;
      captureScroll();
      zone = k;
      resetCollapse();
      scrollTop = 0;
      persistView();
    },
    getZone: () => zone,
    setCurrent: (file) => { currentFile = file; },
    /** 展开某关所在的组（跳转时用），保留其它展开状态 */
    reveal: (p) => { revealGroupOf(p); },
    jumpTo,
    findById,
  };
}

/* SVG 渲染：把棋盘、区域配色、墙体与符号画出来。
 * 纯 DOM 操作，无依赖；尺寸自适应容器。
 */

import { cellGlyph, edgeBadge } from './boardGlyphs.js';

const PALETTE = [
  '#4a6fa5', '#a55a6f', '#6f9f5a', '#b08a3e', '#7a5aa5',
  '#3f8fa0', '#a56f3f', '#5a7fa5', '#9f5a8f', '#5aa57f',
  '#8a6fa5', '#a5903f',
];

/* 线的粗细基准（会再乘上按格子大小算的 wallScale）。
 * 边框与预制墙共用同一套，保证风格一致；玩家画的墙略细，便于区分。 */
const WALL_W = 7.5;      // 边框 / 预制墙：外描边
const WALL_IN = 2.6;     // 边框 / 预制墙：内芯高光
const USER_W = 6.0;      // 玩家画的墙：外描边
const USER_IN = 2.0;     // 玩家画的墙：内芯高光

export function colorForRegion(regionId) {
  if (!regionId || regionId <= 0) return null;
  return PALETTE[(regionId - 1) % PALETTE.length];
}

export const PALETTE_SIZE = PALETTE.length;

/**
 * 把一堆首尾相接的线段合并成尽量少的连续折线。
 *
 * 输入线段用**格点坐标**表示：`[[c1,r1],[c2,r2]]`。输出是折线数组，
 * 每条折线是一串格点。相邻且共线的多余中间点会被去掉。
 *
 * 做法：把线段当成无向图，先从「端点 / 岔口」（度数 != 2）出发把开放路径走完，
 * 剩下的必然是闭合环，再逐个走掉。
 *
 * 为什么要合并：逐条 <line> 画的时候，转折处两条线各自收笔，
 * 即使都是圆头也会在接缝处露出缺口；合并成一条 <path> 后
 * 由 stroke-linejoin 负责转角，连续墙体就融为一体了。
 */
export function tracePolylines(segments) {
  if (!segments.length) return [];
  const vk = (p) => `${p[0]},${p[1]}`;
  const adj = new Map();      // 格点 -> 关联的线段下标
  const ends = [];            // 线段下标 -> [格点key, 格点key]
  segments.forEach((sg, i) => {
    const a = vk(sg[0]);
    const b = vk(sg[1]);
    if (a === b) return;      // 退化线段忽略
    ends.push([a, b]);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(i);
    adj.get(b).push(i);
  });
  const used = new Array(segments.length).fill(false);
  const paths = [];
  const other = (i, v) => (ends[i][0] === v ? ends[i][1] : ends[i][0]);
  const pt = (key) => key.split(',').map(Number);

  const walk = (startKey) => {
    const verts = [pt(startKey)];
    let cur = startKey;
    for (;;) {
      const cands = (adj.get(cur) || []).filter((i) => !used[i]);
      if (!cands.length) break;
      let e = cands[0];
      // 岔口优先「直行」：否则一条直线在十字口会被拆成两条，
      // 虽然圆头能勉强接上，但会多出一处接缝
      if (verts.length >= 2) {
        const b = verts[verts.length - 1];
        const a = verts[verts.length - 2];
        const wx = 2 * b[0] - a[0];
        const wy = 2 * b[1] - a[1];
        const straight = cands.find((i) => {
          const o = pt(other(i, cur));
          return o[0] === wx && o[1] === wy;
        });
        if (straight !== undefined) e = straight;
      }
      used[e] = true;
      cur = other(e, cur);
      verts.push(pt(cur));
    }
    return simplify(verts);
  };

  // 1) 开放路径：先走死胡同（度数 1），再走岔口，出来的折线端点更自然
  const starts = [...adj.keys()].sort((x, y) => adj.get(x).length - adj.get(y).length);
  for (const v of starts) {
    const list = adj.get(v);
    if (list.length === 2) continue;
    while (list.some((i) => !used[i])) {
      const p = walk(v);
      if (p.length > 1) paths.push(p);
    }
  }
  // 2) 闭合环：剩下的所有点度数都是 2
  for (let i = 0; i < ends.length; i++) {
    if (used[i]) continue;
    const p = walk(ends[i][0]);
    if (p.length > 1) paths.push(p);
  }
  return paths;
}

/** 去掉折线上共线的多余中间点 */
function simplify(verts) {
  if (verts.length < 3) return verts;
  const out = [verts[0]];
  for (let i = 1; i < verts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = verts[i];
    const c = verts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  out.push(verts[verts.length - 1]);
  return out;
}

export class Renderer {
  /**
   * @param {SVGElement} svg
   * @param {import('./board.js').Board} board
   */
  constructor(svg, board) {
    this.svg = svg;
    this.board = board;
    this.cellSize = 46;
    this.pad = 14;
    this.wrongCells = new Set();
    this.rebuild();
    this._observeFrame();
  }

  /** 取棋盘容器元素；在没有真实 DOM 的环境（Node 测试）下返回 null。 */
  _frameEl() {
    if (typeof document === 'undefined' || !document
        || typeof document.getElementById !== 'function') return null;
    return document.getElementById('board-frame');
  }

  /**
   * 监听棋盘容器的尺寸变化：窗口缩放 / 侧栏变化 / 切关后重排时，
   * 重新挑选格子大小并重绘，让棋盘**始终填满可用空间**。
   *
   * 只在「算出来的格子大小真的变了」时才重绘，避免
   * 「重绘 → 出现滚动条 → 容器尺寸变化 → 再重绘」的死循环。
   */
  _observeFrame() {
    const frame = this._frameEl();
    if (!frame || typeof ResizeObserver === 'undefined' || this._ro) return;
    this._ro = new ResizeObserver(() => {
      if (this._fitCellSize() !== this.cellSize) this.rebuild();
    });
    this._ro.observe(frame);
  }

  setBoard(board) {
    this.board = board;
    this.wrongCells = new Set();
    this.rebuild();
  }

  /**
   * 供外部（如输入层）获取**当前**棋盘。
   *
   * 输入事件监听只注册一次，但每次切关都会 `new Board()`。
   * 若监听里直接闭包捕获最初那个 board，切关后所有操作都会作用在旧棋盘上
   * —— 表现就是「完成一关后切到新关卡，怎么点都填不上」。
   * 所以输入层一律通过这个 getter 取当前棋盘。
   */
  get boardRef() {
    return this.board;
  }

  /** 根据容器可用空间挑选格子像素大小，让棋盘尽量填满又不溢出。
   *
   *  优先按 `#board-frame` 的实际尺寸算；容器还没布局好（首次渲染、
   *  容器被隐藏）时退回到按棋盘规模估的经验值。
   */
  /**
   * 容器（`#board-frame`）的可用尺寸，即**米色画布**的大小。
   * 拿不到（未布局 / 被隐藏 / 测试环境）时返回 null。
   */
  _availBox() {
    const frame = this._frameEl();
    if (!frame || typeof getComputedStyle !== 'function') return null;
    const cs = getComputedStyle(frame);
    const w = frame.clientWidth
      - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const h = frame.clientHeight
      - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    return (w > 80 && h > 80) ? { w, h } : null;
  }

  /** 屏幕坐标 -> **画布坐标**（已算上 viewBox 原点偏移） */
  _screenToCanvas(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    const scale = rect.width ? vb.width / rect.width : 1;
    return {
      x: (clientX - rect.left) * scale + vb.x,
      y: (clientY - rect.top) * scale + vb.y,
    };
  }

  /**
   * 画布坐标 -> 屏幕坐标。
   * 测试与探针一律用它，别自己写 `pad + c*cellSize` —— 那算出来的是画布坐标，
   * 而 viewBox 原点现在不在 0（网格居中后左边/上边还有一圈米色）。
   */
  canvasToScreen(x, y) {
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    const scale = rect.width ? rect.width / vb.width : 1;
    return { clientX: rect.left + (x - vb.x) * scale, clientY: rect.top + (y - vb.y) * scale };
  }

  /**
   * 把**格坐标**夹到可见画布范围内（涂鸦用：拖出画布外就别存看不见的点）。
   * ⚠️ 入参是格坐标（和 `pointerCell()` 一致），不是画布坐标 —— 别搞混。
   */
  clampCanvas(x, y) {
    const vb = this.svg.viewBox.baseVal;
    const s = this.cellSize;
    if (!vb || !vb.width || !s) return { x, y };
    const minX = (vb.x - this.pad) / s;
    const maxX = (vb.x + vb.width - this.pad) / s;
    const minY = (vb.y - this.pad) / s;
    const maxY = (vb.y + vb.height - this.pad) / s;
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  }

  _fitCellSize() {
    const fallback = () => {
      const c = Math.max(this.board.cols, this.board.rows);
      if (c <= 4) return 84;
      if (c <= 6) return 66;
      if (c <= 8) return 54;
      if (c <= 11) return 44;
      if (c <= 15) return 34;
      return 27;
    };
    const frame = this._frameEl();
    if (!frame || typeof getComputedStyle !== 'function') return fallback();
    const cs = getComputedStyle(frame);
    const box = this._availBox();
    if (!box) return fallback();
    const s = Math.min(
      (box.w - this.pad * 2) / this.board.cols,
      (box.h - this.pad * 2) / this.board.rows,
    );
    // 太小会看不清；上限放宽到 170，让 4×4 这类小盘也能撑满高度
    return Math.max(16, Math.min(Math.floor(s), 170));
  }

  rebuild() {
    const { cols, rows } = this.board;
    this.cellSize = this._fitCellSize();
    const s = this.cellSize;
    const pad = this.pad;
    // 内容（网格 + 内边距）的大小
    const gw = cols * s + pad * 2;
    const gh = rows * s + pad * 2;
    // 画布至少要装下内容；容器更大的话就铺满整个容器 ——
    // 这样**整块米色都落在 viewBox 里**，涂鸦才能画到棋盘外面去。
    const box = this._availBox();
    const w = Math.max(gw, box ? box.w : gw);
    const h = Math.max(gh, box ? box.h : gh);
    // 网格在画布里居中；viewBox 原点因此可能是负的
    const ox = -(w - gw) / 2;
    const oy = -(h - gh) / 2;
    this.svg.setAttribute('viewBox', `${ox} ${oy} ${w} ${h}`);
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', h);
    this.svg.innerHTML = '';

    const NS = 'http://www.w3.org/2000/svg';
    const gCells = document.createElementNS(NS, 'g');
    const gDashes = document.createElementNS(NS, 'g');
    // 墙分**两个全局图层**：先铺满所有深色外描边，再统一压上所有内芯金线。
    //
    // 不能按「边框 / 内部墙」分组 —— SVG 的 <g> 有整体层级，那样无论哪个组在前，
    // 后一组的外描边都会盖住前一组的金线：边框在上 → 内部墙接上边框时 T 字断开；
    // 内部墙在上 → 边框的金线被内部墙的深色描边切断。两种都不对。
    // 只有把「描边」和「金线」拆成两个全局图层，交接点才能真正融成一体。
    const gWalls = document.createElementNS(NS, 'g');
    const gWallsInner = document.createElementNS(NS, 'g');
    const gEdgeClues = document.createElementNS(NS, 'g');
    const gHover = document.createElementNS(NS, 'g');
    const gSymbols = document.createElementNS(NS, 'g');
    // 涂鸦在最上层：玩家的批注要压在所有东西之上
    const gDoodle = document.createElementNS(NS, 'g');
    gDoodle.setAttribute('id', 'g-doodle');
    this.svg.append(gCells, gDashes, gWalls, gWallsInner, gEdgeClues, gHover, gSymbols, gDoodle);
    this.gCells = gCells;
    this.gDashes = gDashes;
    this.gWalls = gWalls;            // 所有外描边：边框 / 预置墙 / 玩家墙
    this.gWallsInner = gWallsInner;  // 所有内芯金线：与上面对应
    this.gEdgeClues = gEdgeClues;
    this.gHover = gHover;
    this.gSymbols = gSymbols;
    this.gDoodle = gDoodle;
    this.cellEls = new Map();

    const x = (c) => pad + c * s;
    const y = (r) => pad + r * s;

    // 单元格
    for (const { r, c, id } of this.board.cells) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', x(c));
      rect.setAttribute('y', y(r));
      rect.setAttribute('width', s);
      rect.setAttribute('height', s);
      rect.setAttribute('class', 'cell empty');
      rect.dataset.cell = `${r},${c}`;
      gCells.appendChild(rect);
      this.cellEls.set(id, rect);
    }

    // 格内符号：交给 boardGlyphs 画成**可视化图形**，不再直接摆 "S1" / "P2" 这样的字面量。
    //   S<n> -> 该形状的迷你拼块      P<n> -> 玫瑰窗徽章
    //   F<n> -> 围栏（边界图案）      U/D/L/R -> 罗盘星 + 数字
    //   纯数字 -> 面积数字
    // boardGlyphs 返回的 <g> 以 (0,0) 为中心，这里平移到格心。
    const shapeMap = new Map((this.board.puzzle.shapes ?? []).map((sh) => [sh.id, sh]));
    for (const sym of this.board.puzzle.symbols ?? []) {
      const glyph = cellGlyph(sym.raw ?? '', s, { shapes: shapeMap });
      glyph.setAttribute('transform', `translate(${x(sym.c) + s / 2} ${y(sym.r) + s / 2})`);
      gSymbols.appendChild(glyph);
    }

    // rebuild 会清空整个 SVG，所以「已经画过内容」时要立刻重画一遍。
    // 否则 ResizeObserver 触发的 rebuild 会把墙、虚线、边线索全清掉
    // （表现为：棋盘只剩一片空底色）。
    if (this._painted) this.paint();
  }

  /**
   * 重画棋盘上的线：
   *   1. 棋盘外轮廓（PUZZLE 自带）—— 深色实线
   *   2. 未填充、未画墙的格边 —— **浅色虚线**（格子分隔线）
   *   3. 玩家画的墙 —— 金色实线
   */
  paintWalls() {
    const NS = 'http://www.w3.org/2000/svg';
    const s = this.cellSize;
    const pad = this.pad;
    // 基准 44px 格；线宽按比例缩放并夹在 0.8~2.2 倍，既不糊也不飘
    const wallScale = Math.max(0.8, Math.min(s / 44, 2.2));
    const g = this.gWalls;
    const gi = this.gWallsInner;
    const gd = this.gDashes;
    for (const parent of [g, gi, gd]) {
      while (parent.firstChild) parent.removeChild(parent.firstChild);
    }

    /** 把一串顶点（格点坐标）写成 <path>；两遍描边画出「深色外描边 + 内芯高光」 */
    const mkPath = (parent, cls, width, verts) => {
      if (verts.length < 2) return null;
      const d = 'M' + verts
        .map(([vc, vr]) => `${pad + vc * s} ${pad + vr * s}`)
        .join(' L');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', cls);
      path.setAttribute('fill', 'none');
      // 线宽跟着格子大小走，避免大盘线条相对过粗 / 小盘过细
      path.setAttribute('stroke-width', (width * wallScale).toFixed(2));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      parent.appendChild(path);
      return path;
    };

    /** 顶点坐标的线段（格点为单位）：a → b */
    const vseg = (r, c, dir) => {
      if (dir === 0) return [[c, r], [c + 1, r]];          // 上
      if (dir === 1) return [[c + 1, r], [c + 1, r + 1]];  // 右
      if (dir === 2) return [[c, r + 1], [c + 1, r + 1]];  // 下
      return [[c, r], [c, r + 1]];                         // 左
    };

    const isOuter = (r, c, dir) => {
      const DR = [-1, 0, 1, 0];
      const DC = [0, 1, 0, -1];
      return !this.board.isCell(r + DR[dir], c + DC[dir]);
    };

    // 按「预置墙 / 玩家墙 / 外边框 / 虚线」分桶收集线段，
    // 之后逐桶把首尾相接的线段**合并成连续折线**再画。
    // 逐条画 <line> 的话，转角处两条线各自收笔（圆头），接缝会露出来，很难看。
    const buckets = { given: [], user: [], outer: [], dash: [] };
    for (const { r, c } of this.board.cells) {
      for (let d = 0; d < 4; d++) {
        const outer = isOuter(r, c, d);
        // 内部边由「上/左」那一侧负责画，避免同一条边画两遍
        if (!outer && d !== 0 && d !== 3) continue;
        const user = this.board.userWalls?.[r]?.[c]?.[d] ? 1 : 0;
        const given = user && this.board.isLockedWall?.(r, c, d);
        const segv = vseg(r, c, d);
        if (given) buckets.given.push(segv);
        else if (user) buckets.user.push(segv);
        else if (outer) buckets.outer.push(segv);
        else buckets.dash.push(segv);
      }
    }

    // 虚线也合并：这样长直线上虚线相位连续，不会每格重新起一段
    for (const verts of tracePolylines(buckets.dash)) mkPath(gd, 'dash', 1.6, verts);

    // ⚠️ 关键：**先把所有外描边画完，再统一画所有内芯**。
    // 若按「路径A外描边 → 路径A内芯 → 路径B外描边 → …」的顺序，
    // B 那根深色外描边会盖住 A 的内芯 —— 在 T 字 / 十字交接点看起来
    // 就像两根线各画各的、在交点处叠了一块。
    const outerPaths = tracePolylines(buckets.outer);
    const givenPaths = tracePolylines(buckets.given);
    const userPaths = tracePolylines(buckets.user);

    // 第一遍：所有外描边（边框 + 预置墙 + 玩家墙），全在这一个图层里
    for (const verts of outerPaths) mkPath(g, 'wall', WALL_W, verts);
    for (const verts of givenPaths) {
      const p = mkPath(g, 'gwall', WALL_W, verts);
      if (p) p.dataset.given = '1';
    }
    for (const verts of userPaths) mkPath(g, 'uwall', USER_W, verts);

    // 第二遍：所有内芯金线。换到下一个图层，保证压在所有外描边之上，
    // 于是 T 字 / 十字交接点上金线能连成完整的一笔。
    // （边框与预制墙同粗细同色；玩家墙略细、金色更亮）
    for (const verts of outerPaths) mkPath(gi, 'wall-inner', WALL_IN, verts);
    for (const verts of givenPaths) mkPath(gi, 'gwall-inner', WALL_IN, verts);
    for (const verts of userPaths) mkPath(gi, 'uwall-inner', USER_IN, verts);
  }

  /** 重绘区域颜色 */
  paint() {
    const board = this.board;
    for (const { r, c, id } of board.cells) {
      const el = this.cellEls.get(id);
      if (!el) continue;
      const rid = board.regionOf(r, c);
      const color = this.colorFor ? this.colorFor(rid) : colorForRegion(rid);
      el.setAttribute('fill', color ?? 'rgba(80,62,40,0.10)');
      el.setAttribute('class', `cell${rid ? '' : ' empty'}`);
    }
    this.paintWalls();
    this.paintEdgeClues();
    this._painted = true;
  }

  /**
   * 画「边线索」：双生/异生（= != == !!）、不等号（< > ^^ vv）、差值（数字）。
   *
   * 坐标约定与 rules.js 一致（也来自 .puz 的解析）：
   *   V 边：左右两格是 (r, k-1) 与 (r, k)   → 画在竖直格边上
   *   H 边：上下两格是 (r-1, k) 与 (r, k)   → 画在水平格边上
   * 线索画在**两格之间的边界线**上，跨越边线（两端分别伸进两侧格子）。
   */
  paintEdgeClues() {
    const g = this.gEdgeClues;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    const edges = this.board?.puzzle?.edges ?? [];
    if (!edges.length) return;
    const NS = 'http://www.w3.org/2000/svg';
    const s = this.cellSize;
    const pad = this.pad;

    for (const e of edges) {
      const gl = String(e.glyph ?? '');
      // 注意：'diff' 只取首字符会变成 'd'，必须整体比较
      const isDiff = gl === 'diff';
      const kind = gl[0];
      if (e.type === 'V') {
        // 竖直格边：x = pad + k*s，纵向中点
        const x = pad + e.k * s;
        const y = pad + e.r * s + s / 2;
        // 不等号 '<' 指左、'>' 指右（与 rules.js 的判定一致）
        if (isDiff) this._placeBadge(g, edgeBadge('difference', { value: e.value }, s), x, y);
        else if (kind === '<' || kind === '>') {
          this._placeBadge(g, edgeBadge('inequality', { dir: kind === '<' ? 'left' : 'right' }, s), x, y);
        } else if ('=!'.includes(kind)) this._edgeTwin(g, NS, x, y, kind, true, s);
        continue;
      }
      if (e.type === 'H') {
        // 水平格边：y = pad + r*s，横向中点
        const y = pad + e.r * s;
        const x = pad + e.k * s + s / 2;
        // '^' 指上、'v' 指下
        if (isDiff) this._placeBadge(g, edgeBadge('difference', { value: e.value }, s), x, y);
        else if (kind === '^' || kind === 'v') {
          this._placeBadge(g, edgeBadge('inequality', { dir: kind === '^' ? 'up' : 'down' }, s), x, y);
        } else if ('=!'.includes(kind)) this._edgeTwin(g, NS, x, y, kind, false, s);
        continue;
      }
      if (e.type === 'vertex') {
        // 顶点雷达：数字写在格点上（该顶点接触的不同区域数）
        const x = pad + e.k * s;
        const y = pad + e.r * s;
        if (this.board.isCell(e.r - 1, e.k - 1) || this.board.isCell(e.r - 1, e.k)
          || this.board.isCell(e.r, e.k - 1) || this.board.isCell(e.r, e.k)) {
          this._placeBadge(g, edgeBadge('watchtower', { value: e.value }, s), x, y);
        }
      }
    }
  }

  /**
   * 双生（=）/ 异生（!）标记。
   *
   * 画法：
   *   双生（形状相同）→ 边线上 2 道平行短杠，绿色
   *   异生（形状不同）→ 2 道平行短杠 **+ 一个 X 划掉**，红色
   * 短杠方向与边线垂直；X 盖在短杠之上。
   *
   * ⚠️ 横边与竖边必须**完全同尺寸**——整个标记只是旋转 90°，别的都一样。
   *
   * 曾经按 glyph 长度区分「加重版」（`=` 是普通、`==` 是加重）。
   * 但那是错的：`.puz` 里**横向格边占 2 个字符、纵向占 1 个**，
   * 所以横边的双生必然写成 `==`、竖边必然是 `=`。
   * 全量统计：纵向 232+250 条全是 len=1，横向 194+216 条全是 len=2，
   * 长度与方向完全相关、不含任何语义。照它分档的直接后果就是
   * **同一个标记横着画得比竖着更粗更大**。
   */
  _edgeTwin(g, NS, x, y, ch, vertical, s) {
    const base = ch === '=' ? 'twin' : 'alien';
    const isAlien = base === 'alien';

    // 尺寸（全部按格宽等比缩放；横向 / 纵向共用这一套）
    const barHalf = s * 0.27;    // 短杠从边线向两侧伸出多少
    const gap = s * 0.12;        // 两根杠的中心距
    const stroke = s * 0.055;    // 短杠粗细 —— 与不等号箭头同粗，整组线索观感一致
    const ext = s * 0.23;        // 异生 X 的半臂长

    // 底板：沿边线方向宽（容下两根杠），垂直于边线方向窄。两个方向都取同一组数值。
    const along = gap + s * 0.10;
    const cross = s * 0.22;
    const bw = vertical ? cross : along;
    const bh = vertical ? along : cross;
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', String(x - bw / 2));
    bg.setAttribute('y', String(y - bh / 2));
    bg.setAttribute('width', String(bw));
    bg.setAttribute('height', String(bh));
    bg.setAttribute('rx', String(s * 0.05));
    bg.setAttribute('class', 'edge-clue-bg');
    g.appendChild(bg);

    // 两根平行短杠（垂直于边线）
    for (const sign of [-1, 1]) {
      const off = sign * gap / 2;
      const line = document.createElementNS(NS, 'line');
      if (vertical) {
        line.setAttribute('x1', String(x - barHalf));
        line.setAttribute('y1', String(y + off));
        line.setAttribute('x2', String(x + barHalf));
        line.setAttribute('y2', String(y + off));
      } else {
        line.setAttribute('x1', String(x + off));
        line.setAttribute('y1', String(y - barHalf));
        line.setAttribute('x2', String(x + off));
        line.setAttribute('y2', String(y + barHalf));
      }
      line.setAttribute('stroke-width', String(stroke));
      line.setAttribute('class', `edge-clue ${base}`);
      g.appendChild(line);
    }

    // 异生：一个 X 划在两根杠上（正方形对称，两条对角线等长）
    if (isAlien) {
      for (const sign of [1, -1]) {
        const slash = document.createElementNS(NS, 'line');
        slash.setAttribute('x1', String(x - ext));
        slash.setAttribute('y1', String(y - sign * ext));
        slash.setAttribute('x2', String(x + ext));
        slash.setAttribute('y2', String(y + sign * ext));
        // 粗细也走属性（跟着格子缩放）；不要再让 CSS 写死像素值
        slash.setAttribute('stroke-width', String(stroke));
        slash.setAttribute('class', 'edge-clue alien-slash');
        g.appendChild(slash);
      }
    }
  }

  /** 把 boardGlyphs 生成的徽章摆到 (x,y) —— 图形本身以 (0,0) 为中心 */
  _placeBadge(g, node, x, y) {
    node.setAttribute('transform', `translate(${x} ${y})`);
    g.appendChild(node);
  }

  /**
   * 只重画笔迹层。涂鸦时每次 pointermove 都会调它，**不能整盘重绘**
   * （整盘重绘还会连带跑一遍规则校验，拖动会卡）。
   * @param {import('./doodle.js').Doodle} doodle
   */
  paintDoodles(doodle) {
    const g = this.gDoodle;
    if (!g) return;
    const NS = 'http://www.w3.org/2000/svg';
    while (g.firstChild) g.removeChild(g.firstChild);
    const strokes = doodle?.strokes ?? [];
    if (!strokes.length) return;
    const s = this.cellSize;
    const pad = this.pad;
    for (const st of strokes) {
      const pts = st.pts;
      if (!pts || !pts.length) continue;
      const X = (p) => (pad + p[0] * s).toFixed(2);
      const Y = (p) => (pad + p[1] * s).toFixed(2);
      let d;
      if (pts.length === 1) {
        // 单点：一段极短的线段 + round linecap，渲染成一个圆点
        d = `M${X(pts[0])} ${Y(pts[0])} L${X(pts[0])} ${(pad + pts[0][1] * s + 0.01).toFixed(2)}`;
      } else {
        d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p)} ${Y(p)}`).join(' ');
      }
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', st.color || '#2b2119');
      path.setAttribute('stroke-width', String((st.w || 0.075) * s));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('class', 'doodle');
      g.appendChild(path);
    }
  }

  /** 为「颜色」面板生成一整套高区分度的玻璃色 */
  static palette() {
    return PALETTE.slice();
  }

  /** 屏幕坐标 -> 单元格 */
  hitTest(clientX, clientY) {
    const p = this.hitPoint(clientX, clientY);
    if (!p) return null;
    if (!this.board.isCell(p.r, p.c)) return null;
    return { r: p.r, c: p.c };
  }

  /** 屏幕坐标 -> { r, c, fx, fy }（fx/fy 是格内 0..1 的小数位置） */
  hitPoint(clientX, clientY) {
    const c = this._screenToCanvas(clientX, clientY);
    const x = c.x - this.pad;
    const y = c.y - this.pad;
    const s = this.cellSize;
    const col = Math.floor(x / s);
    const row = Math.floor(y / s);
    if (row < 0 || col < 0 || row >= this.board.rows || col >= this.board.cols) return null;
    return {
      r: row,
      c: col,
      fx: x / s - col,
      fy: y / s - row,
    };
  }

  /**
   * 屏幕坐标 -> **棋盘格坐标**（以格为单位的小数，不含 pad）。
   * 格点 (vr, vc) 正好落在 `(vc, vr)`；格心是 `(vc + .5, vr + .5)`。
   *
   * 连续划线时需要拿它算「指针离当前锚点格点有多远」，所以不能只给整数格。
   */
  pointerCell(clientX, clientY) {
    if (!this.cellSize) return null;
    const c = this._screenToCanvas(clientX, clientY);
    return { x: (c.x - this.pad) / this.cellSize, y: (c.y - this.pad) / this.cellSize };
  }

  /** 一格内到最近格边的归一化距离（0 = 正落在边上，0.5 = 格心） */
  static edgeDistance(pt) {
    return Math.min(pt.fy, 1 - pt.fx, 1 - pt.fy, pt.fx);
  }

  /**
   * 内部格边 -> 屏幕像素长度（用于设定「画/擦墙」的判定半径）。
   * 这样判定就与棋盘大小、缩放比例无关。
   */
  edgeScreenLength(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    if (!rect.width) return this.cellSize;
    void clientX; void clientY;
    return this.cellSize * (rect.width / vb.width);
  }

  /**
   * 由屏幕坐标求「最靠近的格边」。
   * @param {number} maxDistPx 允许的最大屏幕距离；超出则返回 null
   * @returns {{r:number,c:number,dir:number,dist:number}|null}
   *          dir: 0=上 1=右 2=下 3=左
   */
  hitEdge(clientX, clientY, maxDistPx = Infinity) {
    const p = this.hitPoint(clientX, clientY);
    if (!p) return null;
    const { r, c, fx, fy } = p;
    // 到四条边的距离（格内比例）
    const d = [fy, 1 - fx, 1 - fy, fx];
    const cellPx = this.edgeScreenLength(clientX, clientY);
    let dir = 0;
    for (let i = 1; i < 4; i++) if (d[i] < d[dir]) dir = i;
    const dist = d[dir] * cellPx;
    if (dist > maxDistPx) return null;
    if (this.board.isCell(r, c)) return { r, c, dir, dist };
    // 落在空洞上：尝试用邻格
    const DR = [-1, 0, 1, 0];
    const DC = [0, 1, 0, -1];
    const nr = r + DR[dir];
    const nc = c + DC[dir];
    if (!this.board.isCell(nr, nc)) return null;
    return { r: nr, c: nc, dir: (dir + 2) % 4, dist };
  }

  /**
   * 求离指针最近的**玩家已画的墙**，超过 maxDistPx 返回 null。
   * 用真正的点到线段距离，所以「离分割线较远」就不会被判定为命中。
   */
  /**
   * 命中半径：给定的像素值再**按格子大小夹紧**。
   *
   * ⚠️ 这是曾经的一个隐患：`nearestVertex` / `nearestUserWall` 里的距离是在**棋盘坐标**
   * 下算的，却直接拿去和固定的 `16` / `9` 比 —— 于是格子越小，捕获圈相对越大。
   * 手机上的大盘（格子 20px）里，`16` 已经大于格心到格点的距离（20×0.707 ≈ 14.1），
   * 整格都被格点圈吞掉，「点格内填充」永远被判成「点在格点上」，压根填不上。
   *
   * 夹到 0.30 格之后：格点/墙附近仍然好点（20px 格子上半径 6px），
   * 同时格心稳定落在圈外（0.707 格 ≫ 0.30 格），填充与划线不再互相抢。
   */
  _hitRadius(px, frac) {
    return Math.min(px, this.cellSize * frac);
  }

  nearestUserWall(clientX, clientY, maxDistPx = 10) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width) return null;
    const c = this._screenToCanvas(clientX, clientY);
    const px = c.x;
    const py = c.y;
    const s = this.cellSize;
    const pad = this.pad;
    const lim = this._hitRadius(maxDistPx, 0.30);
    let best = null;
    const consider = (x1, y1, x2, y2, r, c, dir) => {
      const vx = x2 - x1;
      const vy = y2 - y1;
      const len2 = vx * vx + vy * vy || 1;
      let t = ((px - x1) * vx + (py - y1) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = x1 + t * vx;
      const qy = y1 + t * vy;
      const dist = Math.hypot(px - qx, py - qy);
      if (dist <= lim && (!best || dist < best.dist)) {
        best = { r, c, dir, dist, x1, y1, x2, y2 };
      }
    };
    for (const { r, c } of this.board.cells) {
      // 每条边只算一次（上/左，以及棋盘外沿）
      for (const dir of [0, 3]) {
        if (!this.board.userWalls?.[r]?.[c]?.[dir]) continue;
        const x0 = pad + c * s;
        const y0 = pad + r * s;
        if (dir === 0) consider(x0, y0, x0 + s, y0, r, c, dir);
        else consider(x0, y0, x0, y0 + s, r, c, dir);
      }
      // 右/下边若是玩家墙且邻格不存在（外沿）也要算；
      // 但邻格存在时那条墙会由邻格的左/上边覆盖
      for (const dir of [1, 2]) {
        if (!this.board.userWalls?.[r]?.[c]?.[dir]) continue;
        const DR = [-1, 0, 1, 0];
        const DC = [0, 1, 0, -1];
        if (this.board.isCell(r + DR[dir], c + DC[dir])) continue;
        const x0 = pad + c * s;
        const y0 = pad + r * s;
        if (dir === 1) consider(x0 + s, y0, x0 + s, y0 + s, r, c, dir);
        else consider(x0, y0 + s, x0 + s, y0 + s, r, c, dir);
      }
    }
    return best;
  }

  /**
   * 求离指针最近的**格点（顶点）**。
   * 顶点是格与格之间的角点，坐标用 (r, c) 表示：
   *   它位于第 r 行与第 r-1 行之间、第 c 列与第 c-1 列之间。
   * @returns {{r:number,c:number,dist:number}|null}
   */
  nearestVertex(clientX, clientY, maxDistPx = 14) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width) return null;
    const c = this._screenToCanvas(clientX, clientY);
    const px = c.x;
    const py = c.y;
    const s = this.cellSize;
    const pad = this.pad;
    // 半径按格子夹紧，理由见 _hitRadius
    const lim = this._hitRadius(maxDistPx, 0.30);
    // 指针所在的高斯格
    const gc = Math.round((px - pad) / s);
    const gr = Math.round((py - pad) / s);
    let best = null;
    for (let vr = gr - 1; vr <= gr + 1; vr++) {
      for (let vc = gc - 1; vc <= gc + 1; vc++) {
        if (vr < 0 || vc < 0 || vr > this.board.rows || vc > this.board.cols) continue;
        // 顶点必须至少挨着一格，否则是棋盘外的空角
        const touches =
          this.board.isCell(vr - 1, vc - 1) || this.board.isCell(vr - 1, vc) ||
          this.board.isCell(vr, vc - 1) || this.board.isCell(vr, vc);
        if (!touches) continue;
        const vx = pad + vc * s;
        const vy = pad + vr * s;
        const dist = Math.hypot(px - vx, py - vy);
        if (dist <= lim && (!best || dist < best.dist)) best = { r: vr, c: vc, dist };
      }
    }
    return best;
  }

  /**
   * 显示「悬停提示」：告诉玩家此刻点下去会操作什么。
   * @param {null
   *   |{kind:'cell',r,c}
   *   |{kind:'wall',r,c,dir}
   *   |{kind:'newWall',r,c,dir}
   *   |{kind:'vertex',r,c,remove:boolean,dir?:number}} hint
   *   kind='vertex' 时画一个棱形顶点；remove=true 表示拖走会**取消**这条线。
   */
  showCursor(hint) {
    const NS = 'http://www.w3.org/2000/svg';
    const g = this.gHover;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (!hint) return;
    const s = this.cellSize;
    const pad = this.pad;

    if (hint.kind === 'cell') {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', pad + hint.c * s + 2);
      rect.setAttribute('y', pad + hint.r * s + 2);
      rect.setAttribute('width', s - 4);
      rect.setAttribute('height', s - 4);
      rect.setAttribute('class', 'hover-cell');
      g.appendChild(rect);
      return;
    }

    if (hint.kind === 'vertex') {
      const vx = pad + hint.c * s;
      const vy = pad + hint.r * s;
      const half = Math.max(5, s * 0.14);
      const poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('points',
        `${vx},${vy - half} ${vx + half},${vy} ${vx},${vy + half} ${vx - half},${vy}`);
      poly.setAttribute('class', hint.remove ? 'hover-vertex remove' : 'hover-vertex');
      g.appendChild(poly);
      // 若已知方向，顺带预览这条线
      if (hint.dir != null) {
        const seg = this._vertexSegment(hint.r, hint.c, hint.dir);
        if (seg) {
          const line = document.createElementNS(NS, 'line');
          line.setAttribute('x1', seg[0]); line.setAttribute('y1', seg[1]);
          line.setAttribute('x2', seg[2]); line.setAttribute('y2', seg[3]);
          line.setAttribute('class', hint.remove ? 'hover-wall' : 'hover-newwall');
          g.appendChild(line);
        }
      }
      return;
    }

    const x0 = pad + hint.c * s;
    const y0 = pad + hint.r * s;
    let coords;
    if (hint.dir === 0) coords = [x0, y0, x0 + s, y0];
    else if (hint.dir === 1) coords = [x0 + s, y0, x0 + s, y0 + s];
    else if (hint.dir === 2) coords = [x0, y0 + s, x0 + s, y0 + s];
    else coords = [x0, y0, x0, y0 + s];
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', coords[0]);
    line.setAttribute('y1', coords[1]);
    line.setAttribute('x2', coords[2]);
    line.setAttribute('y2', coords[3]);
    line.setAttribute('class', hint.kind === 'wall' ? 'hover-wall' : 'hover-newwall');
    g.appendChild(line);
  }

  /**
   * 顶点 (r,c) 沿方向 dir 的那条线段的两端坐标。
   * **必须与 vertexEdge 保持一致**：先取出对应的格边，再按该边的方向算端点。
   *   dir=0 上 → 水平段 (c-1..c)*S @ y=(r-1)*S
   *   dir=1 右 → 竖直段 x=c*S @ (r-1..r)*S
   *   dir=2 下 → 水平段 (c-1..c)*S @ y=r*S
   *   dir=3 左 → 竖直段 x=(c-1)*S @ (r-1..r)*S
   * 返回 null 表示该方向没有格边。
   */
  _vertexSegment(r, c, dir) {
    const e = this.vertexEdge(r, c, dir);
    if (!e) return null;
    const s = this.cellSize;
    const pad = this.pad;
    const x0 = pad + e.c * s;
    const y0 = pad + e.r * s;
    if (e.dir === 0) return [x0, y0, x0 + s, y0];
    if (e.dir === 1) return [x0 + s, y0, x0 + s, y0 + s];
    if (e.dir === 2) return [x0, y0 + s, x0 + s, y0 + s];
    return [x0, y0, x0, y0 + s];
  }

  /**
   * 顶点 (r,c) 沿方向 dir 对应的**格边**。
   *
   * 顶点 (r,c) 的屏幕位置是 (c*S, r*S)。与它相连的四条格边，按「从顶点看过去的方向」：
   *   左 → 格 (r, c-1) 的上边      （水平段，从顶点向左）
   *   右 → 格 (r, c)   的上边      （水平段，从顶点向右）
   *   上 → 格 (r-1, c-1) 的右边    （竖直段，从顶点向上）
   *   下 → 格 (r, c-1)  的右边     （竖直段，从顶点向下）
   *
   * 已用 4x4 缺角棋盘逐条枚举核对过（见 tools/_dir2 的验证方式）。
   * dir 可用数字或名称：0/2 是水平段、1/3 是竖直段；
   * 为免混淆，内部按名称处理。
   *
   * @param {number|'up'|'right'|'down'|'left'} dir
   * @returns {{r:number,c:number,dir:number}|null}
   */
  vertexEdge(r, c, dir) {
    const name = { 0: 'up', 1: 'right', 2: 'down', 3: 'left' }[dir] ?? dir;
    let e = null;
    if (name === 'left') e = { r, c: c - 1, dir: 0 };
    else if (name === 'right') e = { r, c, dir: 0 };
    else if (name === 'up') e = { r: r - 1, c: c - 1, dir: 1 };
    else if (name === 'down') e = { r, c: c - 1, dir: 1 };
    if (!e) return null;
    const DR = [-1, 0, 1, 0];
    const DC = [0, 1, 0, -1];
    if (!this.board.isCell(e.r, e.c)) return null;
    if (!this.board.isCell(e.r + DR[e.dir], e.c + DC[e.dir])) return null;
    return e;
  }

  /** 方向名称（便于外部读代码） */
  static DIR_NAME(dir) {
    return { 0: 'up', 1: 'right', 2: 'down', 3: 'left' }[dir] ?? dir;
  }
}

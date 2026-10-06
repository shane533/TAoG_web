/* 棋盘模型
 *
 * 三套数据互相独立：
 *   grid       PUZZLE 给出的「哪些格存在」
 *   baseWalls  PUZZLE 给出的墙（棋盘外轮廓，纯装饰）
 *   userWalls  玩家用「划线模式」画出来的墙（也用于 flood-fill 分块）
 *   paint      玩家用「填充模式」刷出来的区域归属（0 = 未涂）
 *
 * 关键设计：**填充区域的合并只看「是否被涂到」**，与墙无关。
 * 两个已涂区域被一次拖动同时碰到时才会合并 —— 这正是游戏里
 * 「相邻无墙也不会自动合并，只有手动划动合并两个区域才会合并」。
 */

/** 单元格 id */
export const cid = (r, c) => r * 1000 + c;

/** 四个方向的索引：0=上 1=右 2=下 3=左 */
const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];
const OPP = [2, 3, 0, 1];

export class Board {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.cols = puzzle.cols;
    this.rows = puzzle.rows;
    this.grid = puzzle.grid;
    /** PUZZLE 自带的墙（棋盘外轮廓） */
    this.baseWalls = (puzzle.walls ?? []).map((row) => row.map((w) => w.slice()));

    /** 玩家画出的墙：userWalls[r][c][dir] = 1 */
    this.userWalls = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => [0, 0, 0, 0]));

    /**
     * 预置墙（关卡自带的不可清除分割线），同样存在 userWalls 里，
     * 但在 lockedWalls 中登记 —— 玩家不能擦除，渲染时也画得更粗。
     */
    this.lockedWalls = new Set();
    this._applyGivenWalls(puzzle.given_walls);

    /** 填充出来的区域归属 */
    this.paint = Array.from({ length: this.rows }, () => new Array(this.cols).fill(0));
    this.nextRegionId = 1;

    // 有效格集合 & 邻接（同时考虑 PUZZLE 墙与玩家墙）
    this.cells = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) this.cells.push({ r, c, id: cid(r, c) });
      }
    }
    // 玩家墙会改变棋盘连通性，因此邻接要动态算
    this._refreshAdjacency();
  }

  /**
   * 载入关卡自带的预置墙。
   * @param {object|undefined} given `{"r,c,dir": true}` 形式
   */
  _applyGivenWalls(given) {
    if (!given) return;
    for (const key of Object.keys(given)) {
      if (!given[key]) continue;
      const [r, c, dir] = String(key).split(',').map(Number);
      if (!Number.isFinite(r) || !Number.isFinite(c) || !Number.isFinite(dir)) continue;
      if (dir < 0 || dir > 3) continue;
      const nr = r + DR[dir];
      const nc = c + DC[dir];
      if (!this.isCell(r, c) || !this.isCell(nr, nc)) continue;
      // 两侧都登记（渲染与连通性都按双向处理）
      this.userWalls[r][c][dir] = 1;
      this.userWalls[nr][nc][OPP[dir]] = 1;
      this.lockedWalls.add(cid(r, c) * 10 + dir);
      this.lockedWalls.add(cid(nr, nc) * 10 + OPP[dir]);
    }
  }

  /** 这条边是不是关卡预置的（不可清除） */
  isLockedWall(r, c, dir) {
    return this.lockedWalls.has(cid(r, c) * 10 + dir);
  }

  /* ---------------- 基础查询 ---------------- */

  get totalCells() { return this.cells.length; }

  get assignedCells() {
    let n = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] && this.paint[r][c] > 0) n++;
      }
    }
    return n;
  }

  isCell(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols && this.grid[r][c] === 1;
  }

  /** 渲染用的墙：PUZZLE 墙 + 玩家墙 */
  wallAt(r, c, dir) {
    if (!this.isCell(r, c)) return 0;
    return (this.baseWalls?.[r]?.[c]?.[dir] ? 1 : 0) || (this.userWalls[r][c][dir] ? 1 : 0);
  }

  /** 邻接（只被玩家墙阻断；PUZZLE 墙是外轮廓，本来就在棋盘外沿） */
  _refreshAdjacency() {
    this.adj = new Map();
    for (const { r, c } of this.cells) {
      const list = [];
      for (let d = 0; d < 4; d++) {
        const nr = r + DR[d];
        const nc = c + DC[d];
        if (!this.isCell(nr, nc)) continue;
        if (this.userWalls[r][c][d] || this.userWalls[nr][nc][OPP[d]]) continue;
        list.push({ r: nr, c: nc, dir: d });
      }
      this.adj.set(cid(r, c), list);
    }
  }

  neighbors(r, c) {
    return this.adj.get(cid(r, c)) ?? [];
  }

  /* ---------------- 墙（划线模式） ---------------- */

  /**
   * 设置/清除一条格边上的玩家墙；返回是否发生变化。
   * **预置墙（isLockedWall）不可清除** —— 尝试擦除时直接返回 false。
   */
  setWall(r, c, dir, on) {
    if (!this.isCell(r, c)) return false;
    const nr = r + DR[dir];
    const nc = c + DC[dir];
    if (!this.isCell(nr, nc)) return false;      // 棋盘外沿不用画
    if (!on && this.isLockedWall(r, c, dir)) return false;   // 预置墙不可擦
    const before = this.userWalls[r][c][dir];
    const next = on ? 1 : 0;
    if (before === next) return false;
    this.userWalls[r][c][dir] = next;
    this.userWalls[nr][nc][OPP[dir]] = next;
    // 邻接表必须跟着更新，否则连通块计算 / autoEnclose 会用旧的边
    this._refreshAdjacency();
    return true;
  }

  /**
   * 玩家墙把棋盘切成若干连通块后，把每块内**已经涂过色**的格子统一成一个区域。
   *
   * 两条硬性约束：
   *   1. **绝不把 paint === 0（未涂 / 已被擦掉）的格子写回。**
   *   2. **只在「棋盘真的被墙切成多块」时才合并。**
   *      只在某条边上加一堵墙并不会圈出任何区域，此时绝不该改动已有涂色 ——
   *      否则「点一下两格之间」就会把整块已涂区域并成一个。
   *
   * @param {number} prevComponents 加墙前棋盘的连通块数量
   */
  autoEnclose(prevComponents = 1) {
    const comps = this.componentCount();
    if (comps <= 1 && prevComponents <= 1) return false;   // 没被切开 → 不动涂色

    const seen = Array.from({ length: this.rows }, () => new Array(this.cols).fill(false));
    let changed = false;
    for (const { r, c } of this.cells) {
      if (seen[r][c]) continue;
      const block = [];
      const st = [[r, c]];
      seen[r][c] = true;
      while (st.length) {
        const [cr, cc] = st.pop();
        block.push({ r: cr, c: cc });
        for (const nb of this.neighbors(cr, cc)) {
          if (!seen[nb.r][nb.c]) {
            seen[nb.r][nb.c] = true;
            st.push([nb.r, nb.c]);
          }
        }
      }
      // 只处理块内「已涂色」的格子；未涂的一律不动
      const painted = block.filter(({ r: rr, c: cc }) => this.paint[rr][cc] > 0);
      if (painted.length < 2) continue;
      const ids = new Set(painted.map(({ r: rr, c: cc }) => this.paint[rr][cc]));
      let rid;
      if (ids.size === 1) {
        rid = [...ids][0];
      } else {
        rid = this.nextRegionId++;
        changed = true;
      }
      for (const { r: rr, c: cc } of painted) {
        if (this.paint[rr][cc] !== rid) {
          if (this._trace) this._trace.push(`autoEnclose: (${rr},${cc}) ${this.paint[rr][cc]} -> ${rid}`);
          this.paint[rr][cc] = rid;
          changed = true;
        }
      }
    }
    return changed;
  }

  /** 棋盘被玩家墙切成的连通块数量 */
  componentCount() {
    const seen = new Set();
    let n = 0;
    for (const { r, c, id } of this.cells) {
      if (seen.has(id)) continue;
      n++;
      const st = [{ r, c }];
      seen.add(id);
      while (st.length) {
        const cur = st.pop();
        for (const nb of this.neighbors(cur.r, cur.c)) {
          const nid = cid(nb.r, nb.c);
          if (!seen.has(nid)) {
            seen.add(nid);
            st.push(nb);
          }
        }
      }
    }
    return n;
  }

  /* ---------------- 填充（填充模式） ---------------- */

  /**
   * 把一个笔画的格子归入同一区域。
   *
   * 「拖动合并」的语义：
   *   - 笔画碰到的所有已存在区域会被合并成一个；
   *   - 合并时如果笔画**跨过了**它们之间的墙，那堵墙会被顺手拆掉
   *     （否则合并出来的区域内部还留着墙，看着自相矛盾）。
   *
   * @param {{r:number,c:number}[]} stroke 本次拖过的格（按顺序）
   * @returns {{rid:number, removedWalls:number}} 区域号与拆掉的墙数
   */
  fillStroke(stroke) {
    const cells = stroke.filter(({ r, c }) => this.isCell(r, c));
    if (!cells.length) return { rid: 0, removedWalls: 0 };

    // 笔画碰到的所有已存在区域 —— 它们要被合并
    const hit = new Set();
    for (const { r, c } of cells) {
      const v = this.paint[r][c];
      if (v > 0) hit.add(v);
    }

    let rid;
    if (hit.size === 0) {
      rid = this.nextRegionId++;
    } else if (hit.size === 1) {
      rid = [...hit][0];
    } else {
      // 手动划动把多个区域合并成一个
      rid = Math.min(...hit);
      for (const other of hit) {
        if (other === rid) continue;
        this._rename(other, rid);
      }
    }

    for (const { r, c } of cells) {
      if (this._trace && this.paint[r][c] === 0 && rid > 0) {
        this._trace.push(`fillStroke: (${r},${c}) 0 -> ${rid}`);
      }
      this.paint[r][c] = rid;
    }

    // ---- 拆墙 ----
    // 1) 笔画**跨过**的墙：相邻两格之间若有玩家墙，说明玩家是「划过去」的，
    //    这堵墙已无意义 → 拆掉。（两边都是空格子时同样要拆，
    //    否则涂完两格后中间还留着一道墙，自相矛盾。）
    let removedWalls = 0;
    const clearedEdges = new Set();
    const clearEdgeBetween = (r, c, nr, nc) => {
      const dr = nr - r;
      const dc = nc - c;
      if (Math.abs(dr) + Math.abs(dc) !== 1) return;
      const d = dr === -1 ? 0 : dr === 1 ? 2 : dc === 1 ? 1 : 3;
      const key = `${Math.min(r, nr)},${Math.min(c, nc)},${d === 0 || d === 2 ? 'h' : 'v'}`;
      if (clearedEdges.has(key)) return;
      clearedEdges.add(key);
      if (this.userWalls[r][c][d] || this.userWalls[nr][nc][OPP[d]]) {
        this.setWall(r, c, d, false);
        removedWalls++;
      }
    };
    for (let i = 1; i < cells.length; i++) {
      clearEdgeBetween(cells[i - 1].r, cells[i - 1].c, cells[i].r, cells[i].c);
    }

    // 2) 刚刚合并起来的若干区域之间，可能还隔着墙（笔画是跳过去的，
    //    并没有真正从这两格之间走过）→ 一并拆掉
    if (hit.size > 1) {
      const area = new Set(hit);
      const seenCells = new Set(cells.map(({ r, c }) => cid(r, c)));
      for (let rr = 0; rr < this.rows; rr++) {
        for (let cc = 0; cc < this.cols; cc++) {
          const v = this.paint[rr][cc];
          if (v <= 0 || !area.has(v)) continue;
          seenCells.add(cid(rr, cc));
        }
      }
      for (const key of seenCells) {
        const r = Math.floor(key / 1000);
        const c = key % 1000;
        for (let d = 0; d < 4; d++) {
          const nr = r + DR[d];
          const nc = c + DC[d];
          if (!this.isCell(nr, nc)) continue;
          clearEdgeBetween(r, c, nr, nc);
        }
      }
    }
    return { rid, removedWalls };
  }

  /**
   * 加了一堵墙之后，检查是否有区域被切成多块。
   * 每块会拿到各自的新区域号 → 渲染时自然就是不同颜色。
   * @returns {number} 被拆分的区域数
   */
  splitRegions() {
    const byRegion = new Map();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = this.paint[r][c];
        if (v <= 0) continue;
        if (!byRegion.has(v)) byRegion.set(v, []);
        byRegion.get(v).push({ r, c });
      }
    }
    let splitCount = 0;
    for (const [rid, cells] of byRegion) {
      if (cells.length < 2) continue;
      // 按「无玩家墙连通」把这块切分
      const inRegion = new Set(cells.map(({ r, c }) => cid(r, c)));
      const seen = new Set();
      const comps = [];
      for (const { r, c } of cells) {
        const id = cid(r, c);
        if (seen.has(id)) continue;
        const comp = [];
        const st = [{ r, c }];
        seen.add(id);
        while (st.length) {
          const cur = st.pop();
          comp.push(cur);
          for (const nb of this.neighbors(cur.r, cur.c)) {
            const nid = cid(nb.r, nb.c);
            if (!inRegion.has(nid) || seen.has(nid)) continue;
            seen.add(nid);
            st.push(nb);
          }
        }
        comps.push(comp);
      }
      if (comps.length <= 1) continue;
      splitCount++;
      // 第一块保留原号，其余各拿新号
      for (let i = 1; i < comps.length; i++) {
        const newId = this.nextRegionId++;
        for (const { r, c } of comps[i]) this.paint[r][c] = newId;
      }
    }
    return splitCount;
  }

  /** 把某区域的所有格改号为 target */
  _rename(from, to) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.paint[r][c] === from) this.paint[r][c] = to;
      }
    }
  }

  /** 抹掉一组格的涂色（擦除） */
  eraseCells(cells) {
    for (const { r, c } of cells) {
      if (this.isCell(r, c)) this.paint[r][c] = 0;
    }
  }

  /* ---------------- 区域视图 ---------------- */

  regionOf(r, c) {
    if (!this.isCell(r, c)) return 0;
    return this.paint[r][c];
  }

  /** 区域号 -> 格列表 */
  regionCells() {
    const m = new Map();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = this.paint[r][c];
        if (!this.grid[r][c] || v <= 0) continue;
        if (!m.has(v)) m.set(v, []);
        m.get(v).push({ r, c });
      }
    }
    return m;
  }

  get regionCount() { return this.regionCells().size; }

  /* ---------------- 整体操作 ---------------- */

  clear() {
    for (let r = 0; r < this.rows; r++) this.paint[r].fill(0);
    this.nextRegionId = 1;
  }

  /** 「重新开始」：清空涂色 + 清空所有玩家墙，恢复关卡初始状态 */
  reset() {
    this.clear();
    this.clearWalls();
  }

  /** 清掉玩家画的墙；**预置墙保留** */
  clearWalls() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        for (let d = 0; d < 4; d++) {
          if (this.isLockedWall(r, c, d)) continue;
          this.userWalls[r][c][d] = 0;
        }
      }
    }
    this._refreshAdjacency();
  }

  /** 状态快照（撤销用） */
  snapshot() {
    return {
      paint: this.paint.map((row) => row.slice()),
      walls: this.userWalls.map((row) => row.map((w) => w.slice())),
      nextRegionId: this.nextRegionId,
    };
  }

  restore(snap) {
    if (!snap) return;
    this.paint = snap.paint.map((row) => row.slice());
    this.userWalls = snap.walls.map((row) => row.map((w) => w.slice()));
    this.nextRegionId = snap.nextRegionId;
    this._refreshAdjacency();
  }

  /**
   * 载入一组分区（区域网格；也用于恢复保存的进度）。
   *
   * 注意两点：
   *   1. 分区网格里的编号**可能是 0**（例如标准答案就用了 0..n），
   *      所以判定标准是「不是负数」，不能写成 `v > 0`；
   *   2. 同一个编号**可能对应多块互不相连的格子**，必须按连通性拆开，
   *      否则会把它们当成一个区域（进而漏掉一部分格子）。
   */
  loadPaintGrid(regionGrid) {
    this.clear();
    const seen = Array.from({ length: this.rows }, () => new Array(this.cols).fill(false));
    const valAt = (r, c) => {
      if (!this.isCell(r, c)) return null;
      const v = regionGrid?.[r]?.[c];
      return (typeof v === 'number' && v >= 0) ? v : null;
    };
    let nextId = 1;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = valAt(r, c);
        if (v === null || seen[r][c]) continue;
        // 把「同号且连通」的格子收成一块
        const comp = [];
        const st = [[r, c]];
        seen[r][c] = true;
        while (st.length) {
          const [cr, cc] = st.pop();
          comp.push({ r: cr, c: cc });
          for (const nb of this.neighbors(cr, cc)) {
            if (seen[nb.r][nb.c]) continue;
            if (valAt(nb.r, nb.c) !== v) continue;
            seen[nb.r][nb.c] = true;
            st.push([nb.r, nb.c]);
          }
        }
        // 每一块拿到各自的新区域号
        for (const { r: rr, c: cc } of comp) this.paint[rr][cc] = nextId;
        nextId++;
      }
    }
    this.nextRegionId = nextId;
  }

  /** 当前分区（按区域排序的最小行列规范化），用于比较 */
  canonicalPartition() {
    const parts = [];
    for (const [, list] of this.regionCells()) {
      const pts = list.map(({ r, c }) => [r, c]);
      const r0 = Math.min(...pts.map((p) => p[0]));
      const c0 = Math.min(...pts.map((p) => p[1]));
      parts.push(pts.map(([r, c]) => `${r - r0},${c - c0}`).sort().join(';'));
    }
    parts.sort();
    return parts.join('|');
  }
}

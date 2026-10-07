/* 交互模式（对照游戏左侧四个按钮）
 *
 *   both  同时支持填充与划线：按落点自动判定
 *   fill  填充模式：左键拖动划动区域。**相邻无墙也不会自动合并**，
 *         只有一次拖动同时碰到两个区域时才会合并它们
 *   line  划线模式：从**棱形格点**出发拖动画线（见下）
 *   note  笔记模式（暂不实现）
 *
 * 墙与区域解耦：区域只由「填充」决定；线只影响视觉与连通性。
 * 例外：**画线把区域切成两块时**会拆成两个区域（颜色随之不同）。
 *
 * ── 划线模式（重做）──
 *   格子的四个角是「格点」。鼠标靠近格点时会高亮出**棱形顶点**；
 *   从该顶点**按下并拖动**即可画线：
 *     上 / 下  → 一条水平线（该格点左下方格的上边 / 下边）
 *     左 / 右  → 一条竖直线（该格点的左边 / 右边）
 *   若该方向**已经有线**，这一拖就把它**取消**。
 *   不能靠「点格子中间」或「点已有的线」来加/删线。
 *
 *   **连续划线**：落完一条边后，锚点会推进到这条边的另一端，
 *   于是接着往别的方向拖就能继续画，一笔画出折线（拐弯自然接上）。
 *   指针离当前锚点超过 VERTEX_STEP 格就算「走到下一个格点」。
 *
 * ── 右键 ──
 *   贴到已有的线（≤ WALL_HIT_PX）→ 擦掉这条线
 *   否则 → 擦掉这一格的涂色
 */

/** 距已有的线多少屏幕像素内算命中（右键可擦） */
const WALL_HIT_PX = 9;
/** 距格点多少屏幕像素内算命中棱形顶点 */
const VERTEX_HIT_PX = 16;
/**
 * 连续划线：指针离当前锚点格点超过多少**格**，就落一条边并推进锚点。
 * 取 0.5 表示「走到最近的那半边就算到达下一个格点」，
 * 正好一格宽的拖动 ⇒ 恰好一条边，拖两格 ⇒ 两条边。
 */
const VERTEX_STEP = 0.5;
/**
 * 填充落笔的内缩比例：指针要「深入」格子这么多（占格宽比例）才落笔。
 * 用来消除「斜向快速拖动擦过顶点、误涂斜对角格」的问题。
 * 取 0.2 ≈ 84px 格子对应 17px 死区。
 */
const PAINT_INSET = 0.2;
/** 擦除模式下点中一笔涂鸦的容差（格为单位） */
const ERASE_DOODLE_TOL = 0.18;

export function attachInput({ svg, renderer, board: initialBoard, onChange, onBegin, toast, doodle, onDoodle, getColor }) {
  // 事件监听只注册一次，但每次切关都会 new Board()。
  // 这里用 Proxy 让 `board` 永远指向**当前**棋盘，避免闭包捕获旧棋盘
  //（否则「完成一关后切到新关卡」就会完全点不动 —— 操作都落在旧棋盘上）。
  let currentBoard = initialBoard;
  const board = new Proxy({}, {
    get(_t, prop) {
      const b = currentBoard ?? renderer?.boardRef;
      const v = b?.[prop];
      return typeof v === 'function' ? v.bind(b) : v;
    },
    set(_t, prop, value) {
      const b = currentBoard ?? renderer?.boardRef;
      if (b) b[prop] = value;
      return true;
    },
    has(_t, prop) {
      const b = currentBoard ?? renderer?.boardRef;
      return !!b && prop in b;
    },
  });
  /** 切关时由外部调用，把输入层指向新的棋盘 */
  const setBoardRef = (b) => { currentBoard = b; };

  let mode = 'both';
  let dragging = false;
  let stroke = [];
  let lastEdge = null;
  let strokeKind = null;      // 'wall' | 'eraseWall' | 'paint' | 'erasePaint' | 'vertexLine'
  let dirty = false;
  /** 这一笔是否真的落过线（用于「点了格点却没拖动」时退化成填充） */
  let placedLine = false;
  /** 「点一下」判定：按下时所在格子、是否已有涂色、有没有拖开 */
  let pressCell = null;
  let pressFilled = false;
  let pressAt = null;
  let pressMoved = false;
  // 划线模式状态
  let anchor = null;          // **当前**格点 { r, c }；连续划线时随每条边推进
  let dragStart = null;       // 屏幕起点

  // 调试开关：控制台执行 __taogDebug(true) 后记录每次操作
  const DBG = { on: false, log: [] };
  globalThis.__taogDebug = (on = true) => {
    DBG.on = !!on;
    board._trace = DBG.on ? DBG.log : null;
    if (!on) {
      console.log('[taog] 操作日志：\n' + DBG.log.join('\n'));
      DBG.log = [];
    }
    return DBG.on ? 'debug on' : 'debug off（已打印历史）';
  };
  const dbg = (s) => { if (DBG.on) DBG.log.push(s); };

  const DR = [-1, 0, 1, 0];
  const DC = [0, 1, 0, -1];

  const setMode = (m) => {
    mode = m;
    updateCursor();
    renderer.showCursor(null);
  };

  function updateCursor() {
    svg.style.cursor = 'crosshair';
  }

  /* ---------------- 命中判定 ---------------- */

  const canDrawEdge = (r, c, dir) =>
    board.isCell(r, c) && board.isCell(r + DR[dir], c + DC[dir]);

  /** 由起点格点与拖动方向求对应的格边（与 Renderer.vertexEdge 同一套规则） */
  function edgeFromVertex(vr, vc, dir) {
    return renderer.vertexEdge(vr, vc, dir);
  }

  /** 综合判定：这次落点会操作什么 */
  function resolve(clientX, clientY) {
    const vertex = true
      ? renderer.nearestVertex(clientX, clientY, VERTEX_HIT_PX)
      : null;
    const wall = renderer.nearestUserWall(clientX, clientY, WALL_HIT_PX);
    const cell = renderer.hitPoint(clientX, clientY);
    return { vertex, wall, cell };
  }

  /* ---------------- 悬停高亮 ---------------- */

  function updateHover(clientX, clientY) {
    // 涂鸦模式：不提示任何可点目标，画就是了
    if (mode === 'doodle') { renderer.showCursor(null); return; }

    if (mode === 'erase') {
      // 擦除模式：高亮「点下去会擦掉什么」—— 优先墙，其次格子
      const w = renderer.nearestUserWall(clientX, clientY, WALL_HIT_PX);
      if (w) { renderer.showCursor({ kind: 'wall', r: w.r, c: w.c, dir: w.dir }); return; }
      const c0 = renderer.hitPoint(clientX, clientY);
      if (c0) renderer.showCursor({ kind: 'cell', r: c0.r, c: c0.c });
      else renderer.showCursor(null);
      return;
    }

    const vertex = renderer.nearestVertex(clientX, clientY, VERTEX_HIT_PX);
    const cell = renderer.hitPoint(clientX, clientY);
    if (vertex) {
      // 只提示格点本身（可能画线 / 取消该方向的线）
      let has = false;
      for (let d = 0; d < 4; d++) {
        const e = edgeFromVertex(vertex.r, vertex.c, d);
        if (e && board.userWalls[e.r][e.c][e.dir]) { has = true; break; }
      }
      renderer.showCursor({ kind: 'vertex', r: vertex.r, c: vertex.c, remove: has });
      return;
    }
    if (cell) renderer.showCursor({ kind: 'cell', r: cell.r, c: cell.c });
    else renderer.showCursor(null);
  }

  /* ---------------- 操作 ---------------- */

  function applyWall(r, c, dir, on) {
    if (!canDrawEdge(r, c, dir)) return;
    if (board.setWall(r, c, dir, on)) dirty = true;
  }

  function applyPaint(cell) {
    if (!cell || !board.isCell(cell.r, cell.c)) return;
    if (board.regionOf(cell.r, cell.c) > 0) return;
    board.fillStroke([cell]);
    dirty = true;
  }

  function applyErasePaint(cell) {
    if (!cell || !board.isCell(cell.r, cell.c)) return;
    if (board.regionOf(cell.r, cell.c) === 0) return;
    board.eraseCells([cell]);
    dirty = true;
  }

  /**
   * 指针是否「真正深入」了某一格（用于填充落笔）。
   * hitPoint 给出的 fx/fy 是格内 0..1 的比例；只要有一边落在死区内就返回 false。
   * 起点不受此限制（起笔时用户是明确点在格子里的）。
   */
  function inPaintZone(pt) {
    const lo = PAINT_INSET;
    const hi = 1 - PAINT_INSET;
    return pt.fx >= lo && pt.fx <= hi && pt.fy >= lo && pt.fy <= hi;
  }

  /* ---------------- 悬停（未按下时） ---------------- */
  svg.addEventListener('pointermove', (ev) => {
    if (dragging) return;
    updateHover(ev.clientX, ev.clientY);
  });
  svg.addEventListener('pointerleave', () => renderer.showCursor(null));

  /* ---------------- pointerdown ---------------- */
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 && ev.button !== 2) return;
    // ---- 涂鸦模式：在棋盘上自由手绘 ----
    if (mode === 'doodle') {
      if (!doodle) return;
      const p0 = renderer.pointerCell(ev.clientX, ev.clientY);
      if (!p0) return;
      ev.preventDefault();
      svg.setPointerCapture(ev.pointerId);
      dragging = true;
      strokeKind = 'doodle';
      onBegin?.();                       // 让撤销能退回这一笔
      if (ev.button === 2) {
        // 右键 = 撤掉最后一笔，随手改错
        doodle.undoLast();
        onChange?.();
        return;
      }
      const c0 = renderer.clampCanvas?.(p0.x, p0.y) ?? p0;
      doodle.begin(c0.x, c0.y, getColor?.() ?? '#2b2119');
      onDoodle?.();
      return;
    }
    const { vertex, wall, cell } = resolve(ev.clientX, ev.clientY);
    if (!cell) return;
    ev.preventDefault();
    svg.setPointerCapture(ev.pointerId);
    onBegin?.();
    dragging = true;
    stroke = [];
    lastEdge = null;
    dirty = false;
    placedLine = false;
    anchor = null;
    dragStart = { x: ev.clientX, y: ev.clientY };
    renderer.showCursor(null);

    // 记录「按下的这一格是否已经有涂色」——松手时若没拖动过，就当成一次点击，
    // 给这个区域换个颜色（填充模式）。
    {
      const hp = renderer.hitPoint(ev.clientX, ev.clientY);
      pressCell = hp ? { r: hp.r, c: hp.c } : null;
      pressFilled = !!pressCell && board.regionOf(pressCell.r, pressCell.c) > 0;
      pressAt = { x: ev.clientX, y: ev.clientY };
      pressMoved = false;
    }

    const erase = ev.button === 2;
    dbg(`[${erase ? '右键' : '左键'}] mode=${mode} cell=(${cell.r},${cell.c}) ` +
        `vertex=${vertex ? `(${vertex.r},${vertex.c},${vertex.dist.toFixed(1)}px)` : '-'} ` +
        `wall=${wall ? `(${wall.r},${wall.c},d${wall.dir})` : '-'}`);

    // ---- 擦除模式：左键 / 右键都用来擦 ----
    // 优先级：涂鸦（画在最上层）→ 墙 → 涂色。
    // 触屏没有右键，这个工具就是右键擦除的替代品（也顺带让擦墙不必先进划线模式）。
    if (mode === 'erase') {
      // 涂鸦是一笔一笔的手绘线，命中判定放宽一点，不必像素级精确
      if (doodle) {
        const pc = renderer.pointerCell(ev.clientX, ev.clientY);
        if (pc && doodle.removeAt(pc.x, pc.y, ERASE_DOODLE_TOL)) {
          dbg('  -> 擦除模式：擦掉一笔涂鸦');
          onChange();
          return;
        }
      }
      if (wall) {
        lastEdge = { r: wall.r, c: wall.c, dir: wall.dir };
        strokeKind = 'eraseWall';
        dirty = false;
        applyWall(wall.r, wall.c, wall.dir, false);
        if (dirty) onChange();
        dbg(`  -> 擦除模式：擦墙 (${wall.r},${wall.c},d${wall.dir})${dirty ? '' : '（预置墙，不可擦）'}`);
        return;
      }
      strokeKind = 'erasePaint';
      const was = board.regionOf(cell.r, cell.c);
      applyErasePaint(cell);
      dbg(`  -> 擦除模式：擦涂色 (${cell.r},${cell.c}) ${was} -> ${board.regionOf(cell.r, cell.c)}`);
      onChange();
      return;
    }

    // ---- 右键：只擦涂色，**不擦线** ----
    // 线只能在划线模式下从格点拖动来加/减（见下）。
    if (erase) {
      strokeKind = 'erasePaint';
      const before = board.regionOf(cell.r, cell.c);
      applyErasePaint(cell);
      dbg(`  -> 擦涂色 (${cell.r},${cell.c}) ${before} -> ${board.regionOf(cell.r, cell.c)}`);
      onChange();
      return;
    }

    // ---- 左键 ----
    // 从格点起拖 → 画线；否则 → 填充
    if (vertex) {
      anchor = { r: vertex.r, c: vertex.c };
      strokeKind = 'vertexLine';
      dbg(`  -> 混合模式：锚点格点 (${vertex.r},${vertex.c})`);
      return;
    }

    // 填充
    strokeKind = 'paint';
    stroke.push({ r: cell.r, c: cell.c });
    board.fillStroke(stroke);
    dirty = true;
    onChange();
  });

  /* ---------------- pointermove（拖动中） ---------------- */
  svg.addEventListener('pointermove', (ev) => {
    if (!dragging || !strokeKind) return;
    // 超过 5px 就算「拖动」，不再视为点击
    if (!pressMoved && pressAt
      && Math.hypot(ev.clientX - pressAt.x, ev.clientY - pressAt.y) > 5) pressMoved = true;

    if (strokeKind === 'doodle') {
      const p0 = renderer.pointerCell(ev.clientX, ev.clientY);
      if (p0 && doodle) {
        const c0 = renderer.clampCanvas?.(p0.x, p0.y) ?? p0;
        if (doodle.extend(c0.x, c0.y)) onDoodle?.();
      }
      return;
    }

    // 划线：**连续划线**。
    // 从锚点格点出发，只要指针在某个方向上离锚点超过半格，就落一条边，
    // 然后**把锚点推进到这条边的另一端**，接着看下一个方向 ——
    // 于是一次拖动可以画出折线（拐弯处自然接上），而不是只能从同一个点发散。
    if (strokeKind === 'vertexLine') {
      if (!anchor || !dragStart) return;
      // 顶点坐标下走一步的行列变化（0=上 1=右 2=下 3=左，与 vertexEdge 一致）
      const VR = [-1, 0, 1, 0];
      const VC = [0, 1, 0, -1];
      let placed = 0;
      let lastDir = null;
      let lastRemove = false;
      // 上限只是防御死循环；正常一次事件最多走几格
      for (let guard = 0; guard < 128; guard++) {
        const p = renderer.pointerCell(ev.clientX, ev.clientY);
        if (!p) break;
        const dx = p.x - anchor.c;
        const dy = p.y - anchor.r;
        // 主轴优先；不到半格就不算「走到下一个格点」
        let dir = null;
        if (Math.abs(dx) >= Math.abs(dy)) {
          if (Math.abs(dx) >= VERTEX_STEP) dir = dx > 0 ? 1 : 3;
        } else if (Math.abs(dy) >= VERTEX_STEP) {
          dir = dy > 0 ? 2 : 0;
        }
        if (dir == null) break;

        const edge = edgeFromVertex(anchor.r, anchor.c, dir);
        if (!edge) {
          // 该方向没有格边。若这一笔还一条都没画成，就退化成填充 —— 免得从格点起拖却白费力气。
          if (!placed) {
            const pt0 = renderer.hitPoint(ev.clientX, ev.clientY);
            if (pt0) {
              strokeKind = 'paint';
              stroke = [{ r: pt0.r, c: pt0.c }];
              board.fillStroke(stroke);
              dirty = true;
              onChange();
            }
          }
          break;
        }
        const exists = !!board.userWalls[edge.r][edge.c][edge.dir];
        lastRemove = exists;
        dirty = false;
        applyWall(edge.r, edge.c, edge.dir, !exists);
        if (dirty) placedLine = true;
        if (dirty) {
          placed++;
          if (!exists) board.splitRegions();
          onChange();
        }
        lastDir = dir;
        anchor = { r: anchor.r + VR[dir], c: anchor.c + VC[dir] };
      }
      if (placed) {
        dbg(`  -> 连续划线：共 ${placed} 段，当前顶点 (${anchor.r},${anchor.c})`);
      }
      renderer.showCursor({
        kind: 'vertex', r: anchor.r, c: anchor.c, remove: lastRemove, dir: lastDir,
      });
      return;
    }

    if (strokeKind === 'wall' || strokeKind === 'eraseWall') {
      const edge = renderer.hitEdge(ev.clientX, ev.clientY, 20);
      if (!edge) return;
      if (lastEdge && lastEdge.r === edge.r && lastEdge.c === edge.c && lastEdge.dir === edge.dir) return;
      lastEdge = edge;
      dirty = false;
      applyWall(edge.r, edge.c, edge.dir, strokeKind === 'wall');
      if (dirty && strokeKind === 'wall') board.splitRegions();
      if (dirty) onChange();
      return;
    }

    const pt = renderer.hitPoint(ev.clientX, ev.clientY);
    if (!pt) return;

    if (strokeKind === 'erasePaint') {
      applyErasePaint({ r: pt.r, c: pt.c });
      if (dirty) onChange();
      return;
    }

    // 填充：需要「真正进入」这一格才落笔。
    // 鼠标快速斜向拖动时，轨迹会从两条格边的交点（顶点）上掠过 ——
    // 那一刻 hitPoint 会把指针归到**斜对角**那一格，于是误涂了相邻区域的格子、
    // 把两块区域错误合并（0066 等关卡就是这么坏掉的）。
    // 这里加一个内缩死区：只有当指针离格边足够远时才算进入该格。
    if (!inPaintZone(pt)) return;
    // 填充
    const prev = stroke[stroke.length - 1];
    if (prev && prev.r === pt.r && prev.c === pt.c) return;
    const line = interpolate(prev, pt);
    stroke.push(...line);
    board.fillStroke(stroke);
    dirty = true;
    onChange();
  });

  const finish = (ev) => {
    if (!dragging) return;
    // 「点在格点上，但从头到尾一条线都没画成」= 其实是一次点击。
    // 点击本来就画不出线（画线要靠拖动），所以这里退化成填充 ——
    // 否则格点捕获圈一偏，用户就会觉得「点了没反应」。
    // 手机上的大盘尤其明显：格子 20px 时捕获圈相对很大，点偏一点就落到圈里。
    // ★ 点一下已填色的区域 = 换个颜色（纯外观）。只在填充模式生效。
    //   拖动过就不算点击，否则每次涂完松手都会顺手换色。
    if (ev?.type !== 'pointercancel' && mode === 'both'
      && pressFilled && !pressMoved && pressCell) {
      const id = board.regionOf(pressCell.r, pressCell.c);
      if (id > 0 && board.rerollRegionColor?.(id, renderer.colorCount)) {
        onChange?.();
      }
    }
    if (strokeKind === 'doodle') {
      doodle?.end();
      onChange?.();                      // 收笔才走「重量级」刷新 + 存档
    }
    if (strokeKind === 'vertexLine' && !placedLine && ev && ev.clientX != null) {
      const pt = renderer.hitPoint(ev.clientX, ev.clientY);
      if (pt && board.isCell(pt.r, pt.c)) {
        stroke = [{ r: pt.r, c: pt.c }];
        board.fillStroke(stroke);
        dirty = true;
      }
    }
    dragging = false;
    lastEdge = null;
    stroke = [];
    strokeKind = null;
    anchor = null;
    dragStart = null;
    onChange();
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('contextmenu', (ev) => ev.preventDefault());

  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    if (ev.key === 'c' || ev.key === 'C') {
      onBegin?.();
      board.clear();
      onChange();
      toast?.('已清空区域');
    }
    if (ev.key === 'w' || ev.key === 'W') {
      onBegin?.();
      board.clearWalls();
      onChange();
      toast?.('已清除所画的墙');
    }
  });

  updateCursor();
  return { setMode, getMode: () => mode, setBoardRef };
}

/**
 * 画笔在两格之间经过的中间格。
 *
 * 关键：**不能多画格子**。
 *  - 同一行 / 同一列 → 补上沿途每一格；
 *  - 斜向 → **只到终点**，绝不额外引入拐角格。
 *    （早期实现走「先水平补齐、再垂直补齐」的 L 形，
 *      于是从 (2,1) 斜拖到 (3,0) 会顺带把 (3,1) 或 (2,0) 也涂上 ——
 *      本来 3 格的区域变 4 格，形状就不在形状池里了，0066 就是这么坏掉的。）
 *
 * 统一规则：主轴每步推进 1，副轴整段保持不动，只在终点落到目标。
 */
function interpolate(a, b) {
  if (!a) return [b];
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  if (dr === 0 && dc === 0) return [];
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  // 主轴：位移较大的那根轴
  const rowMajor = adr >= adc;
  const major = rowMajor ? adr : adc;
  const out = [];
  for (let i = 1; i <= major; i++) {
    // 主轴按 i 推进；副轴只在最后一步才落到终点（中间保持起点值）
    let r;
    let c;
    if (rowMajor) {
      r = a.r + Math.sign(dr) * i;
      c = (i === major) ? b.c : a.c;
    } else {
      c = a.c + Math.sign(dc) * i;
      r = (i === major) ? b.r : a.r;
    }
    out.push({ r, c });
  }
  return out;
}

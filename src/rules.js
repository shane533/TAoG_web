/* 规则校验：把 .puz 的指令翻译成可判定的约束，并给出实时诊断。
 *
 * 指令 ↔ 游戏内规则名（已用 ref/*.png 官方说明逐条核对）：
 *   SHAPE / SHAPE_BANK        形状池   区域形状必须取自形状库，并受用量限制
 *   AREA_EQUALS n             精确(N)  每个区域面积正好为 n
 *   AREA_AT_LEAST / AT_MOST   范围(N-M) 所有区域面积在区间内
 *   ALL_SHAPES_SAME           相同     所有区域形状相同
 *   ALL_SHAPES_DIFFERENT      相异     所有区域形状不同
 *   ADJACENT_SIZES_DIFFERENT  差异化    相邻区域面积必须不同
 *   ADJACENT_SHAPES_DIFFERENT （相邻区域形状不同）
 *   ONE_SYMBOL_PER_REGION     独居     每个区域包含单独一个符号
 *   ONLY_RECTANGLES           方块     所有区域必须是矩形
 *   NO_RECTANGLES             非方块   不允许矩形区域
 *   NO_4_WAY_INTERSECTIONS    砖纹     不能出现正好有 4 条边框交汇的点
 *   NO_3_WAY_INTERSECTIONS    环纹     不能出现正好有 3 条边框交汇的点
 *
 * 符号族（写在格子内容里）：
 *   两位数字    面积     该区域的面积必须等于此数
 *   S<n>              同号区域形状必须相同
 *   P<n>              同号区域面积相同、形状必须不同
 *   F<n>              所有区域形状互不相同
 *   U/D/L/R + 数字     罗盘：区域在四个方向上贴边的格子数
 */

/** 各指令对应的游戏内规则名 */
export const RULE_LABELS = {
  area_equals: (n) => `精确（${n}）`,
  area_at_least: (n) => `范围（≥${n}）`,
  area_at_most: (n) => `范围（≤${n}）`,
  all_shapes_same: () => '相同',
  all_shapes_different: () => '相异',
  adjacent_sizes_different: () => '差异化',
  adjacent_shapes_different: () => '相异（相邻）',
  one_symbol_per_region: () => '独居',
  only_rectangles: () => '方块',
  no_rectangles: () => '非方块',
  no_4_way_intersections: () => '砖纹',
  no_3_way_intersections: () => '环纹',
};

/** 归一化一组格子坐标，返回可比较的字符串 */
function normalize(cells) {
  const r0 = Math.min(...cells.map((p) => p[0]));
  const c0 = Math.min(...cells.map((p) => p[1]));
  return cells
    .map(([r, c]) => [r - r0, c - c0])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([r, c]) => `${r},${c}`)
    .join(';');
}

/** 生成 8 种旋转/镜像变体 */
function variants(cells) {
  const out = [];
  let cur = cells;
  for (let i = 0; i < 4; i++) {
    out.push(cur);
    out.push(cur.map(([r, c]) => [r, -c]));
    cur = cur.map(([r, c]) => [c, -r]); // 旋转 90°
  }
  return out;
}

/** 形状签名（默认允许旋转与镜像） */
export function shapeSignature(cells) {
  const keys = variants(cells).map((v) => normalize(v));
  keys.sort();
  return keys[0];
}

export function isRectangle(cells) {
  const rs = cells.map((p) => p[0]);
  const cs = cells.map((p) => p[1]);
  const h = Math.max(...rs) - Math.min(...rs) + 1;
  const w = Math.max(...cs) - Math.min(...cs) + 1;
  return h * w === cells.length;
}

function rectSize(cells) {
  const rs = cells.map((p) => p[0]);
  const cs = cells.map((p) => p[1]);
  const h = Math.max(...rs) - Math.min(...rs) + 1;
  const w = Math.max(...cs) - Math.min(...cs) + 1;
  return { h, w };
}

/** 区域对象：cells 为 [r,c] 数组，symbols 为该区域内的符号名 */
export function buildRegionInfo(board) {
  const infos = [];
  for (const [id, list] of board.regionCells()) {
    const cells = list.map(({ r, c }) => [r, c]);
    const symbols = [];
    for (const { r, c, raw } of board.puzzle.symbols ?? []) {
      if (board.regionOf(r, c) === id) symbols.push(raw);
    }
    infos.push({
      id,
      cells,
      size: cells.length,
      signature: shapeSignature(cells),
      rectangle: isRectangle(cells),
      rect: rectSize(cells),
      symbols,
    });
  }
  return infos;
}

function localParts(infos, regions, str) {
  switch (regions) {
    case '3': {
      const n = parseInt(str, 10);
      return infos
        .filter((i) => i.symbols.length === 1 && /^\d+$/.test(i.symbols[0]) && parseInt(i.symbols[0], 10) !== n)
        .map((i) => `区域含数字 ${i.symbols[0]}，但本题要求全部为 ${n}`);
    }
    case '4': {
      const groups = new Map();
      for (const i of infos) {
        if (i.symbols.length !== 1 || !/^\d+$/.test(i.symbols[0])) continue;
        const key = i.symbols[0];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }
      const out = [];
      for (const [key, list] of groups) {
        if (list.length !== 1) out.push(`数字 ${key} 出现了 ${list.length} 次，应各出现一次`);
      }
      return out;
    }
    case '5': {
      const groups = new Map();
      for (const i of infos) {
        if (!i.symbols.length) continue;
        const key = i.symbols[0];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }
      const out = [];
      for (const [key, list] of groups) {
        if (list.length < 2) {
          out.push(`符号 ${key} 只出现了 1 次，需要至少两个此类区域才能比较大小`);
          continue;
        }
        const sizes = list.map((i) => i.size);
        const uniq = new Set(sizes);
        if (uniq.size !== sizes.length) {
          out.push(`符号 ${key} 的区域大小出现重复：${sizes.join('、')}`);
        }
      }
      return out;
    }
    case '1':
      return infos.filter((i) => i.symbols.length !== 1).map((i) => `有区域包含 ${i.symbols.length} 个符号，应为 1 个`);
    default:
      return [];
  }
}

/**
 * 校验整个棋盘。
 * @returns {{complete:boolean, ok:boolean, statements:Array, violations:Array}}
 */
export function validate(board) {
  const puzzle = board.puzzle;
  const rules = puzzle.rules ?? {};
  const infos = buildRegionInfo(board);
  const statements = [];
  const violations = [];

  /**
   * 本关是否**声明**了某类符号。
   *
   * ⚠️ 必须看关卡数据（`puzzle.symbols`），**不能**看当前已划定的区域 ——
   * 刚进关卡时一个区域都没有，`infos` 是空的，那样规则卡会全都不显示。
   * （边线索那组已经因为同样的原因踩过一次坑。）
   */
  const declared = puzzle.symbols ?? [];
  const hasSymbol = (re) => declared.some((sym) => re.test(String(sym?.raw ?? '')));

  const unassigned = board.totalCells - board.assignedCells;
  const complete = unassigned === 0 && infos.length > 0;

  // ---- 面积规则
  //
  // 每条规则都带上展示用的元数据（name / desc / icon），
  // 由右栏渲染成「一张卡一条规则」，样式对齐游戏里的规则卷轴。
  // `at_least` + `at_most` 同时存在时合成一张「范围」卡（游戏里也是这样）。
  const lo = rules.area_at_least;
  const hi = rules.area_at_most;
  if (rules.area_equals != null) {
    statements.push({
      id: 'area-equals',
      name: `精确 (${rules.area_equals})`,
      desc: `每个区域的面积必须正好为 ${rules.area_equals}。`,
      icon: { kind: 'area-equals', n: rules.area_equals },
      done: infos.length > 0 && infos.every((i) => i.size === rules.area_equals),
    });
    for (const i of infos) if (i.size !== rules.area_equals) violations.push(`有区域为 ${i.size} 格，应为 ${rules.area_equals} 格`);
  }
  if (lo != null && hi != null) {
    statements.push({
      id: 'area-between',
      name: `范围 (${lo}-${hi})`,
      desc: `每个区域的面积在 ${lo} 和 ${hi} 之间。`,
      icon: { kind: 'area-between', lo, hi },
      done: infos.length > 0 && infos.every((i) => i.size >= lo && i.size <= hi),
    });
    for (const i of infos) {
      if (i.size < lo) violations.push(`有区域只有 ${i.size} 格，至少需要 ${lo} 格`);
      if (i.size > hi) violations.push(`有区域有 ${i.size} 格，最多允许 ${hi} 格`);
    }
  } else if (lo != null) {
    statements.push({
      id: 'area-at-least',
      name: `至少 (${lo})`,
      desc: `所有区域的面积至少为 ${lo}。`,
      icon: { kind: 'area-at-least', n: lo },
      done: infos.length > 0 && infos.every((i) => i.size >= lo),
    });
    for (const i of infos) if (i.size < lo) violations.push(`有区域只有 ${i.size} 格，至少需要 ${lo} 格`);
  } else if (hi != null) {
    statements.push({
      id: 'area-at-most',
      name: `至多 (${hi})`,
      desc: `所有区域的面积最大为 ${hi}。`,
      icon: { kind: 'area-at-most', n: hi },
      done: infos.length > 0 && infos.every((i) => i.size <= hi),
    });
    for (const i of infos) if (i.size > hi) violations.push(`有区域有 ${i.size} 格，最多允许 ${hi} 格`);
  }

  // ---- 形状池（SHAPE / SHAPE_BANK）
  //
  // 语义区分（由全量标准答案验证得出）：
  //   * `SHAPE` 单独出现 —— 只是**声明本关有哪些形状**，供 `S<n>` / `F<n>` / `P<n>`
  //     这些符号引用（例如「拼块」规则要求某区域呈形状 n）。
  //     此时区域形状**不受限制**（`Zone1/10-same-shape-no-touch` 等 87 关就是如此）。
  //   * `SHAPE` + `SHAPE_BANK` —— 才是「形状池」规则：**所有区域必须取自形状池**。
  //     （`SHAPE_BANK` 是「本关用到的形状 id 列表」，不是用量上限。）
  const shapes = puzzle.shapes ?? [];
  const bankKeys = Object.keys(puzzle.shape_bank ?? {});
  const poolEnforced = shapes.length > 0 && bankKeys.length > 0;
  if (poolEnforced) {
    const allowed = new Set();
    for (const s of shapes) {
      const cells = [];
      s.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] === '#') cells.push([r, c]);
      });
      allowed.add(shapeSignature(cells));
    }
    let allAllowed = infos.length > 0;
    for (const i of infos) {
      if (!allowed.has(i.signature)) {
        allAllowed = false;
        violations.push('有区域的形状不在允许的形状池中');
      }
    }
    statements.push({
      id: 'shape-pool',
      name: '形状池',
      desc: '所有区域必须呈以下形状：',
      icon: null,          // 卡面直接展示形状本身，不需要插图
      done: allAllowed,
    });
  }

  // ---- 形状关系
  if (rules.all_shapes_same) {
    const sigs = new Set(infos.map((i) => i.signature));
    statements.push({
      id: 'shapes-same', name: '相同', desc: '所有区域必须形状相同。',
      icon: { kind: 'same' }, done: infos.length > 0 && sigs.size === 1,
    });
    if (infos.length && sigs.size > 1) violations.push(`出现了 ${sigs.size} 种不同形状，应完全相同`);
  }
  if (rules.all_shapes_different) {
    const sigs = infos.map((i) => i.signature);
    const dup = sigs.length - new Set(sigs).size;
    statements.push({
      id: 'shapes-different', name: '相异', desc: '所有区域必须形状不同。',
      icon: { kind: 'different' }, done: infos.length > 0 && dup === 0,
    });
    if (dup > 0) violations.push(`有 ${dup} 个区域与其它区域形状重复`);
  }

  // 邻接关系（「相邻」= 两格共享一条边；玩家画的墙只影响视觉与自动分块，
  // 不改变连通性判定，所以这里用格子本身的四邻而非 board.neighbors）
  if (rules.adjacent_shapes_different || rules.adjacent_sizes_different) {
    let bad = 0;
    const seenPair = new Set();
    const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    for (const i of infos) {
      for (const [r, c] of i.cells) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr;
          const nc = c + dc;
          if (!board.isCell(nr, nc)) continue;
          const other = board.regionOf(nr, nc);
          if (other <= 0 || other === i.id) continue;
          const key = i.id < other ? `${i.id}-${other}` : `${other}-${i.id}`;
          if (seenPair.has(key)) continue;
          seenPair.add(key);
          const j = infos.find((x) => x.id === other);
          if (!j) continue;
          if (rules.adjacent_shapes_different && i.signature === j.signature) bad++;
          if (rules.adjacent_sizes_different && i.size === j.size) bad++;
        }
      }
    }
    if (rules.adjacent_shapes_different) {
      statements.push({
        id: 'adjacent-shapes-different', name: '混合', desc: '相邻区域必须形状不同。',
        icon: { kind: 'mingle' }, done: infos.length > 0 && bad === 0,
      });
      if (bad) violations.push(`有 ${bad} 对相邻区域形状相同`);
    }
    if (rules.adjacent_sizes_different) {
      statements.push({
        id: 'adjacent-areas-different', name: '差异化', desc: '相邻区域的面积必须不同。',
        icon: { kind: 'diff-area' }, done: infos.length > 0 && bad === 0,
      });
      if (bad) violations.push(`有 ${bad} 对相邻区域面积相同`);
    }
  }

  // ---- 矩形
  if (rules.only_rectangles) {
    const bad = infos.filter((i) => !i.rectangle);
    statements.push({
      id: 'only-rectangles', name: '方块', desc: '所有区域是矩形。',
      icon: { kind: 'boxy' }, done: infos.length > 0 && bad.length === 0,
    });
    if (bad.length) violations.push(`有 ${bad.length} 个区域不是矩形`);
  }
  if (rules.no_rectangles) {
    const bad = infos.filter((i) => i.rectangle);
    statements.push({
      id: 'no-rectangles', name: '非方块', desc: '没有区域是矩形。',
      icon: { kind: 'non-boxy' }, done: infos.length > 0 && bad.length === 0,
    });
    if (bad.length) violations.push(`有 ${bad.length} 个区域是矩形`);
  }

  // ---- 顶点交叉（砖纹 / 环纹）
  // 规则含义：在一个「顶点」（4 格的角点）上相遇的区域数量受限。
  //   砖纹（NO_4_WAY_INTERSECTIONS）：不允许 4 个区域交于一点（砖砌式错缝）
  //   环纹（NO_3_WAY_INTERSECTIONS）：不允许 3 个区域交于一点
  // 判定：遍历每个顶点，收集其周围 4 格（含棋盘外/未分配）的区域号去重计数。
  if (rules.no_3_way_intersections || rules.no_4_way_intersections) {
    let three = 0;
    let four = 0;
    const R = board.rows;
    const C = board.cols;
    // 顶点上「汇聚了几条边」——这里的「边」指**区域边界**（格边），
    // 不是「有几个区域」。这是游戏内规则原文的定义：
    //   「不能出现正好有 3 条边汇聚的点」（环纹）
    //   「不能出现正好有 4 条边汇聚的点」（砖纹）
    // 已用 40 个含环纹的关卡 × 其标准答案验证：40/40 都没有 3 边顶点。
    const isBoundary = (r1, c1, r2, c2) => {
      const aIn = board.isCell(r1, c1);
      const bIn = board.isCell(r2, c2);
      if (!aIn && !bIn) return false;          // 两侧都没有格 → 这条边不存在
      if (!aIn || !bIn) return true;           // 一侧是棋盘外 → 边界
      const ra = board.regionOf(r1, c1);
      const rb = board.regionOf(r2, c2);
      return ra !== rb;                        // 不同区域 → 边界
    };
    for (let vr = 0; vr <= R; vr++) {
      for (let vc = 0; vc <= C; vc++) {
        // 顶点周围的四条格边（水平两条 + 竖直两条）
        const edges = [
          isBoundary(vr - 1, vc - 1, vr - 1, vc),
          isBoundary(vr, vc - 1, vr, vc),
          isBoundary(vr - 1, vc - 1, vr, vc - 1),
          isBoundary(vr - 1, vc, vr, vc),
        ];
        const n = edges.filter(Boolean).length;
        if (n >= 4) four++;
        else if (n === 3) three++;
      }
    }
    if (rules.no_4_way_intersections) {
      statements.push({
        id: 'no-4-way', name: '砖纹', desc: '没有顶点正好有 4 条边相交。',
        icon: { kind: 'bricky' }, done: four === 0,
      });
      if (four) violations.push(`有 ${four} 个顶点汇聚了 4 条边`);
    }
    if (rules.no_3_way_intersections) {
      statements.push({
        id: 'no-3-way', name: '环纹', desc: '没有顶点正好有 3 条边相交。',
        icon: { kind: 'loopy' }, done: three === 0,
      });
      if (three) violations.push(`有 ${three} 个顶点汇聚了 3 条边`);
    }
  }

  // ---- 符号：独居（每个区域恰好一个符号）
  if (rules.one_symbol_per_region) {
    const bad = infos.filter((i) => i.symbols.length !== 1);
    statements.push({
      id: 'one-symbol-per-region', name: '独居',
      // 「包含单独一个符号」语法别扭；实现判的是 length !== 1（恰好一个）
      desc: '每个区域只能包含一个符号。',
      icon: { kind: 'solitude' }, done: infos.length > 0 && bad.length === 0,
    });
    if (bad.length) violations.push(`有 ${bad.length} 个区域的符号数不是 1`);
  }

  // ---- 面积符号：格子里写了数字（如 04）表示「该区域面积等于此数」
  {
    const bad = infos.filter((i) => i.symbols.some((s) => /^\d+$/.test(s)
      && parseInt(s, 10) !== i.size));
    if (hasSymbol(/^\d+$/)) {
      statements.push({
        id: 'area-numbers', name: '面积', desc: '显示所属区域的面积。',
        icon: { kind: 'area-number' }, done: bad.length === 0,
      });
      for (const i of bad) {
        const n = i.symbols.find((s) => /^\d+$/.test(s));
        violations.push(`标注 ${n} 的区域实际有 ${i.size} 格`);
      }
    }
  }

  // ---- 拼块 S<n>：该区域的形状必须等于形状池里 id === n 的那个形状
  //      （等价说法：同号区域形状相同，异号区域形状不同）
  {
    const pool = new Map();
    for (const s of puzzle.shapes ?? []) {
      const cells = [];
      s.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] === '#') cells.push([r, c]);
      });
      pool.set(String(s.id), shapeSignature(cells));
    }
    const bad = [];
    for (const i of infos) {
      for (const sym of i.symbols) {
        const m = /^S(\d+)$/.exec(sym);
        if (!m) continue;
        const want = pool.get(m[1]);
        if (!want) { bad.push(`符号 ${sym} 指向的形状池编号 ${m[1]} 不存在`); continue; }
        if (want !== i.signature) bad.push(`符号 ${sym} 所在区域形状与形状池 ${m[1]} 不符`);
      }
    }
    if (hasSymbol(/^S\d+$/)) {
      statements.push({
        id: 'poly', name: '拼块', desc: '显示所属区域的形状。',
        icon: { kind: 'poly' }, done: bad.length === 0,
      });
      violations.push(...bad);
    }
  }

  // ---- 玫瑰窗 P<n>：每种 P 编号在每个区域里各出现一次
  //
  // ⚠️ 判定条件必须看**关卡声明了哪些符号**（`hasSymbol`），不能看当前涂色分出来的区域
  //    （`infos`）—— 否则刚进关卡、棋盘还是空的时候一个区域都没有，
  //    这张规则卡就整个消失了（和面积/拼块/围栏当初那个 bug 一模一样）。
  if (hasSymbol(/^P\d+$/)) {
    const idxs = new Set();
    for (const i of infos) for (const s of i.symbols) {
      const m = /^P(\d+)$/.exec(s);
      if (m) idxs.add(m[1]);
    }
    const bad = [];
    for (const n of idxs) {
      for (const i of infos) {
        const cnt = i.symbols.filter((s) => s === `P${n}`).length;
        if (cnt !== 1) bad.push(`区域含 P${n} 共 ${cnt} 个，应恰好 1 个`);
      }
    }
    statements.push({
      id: 'rose-window', name: '玫瑰窗', desc: '每种符号每个区域必须各包含一个。',
      icon: { kind: 'rose' }, done: bad.length === 0,
    });
    violations.push(...bad);
  }

  // ---- 围栏 F<n>：该格自身四条区域边界构成的图案（可旋转）
  //      0=无墙 1=一条 2=两条相对 3=三条 4=四条 7=两条相邻
  {
    const F = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 7: 7 };
    const bad = [];
    for (const i of infos) {
      for (const sym of i.symbols) {
        const m = /^F(\d+)$/.exec(sym);
        if (!m || !(m[1] in F)) continue;
        const want = F[m[1]];
        const { r, c } = board.cellOf ? board.cellOf(sym) : { r: -1, c: -1 };
        void r; void c;
        // 图案由「该格四条边是否为区域边界」决定
        const cell = i.cells.find(([rr, cc]) => {
          const s2 = board.puzzle.symbols?.find((x) => x.r === rr && x.c === cc);
          return s2 && s2.raw === sym;
        });
        if (!cell) continue;
        const [rr, cc] = cell;
        let wallsCount = 0;
        let pattern = [0, 0, 0, 0]; // 上右下左
        const dirs = [[-1, 0], [0, 1], [1, 0], [0, -1]];
        dirs.forEach(([dr, dc], k) => {
          const nr = rr + dr;
          const nc = cc + dc;
          const other = board.isCell(nr, nc) ? board.regionOf(nr, nc) : 0;
          if (!board.isCell(nr, nc) || other !== i.id) {
            pattern[k] = 1;
            wallsCount++;
          }
        });
        const adjacentPair = pattern[0] + pattern[1] + pattern[2] + pattern[3];
        let cls;
        if (wallsCount === 4) cls = 4;
        else if (wallsCount === 3) cls = 3;
        else if (wallsCount === 2) cls = (pattern[0] === pattern[2]) ? 2 : 7;
        else if (wallsCount === 1) cls = 1;
        else cls = 0;
        void adjacentPair;
        if (cls !== want) bad.push(`符号 ${sym} 所在格的边界图案为 ${cls}，应为 ${want}`);
      }
    }
    if (hasSymbol(/^F\d+$/)) {
      statements.push({
        id: 'palisade', name: '围栏', desc: '显示所属单元格边框的形状，可旋转。',
        icon: { kind: 'palisade' }, done: bad.length === 0,
      });
      violations.push(...bad);
    }
  }

  // ---- 罗盘 U/D/L/R + 数字：区域在该半平面上的其他格数
  {
    const bad = [];
    const seen = new Set();
    for (const i of infos) {
      for (const sym of i.symbols) {
        for (const m of sym.matchAll(/([UDLR])(\d+)/g)) {
          const dir = m[1];
          const want = parseInt(m[2], 10);
          const key = `${sym}|${dir}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // 找到该符号所在格
          const s0 = board.puzzle.symbols?.find((x) => x.raw === sym
            && board.regionOf(x.r, x.c) === i.id);
          if (!s0) continue;
          let cnt = 0;
          for (const [rr, cc] of i.cells) {
            if (dir === 'U' && rr < s0.r) cnt++;
            if (dir === 'D' && rr > s0.r) cnt++;
            if (dir === 'L' && cc < s0.c) cnt++;
            if (dir === 'R' && cc > s0.c) cnt++;
          }
          if (cnt !== want) bad.push(`罗盘 ${sym} 的 ${dir} 方向实际 ${cnt} 格，标 ${want}`);
        }
      }
    }
    if (hasSymbol(/[UDLR]\d/)) {
      statements.push({
        id: 'compass', name: '罗盘',
        // 游戏内的原文表述；「半平面单元」那种说法是我自己编的，容易看不懂
        desc: '显示该单元格所属区域内，各方向其他单元格的数量。',
        icon: { kind: 'compass' }, done: bad.length === 0,
      });
      violations.push(...bad);
    }
  }

  // ---- 边上的线索（不等号 / 双生异生 / 顶点雷达）
  //   已用 SOLUTION 还原的标准答案定量验证：
  //     不等号「箭头指向面积更小的一侧」   402/402 = 100%
  //     顶点雷达「数字 = 该顶点接触的区域数」 698/698 = 100%
  //     差值「两侧区域面积之差」            388/388 = 100%
  {
    const edges = puzzle.edges ?? [];
    const sizeOf = new Map(infos.map((i) => [i.id, i.size]));
    const regionAt = (r, c) => (board.isCell(r, c) ? board.regionOf(r, c) : 0);

    // 游戏里「不等号 / 双生 / 异生 / 差值」是**四张独立的规则卡**，
    // 所以这里也按线索种类分开收集、分开出卡。
    const badBy = { ineq: [], twin: [], alien: [], diff: [] };
    const seenBy = { ineq: false, twin: false, alien: false, diff: false };
    for (const e of edges) {
      if (e.type !== 'V' && e.type !== 'H') continue;
      // 归一字形：竖边是 '<' '>'，横边是 '^^' 'vv'；双生/异生同理
      const gl = String(e.glyph ?? '');
      const kind = gl[0];
      // ⚠️ 先按**符号种类**登记「本关存在这类线索」，与区域是否已划定无关。
      // 否则刚进关卡时一个区域都没有，下面的 `!ra` 会把所有边都跳过，
      // 规则卡就全都不出现了。
      if (kind === '<' || kind === '^' || kind === '>' || kind === 'v') seenBy.ineq = true;
      else if (kind === '=') seenBy.twin = true;
      else if (kind === '!') seenBy.alien = true;
      else if (kind === 'd') seenBy.diff = true;
      else continue;

      const [a, b] = e.type === 'V'
        ? [[e.r, e.k - 1], [e.r, e.k]]            // 左 / 右
        : [[e.r - 1, e.k], [e.r, e.k]];           // 上 / 下
      const ra = regionAt(...a);
      const rb = regionAt(...b);
      if (!ra || !rb || ra === rb) continue;
      const sa = sizeOf.get(ra);
      const sb = sizeOf.get(rb);
      const leftLabel = e.type === 'V' ? '左' : '上';
      const rightLabel = e.type === 'V' ? '右' : '下';
      if (kind === '<' || kind === '^') {
        if (!(sa < sb)) badBy.ineq.push(`箭头指${leftLabel}，但${leftLabel} ${sa} 格不小于${rightLabel} ${sb} 格`);
      } else if (kind === '>' || kind === 'v') {
        if (!(sa > sb)) badBy.ineq.push(`箭头指${rightLabel}，但${leftLabel} ${sa} 格不大于${rightLabel} ${sb} 格`);
      } else if (kind === '=') {
        if (shapeSigOf(ra) !== shapeSigOf(rb)) badBy.twin.push('双生边上两侧区域形状不同');
      } else if (kind === '!') {
        if (shapeSigOf(ra) === shapeSigOf(rb)) badBy.alien.push('异生边上两侧区域形状相同');
      } else if (kind === 'd') {
        // 差值：两侧区域面积之差
        const want = Number(e.value);
        if (Math.abs(sa - sb) !== want) {
          badBy.diff.push(`差值标注 ${want}，但两侧为 ${sa} 与 ${sb}（差 ${Math.abs(sa - sb)}）`);
        }
      }
    }
    function shapeSigOf(id) {
      const i = infos.find((x) => x.id === id);
      return i ? i.signature : null;
    }
    // 四张卡分别对应游戏里的「不等号 / 双生 / 异生 / 差值」
    const CLUE_CARDS = [
      ['ineq', 'inequality', '不等号', '尖头指向的区域面积更小。'],
      ['twin', 'twin', '双生', '接触该符号的两个区域必须形状相同。'],
      ['alien', 'alien', '异生', '接触该符号的两个区域必须形状不同。'],
      ['diff', 'difference', '差值', '表示两个相邻区域面积的差值。'],
    ];
    for (const [key, id, name, desc] of CLUE_CARDS) {
      if (!seenBy[key]) continue;
      statements.push({
        id,
        name,
        desc,
        icon: { kind: id },
        done: badBy[key].length === 0,
      });
      violations.push(...badBy[key]);
    }

    const radarBad = [];
    for (const e of edges) {
      if (e.type !== 'vertex') continue;
      const cells = [[e.r - 1, e.k - 1], [e.r - 1, e.k], [e.r, e.k - 1], [e.r, e.k]];
      const ids = new Set();
      for (const [r, c] of cells) {
        const rid = regionAt(r, c);
        if (rid) ids.add(rid);
      }
      if (!ids.size) continue;
      if (ids.size !== e.value) {
        radarBad.push(`顶点(${e.r},${e.k}) 接触 ${ids.size} 个区域，标 ${e.value}`);
      }
    }
    if (edges.some((e) => e.type === 'vertex')) {
      statements.push({
        id: 'watchtower', name: '望塔', desc: '显示与该点接触的区域数量。',
        icon: { kind: 'watchtower' }, done: radarBad.length === 0,
      });
      violations.push(...radarBad);
    }
  }

  // ---- 未分配格子
  if (unassigned > 0) violations.push(`还有 ${unassigned} 格没有划定区域`);

  const ok = complete && violations.length === 0;
  return { complete, ok, statements, violations: [...new Set(violations)] };
}

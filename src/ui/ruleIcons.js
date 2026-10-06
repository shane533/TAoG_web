/* 规则卡片左侧的小插图：把每条规则的语义画成一张 40x40 的迷你谜题示意图。
   纯 DOM、零依赖、无外部资源；只负责画图，不参与任何规则判定。 */

const NS = 'http://www.w3.org/2000/svg';

// 区域填色只允许用这几个（见下方的调色板约束）
const AMBER = '#e0b955';
const GREEN = '#5b8f4e';
const BLUE = '#4a6fa5';
const ROSE = '#a55a6f';
const PURPLE = '#7a5aa5';
const TEAL = '#3f8fa0';

const GRID = '#8a6f4a';   // 网格线 / 墙
const EDGE = '#4a3d2c';   // 区域轮廓
const INK = '#3a2f22';    // 叠加符号（数字、箭头、点、×）
const BAD = '#c0574a';    // 问题 / 划掉的标记

const FONT = 'Segoe UI, sans-serif';

/* ---------- 小工具 ---------- */

function mk(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  }
  return n;
}

function rect(x, y, w, h, fill, stroke, sw = 1, rx = 2) {
  return mk('rect', {
    x, y, width: w, height: h, rx,
    fill: fill || 'none',
    stroke: stroke || 'none',
    'stroke-width': sw,
  });
}

function line(x1, y1, x2, y2, stroke = GRID, sw = 1) {
  return mk('line', {
    x1, y1, x2, y2, stroke, 'stroke-width': sw, 'stroke-linecap': 'round',
  });
}

function poly(points, fill, stroke, sw = 1) {
  return mk('polygon', {
    points,
    fill: fill || 'none',
    stroke: stroke || 'none',
    'stroke-width': sw,
    'stroke-linejoin': 'round',
  });
}

function text(str, x, y, size = 12, fill = INK) {
  const t = mk('text', {
    x, y,
    'font-family': FONT,
    'font-weight': '700',
    'font-size': size,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    fill,
  });
  t.textContent = String(str);
  return t;
}

/**
 * 画一段「墙」：深色外描边 + 暖色内芯，和棋盘上的墙同一套观感。
 * 砖纹 / 环纹 / 划分区域这几个图标靠它才看得清 ——
 * 一开始只用 1.6px 的浅色网格线，46px 下几乎看不见。
 */
const WALL_DARK = '#4a3d2c';
const WALL_CORE = '#b8832e';
function wall(svg, x1, y1, x2, y2, w = 5.5) {
  svg.appendChild(line(x1, y1, x2, y2, WALL_DARK, w));
  svg.appendChild(line(x1, y1, x2, y2, WALL_CORE, Math.max(1.4, w * 0.34)));
}

function dot(cx, cy, r, fill = INK) {
  return mk('circle', { cx, cy, r, fill });
}

/** 画 cols x rows 的方格线（cell 为格子边长，线落在 x/y 起点上） */
function gridLines(svg, cols, rows, x, y, cell, stroke = GRID, sw = 1) {
  for (let c = 0; c <= cols; c++) {
    svg.appendChild(line(x + c * cell, y, x + c * cell, y + rows * cell, stroke, sw));
  }
  for (let r = 0; r <= rows; r++) {
    svg.appendChild(line(x, y + r * cell, x + cols * cell, y + r * cell, stroke, sw));
  }
}

/** 把 [col,row] 列表画成带缝隙的实心格（看得出是一个个格子，适合讲面积） */
function fillCells(svg, list, x, y, cell, fill, inset = 1) {
  for (const [c, r] of list) {
    svg.appendChild(rect(
      x + c * cell + inset, y + r * cell + inset,
      cell - inset * 2, cell - inset * 2,
      fill, EDGE, 1, 2,
    ));
  }
}

/** 把 [col,row] 列表画成一块完整的多联骨牌：内部无缝，外圈一道细轮廓 */
function polyomino(svg, list, x, y, cell, fill) {
  const key = (c, r) => c + ',' + r;
  const inSet = new Set(list.map(([c, r]) => key(c, r)));
  for (const [c, r] of list) {
    svg.appendChild(rect(x + c * cell, y + r * cell, cell, cell, fill, 'none', 0, 0));
  }
  for (const [c, r] of list) {
    const x0 = x + c * cell;
    const y0 = y + r * cell;
    const sides = [
      [key(c, r - 1), x0, y0, x0 + cell, y0],
      [key(c, r + 1), x0, y0 + cell, x0 + cell, y0 + cell],
      [key(c - 1, r), x0, y0, x0, y0 + cell],
      [key(c + 1, r), x0 + cell, y0, x0 + cell, y0 + cell],
    ];
    for (const [nb, ax, ay, bx, by] of sides) {
      if (!inSet.has(nb)) svg.appendChild(line(ax, ay, bx, by, EDGE, 1));
    }
  }
}

// 3x3 的填充顺序：前缀始终连通，且尽量凑成紧凑的一块（1 格 / 骨牌 / L / 2x2 ...）
const ORDER = [
  [0, 0], [1, 0], [1, 1], [0, 1], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2],
];

function clampCell(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/* ---------- 对外接口 ---------- */

export function ruleIcon(icon, size = 46) {
  const svg = mk('svg', {
    width: size,
    height: size,
    viewBox: '0 0 40 40',
    class: 'rule-icon',
    'aria-hidden': 'true',
  });
  const kind = icon && icon.kind;
  if (!kind) return svg;

  switch (kind) {
    // 区域面积恰好为 n
    case 'area-equals': {
      const n = clampCell(icon.n, 1, 9);
      gridLines(svg, 3, 3, 2, 2, 12);
      fillCells(svg, ORDER.slice(0, n), 2, 2, 12, AMBER);
      break;
    }

    // 区域面积 >= n / <= n：右下留白写徽标
    case 'area-at-least':
    case 'area-at-most': {
      const n = clampCell(icon.n, 1, 9);
      gridLines(svg, 3, 3, 2, 2, 12);
      fillCells(svg, ORDER.slice(0, 5), 2, 2, 12, AMBER);
      svg.appendChild(text((kind === 'area-at-least' ? '≥' : '≤') + n, 31, 32, 11));
      break;
    }

    // 区域面积在 lo..hi 之间
    case 'area-between': {
      const lo = clampCell(icon.lo, 1, 9);
      const hi = Math.max(lo, clampCell(icon.hi, 1, 9));
      gridLines(svg, 3, 3, 2, 2, 12);
      fillCells(svg, ORDER.slice(0, 5), 2, 2, 12, AMBER);
      svg.appendChild(text(`${lo}-${hi}`, 32, 32, 10));
      break;
    }

    // 所有区域形状相同：两块一模一样的 L（三格）
    case 'same': {
      const L = [[0, 0], [0, 1], [1, 1]];
      polyomino(svg, L, 2, 11, 9, AMBER);
      polyomino(svg, L, 20, 11, 9, BLUE);
      break;
    }

    // 所有区域形状不同：2x2 方块 vs 三格 L
    case 'different': {
      polyomino(svg, [[0, 0], [1, 0], [0, 1], [1, 1]], 2, 11, 9, GREEN);
      polyomino(svg, [[0, 0], [0, 1], [1, 1]], 20, 11, 9, ROSE);
      break;
    }

    // 相邻区域形状必须不同：四块**形状各异**的拼块（正方形 / L / T / 十字）。
    // 注意别画成四个等大的方块 —— 那看起来反而像「形状相同」，和规则相反。
    case 'mingle': {
      svg.appendChild(poly('4,4 20,4 20,20 4,20', AMBER, EDGE, 1));
      svg.appendChild(poly('22,4 38,4 38,13 31,13 31,20 22,20', GREEN, EDGE, 1));
      svg.appendChild(poly('4,22 20,22 20,29 15,29 15,38 9,38 9,29 4,29', BLUE, EDGE, 1));
      svg.appendChild(poly('26,22 34,22 34,26 38,26 38,34 34,34 34,38 26,38 26,34 22,34 22,26 26,26',
        ROSE, EDGE, 1));
      break;
    }

    // 相邻区域面积不同：2x2 紧挨着 1x1
    case 'diff-area': {
      fillCells(svg, [[0, 0], [1, 0], [0, 1], [1, 1]], 2, 8, 10, BLUE);
      svg.appendChild(rect(21, 19, 8, 8, AMBER, EDGE, 1, 2));
      break;
    }

    // 每个区域恰好含一个符号：2x2 区块，各有一个点
    case 'solitude': {
      const fills = [AMBER, GREEN, BLUE, ROSE];
      const spots = [[2, 2], [20, 2], [2, 20], [20, 20]];
      spots.forEach(([x, y], i) => {
        svg.appendChild(rect(x, y, 16, 16, fills[i], EDGE, 1, 3));
        svg.appendChild(dot(x + 8, y + 8, 3, INK));
      });
      break;
    }

    // 所有区域都是矩形：一条 3x1 + 一个 2x2
    case 'boxy': {
      svg.appendChild(rect(4, 4, 32, 11, AMBER, EDGE, 1, 2));
      svg.appendChild(rect(11, 19, 18, 18, BLUE, EDGE, 1, 2));
      break;
    }

    // 所有区域都不是矩形：L 形 + T 形
    case 'non-boxy': {
      polyomino(svg, [[0, 0], [0, 1], [0, 2], [1, 2]], 2, 4, 7, PURPLE);
      polyomino(svg, [[0, 0], [1, 0], [2, 0], [1, 1]], 17, 20, 7, TEAL);
      break;
    }

    // 顶点不恰好接 4 条边：粗墙画成的十字接点上打叉
    case 'bricky': {
      wall(svg, 20, 5, 20, 35);
      wall(svg, 5, 20, 35, 20);
      svg.appendChild(line(14, 14, 26, 26, BAD, 3));
      svg.appendChild(line(26, 14, 14, 26, BAD, 3));
      break;
    }

    // 顶点不恰好接 3 条边：粗墙画成的 T 形接点上打叉
    case 'loopy': {
      wall(svg, 5, 17, 35, 17);
      wall(svg, 20, 17, 20, 35);
      svg.appendChild(line(14, 11, 26, 23, BAD, 3));
      svg.appendChild(line(26, 11, 14, 23, BAD, 3));
      break;
    }

    // 划分区域（没有任何具体规则时的兜底）：一块被墙分成两半的棋盘
    case 'divide': {
      svg.appendChild(rect(4, 4, 14, 32, AMBER, EDGE, 1, 2));
      svg.appendChild(rect(22, 4, 14, 32, BLUE, EDGE, 1, 2));
      wall(svg, 20, 4, 20, 36, 4.5);
      break;
    }

    // 数字表示所在区域的面积
    case 'area-number': {
      gridLines(svg, 3, 3, 2, 2, 12);
      fillCells(svg, [[0, 0], [2, 0], [1, 2]], 2, 2, 12, AMBER);
      svg.appendChild(text('3', 8, 8, 12));
      svg.appendChild(text('2', 32, 8, 12));
      svg.appendChild(text('4', 20, 32, 12));
      break;
    }

    // 符号表示所在区域的形状：S 形四联骨牌 + S 角标
    case 'poly': {
      polyomino(svg, [[1, 0], [2, 0], [0, 1], [1, 1]], 5, 8, 10, GREEN);
      svg.appendChild(text('S', 33, 34, 11));
      break;
    }

    // 每种符号在每个区域里恰好出现一次：红框 2x2 + 两个符号
    case 'rose': {
      svg.appendChild(rect(3, 3, 34, 34, 'none', ROSE, 1.6, 5));
      svg.appendChild(line(20, 3, 20, 37, GRID, 1));
      svg.appendChild(line(3, 20, 37, 20, GRID, 1));
      svg.appendChild(poly('11,6 16,11 11,16 6,11', INK, INK, 0));
      svg.appendChild(rect(26, 26, 6, 6, INK, 'none', 0, 1));
      break;
    }

    // 表示单元格边框的形状：淡绿圆角格 + F 角标
    case 'palisade': {
      const cell = rect(6, 6, 28, 28, GREEN, EDGE, 1, 5);
      cell.setAttribute('fill-opacity', '0.5');
      svg.appendChild(cell);
      svg.appendChild(text('F', 30, 30, 11));
      break;
    }

    // 数字表示区域在各个方向上占多少格：十字把 2x2 切开
    case 'compass': {
      gridLines(svg, 2, 2, 2, 2, 18);
      svg.appendChild(line(20, 2, 20, 38, GRID, 1.6));
      svg.appendChild(line(2, 20, 38, 20, GRID, 1.6));
      svg.appendChild(text('1', 11, 11, 12));
      svg.appendChild(text('2', 29, 11, 12));
      svg.appendChild(text('3', 11, 29, 12));
      svg.appendChild(text('4', 29, 29, 12));
      break;
    }

    // 数字表示该点接触几个区域：格点上的点 + 3 角标 + 两块淡色区域
    case 'watchtower': {
      const a = rect(3, 3, 16, 16, BLUE, EDGE, 1, 2);
      const b = rect(22, 22, 15, 15, GREEN, EDGE, 1, 2);
      a.setAttribute('fill-opacity', '0.3');
      b.setAttribute('fill-opacity', '0.3');
      svg.appendChild(a);
      svg.appendChild(b);
      svg.appendChild(line(3, 20, 37, 20, GRID, 1));
      svg.appendChild(line(20, 3, 20, 37, GRID, 1));
      svg.appendChild(dot(20, 20, 3, INK));
      svg.appendChild(text('3', 31, 12, 11));
      break;
    }

    // 尖头指向的区域面积更小：小的一块画得更淡，箭头指向它
    case 'inequality': {
      svg.appendChild(rect(4, 10, 20, 20, AMBER, EDGE, 1, 2));
      const small = rect(26, 18, 12, 12, AMBER, EDGE, 1, 2);
      small.setAttribute('fill-opacity', '0.28');
      svg.appendChild(small);
      svg.appendChild(line(7, 34, 28, 34, INK, 1.6));
      svg.appendChild(poly('28,31 35,34 28,37', INK, INK, 0));
      break;
    }

    // 两侧区域形状相同：两个同款 L，中间竖线上写 =
    case 'twin': {
      svg.appendChild(line(20, 4, 20, 12, GRID, 1.6));
      svg.appendChild(line(20, 28, 20, 36, GRID, 1.6));
      polyomino(svg, [[0, 0], [0, 1], [1, 1]], 3, 10, 7, AMBER);
      polyomino(svg, [[0, 0], [0, 1], [1, 1]], 23, 10, 7, BLUE);
      svg.appendChild(text('=', 20, 20, 13));
      break;
    }

    // 两侧区域形状不同：方块 vs L，中间竖线上写 ≠
    case 'alien': {
      svg.appendChild(line(20, 4, 20, 12, GRID, 1.6));
      svg.appendChild(line(20, 28, 20, 36, GRID, 1.6));
      polyomino(svg, [[0, 0], [1, 0], [0, 1], [1, 1]], 3, 13, 7, GREEN);
      polyomino(svg, [[0, 0], [0, 1], [1, 1]], 23, 10, 7, ROSE);
      svg.appendChild(text('≠', 20, 20, 13));
      break;
    }

    // 两个区域的面积之差：大小两块之间写差值
    case 'difference': {
      svg.appendChild(rect(3, 15, 10, 10, GREEN, EDGE, 1, 2));
      svg.appendChild(rect(22, 12, 16, 16, BLUE, EDGE, 1, 2));
      svg.appendChild(text('2', 17.5, 20, 13));
      break;
    }

    default:
      break; // 未知种类：返回空的 svg，属性依然齐全
  }

  return svg;
}

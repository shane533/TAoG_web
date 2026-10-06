/* 棋盘格内的符号 + 压在格子边线上的徽章。
   纯 DOM、零依赖、零外部资源、无 innerHTML；只负责画图，不参与任何判定。

   约定（调用方已经按这套写好了）：
     - cellGlyph(raw, size, ctx)   -> <g>，几何全部以 (0,0) 为中心
     - edgeBadge(kind, opts, size) -> <g>，几何全部以 (0,0) 为中心
   调用方自己 setAttribute('transform', `translate(x,y)`) 来摆位置，
   这里绝不写绝对坐标、也绝不自己设 transform（罗盘/花瓣绕中心自转除外）。

   所有尺寸都从 size（格子边长 px）推出来 —— 没有任何写死的像素值，
   这样 40px 的小格和 150px 的大格只是同一张图放大缩小，
   徽章之间也不会再出现「有的粗有的细」的观感差。 */

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Segoe UI, Arial, sans-serif';

// 和 ruleIcons.js 同一套墨色：羊皮纸白徽章 + 深棕描边 + 深色字
const INK = '#2b2119';        // 图形本体（星、粗边、箭头）
const NUM_INK = '#22190f';    // 数字
const BADGE_LINE = '#6b5540'; // 徽章描边
const BADGE_FILL = '#fdf6e6'; // 徽章底色（羊皮纸白）
const POLY_FILL = '#e8c86a';
const POLY_LINE = '#4a3d2c';
const ROSE_LINE = '#3a2f22';

// 玫瑰窗按 (n-1)%6 取色：主色 + 同色系浅色
const ROSE_HUES = ['#b4453c', '#2f6fa8', '#c9a227', '#4f8f45', '#7a5aa5', '#c2703a'];
const ROSE_TINTS = ['#e08a80', '#7fb0d8', '#f0dc8a', '#9fd08f', '#b9a5d8', '#e8a878'];

// 唯一的线宽系数：所有徽章共用，保证粗细完全一致
const BADGE_STROKE = 0.018;

/* ---------- 小工具 ---------- */

function mk(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v !== null && v !== undefined) n.setAttribute(k, String(v));
    }
  }
  return n;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** size 归一化：非法值退到 60，保证永远画得出来 */
function normSize(size) {
  const s = num(size, 60);
  return s > 0 ? s : 60;
}

/** 居中的文字（数字 / 兜底符号） */
function label(str, fontSize, fill, cls) {
  const t = mk('text', {
    x: 0,
    y: 0,
    'font-family': FONT,
    'font-weight': '700',
    'font-size': fontSize,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    fill: fill || NUM_INK,
    class: cls || 'sym-other',
  });
  t.textContent = str === null || str === undefined ? '' : String(str);
  return t;
}

/* ---------- 共用徽章（菱形 / 圆形） ---------- */

/** 羊皮纸白菱形徽章：四角落在 (0,-r) (r,0) (0,r) (-r,0) */
function badgeDiamond(r, size, cls) {
  return mk('polygon', {
    points: '0,' + -r + ' ' + r + ',0 0,' + r + ' ' + -r + ',0',
    fill: BADGE_FILL,
    stroke: BADGE_LINE,
    'stroke-width': size * BADGE_STROKE,
    'stroke-linejoin': 'round',
    class: cls || 'edge-badge',
  });
}

/** 圆形徽章：和菱形同一档线宽，两种徽章观感一致 */
function badgeCircle(r, size, cls) {
  return mk('circle', {
    cx: 0,
    cy: 0,
    r,
    fill: BADGE_FILL,
    stroke: BADGE_LINE,
    'stroke-width': size * BADGE_STROKE,
    class: cls || 'edge-badge',
  });
}

/* ---------- A1. 拼块 S<n> ---------- */

/** 形状库既可能是 Map 也可能是普通对象，两种都试一遍 */
function lookupShape(ctx, n) {
  const bank = ctx && ctx.shapes;
  if (!bank) return null;
  let sh = null;
  if (typeof bank.get === 'function') sh = bank.get(n);
  if (!sh) sh = bank[n];
  return sh || null;
}

function polyGlyph(n, rawText, size, ctx) {
  const g = mk('g', { class: 'sym-poly' });
  const shape = lookupShape(ctx, n);
  const rows = shape && Array.isArray(shape.rows) ? shape.rows.map((r) => String(r)) : null;

  if (!rows || !rows.length) {
    // 形状库里没有这块拼块：退回文字 S<n>
    g.appendChild(label(rawText, size * 0.3, NUM_INK, 'sym-poly'));
    return g;
  }

  // 网格只认 rows：语料里的 w/h 并不可靠
  // （例如 {w:3,h:3,rows:['#','#','#']}，每行其实只有 1 个字符宽）
  const gridH = rows.length;
  let gridW = 0;
  for (const r of rows) gridW = Math.max(gridW, r.length);
  const span = Math.max(gridW, gridH, 1);

  const cell = (size * 0.9) / span;  // 整块拼块控制在格子的 ~90% 内
  const gap = cell * 0.06;           // 每小格留一点缝，看得出是一格一格
  const rx = cell * 0.12;
  const sw = size * 0.018;
  const ox = -(gridW * cell) / 2;
  const oy = -(gridH * cell) / 2;

  for (let r = 0; r < gridH; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      // 只有 '#' 是实心格；空格和 '.' 都算空（语料里空格更常见）
      if (rows[r][c] !== '#') continue;
      g.appendChild(mk('rect', {
        x: ox + c * cell + gap,
        y: oy + r * cell + gap,
        width: Math.max(cell - gap * 2, 0),
        height: Math.max(cell - gap * 2, 0),
        rx,
        ry: rx,
        fill: POLY_FILL,
        stroke: POLY_LINE,
        'stroke-width': sw,
        class: 'sym-poly-cell',
      }));
    }
  }
  return g;
}

/* ---------- A2. 玫瑰窗 P<n> ---------- */

function roseGlyph(n, size) {
  const g = mk('g', { class: 'sym-rose' });
  const R = size * 0.3;
  const idx = (((n - 1) % ROSE_HUES.length) + ROSE_HUES.length) % ROSE_HUES.length;
  const base = ROSE_HUES[idx];
  const tint = ROSE_TINTS[idx];

  // 外圈：填主色，靠花瓣的浅色透出彩窗感
  g.appendChild(mk('circle', {
    cx: 0,
    cy: 0,
    r: R,
    fill: base,
    stroke: ROSE_LINE,
    'stroke-width': size * 0.02,
    class: 'sym-rose-ring',
  }));

  // 8 片花瓣：细长圆头矩形，绕中心旋转 45° 递增
  const pw = R * 0.34;
  const ph = R * 0.68;
  for (let k = 0; k < 8; k++) {
    g.appendChild(mk('rect', {
      x: -pw / 2,
      y: -R * 0.9,
      width: pw,
      height: ph,
      rx: pw / 2,
      ry: pw / 2,
      fill: tint,
      class: 'sym-rose-petal',
      transform: 'rotate(' + k * 45 + ')',
    }));
  }

  // 中心的圆钉
  g.appendChild(mk('circle', {
    cx: 0,
    cy: 0,
    r: R * 0.26,
    fill: tint,
    stroke: ROSE_LINE,
    'stroke-width': size * 0.014,
    class: 'sym-rose-core',
  }));
  return g;
}

/* ---------- A3. 围栏 F<n> ---------- */

// 数字 -> 哪几条边是墙：0 无 / 1 上 / 2 上下 / 3 上右下 / 4 全 / 7 上右
const PALISADE_SIDES = {
  0: [],
  1: ['top'],
  2: ['top', 'bottom'],
  3: ['top', 'right', 'bottom'],
  4: ['top', 'right', 'bottom', 'left'],
  7: ['top', 'right'],
};

function palisadeGlyph(n, size) {
  const g = mk('g', { class: 'sym-palisade' });
  g.appendChild(badgeDiamond(size * 0.3, size, 'sym-palisade-badge'));

  const half = (size * 0.26) / 2;
  g.appendChild(mk('rect', {
    x: -half,
    y: -half,
    width: size * 0.26,
    height: size * 0.26,
    fill: 'none',
    stroke: BADGE_LINE,
    'stroke-width': size * 0.016,
    class: 'sym-palisade-square',
  }));

  const sides = PALISADE_SIDES[n] || [];
  const seg = {
    top: [-half, -half, half, -half],
    bottom: [-half, half, half, half],
    left: [-half, -half, -half, half],
    right: [half, -half, half, half],
  };
  for (const s of sides) {
    const [x1, y1, x2, y2] = seg[s];
    g.appendChild(mk('line', {
      x1, y1, x2, y2,
      stroke: INK,
      'stroke-width': size * 0.05, // 该边加粗变深 = 这里有一道围栏
      'stroke-linecap': 'round',
      class: 'sym-palisade-side',
    }));
  }
  return g;
}

/* ---------- A4. 罗盘 U/D/L/R ---------- */

/**
 * ⚠️ 一个罗盘符号 = **一枚**徽章，不是每个方向一枚。
 *
 * 对照游戏截图：一枚白圆盘里放一颗四尖星，数字围绕中心摆在
 * **上 / 右 / 下 / 左** 四个方位 —— 一个罗盘最多会同时显示四个方向的格数
 * （例如 `U2D1L3R2` 就是 上2 右2 下1 左3 同框）。
 *
 * 星的刀刃指向**四个斜角**：数字占住十字方位，刀刃让开它们走斜向，两者不打架。
 */

// 数字的四个方位（单位向量）
const COMPASS_SLOT = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] };

/** 四尖深色星，刀刃朝四个斜角 */
function compassStar(R) {
  // 内凹半径：越小刀刃越瘦。取 0.20 让上/右/下/左 的十字方位留出白底，
  // 数字才能落在白盘上而不是压在星上（游戏截图就是这个比例）。
  const k = R * 0.20;
  const d = k * 0.7071;             // 45° 方向的凹陷点
  const pts = [
    [0, -R], [d, -d], [R, 0], [d, d],
    [0, R], [-d, d], [-R, 0], [-d, -d],
  ];
  return mk('polygon', {
    points: pts.map((p) => `${p[0]},${p[1]}`).join(' '),
    fill: INK,
    class: 'sym-compass-star',
    transform: 'rotate(45)',        // 转 45°：上右下左 -> 四个斜角
  });
}

function compassGlyph(rawText, size) {
  const g = mk('g', { class: 'sym-compass' });

  // 只有「写了数字」的方向才有约束；
  // 缺数字 = 这个方向完全不约束（语料核对过，当成 0 会大面积和官方解冲突）。
  const slots = [];
  for (const m of rawText.matchAll(/([UDLR])(\d*)/g)) {
    if (!m[2]) continue;
    slots.push({ dir: m[1], v: parseInt(m[2], 10) });
  }

  const R = size * 0.40;            // 星臂长（伸出白盘之外，和截图一致）
  const discR = size * 0.325;       // 白盘半径
  const slotR = size * 0.20;        // 数字离中心的距离

  if (!slots.length) {
    // 例如裸的 "UDLR"：纯装饰的罗盘玫瑰 —— 只有星，没有白盘也没有数字
    g.appendChild(compassStar(R * 0.62));
    return g;
  }

  g.appendChild(badgeCircle(discR, size, 'sym-compass-disc'));
  g.appendChild(compassStar(R));
  for (const s of slots) {
    const [ux, uy] = COMPASS_SLOT[s.dir];
    const t = label(String(s.v), size * 0.19, NUM_INK, 'sym-compass-num');
    t.setAttribute('x', String(ux * slotR));
    t.setAttribute('y', String(uy * slotR));
    g.appendChild(t);
  }
  return g;
}

/* ---------- A5/A6. 面积数字 / 兜底 ---------- */

function stripZeros(s) {
  const t = s.replace(/^0+(?=\d)/, '');
  return t === '' ? '0' : t;
}

/* ---------- 对外接口 A：格内符号 ---------- */

/**
 * 把谜题数据里的符号字符串画成一个居中的 <g>（永不返回 null）。
 * @param {string} raw  原始符号，如 'S1' 'P3' 'F2' 'U2D1' '04'
 * @param {number} size 格子边长 px
 * @param {{shapes?: Map}} [ctx] 形状库等上下文，可选
 */
export function cellGlyph(raw, size, ctx) {
  ctx = ctx || {};
  const s = normSize(size);
  const text = raw === null || raw === undefined ? '' : String(raw);

  let m = /^S(\d+)$/.exec(text);
  if (m) return polyGlyph(Number(m[1]), text, s, ctx);

  m = /^P(\d+)$/.exec(text);
  if (m) return roseGlyph(Number(m[1]), s);

  m = /^F(\d+)$/.exec(text);
  if (m) return palisadeGlyph(Number(m[1]), s);

  if (/^([UDLR]\d*)+$/.test(text)) return compassGlyph(text, s);

  if (/^\d+$/.test(text)) {
    const g = mk('g', { class: 'sym-num' });
    g.appendChild(label(stripZeros(text), s * 0.42, NUM_INK, 'sym-num'));
    return g;
  }

  const g = mk('g', { class: 'sym-other' });
  g.appendChild(label(text, s * 0.3, NUM_INK, 'sym-other'));
  return g;
}

/* ---------- 对外接口 B：格线徽章 ---------- */

/** 雪佛龙箭头的三个点；arm = 单臂在主轴上的长度 */
function chevronPoints(dir, arm) {
  const h = arm * 0.5;
  const table = {
    up: [[-arm, h], [0, -h], [arm, h]],
    down: [[-arm, -h], [0, h], [arm, -h]],
    left: [[h, arm], [-h, 0], [h, -arm]],
    right: [[-h, -arm], [h, 0], [-h, arm]],
  };
  const pts = table[dir] || table.up;
  return pts.map((p) => p[0] + ',' + p[1]).join(' ');
}

function valueText(v) {
  const n = num(v, 0);
  return String(Number.isInteger(n) ? n : Math.round(n * 100) / 100);
}

/**
 * 格线徽章（永不返回 null）。
 * @param {'inequality'|'difference'|'watchtower'} kind
 * @param {{dir?: string, value?: number}} [opts]
 * @param {number} size 格子边长 px
 */
export function edgeBadge(kind, opts, size) {
  opts = opts || {};
  const s = normSize(size);
  const g = mk('g', { class: 'edge-badge' });

  if (kind === 'inequality') {
    const dir = ['up', 'down', 'left', 'right'].indexOf(opts.dir) >= 0 ? opts.dir : 'up';
    g.appendChild(badgeDiamond(s * 0.26, s, 'edge-badge'));
    g.appendChild(mk('polyline', {
      points: chevronPoints(dir, s * 0.12),
      fill: 'none',
      stroke: INK,
      'stroke-width': s * 0.05,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: 'edge-badge-arrow',
    }));
    return g;
  }

  if (kind === 'difference') {
    g.appendChild(badgeDiamond(s * 0.28, s, 'edge-badge'));
    g.appendChild(label(valueText(opts.value), s * 0.28, NUM_INK, 'edge-badge-num'));
    return g;
  }

  if (kind === 'watchtower') {
    g.appendChild(badgeCircle(s * 0.19, s, 'edge-badge'));
    g.appendChild(label(valueText(opts.value), s * 0.24, NUM_INK, 'edge-badge-num'));
    return g;
  }

  // 未知种类：给一个同款圆徽章，把 kind 原样写进去，绝不返回 null
  g.appendChild(badgeCircle(s * 0.19, s, 'edge-badge'));
  g.appendChild(label(valueText(kind), s * 0.2, NUM_INK, 'edge-badge-num'));
  return g;
}

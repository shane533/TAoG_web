/**
 * 涂鸦层：棋盘上自由手绘的铅笔笔迹。
 *
 * 和谜题本身（`Board`）完全分开 —— 它只是给玩家自己看的批注，
 * 不参与区域划分，也不影响任何规则判定。
 *
 * 坐标一律用**格为单位**（顶点在整数上，和 `renderer.pointerCell()` 一致），
 * 而不是屏幕像素：这样缩放窗口 / 换设备时，笔迹会跟着棋盘一起缩放，
 * 始终贴在它当时圈住的那个位置上。
 */

/** 相邻两点至少隔这么多格才记录，免得点密到爆内存（0.03 格在 60px 格子上约 2px） */
const MIN_STEP = 0.03;
/** 单笔上限 */
const MAX_PTS = 1200;
/** 整层上限（一笔一笔算） */
const MAX_STROKES = 150;
/** 默认笔宽（格为单位；60px 格子上约 4.5px） */
export const DOODLE_WIDTH = 0.075;

export class Doodle {
  constructor() {
    /** @type {{color:string, w:number, pts:number[][]}[]} */
    this.strokes = [];
    this._cur = null;
  }

  get isEmpty() {
    return this.strokes.length === 0;
  }

  get count() {
    return this.strokes.length;
  }

  /** 起笔。(x,y) 是格坐标 */
  begin(x, y, color) {
    if (this.strokes.length >= MAX_STROKES) this.strokes.shift();
    this._cur = { color: color || '#2b2119', w: DOODLE_WIDTH, pts: [[x, y]] };
    this.strokes.push(this._cur);
    return true;
  }

  /** 续笔。返回是否真的记了一个新点（调用方可据此决定要不要重绘） */
  extend(x, y) {
    const st = this._cur;
    if (!st) return false;
    const last = st.pts[st.pts.length - 1];
    // 抖动的点直接丢掉；但两端的点要保留，否则短笔画会被吃掉
    if (Math.hypot(x - last[0], y - last[1]) < MIN_STEP) return false;
    if (st.pts.length >= MAX_PTS) return false;
    st.pts.push([x, y]);
    return true;
  }

  /** 收笔。单点的笔画（点一下）也保留，渲染成一个圆点。 */
  end() {
    const st = this._cur;
    this._cur = null;
    if (!st) return false;
    return true;
  }

  /** 撤掉最后一笔；返回是否真的撤了 */
  undoLast() {
    if (!this.strokes.length) return false;
    this.strokes.pop();
    this._cur = null;
    return true;
  }

  clear() {
    this.strokes = [];
    this._cur = null;
  }

  /** 点到线段的距离（格坐标） */
  static _distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  /**
   * 擦掉指针附近的那一笔（取最近的一笔）。
   * @returns {boolean} 是否擦掉了
   */
  removeAt(x, y, tol) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const pts = this.strokes[i].pts;
      if (pts.length === 1) {
        const d = Math.hypot(x - pts[0][0], y - pts[0][1]);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
        continue;
      }
      for (let k = 1; k < pts.length; k++) {
        const d = Doodle._distToSeg(x, y, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }
    if (bestIdx >= 0 && bestDist <= tol) {
      this.strokes.splice(bestIdx, 1);
      this._cur = null;
      return true;
    }
    return false;
  }

  /** 深拷贝快照，用于撤销 */
  snapshot() {
    return { strokes: this.strokes.map((s) => ({ color: s.color, w: s.w, pts: s.pts.map((p) => [p[0], p[1]]) })) };
  }

  restore(snap) {
    this._cur = null;
    this.strokes = (snap?.strokes ?? []).map((s) => ({
      color: s.color, w: s.w, pts: s.pts.map((p) => [p[0], p[1]]),
    }));
  }

  /** 存档用：坐标压到 3 位小数 */
  toJSON() {
    return this.strokes.map((s) => ({
      c: s.color,
      pts: s.pts.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]),
    }));
  }

  /** 读档；对坏数据一律忽略，绝不让它把页面搞崩 */
  loadJSON(v) {
    this.clear();
    if (!Array.isArray(v)) return;
    for (const s of v.slice(0, MAX_STROKES)) {
      if (!s || !Array.isArray(s.pts)) continue;
      const pts = [];
      for (const p of s.pts.slice(0, MAX_PTS)) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = Number(p[0]);
        const y = Number(p[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
      }
      if (!pts.length) continue;
      this.strokes.push({
        color: typeof s.c === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.c) ? s.c : '#2b2119',
        w: DOODLE_WIDTH,
        pts,
      });
    }
  }
}

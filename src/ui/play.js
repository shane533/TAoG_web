/* 游戏页：棋盘渲染、规则面板、形状池、工具与撤销。 */

import { Board } from '../board.js';
import { Doodle } from '../doodle.js';
import { validate, buildRegionInfo } from '../rules.js';
import { Renderer } from '../render.js';
import { attachInput } from '../input.js';
import { $, el, clear, toast, shapeSvg } from './dom.js';
import { ruleIcon } from './ruleIcons.js';

const GLASS = [
  '#5b8fc9', '#c9707f', '#7fb069', '#d4a94a', '#9a7bc8',
  '#4fa3b5', '#c98a4a', '#6f8fc9', '#c47fb0', '#5fc9a3',
  '#a98fd4', '#c9b34a', '#7fc9d4', '#c96f5b', '#8fc95b',
  '#5b7fc9',
];

export function createPlayView({ store, onContinue, onSolved }) {
  let board = null;
  let renderer = null;
  let input = null;
  let current = null;
  let undoStack = [];
  /** 当前选中的玻璃色；涂鸦模式下它就是铅笔颜色 */
  let pencilColor = GLASS[0];
  /** 涂鸦层：纯批注，和谜题状态分开存 */
  const doodles = new Doodle();

  const svg = $('#board');

  /** 棋盘 + 涂鸦一起重绘 */
  function repaint() {
    if (!renderer) return;
    renderer.paint();
    renderer.paintDoodles(doodles);
  }

  /* ---------------- 工具 / 色板 ---------------- */
  function buildSwatches() {
    const box = $('#swatches');
    clear(box);
    GLASS.slice(0, 12).forEach((color, i) => {
      const b = el('button', 'swatch');
      b.style.background = color;
      b.title = `颜色 ${i + 1}　（涂鸦模式下即铅笔颜色）`;
      b.onclick = () => {
        box.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        pencilColor = color;
      };
      if (i === 0) b.classList.add('active');
      box.appendChild(b);
    });
  }

  function setTool(mode) {
    document.querySelectorAll('#tool-list .tool').forEach((t) => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    input?.setMode(mode);
    const hints = {
      both: '从格点（棱形）拖出＝画/取消墙；在格内点或拖＝划分区域。'
        + '单击永远算填充（点一下画不出线），所以点偏了也不会没反应。'
        + '拖过分割线时那根线会被自动清除。',
      erase: '左键拖拽：贴着已有的墙就擦墙，否则擦掉这一格的涂色。'
        + '预置墙擦不掉。触屏没有右键，就用这个工具。',
      doodle: '在棋盘上按住左键随手画（铅笔）。右键撤掉最后一笔。'
        + '笔色取左边「颜色」里选中的那个。涂鸦只是你自己的批注，不参与规则判定。',
    };
    const h = $('#mode-hint');
    if (h) h.textContent = hints[mode] ?? '';
  }

  /* ---------------- 撤销 ---------------- */
  function pushUndo() {
    if (!board) return;
    undoStack.push({ board: board.snapshot(), doodle: doodles.snapshot() });
    if (undoStack.length > 200) undoStack.shift();
  }

  function undo() {
    if (!board || !undoStack.length) { toast('没有可撤销的操作'); return; }
    const snap = undoStack.pop();
    board.restore(snap.board);
    if (snap.doodle) doodles.restore(snap.doodle);
    afterChange();
  }

  /* ---------------- 载入关卡 ---------------- */
  function load(puzzle) {
    current = puzzle;
    board = new Board(puzzle);
    undoStack = [];

    if (!renderer) {
      renderer = new Renderer(svg, board);
      input = attachInput({
        svg,
        renderer,
        board,
        onChange: afterChange,
        onBegin: pushUndo,
        toast,
        getColor: () => pencilColor,
        doodle: doodles,
        onDoodle: () => renderer.paintDoodles(doodles),
      });
    } else {
      renderer.setBoard(board);
      // 输入层的事件监听只注册一次，所以每次切关都要把当前棋盘告诉它，
      // 否则操作会落在上一关的棋盘上（表现为「切关后填不上」）。
      input.setBoardRef(board);
    }
    // 恢复本关已保存的进度（涂色 + 玩家画的墙）
    const saved = store.getProgress(puzzle.file);
    if (saved) {
      if (saved.paint) board.loadPaintGrid(saved.paint);
      if (Array.isArray(saved.walls)) {
        for (let r = 0; r < board.rows; r++) {
          for (let c = 0; c < board.cols; c++) {
            const w = saved.walls[r]?.[c];
            if (!Array.isArray(w)) continue;
            for (let d = 0; d < 4; d++) {
              // 预置墙已在 Board 构造时载入；这里只恢复玩家自己画的
              if (w[d] && !board.isLockedWall?.(r, c, d)) board.setWall(r, c, d, true);
            }
          }
        }
        // 墙不参与区域合并，恢复时无需重算
      }
    }
    repaint();
    setTool(input?.getMode() ?? 'both');

    $('#crumb-zone').textContent = puzzle.zone ?? '';
    $('#crumb-folder').textContent = puzzle.folder ?? '';
    $('#crumb-id').textContent = puzzle.id ?? '';
    $('#level-title').textContent = `${puzzle.zone} · ${puzzle.folder} · ${puzzle.id}`;
    $('#level-meta').textContent =
      `${puzzle.cols}×${puzzle.rows}　${board.totalCells} 格` +
      (puzzle.regions ? `　参考答案 ${puzzle.regions} 个区域` : '');
    $('#difficulty-chip').textContent = puzzle.difficulty > 0
      ? `难度 ${'★'.repeat(Math.min(6, puzzle.difficulty))}`
      : '练习关';

    renderShapes();
    afterChange();
  }

  /* ---------------- 每次变化后的刷新 ---------------- */
  function afterChange() {
    if (!board) return;
    repaint();
    renderRules();
    // 保存进度（涂色网格 + 玩家画的墙）。
    // 全空时**不写存档**（并清掉本条），这样「重新开始」后下次进来是干净的。
    {
      const paint = [];
      let anyPaint = false;
      for (let r = 0; r < board.rows; r++) {
        const row = [];
        for (let c = 0; c < board.cols; c++) {
          const v = board.isCell(r, c) ? board.regionOf(r, c) : -1;
          if (v > 0) anyPaint = true;
          row.push(v);
        }
        paint.push(row);
      }
      let anyWall = false;
      for (let r = 0; r < board.rows && !anyWall; r++) {
        for (let c = 0; c < board.cols && !anyWall; c++) {
          for (let d = 0; d < 4; d++) {
            if (board.userWalls[r][c][d] && !board.isLockedWall(r, c, d)) { anyWall = true; break; }
          }
        }
      }
      if (!anyPaint && !anyWall) store.clearProgress(current.file);
      else store.setProgress(current.file, { paint, walls: board.userWalls });
    }
    // 涂鸦单独存一份：它和谜题进度是两回事（清空区域不该把批注也抹了）。
    // setDoodle 收到空数组时会自动删掉这条，不给 localStorage 留垃圾。
    store.setDoodle?.(current.file, doodles.toJSON());
  }

  /* ---------------- 规则面板 ---------------- */
  /* 规则小插图的边长；要和 styles.css 里 `.rulecard .r-icon` 的宽高保持一致 */
  const RULE_ICON_PX = 54;

  /**
   * 一条规则 -> 一张卡，版式对齐游戏里的规则卷轴：
   *   [小插图]  规则名
   *             一句话说明
   * 右上角另加 ✓ / ○ 表示是否已满足（游戏没有这个，但复刻版需要进度反馈）。
   */
  function ruleCard(st) {
    const card = el('div', `card rulecard${st.done ? '' : ' pending'}`);
    const iconBox = el('div', 'r-icon');
    if (st.icon) iconBox.appendChild(ruleIcon(st.icon, RULE_ICON_PX));
    else iconBox.classList.add('empty');
    const txt = el('div', 'r-text');
    txt.appendChild(el('div', 'r-name', st.name));
    txt.appendChild(el('div', 'r-desc', st.desc));
    card.appendChild(iconBox);
    card.appendChild(txt);
    card.appendChild(el('span', 'mark', st.done ? '✓' : '○'));
    card.title = st.done ? `${st.name}：已满足` : `${st.name}：尚未满足`;
    return card;
  }

  function renderRules() {
    const box = $('#rule-list');
    clear(box);
    const result = validate(board);
    const info = buildRegionInfo(board);

    // 「形状池」不自成一张卡 —— 下面那张形状池卡会直接把形状画出来，
    // 游戏里也是这个形态（同一件事不该出现两张卡）。
    const statements = result.statements.filter((st) => st.id !== 'shape-pool');
    // 「划分区域」是**每一关都有的基本玩法**，不是这一关的特殊规则，
    // 游戏里也不给每关都挂一张这样的卡（用户明确要求去掉）。
    // 没有任何特殊规则时就让它空着 —— 空着比塞一张废话卡诚实。
    for (const st of statements) box.appendChild(ruleCard(st));

    const unassigned = board.totalCells - board.assignedCells;
    $('#stats').textContent =
      `区域 ${info.length} 个　已划 ${board.assignedCells}/${board.totalCells} 格` +
      (unassigned ? `　剩 ${unassigned} 格` : '');

    // 顶部提示随进度变化。措辞要对触屏也成立 —— 别写「左键 / 鼠标」，
    // 手机上那行字就在棋盘正上方，写错了很显眼。
    const hint = $('#hint-text');
    if (result.ok) hint.textContent = '✓ 已满足全部规则。';
    else if (!result.complete) hint.textContent = '在格内拖动即可划分区域。';
    else hint.textContent = '规则尚未全部满足，继续调整。';

    // 通关
    if (result.ok && !store.isDone(current.file)) {
      store.markDone(current.file);
      onSolved?.(current);
      toast('🎉 通关！', 'ok');
    }
  }

  /* ---------------- 形状池 ---------------- */
  /**
   * ⚠️ 关卡数据里的 `shapes` 有**两种完全不同的用途**，必须区分：
   *
   *   1. `shapes` + `shape_bank` —— 真正的「**形状池**」规则：
   *      所有区域必须取自这些形状。这时才该显示卡片 + 「所有区域必须呈以下形状」。
   *   2. **只有** `shapes` —— 它只是一本**形状字典**，供棋盘上的 `S<n>` / `F<n>` / `P<n>`
   *      符号引用（例如「拼块」要求某区域呈形状 n）。此时区域形状**完全不受限**。
   *
   * 1040 就是第 2 种：游戏里右栏只有「拼块」一张卡，没有任何形状池约束。
   * 以前不区分，一律显示成「所有区域必须呈以下形状」，把只读字典说成了硬约束。
   */
  function renderShapes() {
    const box = $('#shapes');
    clear(box);
    const card = $('#shape-card');
    const shapes = current?.shapes ?? [];
    const bank = current?.shape_bank ?? {};
    if (!shapes.length || !Object.keys(bank).length) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    $('#shape-caption').textContent = '所有区域必须呈以下形状：';
    for (const sh of shapes) {
      const d = el('div', 'shape-box');
      // 形状池是关键的解题信息，画大一点更醒目
      d.appendChild(shapeSvg(sh.rows, 19));
      const limit = bank[String(sh.id)];
      d.appendChild(el('div', 'cap', `形状 ${sh.id}${limit ? ` ×${limit}` : ''}`));
      d.title = `形状 ${sh.id}`;
      box.appendChild(d);
    }
  }

  /* ---------------- 继续（提交本关） ---------------- */
  /**
   * 提交当前划分：
   *   * 满足全部规则 → 交给外层切到下一关（`onContinue`）
   *   * 否则 → 提示**还差什么**，而不是只说一句「未满足」
   * 键盘 `空格` 与「继续」按钮走同一个入口。
   */
  function submit() {
    if (!board || !current) return;
    const res = validate(board);
    if (!res.ok) {
      const left = board.totalCells - board.assignedCells;
      toast(!res.complete && left > 0
        ? `还有 ${left} 格没有划定区域`
        : (res.violations[0] ?? '规则尚未全部满足'), 'bad');
      return;
    }
    onContinue?.(current);
  }

  /* ---------------- 对外接口 ---------------- */
  function wire() {
    buildSwatches();
    document.querySelectorAll('#tool-list .tool').forEach((t) => {
      if (t.classList.contains('disabled')) {
        t.onclick = () => toast('笔记模式暂未实现');
      } else {
        t.onclick = () => setTool(t.dataset.mode);
      }
    });
    $('#btn-undo').onclick = undo;
    $('#btn-restart').onclick = () => {
      pushUndo();
      board.reset();          // 涂色 + 所画的墙一起清空
      store.clearProgress(current.file);   // 同时丢弃本关存档，避免下次进来又恢复
    store.clearDoodle?.(current.file);     // 涂鸦也一起清掉
      afterChange();
      toast('已重新开始');
    };
    $('#btn-continue').onclick = submit;
  }

  return {
    wire,
    load,
    undo,
    submit,
    restart: () => { pushUndo(); board.reset(); doodles.clear(); store.clearDoodle(current.file); afterChange(); },
    getBoard: () => board,
  };
}

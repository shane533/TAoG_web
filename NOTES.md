# The Artisan of Glimmith 网页复刻 — 进度记录

## 0. 需求（用户已确认）

| 议题 | 决定 |
| --- | --- |
| 关卡数据 | 从本地游戏文件**逆向提取全部关卡** |
| 技术栈 | **原生 HTML/CSS/JS，零依赖零构建** |
| 复刻范围 | 可玩核心（拖拽绘区、规则校验、唯一解判定）+ 列表式关卡浏览 + 进度存档 |

游戏文件由用户复制到 `TAoG_web/The Artisan of Glimmith/`（约 870MB），可免授权读取。
交付前应删除该目录。

## 1. ✅ pak 容器解析（`tools/pak.py`）

标准 **UE4.27 pak**（PakFile_Version 11，PathHashIndex 格式），索引未加密。

| 项 | 值 |
| --- | --- |
| IndexOffset / IndexSize | 395,116,263 / 108,194 |
| 索引 SHA-1 | 校验 **OK** |
| footer | 末尾 **221** 字节（magic 在 EOF-204） |
| 压缩方式表 | 1 = Oodle，2 = Zlib |
| 条目总数 | **6361** |

EncodedRecord 位域（**宽度位是「置 1 = 32 位」**，与公开资料相反，由本地字节验证）：

```
bits 0-5   CompressionBlockSize >> 11（== 0x3F 时后面紧跟显式 u32）
bits 6-21  BlockCount
bit  22    加密
bits 23-28 压缩方式索引（0=不压缩）
bit  29/30/31  压缩后大小 / 解压后大小 / 偏移 用 u32（置 1）还是 u64（清 0）
```

## 2. ⚠️ Oodle 压缩条目（占 25%）

`.puz` 共 1237 个：**923 个不压缩（已导出）**，314 个用 **Oodle**。
游戏目录没有独立 `oo2core*.dll`（Oodle 很可能静态链接进 75MB 的 `Geri-Win64-Shipping.exe`），
纯 Python 无法解。补齐需另找 Oodle 运行库或从 exe 导出代码。

## 3. ✅ `.puz` 格式（**已用截图验证**，详见 `docs/puz-format.md`）

### 棋盘几何来自 `PUZZLE` 区

ASCII 图，**墙线 / 单元格行交替**；每格占 3 列（`|` + 2 字符内容）。
每行**各自居中**，偏移逐行求。

**判定一格是否存在的关键规则（已用 `ref/tutorial_1.png` 验证）：**

> 列 c 存在 ⟺ 该列在**上方墙线**和**下方墙线**里**都有**水平边（取**交集**）。

取并集会多算（相邻行的边界会被误算进来）。教学关 1 验证结果：

```
.##.      行0：中间 2 格
.##.      行1：中间 2 格
####      行2
####      行3
= 12 格，正好三个 2×2 正方形呈品字形 —— 与截图一致
```

交叉验证：形状池是 2×2 方块，12 ÷ 4 = 3 可整除（有解）；误读成 14 格则除不尽（无解）。

### 墙线的水平边符号

`-` 普通墙、`#` 实心（区域边界）、`=` 可合并墙、`!` 特殊墙；
**空格 = 该处没有水平边**，即该列在此行不存在。

### 真正的墙 = 棋盘本体的外边界

ASCII 里的 `|`、`-`、`=` 都只是**栅格分隔符**，不是墙。
某方向相邻格不存在 → 该边是墙；相邻格存在 → 无墙（玩家要划成不同区域）。

## 4. ✅ `SOLUTION`：区域划分（已破解，2026-xx）

`SOLUTION` 与 `PUZZLE` **逐行镜像**，`+` 列位置完全一致，**共用同一套绝对栅格**：

- 格行 `2r+1` 的 `'#'`（字符位 `3k`）= 列 `k-1` / `k` 之间的**竖墙**；
- 墙线 `2r` 的 `'#'`（字符位 `3c+1`）= 行 `r-1` / `r` 之间、列 `c` 的**横墙**；
- 其它 `#` 之外的字符不参与判读；块首的空白行是**真实的一整行空洞**，不能剥掉。

把「无墙相邻」的格合并即得标准答案分区（`tools/puz_to_json.py` 的 `solution` 字段），
与 PUZZLE 预画的 `#` 边界一致率 94.7%、满矩形棋盘 415/415 自洽，
全量规则校验见 `tools/verify_pipeline.py`。

> 早期「1296 组参数穷举只有 25.8%」的结论来自按**行内相对锚点**取列号（每行各自居中），
> 用绝对列号后问题消失。

## 5. ✅ 规则体系（与 `ref/rules.png` 的 13 条一一对应）

| rules.png | `.puz` 指令 | 关卡数 |
| --- | --- | --- |
| 形状池 | `SHAPE` + `SHAPE_BANK` | 255 |
| 精确 (N) | `AREA_EQUALS` | 124 |
| 混合 | （无 `SHAPE` 即混合） | 668 |
| 差异化 | `ALL_SHAPES_DIFFERENT` | 70 |
| 至少 (N) | `AREA_AT_LEAST` | 73 |
| 至多 (N) | `AREA_AT_MOST` | 72 |
| 相异 | `ADJACENT_SHAPES_DIFFERENT` | 66 |
| 相同 | `ALL_SHAPES_SAME` | 24 |
| 独居 | `ADJACENT_SIZES_DIFFERENT` | 63 |
| 方块 | `ONLY_RECTANGLES` | 45 |
| 非方块 | `NO_RECTANGLES` | 59 |
| 砖纹 | `NO_4_WAY_INTERSECTIONS` | 61 |
| 环纹 | `NO_3_WAY_INTERSECTIONS` | 40 |

外加 `ONE_SYMBOL_PER_REGION`（54 关）。符号族：`S*` 同形、`P*` 面积同形状异、
`F*` 互异、两位数字 = 面积、`U/D/L/R/UD/LR/DL` + 数字 = 罗盘（Zone3）、
以及 `U0D4LR` 这类变长写法。

## 6. 当前解析质量（2026-xx 重跑）

| 指标 | 结果 |
| --- | --- |
| 关卡总数 | 923 |
| 总格数 | **30,996** |
| 含规则的关卡 | 544 |
| 能解析出棋盘 | 923 / 923 |
| 棋盘连通（几何自洽） | **905 / 923**（其余 18 关是真的多面板关卡） |
| 墙体对称 | 923/923 = **100%** |
| SOLUTION 分区 | 920 关有解，8088 个区域，区域全部连通、覆盖全部格子 |
| 边线索 | 竖 725（`<` 107 / `>` 97 / `=` 161 / `!` 160 / 差值 200）、横 657（`^^` 95 / `vv` 103 / `==` 136 / `!!` 135 / 差值 188）、顶点雷达 698（合计 2080 条） |
| 规则校验（全量数值） | 不等号 402/402、顶点雷达 698/698、差值 388/388、符号族 S 653/653、P 127/127 关、F 1133/1133、两位数 1237/1237、罗盘 788/788、面积指令 122/124 + 73/73 + 72/72（2 处不通过均为 `Data/test*.puz` 自制样例） |
| 教学关 1 | ✅ **12 格、三个 2×2 品字形**（截图验证通过） |

回归命令：`python tools/puz_to_json.py && python tools/build_manifest.py`，
然后 `python tools/verify_pipeline.py`、`python tools/check_board.py`。


## 7. 代码资产

| 文件 | 说明 | 状态 |
| --- | --- | --- |
| `tools/pak.py` | UE4 pak v11 读取器 | ✅ 已验证 |
| `tools/selftest.py` | pak 自检 | ✅ 通过 |
| `tools/extract.py` | 从 pak 导出资产 | ✅ |
| `tools/dump_puzzles.py` | 导出 923 关 + 汇总指令 | ✅ |
| `tools/puz_to_json.py` | `.puz` → JSON（棋盘/符号/边线索/SOLUTION 分区） | ✅ 已验证 |
| `tools/verify_pipeline.py` | 只读 `data/puzzles/**` 全量跑规则回归 | ✅ |
| `tools/build_manifest.py` | 生成 `data/manifest.json` | ✅ |
| `tools/check_board.py` | 棋盘自洽性检查（连通 + 对称） | ✅ |
| `tools/render_png.py` / `render_preview.py` | 渲染棋盘（对照截图的验证工具） | ✅ |
| `tools/audit_rules.py` | 规则清单核对 | ✅ |
| `tools/solve_solution_fmt.py` | SOLUTION 格式穷举（1296 组） | 🔧 研究工具 |
| `src/board.js` | 棋盘模型（区域划分、合并/拆分、分区比较） | ✅ |
| `src/rules.js` | 13 类规则的校验与实时诊断 | ✅ |
| `src/render.js` `input.js` `storage.js` `app.js` | 渲染 / 拖拽 / 存档 / 主逻辑 | ✅ |
| `index.html` `styles.css` | 页面与样式 | ✅ |
| `data/puzzles/**` `data/index.json` `data/manifest.json` | 923 关 JSON 与索引 | ✅ |
| `extracted/puzzles/**` | 923 个 `.puz` 原文 | ✅ |
| `ref/*.png` | 用户提供的截图与规则表（验收依据） | ✅ |
| `docs/puz-format.md` | 格式逆向结论 | ✅ |

## 8. 剩余里程碑

1. **内部空洞判定** → 让剩余 ~63 关的棋盘也能连通（目标 920/920）。
2. **M4/M5 界面打磨**：关卡列表（按 Zone/关卡组 + 难度）、进度存档、彩色玻璃视觉。
3. 可选：写**规则求解器**（形状池拼贴 = 精确覆盖），补齐"唯一解"与独立判题。
4. 可选：解决 Oodle，补齐剩余 314 关。
5. 收尾：删除 `TAoG_web/The Artisan of Glimmith/`（870MB，非交付物）。

# 部署到 GitHub Pages

这是一个**纯静态站点**：没有构建步骤、没有依赖、没有服务端。
只要有文件托管能力就能跑（GitHub Pages / Netlify / Cloudflare Pages / 任意静态服务器）。

**所有资源路径都是相对的**（`styles.css`、`src/app.js`、`data/manifest.json`），
所以放在 `https://<用户名>.github.io/<仓库名>/` 这样的**子目录**下也能正常工作。

---

## 需要提交哪些文件

| 路径 | 说明 | 大小 |
| --- | --- | --- |
| `index.html` | 页面 | 6 KB |
| `styles.css` | 样式 | 22 KB |
| `favicon.svg` | 图标 | 1 KB |
| `src/` | 12 个 JS 模块 | 0.15 MB |
| `data/` | manifest + 1237 个关卡 JSON | 3.42 MB |
| `.nojekyll` | 让 Pages 跳过 Jekyll 处理 | 空文件 |

**合计约 3.6 MB。**

仓库里已经放好 `.gitignore`，会自动排除掉这些**不需要**的东西：

| 目录 | 大小 | 为什么不要 |
| --- | --- | --- |
| `The Artisan of Glimmith/` | **1.0 GB** | 游戏本体（解包分析用的副本） |
| `ref/` | 148 MB | 参考截图 |
| `extracted/` | 1.9 MB | 从 `.pak` 解出的原始 `.puz` |
| `tools/` `docs/` | 2.6 MB | 开发脚本与格式笔记 |
| `dist/` `_scratch/` | — | 构建产物与临时文件 |

> ⚠️ 提交之前先 `git status` 确认一下没有把 `The Artisan of Glimmith/` 带进来 ——
> 它是 1 GB，一旦进了历史就很难清掉。

---

## 方式一：从分支根目录直接发布（最简单，无需 Actions）

1. 建仓库，把**本项目根目录**当作仓库根：

   ```bash
   cd TAoG_web
   git init -b main
   git add .
   git status          # ← 确认没看到 The Artisan of Glimmith/ 、ref/ 等
   git commit -m "The Artisan of Glimmith 网页复刻版"
   git remote add origin https://github.com/<用户名>/<仓库名>.git
   git push -u origin main
   ```

2. 仓库页面 → **Settings → Pages**
   * **Source**：`Deploy from a branch`
   * **Branch**：`main`，目录选 **`/ (root)`**
   * Save

3. 等 1 分钟左右，访问 `https://<用户名>.github.io/<仓库名>/`

`.nojekyll` 已经在仓库里，Pages 不会去跑 Jekyll，也不会因为路径里带下划线而漏文件。

---

## 方式二：只发布 `dist/`（产物更干净）

`tools/build_dist.py` 会生成一个只含运行时文件的 `dist/`：

```bash
python tools/build_dist.py
```

```
  index.html           0.01 MB
  styles.css           0.02 MB
  favicon.svg          0.00 MB
  src/                 0.15 MB  (12 个文件)
  data/                3.42 MB  (1240 个文件)
  .nojekyll            （生成）

输出: dist
合计: 3.59 MB，1255 个文件
最大单文件: 0.70 MB  (data/manifest.json)
```

脚本会在结束时自检：确认没有把 `ref/`、`tools/`、`The Artisan of Glimmith/`
等目录带进产物，并检查单文件不超过 GitHub 的 100 MB 上限。

`dist/` 本身被 `.gitignore` 排除（它是产物，不该进 `main` 的历史）。
把它推到独立的 `gh-pages` 分支即可：

```bash
python tools/build_dist.py
cd dist
git init -b gh-pages
git add -A
git commit -m "site"
git push -f https://github.com/<用户名>/<仓库名>.git gh-pages
```

然后在 **Settings → Pages** 里把 Branch 选成 **`gh-pages`**、目录 `/ (root)`。

> 想让 Pages 从 `/docs` 目录发布也可以，但注意仓库里已经有一个 `docs/`（`.puz` 格式笔记）
> 且被 `.gitignore` 排除。真要这么做，建议把产物输出到别的名字
> （`python tools/build_dist.py --out site`）并相应调整 `.gitignore`，别和笔记混在一起。

---

## 本地预览

因为要 `fetch()` 加载 `data/manifest.json`，**不能用 `file://` 直接打开**
（浏览器会拦跨源请求）。起个本地服务器即可：

```bash
python -m http.server 8000
# 然后访问 http://localhost:8000/
```

或者用仓库里的开发服务器（带 no-cache，改完刷新就能看到）：

```bash
python tools/serve.py 8765 .
```

---

## 验证部署是否成功

打开页面后确认这几点：

1. 右上角进度显示 `0 / 1225`（能读到 manifest）
2. 左侧「选关」抽屉里出现三个区标签，第一区 `0/309`
3. 点任意关卡能画出棋盘（说明 `data/puzzles/*.json` 都取到了）
4. 浏览器控制台没有 404

如果第 1 条失败，多半是 `data/` 没上传全，或者路径被改成了绝对路径（`/data/...`）。

---

## 常见问题

**Q：能直接用仓库根目录发布吗？会不会把 1 GB 的游戏也传上去？**
不会 —— `.gitignore` 已经排除。但**首次 `git add .` 之后一定要 `git status` 看一眼**，
确认暂存区里没有 `The Artisan of Glimmith/`。

**Q：需要 GitHub Actions 吗？**
不需要。这个站点没有构建步骤，Pages 直接从分支读文件就行。
（若以后想让 `dist/` 自动生成，再加 workflow 也不迟。）

**Q：为什么 `.nojekyll` 是空的？**
它只是个标记文件，存在即可。作用是告诉 Pages「不要用 Jekyll 处理这个仓库」。

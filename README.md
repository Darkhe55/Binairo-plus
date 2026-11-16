# 黑白+ Binairo+

一个基于 Web 的黑白+（Binairo+ / Tango）谜题游戏，原生 SVG 渲染，内置逻辑解题器。

## 在线体验

```bash
npm install
npm start
```

`npm start` 会等开发服务就绪后用默认浏览器打开 **http://127.0.0.1:5184/**。

> 也可以用 `npm run dev`，但不会自动打开浏览器。

## 游戏规则

- 每行、每列黑子与白子数量相同
- 不能有三个及以上同色相邻
- 任意两行、任意两列不能完全相同
- 标 `=` 的两格同色，标 `×` 的两格异色
- 题面预填格不能修改

## 操作

| 操作 | 说明 |
|------|------|
| 左键点格 | 循环：空 → 黑 → 白 → 空 |
| 右键点格 | 反向循环 / 清除 |
| 按住拖动 | 连续涂色 |
| 滚轮 / 中键拖拽 | 缩放 / 平移画布 |
| Z / Shift+Z / Y | 撤销 / 重做 |
| C / H / S / Esc | 检查 / 提示一格 / 显示解 / 清空 |
| R / L / P / M | 随机抽题 / 逻辑解题 / 暂停回放 / 音效开关 |
| 0 / + / - | 视图复位 / 放大 / 缩小 |

## 数据存放

运行 `npm start` / `npm run dev` 时，题库、进度和上次题目保存在项目内 `data/` 目录；静态部署时自动降级到浏览器 localStorage。

图片识别导入的题目保存在 `scripts/printed-puzzles.json`，运行 `npm run gen` 后合并进内置题库。

## 功能

- **题库**：内置多道题，题目均校验唯一解
- **自定义题板**：在侧边栏编辑题面，载入后即可游玩；宽高上限 40×50（纵向）；题库里的自定义题支持再次编辑与两步确认删除
- **实时校验**：冲突与违规位置即时高亮，满足的条件同步变灰
- **逻辑解题**：规则引擎逐帧回放，显示每一步理由；回放中按钮变为停止，按 `P` 暂停/继续；多解题目只推所有解一致的格子，不做猜测
- **图片识别**：从题面截图识别网格、圆点与 `=`/`×` 线索，校验唯一解后加入题库
- **提示一格 / 显示解**：提示优先揭示所有解一致的格子，显示解直接填入可行答案
- **撤销/重做**：按手势分组，一次拖拽只需一步撤销
- **进度保存**：自动保存当前题目进度，刷新不丢失
- **音效特效**：Web Audio 合成拨弦、水滴与落子动画，无外部音频资源
- **缩放/平移**：滚轮缩放，中键或 `Shift` 拖拽平移

## 技术栈

- Vite + TypeScript
- 原生 SVG（无框架）
- Web Audio 合成音效（无外部资源）
- localStorage / 项目内 `data/` 存储进度与题库

## 项目结构

```
src/
  main.ts
  core/
    app.ts / ui.ts / view.ts      界面、交互、缩放、回放控制
    store.ts / library.ts         题库、进度、上次题目存储
    audio.ts / fx.ts              音效与落子特效
  game/
    adapter.ts                    游戏规则接入
    rules.ts                      推理规则
    logic.ts                      逻辑解题回放
    render.ts / state.ts          SVG 渲染与盘面状态
    validate.ts / solver.ts       实时校验与回溯求解
    puzzles.ts / puzzles-data.ts  题库加载与静态题库
```

## 命令

```bash
npm run dev       # 开发服务
npm start         # 开发服务 + 自动打开浏览器
npm run build     # tsc --noEmit + vite build
npm run gen       # 重新生成题库（含图片识别导入的题）
npm run import-image -- <图片> [选项]  # 识图导入：预览 / --append 写入 scripts/printed-puzzles.json
npm run recognize -- <图片> [--name 名称] [--series 系列] [--add]  # 旧版识别截图工具（同样写入 printed-puzzles.json）
npm run check     # 审计题库
npm run verify    # 参考解、逻辑回放与交互验证
npm run audit     # 逐题审计逻辑解题
```

## 图片识别导入

用 Playwright + Edge 全自动识别题面截图里的网格、预填圆子与 `=`/`×` 关系线索，
校验唯一解后预览 / 写入 `scripts/printed-puzzles.json`（`npm run gen` 会合并进内置题库）。

```bash
# 只识别 + 预览（自动做唯一性检查并给出参考解）
npm run import-image -- 题面截图.png

# 只识别，不求解、不写入
npm run import-image -- 题面截图.png --dry

# 人工修正个别预填格后追加（行列从 1 开始，B/W/. 表示黑/白/空）
npm run import-image -- 题面截图.png --map 3,4=B --name "我的黑白+" --append

# 写入后重建题库
npm run gen
```

| 参数 | 说明 |
|------|------|
| `--name 名称` / `--id ID` | 名称 / 指定 id |
| `--series 系列` | 系列名（默认「图片识别」） |
| `--difficulty 级别` | `easy` / `medium` / `hard`（默认 `hard`） |
| `--size N` | 正方形网格边长；默认自动识别 |
| `--width N` / `--height N` | 矩形题图宽/高，可只给一边 |
| `--map 行,列=值` | 人工覆盖某格预填（`B`/`1` 黑，`W`/`2` 白，`.`/`0` 空） |
| `--append` | 追加到 `scripts/printed-puzzles.json` |
| `--dry` | 只识别，不求解、不写入 |
| `--max-nodes N` | 唯一性搜索节点上限（默认 2000000） |
| `--edge PATH` | 指定 Edge 路径（默认自动探测） |

识别流程：以亮度众数作背景 → 多档阈值投影找网格线（并用内部线拟合修正外圈圆角造成的偏移）→
每格判断黑点/白点与绿色给定圆环 → 相邻格中点的小圆标按绿色 `=` / 红色 `×` 判定关系 →
生成「预填格串 + 关系串」，校验唯一解并给出参考解。内置题截图可直接导入核对。


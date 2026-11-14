/**
 * 黑白+ —— 图片题目识别工具
 *
 * 从题面截图里识别盘面与关系线索，校验唯一解并输出题库条目。
 *
 * 用法：
 *   node scripts/recognize-puzzle.mjs <图片路径> [选项]
 *
 * 选项：
 *   --name <名称>        题名（默认：识别题 W×H）
 *   --series <系列>      系列（默认：图片识别）
 *   --difficulty <级别>  easy / medium / hard（默认 hard）
 *   --id <id>            指定题目 id
 *   --json <路径>        另存识别结果 JSON
 *   --add                追加到 scripts/printed-puzzles.json（需唯一解）
 *   --max-nodes <n>      唯一解/求解搜索节点上限（默认 2000000）
 *
 * 识别假设：题面为轴对齐网格，预填格用实心/空心圆点表示，
 * 关系线索 "=" / "×" 画在相邻格之间；网格线与坐标标签会被忽略。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { encodeBoard, encodeCells, relationsEdgeCount } from '../src/game/types.ts'
import { countSolutions, solvePuzzle } from '../src/game/solver.ts'

const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const IMPORT_FILE = path.resolve('scripts/printed-puzzles.json')

function usage(message) {
  if (message) console.error(`[recognize] ${message}`)
  console.error(
    '用法: node scripts/recognize-puzzle.mjs <图片> [--name 名称] [--series 系列] ' +
      '[--difficulty easy|medium|hard] [--id id] [--json 路径] [--add] [--max-nodes n]',
  )
  process.exit(1)
}

function parseArgs(argv) {
  const opts = { add: false, maxNodes: 2_000_000, difficulty: 'hard' }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      rest.push(arg)
      continue
    }
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (key === 'add') {
      opts.add = true
    } else if (key === 'name' || key === 'series' || key === 'difficulty' || key === 'id' || key === 'json' || key === 'max-nodes') {
      if (value === undefined) usage(`缺少 --${key} 的值`)
      opts[key === 'max-nodes' ? 'maxNodes' : key] = key === 'max-nodes' ? Number(value) : value
      i++
    } else {
      usage(`未知选项 --${key}`)
    }
  }
  if (rest.length !== 1) usage('需要且只需要一个图片路径')
  if (!['easy', 'medium', 'hard'].includes(opts.difficulty)) usage('--difficulty 只能是 easy / medium / hard')
  if (!Number.isFinite(opts.maxNodes) || opts.maxNodes <= 0) usage('--max-nodes 必须是正数')
  return { image: rest[0], opts }
}

function dataUrl(file) {
  const ext = path.extname(file).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.bmp' ? 'image/bmp' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

/** 在页面里做像素分析：定位网格、分类格子、识别边线索 */
async function analyzeImage(imagePath) {
  const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
  try {
    const page = await browser.newPage()
    const src = dataUrl(imagePath)
    return await page.evaluate(async (imageSrc) => {
      const img = new Image()
      img.src = imageSrc
      await img.decode()

      const W = img.naturalWidth
      const H = img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, W, H).data
      const lum = new Float32Array(W * H)
      for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
        lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      }

      // —— 网格线：贯穿整幅图的深色行/列 ——
      const rowScore = new Int32Array(H)
      const colScore = new Int32Array(W)
      for (let y = 0; y < H; y++) {
        const base = y * W
        for (let x = 0; x < W; x++) if (lum[base + x] < 225) rowScore[y]++
      }
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) if (lum[y * W + x] < 225) colScore[x]++
      }

      const groupLines = (scores, min) => {
        const out = []
        let run = []
        for (let i = 0; i < scores.length; i++) {
          if (scores[i] >= min) run.push(i)
          else if (run.length) {
            out.push(run.reduce((a, b) => a + b, 0) / run.length)
            run = []
          }
        }
        if (run.length) out.push(run.reduce((a, b) => a + b, 0) / run.length)
        return out
      }

      // 取最长的等距线序列，排除图片外框等孤立线
      const longestRun = (lines) => {
        let best = []
        for (let i = 0; i < lines.length; i++) {
          for (let j = i + 1; j < lines.length; j++) {
            const step = (lines[j] - lines[i]) / (j - i)
            if (step < 12) continue
            const run = [lines[i]]
            let expected = lines[i] + step
            let k = i + 1
            while (k < lines.length && Math.abs(lines[k] - expected) <= step * 0.22) {
              run.push(lines[k])
              k++
              expected += step
            }
            if (run.length > best.length) best = run
          }
        }
        if (best.length < 3) return null
        return {
          first: best[0],
          last: best[best.length - 1],
          step: (best[best.length - 1] - best[0]) / (best.length - 1),
          lines: best.length,
        }
      }

      const hLines = longestRun(groupLines(rowScore, W * 0.75))
      const vLines = longestRun(groupLines(colScore, H * 0.75))
      if (!hLines || !vLines) {
        return { error: '未能定位网格线；请确认图片包含完整的题面网格' }
      }

      const cols = vLines.lines - 1
      const rows = hLines.lines - 1
      if (cols < 4 || rows < 4 || cols % 2 || rows % 2) {
        return { error: `识别到 ${cols}×${rows} 网格，宽高需为不小于 4 的偶数` }
      }

      const cellW = vLines.step
      const cellH = hLines.step
      const cx = (c) => vLines.first + (c + 0.5) * cellW
      const cy = (r) => hLines.first + (r + 0.5) * cellH
      const px = (x, y) => lum[Math.round(y) * W + Math.round(x)]

      // —— 格子分类：黑 / 白 / 空 ——
      const innerR = Math.max(3, Math.round(Math.min(cellW, cellH) * 0.12))
      const ringOuter = Math.min(cellW, cellH) * 0.46
      const ringInner = Math.min(cellW, cellH) * 0.18
      const cellStats = (x, y) => {
        let sum = 0
        let n = 0
        for (let dy = -innerR; dy <= innerR; dy++) {
          for (let dx = -innerR; dx <= innerR; dx++) {
            if (dx * dx + dy * dy > innerR * innerR) continue
            sum += px(x + dx, y + dy)
            n++
          }
        }
        // 只看对角线方向的圆环：线索画在上下左右边中点，不会污染这里
        let ink = 0
        let total = 0
        const reach = Math.ceil(ringOuter)
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < ringInner || d > ringOuter) continue
            if (Math.abs(Math.abs(dx) - Math.abs(dy)) > d * 0.35) continue
            total++
            if (px(x + dx, y + dy) < 235) ink++
          }
        }
        return { mean: sum / n, inkRatio: ink / total }
      }

      const givens = new Array(rows * cols).fill(0)
      const rowsText = []
      for (let r = 0; r < rows; r++) {
        let line = ''
        for (let c = 0; c < cols; c++) {
          const { mean, inkRatio } = cellStats(cx(c), cy(r))
          let value = 0
          if (mean < 110) value = 1
          else if (inkRatio > 0.01) value = 2
          givens[r * cols + c] = value
          line += value === 1 ? '#' : value === 2 ? 'o' : '.'
        }
        rowsText.push(line)
      }

      // —— 关系线索：= 同色 / × 异色 ——
      // 圆点是大连通域，线索是小连通域；按连通域面积 + 位置筛选，避免圆点弧线误判。
      const edgeCount = (cols > 1 ? rows * (cols - 1) : 0) + (rows > 1 ? (rows - 1) * cols : 0)
      const relations = new Array(edgeCount).fill(0)
      const markers = []
      const ink = new Uint8Array(W * H)
      for (let p = 0; p < ink.length; p++) ink[p] = lum[p] < 190 ? 1 : 0
      const seen = new Uint8Array(W * H)
      const stack = []
      const hCount = cols > 1 ? rows * (cols - 1) : 0
      const cellArea = cellW * cellH
      const gridLeft = vLines.first - cellW * 0.3
      const gridRight = vLines.first + (cols + 0.3) * cellW
      const gridTop = hLines.first - cellH * 0.3
      const gridBottom = hLines.first + (rows + 0.3) * cellH

      const edgeMidpoint = (edge) => {
        if (edge < hCount) {
          const y = Math.floor(edge / (cols - 1))
          const x = edge % (cols - 1)
          return { x: cx(x) + cellW / 2, y: cy(y), horizontal: true }
        }
        const v = edge - hCount
        const y = Math.floor(v / cols)
        const x = v % cols
        return { x: cx(x), y: cy(y) + cellH / 2, horizontal: false }
      }

      for (let p = 0; p < W * H; p++) {
        if (!ink[p] || seen[p]) continue
        stack.length = 0
        stack.push(p)
        seen[p] = 1
        const pixels = []
        let sx = 0
        let sy = 0
        let minX = W
        let maxX = 0
        let minY = H
        let maxY = 0
        let sr = 0
        let sg = 0
        let sb = 0
        while (stack.length) {
          const cur = stack.pop()
          const x = cur % W
          const y = (cur / W) | 0
          pixels.push(cur)
          sx += x
          sy += y
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          const o = cur * 4
          sr += data[o]
          sg += data[o + 1]
          sb += data[o + 2]
          if (x > 0 && ink[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = 1; stack.push(cur - 1) }
          if (x + 1 < W && ink[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = 1; stack.push(cur + 1) }
          if (y > 0 && ink[cur - W] && !seen[cur - W]) { seen[cur - W] = 1; stack.push(cur - W) }
          if (y + 1 < H && ink[cur + W] && !seen[cur + W]) { seen[cur + W] = 1; stack.push(cur + W) }
        }
        const area = pixels.length
        if (area < 4 || area > Math.min(cellArea * 0.25, 600)) continue
        const gx = sx / area
        const gy = sy / area
        if (gx < gridLeft || gx > gridRight || gy < gridTop || gy > gridBottom) continue

        let bestEdge = -1
        let bestDist = Infinity
        for (let e = 0; e < edgeCount; e++) {
          const m = edgeMidpoint(e)
          const d = Math.hypot(gx - m.x, gy - m.y)
          if (d < bestDist) {
            bestDist = d
            bestEdge = e
          }
        }
        if (bestEdge < 0) continue

        const r = sr / area
        const g = sg / area
        const b = sb / area
        let value
        if (g > r + 18 && g > b + 8) value = 1
        else if (r > g + 18) value = 2
        else {
          // 黑白线条：= 横向笔画，× 斜向笔画
          const bw = maxX - minX + 1
          const bh = maxY - minY + 1
          const midX = (minX + maxX) / 2
          const midY = (minY + maxY) / 2
          let diagonal = 0
          for (const cur of pixels) {
            const dx = Math.abs((cur % W) - midX)
            const dy = Math.abs(((cur / W) | 0) - midY)
            if (Math.abs(dx - dy) <= Math.max(1, bw * 0.12)) diagonal++
          }
          // 只有斜向笔画是 ×；= 无论横竖都是直笔画
          value = diagonal / area > 0.5 ? 2 : 1
        }
        markers.push({
          x: +gx.toFixed(1),
          y: +gy.toFixed(1),
          area,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
          dist: +bestDist.toFixed(1),
          value,
        })
        // 线索画在边中点上；棋子圆环的碎片离边中点约 12px，必须排除
        if (bestDist > Math.min(cellW, cellH) * 0.18) continue
        if (relations[bestEdge] !== 0) continue
        relations[bestEdge] = value
      }

      return {
        width: cols,
        height: rows,
        givens,
        relations,
        rowsText,
        markers,
        grid: { left: vLines.first, top: hLines.first, cellW, cellH, imageW: W, imageH: H },
      }
    }, src)
  } finally {
    await browser.close()
  }
}

function countClues(givens, relations) {
  let n = 0
  for (const v of givens) if (v !== 0) n++
  for (const v of relations) if (v !== 0) n++
  return n
}

const { image, opts } = parseArgs(process.argv.slice(2))
if (!existsSync(image)) usage(`找不到图片：${image}`)

console.log(`[recognize] 分析 ${image}`)
const detected = await analyzeImage(image)
if (detected.error) {
  console.error(`[recognize] ${detected.error}`)
  process.exit(1)
}

const { width, height, givens, relations, rowsText, markers, grid } = detected
if (process.env.DEBUG_RECOGNIZE) {
  console.log('[recognize] 候选墨迹块：', markers.length)
  for (const m of markers.slice(0, 120)) console.log('  ', JSON.stringify(m))
}
const expectedEdges = relationsEdgeCount(width, height)
if (relations.length !== expectedEdges) {
  console.error('[recognize] 关系线索数量异常')
  process.exit(1)
}

console.log(
  `[recognize] 网格 ${width}×${height}，格子 ${grid.cellW.toFixed(1)}×${grid.cellH.toFixed(1)}px，图片 ${grid.imageW}×${grid.imageH}`,
)
for (const line of rowsText) console.log(`  ${line}`)

const puzzle = { width, height, givens, relations }
const clueCount = countClues(givens, relations)
const flagged = givens.filter((v) => v === 1).length + givens.filter((v) => v === 2).length

let solution = null
let unique = false
let timedOut = false
try {
  const counted = countSolutions(puzzle, 2, opts.maxNodes)
  unique = counted.count === 1 && !counted.timedOut
  timedOut = counted.timedOut
  console.log(
    `[recognize] 线索 ${clueCount}（预填 ${flagged}），解数 ${
      counted.timedOut ? `超时（${counted.nodes} 节点）` : counted.count
    }`,
  )
  if (unique || (counted.count >= 1 && !counted.timedOut)) {
    const solved = solvePuzzle(
      { id: 'recognized', name: 'recognized', width, height, difficulty: opts.difficulty, givens, relations },
      opts.maxNodes,
    )
    solution = solved.solution ? solved.solution.cells : null
  }
} catch (err) {
  console.warn(`[recognize] 求解失败：${err instanceof Error ? err.message : err}`)
}

if (!unique) {
  console.warn(
    timedOut
      ? '[recognize] 唯一解检查超时，结果仅供对照'
      : '[recognize] 未找到唯一解；请核对识别结果或补充线索',
  )
}

const board = encodeBoard(givens, relations)
const claimedId = opts.id || `binairo-plus-${width}x${height}-${createHash('sha1').update(board).digest('hex').slice(0, 6)}`
const name = opts.name || `识别题 ${width}×${height}`
const entry = {
  id: claimedId,
  name,
  width,
  height,
  difficulty: opts.difficulty,
  series: opts.series || '图片识别',
  board,
  solution: solution ? encodeCells(solution) : '',
}

console.log('[recognize] 题库条目：')
console.log(JSON.stringify(entry, null, 2))
if (solution) console.log(`[recognize] 解：${entry.solution}`)

if (opts.json) {
  writeFileSync(path.resolve(opts.json), JSON.stringify(entry, null, 2) + '\n')
  console.log(`[recognize] 已写入 ${opts.json}`)
}

if (opts.add) {
  if (!unique) {
    console.error('[recognize] 拒绝写入题库：题目没有唯一解')
    process.exit(1)
  }
  if (!solution) {
    console.error('[recognize] 拒绝写入题库：没有求得参考解')
    process.exit(1)
  }
  let list = []
  if (existsSync(IMPORT_FILE)) {
    const parsed = JSON.parse(readFileSync(IMPORT_FILE, 'utf8'))
    if (Array.isArray(parsed)) list = parsed
  }
  const at = list.findIndex((p) => p && p.id === entry.id)
  if (at >= 0) list[at] = entry
  else list.push(entry)
  writeFileSync(IMPORT_FILE, JSON.stringify(list, null, 2) + '\n')
  console.log(`[recognize] 已加入 ${path.relative(process.cwd(), IMPORT_FILE)}，运行 npm run gen 重建题库`)
}

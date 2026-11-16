/**
 * 黑白+（Binairo+ / Tango）—— 从题面图片自动识别并导入题库
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [选项]
 *
 * 选项：
 *   --name 名称        题库中显示的名称（默认：识图 · W×H）
 *   --id ID            指定题目 id
 *   --series 系列      系列名（默认：图片识别）
 *   --difficulty 级别  easy / medium / hard（默认 hard）
 *   --size N           正方形网格边长（自动识别失败时手动指定）
 *   --width N / --height N  矩形题图宽/高，可只给一边
 *   --map r,c=值       人工覆盖某格给定（行列从 1 开始；B/黑=1、W/白=2、./0=空）
 *   --append           追加到 scripts/printed-puzzles.json（跑 npm run gen 后进入题库）
 *   --dry              只识别，不求解、不写入
 *   --max-nodes N      唯一性搜索节点上限（默认 2000000）
 *   --edge PATH        指定 Edge 可执行文件路径（默认自动探测）
 *
 * 识别原理（Playwright + Edge，无网络、无外部服务）：
 *   1. 以亮度众数作背景，多档阈值投影找网格线，取最长等距线序列；
 *   2. 每格用「中心黑点 / 白色圆点 + 深色描边」判断黑/白给定，用绿色圆环判断是否题面给定；
 *   3. 相邻格中点的小圆标：绿色 = 同色(=)，红色 = 异色(×)；
 *   4. 生成预填格串 + 关系串，校验唯一解后预览 / --append。
 *
 * 题图预期：黑白+题面截图（预填格带绿色圆环，关系线索为绿色 = / 红色 × 小圆标）；
 * 也支持纯黑白圆点题图（无关系线索、无圆环时按全部圆点都算给定处理）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { register } from 'node:module'

const tsResolveLoader = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) } catch (err) {
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
      try { return await next(specifier + '.ts', context) } catch {}
    }
    throw err
  }
}`
register('data:text/javascript;base64,' + Buffer.from(tsResolveLoader).toString('base64'))

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function resolveEdge() {
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p
  throw new Error('找不到 Microsoft Edge，可用 --edge 或环境变量 EDGE_PATH 指定路径')
}

const DATA_FILE = path.resolve('scripts/printed-puzzles.json')

function usage(message) {
  if (message) console.error(`[import] ${message}`)
  console.error(
    '用法: node scripts/import-image.mjs <图片路径> [--name 名称] [--series 系列] [--difficulty easy|medium|hard]\n' +
      '       [--size N | --width N --height N] [--map r,c=值] [--append] [--dry] [--max-nodes N] [--id ID] [--edge PATH]',
  )
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {
    positional: [],
    append: false,
    dry: false,
    size: 0,
    width: 0,
    height: 0,
    maxNodes: 2_000_000,
    map: [],
    difficulty: 'hard',
  }
  const valueFlags = new Set(['name', 'id', 'series', 'difficulty', 'size', 'width', 'height', 'max-nodes', 'edge', 'map'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      opts.positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (key === 'append') opts.append = true
    else if (key === 'dry') opts.dry = true
    else if (valueFlags.has(key)) {
      const value = argv[i + 1]
      if (value === undefined) usage(`缺少 --${key} 的值`)
      i++
      if (key === 'max-nodes') opts.maxNodes = Number(value)
      else if (key === 'size') opts.size = Number(value)
      else if (key === 'width') opts.width = Number(value)
      else if (key === 'height') opts.height = Number(value)
      else if (key === 'map') opts.map.push(value)
      else opts[key] = value
    } else usage(`未知选项 --${key}`)
  }
  if (opts.positional.length !== 1) usage('需要且只需要一个图片路径')
  if (!Number.isFinite(opts.maxNodes) || opts.maxNodes <= 0) usage('--max-nodes 必须是正数')
  if (!['easy', 'medium', 'hard'].includes(opts.difficulty)) usage('--difficulty 只能是 easy / medium / hard')
  return opts
}

function hashId(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 6)
}

const SYMBOL = (v) => (v === 1 ? 'B' : v === 2 ? 'W' : '.')

// ───────────────────────────── 图片识别 ─────────────────────────────

function dataUrlOf(file) {
  const ext = path.extname(file).toLowerCase()
  const mime =
    ext === '.png' ? 'image/png' : ext === '.bmp' ? 'image/bmp' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

async function analyzeImage({ imageFile, edge, size, width, height }) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ headless: true, executablePath: edge })
  try {
    const page = await browser.newPage()
    return await page.evaluate(
      async ({ src, sizeOpt, widthOpt, heightOpt }) => {
        const img = new Image()
        img.src = src
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
        for (let p = 0, i = 0; p < lum.length; p++, i += 4) lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        const rgb = (x, y) => {
          const i = (y * W + x) * 4
          return [data[i], data[i + 1], data[i + 2]]
        }

        const hist = new Int32Array(64)
        for (let p = 0; p < lum.length; p++) hist[Math.min(63, Math.floor(lum[p] / 4))]++
        let modeBin = 0
        for (let i = 0; i < 64; i++) if (hist[i] > hist[modeBin]) modeBin = i
        const bgLum = modeBin * 4 + 2

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
        const axisScores = (horizontal, threshold) => {
          const scores = horizontal ? new Int32Array(H) : new Int32Array(W)
          if (horizontal) {
            for (let y = 0; y < H; y++) {
              let n = 0
              for (let x = 0; x < W; x++) if (lum[y * W + x] < threshold) n++
              scores[y] = n
            }
          } else {
            for (let x = 0; x < W; x++) {
              let n = 0
              for (let y = 0; y < H; y++) if (lum[y * W + x] < threshold) n++
              scores[x] = n
            }
          }
          return scores
        }
        const findGrid = (horizontal) => {
          let best = null
          // 黑白+ 的网格线/单元格描边很浅，需要多档阈值（含小差值）扫描
          const deltas = [120, 100, 80, 60, 50, 40, 30, 24, 20, 16, 12, 10, 8]
          for (const delta of deltas) {
            const threshold = Math.max(4, bgLum - delta)
            const scores = axisScores(horizontal, threshold)
            if (Math.max(...scores) < 20) continue
            const lines = groupLines(scores, Math.max(12, Math.max(...scores) * 0.5))
            if (lines.length < 3) continue
            for (let i = 0; i < lines.length; i++) {
              for (let j = i + 1; j < lines.length; j++) {
                const step = (lines[j] - lines[i]) / (j - i)
                if (step < 6) continue
                const run = [lines[i]]
                let expected = lines[i] + step
                let k = i + 1
                while (k < lines.length && Math.abs(lines[k] - expected) <= step * 0.25) {
                  run.push(lines[k])
                  k++
                  expected += step
                }
                if (run.length < 3) continue
                const realStep = (run[run.length - 1] - run[0]) / (run.length - 1)
                let maxDev = 0
                for (let q = 0; q < run.length; q++) maxDev = Math.max(maxDev, Math.abs(run[q] - (run[0] + q * realStep)))
                if (maxDev > realStep * 0.12) continue
                if (!best || run.length > best.score) {
                  best = { score: run.length, first: run[0], last: run[run.length - 1], step: realStep, lines: run.length, threshold, run: run.slice() }
                }
              }
            }
            if (best && best.score >= 20) break
          }
          return best
        }
        // 网格最外圈的圆角/描边可能让首尾线偏离真实格线，用内部线拟合规则格子后外推修正
        const refineLattice = (grid) => {
          if (!grid || !grid.run || grid.run.length < 4) return grid
          const run = grid.run
          const n = run.length
          const innerIdx = []
          const innerVal = []
          for (let i = 1; i < n - 1; i++) {
            innerIdx.push(i)
            innerVal.push(run[i])
          }
          let slope
          let intercept
          if (innerIdx.length >= 2) {
            const meanX = innerIdx.reduce((a, b) => a + b, 0) / innerIdx.length
            const meanY = innerVal.reduce((a, b) => a + b, 0) / innerVal.length
            let num = 0
            let den = 0
            for (let i = 0; i < innerIdx.length; i++) {
              num += (innerIdx[i] - meanX) * (innerVal[i] - meanY)
              den += (innerIdx[i] - meanX) ** 2
            }
            slope = den ? num / den : (run[n - 1] - run[0]) / (n - 1)
            intercept = meanY - slope * meanX
          } else {
            slope = (run[n - 1] - run[0]) / (n - 1)
            intercept = run[0]
          }
          return { ...grid, first: intercept, last: intercept + slope * (n - 1), step: slope, run: undefined }
        }
        const hLines = refineLattice(findGrid(true))
        const vLines = refineLattice(findGrid(false))
        if (!hLines || !vLines) {
          return { error: '未能定位网格线；请确认图片包含完整的题面网格，或先用 --size / --width / --height 指定尺寸' }
        }
        const autoW = vLines.lines - 1
        const autoH = hLines.lines - 1
        const w = widthOpt || sizeOpt || autoW
        const h = heightOpt || sizeOpt || autoH
        if (!(w >= 4) || !(h >= 4) || w % 2 || h % 2) {
          return { error: `识别到 ${autoW}×${autoH} 网格；黑白+ 的宽高需为不小于 4 的偶数（可用 --size/--width/--height 指定）` }
        }
        if (vLines.lines !== w + 1 || hLines.lines !== h + 1) {
          return { error: `网格不匹配：识别到 ${vLines.lines} 条竖线 / ${hLines.lines} 条横线，但目标是 ${w}×${h}（需要 ${w + 1} / ${h + 1} 条线）` }
        }
        const x0 = vLines.first
        const y0 = hLines.first
        const cellW = vLines.step
        const cellH = hLines.step
        const cellMin = Math.min(cellW, cellH)
        const pixel = (x, y) => {
          const px = Math.max(0, Math.min(W - 1, Math.round(x)))
          const py = Math.max(0, Math.min(H - 1, Math.round(y)))
          return [lum[py * W + px], rgb(px, py)]
        }

        const givens = new Array(w * h).fill(0)
        const givenRing = new Array(w * h).fill(false)
        const ambiguous = []
        let black = 0
        let white = 0
        let empty = 0
        let dotsWithoutRing = 0
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const cx = x0 + (c + 0.5) * cellW
            const cy = y0 + (r + 0.5) * cellH
            const rad = cellMin * 0.28
            let dark = 0
            let total = 0
            for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) {
              for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
                if (dx * dx + dy * dy > rad * rad) continue
                total++
                if (pixel(cx + dx, cy + dy)[0] < 110) dark++
              }
            }
            const centerDark = total ? dark / total : 0
            const rIn = cellMin * 0.24
            const rOut = cellMin * 0.36
            let ringInk = 0
            let ringTotal = 0
            for (let dy = -Math.ceil(rOut); dy <= Math.ceil(rOut); dy++) {
              for (let dx = -Math.ceil(rOut); dx <= Math.ceil(rOut); dx++) {
                const dist = Math.hypot(dx, dy)
                if (dist < rIn || dist > rOut) continue
                ringTotal++
                if (pixel(cx + dx, cy + dy)[0] < 205) ringInk++
              }
            }
            const ringRatio = ringTotal ? ringInk / ringTotal : 0
            // 绿色圆环 = 题面给定标志
            const gIn = cellMin * 0.36
            const gOut = cellMin * 0.5
            let green = 0
            let greenTotal = 0
            for (let dy = -Math.ceil(gOut); dy <= Math.ceil(gOut); dy++) {
              for (let dx = -Math.ceil(gOut); dx <= Math.ceil(gOut); dx++) {
                const dist = Math.hypot(dx, dy)
                if (dist < gIn || dist > gOut) continue
                greenTotal++
                const [, rgbVal] = pixel(cx + dx, cy + dy)
                const [rr, gg, bb] = rgbVal
                if (gg > rr + 22 && gg > bb + 8) green++
              }
            }
            const givenRingRatio = greenTotal ? green / greenTotal : 0
            let value = 0
            if (centerDark > 0.35) value = 1
            else if (ringRatio > 0.12) value = 2
            const idx = r * w + c
            givens[idx] = value
            givenRing[idx] = givenRingRatio > 0.05
            if (value === 1) black++
            else if (value === 2) white++
            else empty++
            if (value !== 0 && !givenRing[idx]) dotsWithoutRing++
            const nearBlack = Math.abs(centerDark - 0.35) < 0.1
            const nearWhite = value === 0 && ringRatio > 0.05 && ringRatio < 0.12
            if (nearBlack || nearWhite) ambiguous.push({ r, c, centerDark: +centerDark.toFixed(3), ringRatio: +ringRatio.toFixed(3), value })
          }
        }

        // —— 关系线索：相邻格中点的小圆标：绿色 = / 红色 × ——
        // 关系标的彩色字形位于中点附近（半径约 0.08 格宽），而给定格的绿色圆环离中点更远，
        // 因此只用中点附近的小窗口统计颜色，避免把给定格圆环误判成关系。
        const half = Math.max(2, cellMin * 0.065)
        const circleInk = (x, y) => {
          let greenCount = 0
          let redCount = 0
          for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
            for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
              if (dx * dx + dy * dy > half * half) continue
              const [, rgbVal] = pixel(x + dx, y + dy)
              const [rr, gg, bb] = rgbVal
              if (gg > rr + 22 && gg > bb + 8) greenCount++
              if (rr > gg + 22 && rr > bb + 8) redCount++
            }
          }
          if (greenCount >= redCount && greenCount > 2) return 1
          if (redCount > greenCount && redCount > 2) return 2
          return 0
        }
        const relations = new Array(w > 1 && h > 1 ? h * (w - 1) + (h - 1) * w : 0).fill(0)
        if (w > 1) {
          const hCount = h * (w - 1)
          for (let r = 0; r < h; r++) {
            for (let c = 0; c + 1 < w; c++) {
              const mx = x0 + (c + 1) * cellW
              const my = y0 + (r + 0.5) * cellH
              relations[r * (w - 1) + c] = circleInk(mx, my)
            }
          }
          if (hCount !== relations.length) {
            // 竖边索引从 hCount 开始，与 types.ts 的 relationsEdgeCount 顺序保持一致
          }
        }
        if (h > 1) {
          const hCount = h * (w - 1)
          for (let r = 0; r + 1 < h; r++) {
            for (let c = 0; c < w; c++) {
              const mx = x0 + (c + 0.5) * cellW
              const my = y0 + (r + 1) * cellH
              relations[hCount + r * w + c] = circleInk(mx, my)
            }
          }
        }

        return {
          width: w,
          height: h,
          givens,
          relations,
          givenRing,
          black,
          white,
          empty,
          dotsWithoutRing,
          ambiguous,
          grid: { imageW: W, imageH: H, x0, y0, cellW, cellH, autoW, autoH, bgLum },
        }
      },
      { src: dataUrlOf(imageFile), sizeOpt: size, widthOpt: width, heightOpt: height },
    )
  } finally {
    await browser.close()
  }
}

// ───────────────────────────── 写入题库 ─────────────────────────────

function appendEntry(entry) {
  let list = []
  if (existsSync(DATA_FILE)) {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
    if (Array.isArray(parsed)) list = parsed
  }
  const at = list.findIndex((p) => p && p.id === entry.id)
  if (at >= 0) list[at] = entry
  else list.push(entry)
  writeFileSync(DATA_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8')
}

// ───────────────────────────── 主流程 ─────────────────────────────

const opts = parseArgs(process.argv.slice(2))
const imageFile = path.resolve(opts.positional[0])
if (!existsSync(imageFile)) usage(`找不到图片：${imageFile}`)
const edge = opts.edge || resolveEdge()

console.log(`[import] 识别 ${path.relative(process.cwd(), imageFile) || imageFile}`)
const detected = await analyzeImage({ imageFile, edge, size: opts.size, width: opts.width, height: opts.height })
if (detected.error) {
  console.error(`[import] ${detected.error}`)
  process.exit(1)
}
const { width, height, grid } = detected
const size = width * height
let givens = detected.givens.slice()
const relations = detected.relations.slice()

// --map 人工覆盖：r,c=值（行列从 1 开始；B/1=黑，W/2=白，./0=空）
for (const spec of opts.map) {
  for (const pair of spec.split(';')) {
    if (!pair.trim()) continue
    const m = pair.trim().match(/^(\d+)\s*,\s*(\d+)\s*=\s*([BWbw12.0.])$/)
    if (!m) usage(`--map 格式应为 行,列=值（B/W/. 或 1/2/0），收到：${pair}`)
    const r = Number(m[1]) - 1
    const c = Number(m[2]) - 1
    if (r < 0 || r >= height || c < 0 || c >= width) usage(`--map 坐标越界：${pair}（网格 ${width}×${height}）`)
    const ch = m[3].toUpperCase()
    givens[r * width + c] = ch === 'B' || ch === '1' ? 1 : ch === 'W' || ch === '2' ? 2 : 0
  }
}

const black = givens.filter((v) => v === 1).length
const white = givens.filter((v) => v === 2).length
const relSame = relations.filter((v) => v === 1).length
const relDiff = relations.filter((v) => v === 2).length
console.log(
  `[import] 网格 ${width}×${height}，格子 ${grid.cellW.toFixed(2)}×${grid.cellH.toFixed(2)}px，图片 ${grid.imageW}×${grid.imageH}；` +
    `给定 黑 ${black} / 白 ${white}；关系 = ${relSame}、× ${relDiff}`,
)
if (detected.dotsWithoutRing) {
  console.warn(
    `[import] 有 ${detected.dotsWithoutRing} 个圆点没有绿色给定圆环（可能是已落子而非题面给定），` +
      '已按题面给定处理；如不是题面截图请换用干净截图。',
  )
}
if (detected.ambiguous.length) {
  console.warn(`[import] 有 ${detected.ambiguous.length} 个格子识别不确定（可用 --map 修正）：`)
  for (const a of detected.ambiguous.slice(0, 12)) {
    console.warn(`  第 ${a.r + 1} 行第 ${a.c + 1} 列：中心暗度 ${a.centerDark}，圆环墨迹 ${a.ringRatio} → ${a.value}`)
  }
}
const givensText = givens.map(SYMBOL).join('')
const relationsText = relations.join('')
const board = givensText + relationsText
const edgeCount = (width > 1 ? height * (width - 1) : 0) + (height > 1 ? (height - 1) * width : 0)
if (relationsText.length !== edgeCount) {
  console.error(`[import] 关系数量异常：${relationsText.length} != ${edgeCount}`)
  process.exit(1)
}

console.log('[import] 预填格（B = 黑，W = 白，. = 空）：')
for (let r = 0; r < height; r++) {
  let line = ''
  for (let c = 0; c < width; c++) line += SYMBOL(givens[r * width + c])
  console.log(String(r + 1).padStart(2) + ' ' + line)
}
if (relSame + relDiff > 0) {
  console.log('[import] 关系（1 = 同色 =，2 = 异色 ×，按「先所有横边、再所有竖边」排列）：')
  for (let r = 0; r < height; r++) {
    let hLine = ''
    for (let c = 0; c + 1 < width; c++) hLine += relations[r * (width - 1) + c]
    let vLine = ''
    const hCount = height * (width - 1)
    for (let c = 0; c < width; c++) vLine += r + 1 < height ? relations[hCount + r * width + c] : ' '
    console.log(String(r + 1).padStart(2) + ' 横 ' + hLine.padEnd(width) + ' 竖 ' + vLine)
  }
}

const id = opts.id || `binairo-plus-${width}x${height}-${hashId(board)}`
const name = opts.name || `识图 ${width}×${height}`
const series = opts.series || '图片识别'
const entry = { id, name, width, height, difficulty: opts.difficulty, series, board, solution: '' }

if (opts.dry) {
  console.log('[import] --dry：仅识别，不求解、不写入。')
  process.exit(0)
}

const solverMod = await import('../src/game/solver.ts')
const puzzle = { id, name, width, height, difficulty: opts.difficulty, givens, relations }
console.log('[import] 唯一性检查…')
const t0 = Date.now()
const counted = solverMod.countSolutions(puzzle, 2, opts.maxNodes)
const ms = Date.now() - t0
if (counted.timedOut) {
  console.warn(`[import] 唯一性检查超时（${counted.nodes} 节点 / ${ms}ms）；可放宽 --max-nodes。`)
} else if (counted.count === 0) {
  console.error(`[import] 无解：识别出的题面自相矛盾，请检查识别结果或使用 --map 修正（${ms}ms）。`)
  process.exit(1)
} else if (counted.count === 1) {
  console.log(`[import] 唯一解确认（${counted.nodes} 节点 / ${ms}ms）`)
  const solved = solverMod.solvePuzzle(puzzle, opts.maxNodes)
  if (solved.solution) entry.solution = solved.solution.cells.join('')
} else {
  console.warn(`[import] 警告：找到 ${counted.count} 个解（上限），题目可能不唯一。`)
  const solved = solverMod.solvePuzzle(puzzle, opts.maxNodes)
  if (solved.solution) entry.solution = solved.solution.cells.join('')
}

if (!opts.append) {
  console.log('[import] 预览模式（未写入题库）。加 --append 写入 scripts/printed-puzzles.json（再 npm run gen 进入题库）。')
  console.log(
    `[import] 题库条目：id=${id} name=${name} 尺寸=${width}×${height} 给定=${black + white} 格 关系=${relSame + relDiff} 条` +
      (entry.solution ? ` 参考解=${entry.solution.length} 格` : ''),
  )
  console.log(`[import] board = ${board}`)
} else {
  if (!entry.solution) {
    console.error('[import] 拒绝写入：没有求得参考解（请先用 --verify/放宽限制确认题目可解）')
    process.exit(1)
  }
  appendEntry(entry)
  console.log(`[import] 已写入 ${path.relative(process.cwd(), DATA_FILE)}：${id} ${name}；运行 npm run gen 重建题库`)
}


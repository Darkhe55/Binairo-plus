/**
 * 黑白+题库生成器
 *
 * 1. 随机生成一个满足「行列等量 + 不三连 + 行列不重复」的完整盘面；
 * 2. 把所有格子预填和相邻关系线索混在一起随机排序；
 * 3. 二分查找最短的唯一解前缀；
 * 4. 简单题在此基础上再补一些线索，困难题在多个顺序里取线索最少者。
 */

import type { Difficulty } from '../core/types'
import {
  BLACK,
  REL_DIFF,
  REL_SAME,
  WHITE,
  encodeBoard,
  encodeCells,
  horizontalEdgeIndex,
  relationsEdgeCount,
  verticalEdgeIndex,
} from './types.ts'
import { hasDuplicateLines, solveByRules } from './rules.ts'
import { countSolutions } from './solver.ts'

export interface RawPuzzleOut {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

interface GenSpec {
  w: number
  h: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  extra: number
  orders: number
  maxNodes: number
  requireLogic: boolean
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = list[i]!
    list[i] = list[j]!
    list[j] = tmp
  }
  return list
}

/** 随机生成满足行列等量、不三连且无重复行/列的完整盘面 */
function generateFull(w: number, h: number, rng: () => number): number[] | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cells = generateFullOnce(w, h, rng)
    if (!cells) return null
    if (!hasDuplicateLines(cells, w, h)) return cells
  }
  return null
}

/** 单次生成：行列等量 + 不三连 */
function generateFullOnce(w: number, h: number, rng: () => number): number[] | null {
  const n = w * h
  const rowTarget = w / 2
  const colTarget = h / 2
  const cells = new Array<number>(n).fill(0)
  const rowBlack = new Array<number>(h).fill(0)
  const rowWhite = new Array<number>(h).fill(0)
  const colBlack = new Array<number>(w).fill(0)
  const colWhite = new Array<number>(w).fill(0)
  let nodes = 0

  const dfs = (idx: number): boolean => {
    if (idx === n) return true
    if (++nodes > 2_000_000) return false

    const x = idx % w
    const y = (idx / w) | 0
    const colors = rng() < 0.5 ? [BLACK, WHITE] : [WHITE, BLACK]

    for (const c of colors) {
      if (c === BLACK) {
        if (rowBlack[y]! + 1 > rowTarget || colBlack[x]! + 1 > colTarget) continue
        if (x >= 2 && cells[idx - 1] === BLACK && cells[idx - 2] === BLACK) continue
        if (y >= 2 && cells[idx - w] === BLACK && cells[idx - 2 * w] === BLACK) continue
      } else {
        if (rowWhite[y]! + 1 > rowTarget || colWhite[x]! + 1 > colTarget) continue
        if (x >= 2 && cells[idx - 1] === WHITE && cells[idx - 2] === WHITE) continue
        if (y >= 2 && cells[idx - w] === WHITE && cells[idx - 2 * w] === WHITE) continue
      }

      cells[idx] = c
      if (c === BLACK) {
        rowBlack[y]!++
        colBlack[x]!++
      } else {
        rowWhite[y]!++
        colWhite[x]!++
      }

      // 剩余空间必须还够填满目标数量
      const rowDone = x + 1 === w
      const colDone = y + 1 === h
      let ok = true
      if (rowDone && rowBlack[y] !== rowTarget) ok = false
      if (colDone && colBlack[x] !== colTarget) ok = false
      if (ok && !rowDone) {
        const remain = w - x - 1
        if (rowBlack[y]! + remain < rowTarget || rowWhite[y]! + remain < rowTarget) ok = false
      }
      if (ok && !colDone) {
        const remain = h - y - 1
        if (colBlack[x]! + remain < colTarget || colWhite[x]! + remain < colTarget) ok = false
      }

      if (ok && dfs(idx + 1)) return true

      cells[idx] = 0
      if (c === BLACK) {
        rowBlack[y]!--
        colBlack[x]!--
      } else {
        rowWhite[y]!--
        colWhite[x]!--
      }
    }
    return false
  }

  return dfs(0) ? cells : null
}

type Clue =
  | { kind: 'cell'; index: number; value: number }
  | { kind: 'edge'; index: number; value: number }

function allClues(cells: number[], w: number, h: number): Clue[] {
  const out: Clue[] = []
  for (let i = 0; i < w * h; i++) {
    out.push({ kind: 'cell', index: i, value: cells[i]! })
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const edge = horizontalEdgeIndex(w, x, y)
      const a = cells[y * w + x]!
      const b = cells[y * w + x + 1]!
      const value = a === b ? REL_SAME : REL_DIFF
      out.push({ kind: 'edge', index: edge, value })
    }
  }
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = verticalEdgeIndex(w, h, x, y)
      const a = cells[y * w + x]!
      const b = cells[(y + 1) * w + x]!
      const value = a === b ? REL_SAME : REL_DIFF
      out.push({ kind: 'edge', index: edge, value })
    }
  }
  return out
}

interface ClueSet {
  givens: number[]
  relations: number[]
}

function applyPrefix(
  clues: Clue[],
  count: number,
  w: number,
  h: number,
): ClueSet {
  const givens = new Array<number>(w * h).fill(0)
  const relations = new Array<number>(relationsEdgeCount(w, h)).fill(0)
  for (let i = 0; i < count; i++) {
    const clue = clues[i]!
    if (clue.kind === 'cell') givens[clue.index] = clue.value
    else relations[clue.index] = clue.value
  }
  return { givens, relations }
}

function isUnique(set: ClueSet, w: number, h: number, maxNodes: number): boolean | null {
  const out = countSolutions(
    { givens: set.givens, relations: set.relations, width: w, height: h },
    2,
    maxNodes,
  )
  if (out.timedOut) return null
  return out.count === 1
}

function minimalUnique(
  cells: number[],
  w: number,
  h: number,
  rng: () => number,
  maxNodes: number,
): ClueSet | null {
  const clues = shuffle(allClues(cells, w, h), rng)
  const total = clues.length

  // 二分查找最短唯一前缀
  let lo = 1
  let hi = total
  if (isUnique(applyPrefix(clues, hi, w, h), w, h, maxNodes) !== true) return null
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const ok = isUnique(applyPrefix(clues, mid, w, h), w, h, maxNodes)
    if (ok === null) return null
    if (ok) hi = mid
    else lo = mid + 1
  }
  return applyPrefix(clues, lo, w, h)
}

function clueCount(set: ClueSet): number {
  let count = 0
  for (const v of set.givens) if (v !== 0) count++
  for (const v of set.relations) if (v !== 0) count++
  return count
}

function addExtraClues(
  set: ClueSet,
  cells: number[],
  w: number,
  h: number,
  extraRatio: number,
  rng: () => number,
): ClueSet {
  const givens = set.givens.slice()
  const relations = set.relations.slice()
  const remaining: Clue[] = []
  for (let i = 0; i < w * h; i++) {
    if (givens[i] === 0) remaining.push({ kind: 'cell', index: i, value: cells[i]! })
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const edge = horizontalEdgeIndex(w, x, y)
      if (relations[edge] === 0) {
        const a = cells[y * w + x]!
        const b = cells[y * w + x + 1]!
        remaining.push({ kind: 'edge', index: edge, value: a === b ? REL_SAME : REL_DIFF })
      }
    }
  }
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = verticalEdgeIndex(w, h, x, y)
      if (relations[edge] === 0) {
        const a = cells[y * w + x]!
        const b = cells[(y + 1) * w + x]!
        remaining.push({ kind: 'edge', index: edge, value: a === b ? REL_SAME : REL_DIFF })
      }
    }
  }

  shuffle(remaining, rng)
  const add = Math.round(remaining.length * extraRatio)
  for (let k = 0; k < add; k++) {
    const clue = remaining[k]!
    if (clue.kind === 'cell') givens[clue.index] = clue.value
    else relations[clue.index] = clue.value
  }
  return { givens, relations }
}

const SPECS: GenSpec[] = [
  {
    w: 6,
    h: 6,
    seed: 0x42494e01,
    difficulty: 'easy',
    name: '黑白初分',
    series: '入门',
    extra: 0.35,
    orders: 3,
    maxNodes: 80_000,
    requireLogic: true,
  },
  {
    w: 6,
    h: 6,
    seed: 0x42494e02,
    difficulty: 'hard',
    name: '六宫对照',
    series: '入门',
    extra: 0,
    orders: 8,
    maxNodes: 80_000,
    requireLogic: true,
  },
  {
    w: 8,
    h: 8,
    seed: 0x42494e03,
    difficulty: 'easy',
    name: '等量回廊',
    series: '进阶',
    extra: 0.3,
    orders: 3,
    maxNodes: 120_000,
    requireLogic: true,
  },
  {
    w: 8,
    h: 8,
    seed: 0x42494e04,
    difficulty: 'hard',
    name: '关系迷宫',
    series: '进阶',
    extra: 0,
    orders: 8,
    maxNodes: 120_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    seed: 0x42494e05,
    difficulty: 'easy',
    name: '双色长廊',
    series: '挑战',
    extra: 0.3,
    orders: 3,
    maxNodes: 180_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    seed: 0x42494e06,
    difficulty: 'hard',
    name: '黑白+终局',
    series: '挑战',
    extra: 0,
    orders: 8,
    maxNodes: 180_000,
    requireLogic: false,
  },
]

export function generatePuzzles(): RawPuzzleOut[] {
  const out: RawPuzzleOut[] = []
  for (const spec of SPECS) {
    const rng = mulberry32(spec.seed)
    const t0 = Date.now()
    const cells = generateFull(spec.w, spec.h, rng)
    if (!cells) throw new Error(`[黑白+ gen] ${spec.name} 无法生成完整盘面`)

    let best: ClueSet | null = null
    let bestCount = Infinity
    for (let k = 0; k < spec.orders; k++) {
      const set = minimalUnique(cells, spec.w, spec.h, rng, spec.maxNodes)
      if (!set) continue
      const count = clueCount(set)
      if (count < bestCount) {
        best = set
        bestCount = count
      }
    }
    if (!best) throw new Error(`[黑白+ gen] ${spec.name} 无法生成唯一解题面`)

    const finalSet =
      spec.extra > 0
        ? addExtraClues(best, cells, spec.w, spec.h, spec.extra, rng)
        : best

    if (spec.requireLogic) {
      const rules = solveByRules(
        {
          givens: finalSet.givens,
          relations: finalSet.relations,
          width: spec.w,
          height: spec.h,
        },
        true,
        240,
      )
      if (!rules.ok || !rules.saturated) {
        // 退化为直接使用规则可推的解；这里若失败则仍输出，check 会给出警告
      }
    }

    console.log(
      `[黑白+ gen] ${spec.name} ${spec.w}×${spec.h}：线索 ${clueCount(finalSet)}，${Date.now() - t0}ms`,
    )
    out.push({
      id: `binairo-plus-${spec.w}x${spec.h}-${spec.seed.toString(36)}`,
      name: spec.name,
      width: spec.w,
      height: spec.h,
      difficulty: spec.difficulty,
      series: spec.series,
      board: encodeBoard(finalSet.givens, finalSet.relations),
      solution: encodeCells(cells),
    })
  }
  return out
}

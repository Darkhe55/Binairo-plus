/**
 * 黑白+（Binairo+ / Tango）—— 游戏专用类型
 *
 * 规则：
 *   1. 每行、每列黑子与白子数量相同；
 *   2. 不能有三个及以上同色圆点相连；
 *   3. 标 "=" 的两格同色，标 "×" 的两格异色。
 *
 * 状态：0 = 未填，1 = 黑，2 = 白。
 * 关系：0 = 无，1 = 同色(=)，2 = 异色(×)。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export const REL_NONE = 0
export const REL_SAME = 1
export const REL_DIFF = 2

export type CellValue = 0 | 1 | 2

export interface BinairoPuzzle extends Puzzle {
  /** 题面预填格：0 空，1 黑，2 白 */
  givens: number[]
  /** 相邻格关系：见 relationsEdgeCount 的排列顺序 */
  relations: number[]
  /** 参考解：1 黑 / 2 白 */
  solution?: number[]
}

export interface BinairoState extends GameState {
  cells: number[]
  givens: number[]
}

export interface LineIssue {
  orientation: 'row' | 'col'
  index: number
  black: number
  white: number
}

export interface RelationIssue {
  edge: number
  a: number
  b: number
  expected: number
  actual: number
}

export interface BinairoResult extends ValidationResult {
  empty: number
  complete: boolean
  /** 三连同色段数 */
  tripleCount: number
  tripleCells: number[]
  lineIssues: LineIssue[]
  relationIssues: RelationIssue[]
  badCells: number[]
  changedGivens: number[]
}

export function asBinairoPuzzle(p: Puzzle): BinairoPuzzle {
  return p as BinairoPuzzle
}

export function asBinairoState(s: GameState): BinairoState {
  return s as BinairoState
}

/* ────────────────────────── 边索引 ────────────────────────── */

export function horizontalEdgeCount(w: number, h: number): number {
  return w > 1 ? h * (w - 1) : 0
}

export function verticalEdgeCount(w: number, h: number): number {
  return h > 1 ? (h - 1) * w : 0
}

export function relationsEdgeCount(w: number, h: number): number {
  return horizontalEdgeCount(w, h) + verticalEdgeCount(w, h)
}

export function horizontalEdgeIndex(w: number, x: number, y: number): number {
  return y * (w - 1) + x
}

export function verticalEdgeIndex(w: number, h: number, x: number, y: number): number {
  return horizontalEdgeCount(w, h) + y * w + x
}

/** 边的两个端点 */
export function edgeCells(
  edge: number,
  w: number,
  h: number,
): { a: number; b: number } | null {
  const hCount = horizontalEdgeCount(w, h)
  if (edge < 0) return null
  if (edge < hCount) {
    const y = Math.floor(edge / (w - 1))
    const x = edge % (w - 1)
    const a = y * w + x
    return { a, b: a + 1 }
  }
  const v = edge - hCount
  if (v >= verticalEdgeCount(w, h)) return null
  const y = Math.floor(v / w)
  const x = v % w
  const a = y * w + x
  return { a, b: a + w }
}

/* ────────────────────────── 编码 ────────────────────────── */

/** 题面 = 预填格串(n) + 关系串(m)，每格/每边一个 0/1/2 字符 */
export function encodeBoard(givens: ArrayLike<number>, relations: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < givens.length; i++) out += String(givens[i]! | 0)
  for (let i = 0; i < relations.length; i++) out += String(relations[i]! | 0)
  return out
}

export function decodeBoard(
  text: string,
  w: number,
  h: number,
): { givens: number[]; relations: number[] } | null {
  const n = w * h
  const m = relationsEdgeCount(w, h)
  if (typeof text !== 'string' || text.length !== n + m) return null
  const givens = new Array<number>(n).fill(EMPTY)
  const relations = new Array<number>(m).fill(REL_NONE)
  for (let i = 0; i < n; i++) {
    const v = text.charCodeAt(i) - 48
    if (v < 0 || v > 2) return null
    givens[i] = v
  }
  for (let i = 0; i < m; i++) {
    const v = text.charCodeAt(n + i) - 48
    if (v < 0 || v > 2) return null
    relations[i] = v
  }
  return { givens, relations }
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0' || ch === '.') out[i] = EMPTY
    else if (ch === '1' || ch === 'B' || ch === 'b' || ch === '#') out[i] = BLACK
    else if (ch === '2' || ch === 'W' || ch === 'w' || ch === 'o' || ch === 'O') out[i] = WHITE
    else return null
  }
  return out
}

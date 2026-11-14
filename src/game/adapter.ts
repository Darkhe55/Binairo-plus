/**
 * ════════════════════════════════════════════════════════════════════
 *  黑白+（Binairo+ / Tango）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 规则：
 *   1. 每行每列黑/白数量相同；
 *   2. 不能有三个及以上同色相连；
 *   3. "=" 同色，"×" 异色。
 *
 * 状态用 0/1/2：0 = 空，1 = 黑，2 = 白。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  BLACK,
  decodeBoard,
  encodeBoard,
  REL_NONE,
  relationsEdgeCount,
  WHITE,
  type BinairoPuzzle,
} from './types'

const meta = {
  title: '黑白+',
  tagline: '行列黑白等量、不出现三连 —— 再用 = 与 × 锁定每一对',
  footerNote:
    '规则：每行每列黑子与白子数量相同；不能有三个及以上同色圆点相连；标 "=" 的两格同色，标 "×" 的两格异色。预填格不能修改。',
  storageKeyPrefix: 'binairo-plus',
  customIdPrefix: 'binairo-plus-custom-',
  customMinW: 4,
  customMinH: 4,
  customMaxW: 12,
  customMaxH: 12,
}

const VALUE_CYCLE: Array<number | null> = [null, BLACK, WHITE]

function readGivens(value: unknown, size: number): number[] | null {
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (n !== 0 && n !== 1 && n !== 2) return null
      out.push(n)
    }
    return out
  }
  return null
}

const custom: CustomSupport = {
  valueCycle: VALUE_CYCLE,

  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit === BLACK) return BLACK
    if (digit === WHITE) return WHITE
    return undefined
  },

  cellLabel: (v) => (v === BLACK ? '黑' : v === WHITE ? '白' : '空'),

  cellClass: (v) => (v === BLACK ? 'v-black' : v === WHITE ? 'v-white' : ''),

  hint: '点格子循环：空 → 黑 → 白；键盘 1 填黑、2 填白、0 清空。自定义题板只支持预填格，关系线索留空。',

  makePuzzle: (w, h, grid, existingId) => {
    const givens = grid.map((v) => (v === BLACK || v === WHITE ? v : 0))
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      givens,
      relations: new Array<number>(relationsEdgeCount(w, h)).fill(REL_NONE),
    } satisfies BinairoPuzzle
  },

  encodePuzzle: (p) => {
    const bp = p as BinairoPuzzle
    return {
      board: encodeBoard(bp.givens ?? [], bp.relations ?? []),
    }
  },

  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null

    if (typeof record.board === 'string') {
      const decoded = decodeBoard(record.board, w, h)
      if (!decoded) return null
      return {
        id: record.id,
        name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
        width: w,
        height: h,
        difficulty: 'custom',
        givens: decoded.givens,
        relations: decoded.relations,
      } satisfies BinairoPuzzle
    }

    const givens = readGivens(record.givens, w * h)
    if (!givens) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      givens,
      relations: new Array<number>(relationsEdgeCount(w, h)).fill(REL_NONE),
    } satisfies BinairoPuzzle
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.from === 0) playPluck(streak, move.to === BLACK ? 1.1 : 0.9)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}

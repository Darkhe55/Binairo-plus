/**
 * 黑白+ —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import {
  asBinairoPuzzle,
  asBinairoState,
  BLACK,
  EMPTY,
  REL_DIFF,
  REL_SAME,
  WHITE,
  edgeCells,
  relationsEdgeCount,
  type BinairoResult,
  type DuplicateLineIssue,
  type LineIssue,
  type RelationIssue,
} from './types'
import { duplicateLines } from './rules'

export function validate(state: GameState, puzzle: Puzzle): BinairoResult {
  const s = asBinairoState(state)
  const p = asBinairoPuzzle(puzzle)
  const w = s.width
  const h = s.height
  const size = w * h
  const cells = s.cells
  const relations = p.relations ?? []

  let empty = 0
  const changed = new Set<number>()
  for (let i = 0; i < size; i++) {
    if (cells[i] === EMPTY) empty++
    const given = p.givens?.[i] ?? EMPTY
    if (given !== EMPTY && cells[i] !== given) changed.add(i)
  }

  const bad = new Set<number>()
  for (const i of changed) bad.add(i)

  let tripleCount = 0
  const tripleCells = new Set<number>()

  const checkTriple = (a: number, b: number, c: number): void => {
    if (cells[a] !== EMPTY && cells[a] === cells[b] && cells[a] === cells[c]) {
      tripleCount++
      tripleCells.add(a)
      tripleCells.add(b)
      tripleCells.add(c)
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + 2 < w; x++) {
      const a = y * w + x
      checkTriple(a, a + 1, a + 2)
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y + 2 < h; y++) {
      const a = y * w + x
      checkTriple(a, a + w, a + 2 * w)
    }
  }
  for (const i of tripleCells) bad.add(i)

  const rowTarget = w / 2
  const colTarget = h / 2
  const lineIssues: LineIssue[] = []

  for (let y = 0; y < h; y++) {
    let black = 0
    let white = 0
    for (let x = 0; x < w; x++) {
      const v = cells[y * w + x]
      if (v === BLACK) black++
      else if (v === WHITE) white++
    }
    const complete = black + white === w
    if (black > rowTarget || white > rowTarget || (complete && black !== rowTarget)) {
      lineIssues.push({ orientation: 'row', index: y, black, white })
      if (complete) for (let x = 0; x < w; x++) bad.add(y * w + x)
    }
  }
  for (let x = 0; x < w; x++) {
    let black = 0
    let white = 0
    for (let y = 0; y < h; y++) {
      const v = cells[y * w + x]
      if (v === BLACK) black++
      else if (v === WHITE) white++
    }
    const complete = black + white === h
    if (black > colTarget || white > colTarget || (complete && black !== colTarget)) {
      lineIssues.push({ orientation: 'col', index: x, black, white })
      if (complete) for (let y = 0; y < h; y++) bad.add(y * w + x)
    }
  }

  const dup = duplicateLines(cells, w, h)
  const duplicateLineIssues: DuplicateLineIssue[] = [
    ...dup.rows.map((index) => ({ orientation: 'row' as const, index })),
    ...dup.cols.map((index) => ({ orientation: 'col' as const, index })),
  ]
  for (const y of dup.rows) for (let x = 0; x < w; x++) bad.add(y * w + x)
  for (const x of dup.cols) for (let y = 0; y < h; y++) bad.add(y * w + x)

  const relationIssues: RelationIssue[] = []
  const m = relationsEdgeCount(w, h)
  for (let edge = 0; edge < m; edge++) {
    const rel = relations[edge] ?? 0
    if (rel !== REL_SAME && rel !== REL_DIFF) continue
    const pair = edgeCells(edge, w, h)
    if (!pair) continue
    const { a, b } = pair
    if (cells[a] === EMPTY || cells[b] === EMPTY) continue
    const same = cells[a] === cells[b]
    if ((rel === REL_SAME && !same) || (rel === REL_DIFF && same)) {
      relationIssues.push({ edge, a, b, expected: rel, actual: same ? REL_SAME : REL_DIFF })
      bad.add(a)
      bad.add(b)
    }
  }

  const complete = empty === 0
  const solved =
    complete &&
    tripleCount === 0 &&
    lineIssues.length === 0 &&
    duplicateLineIssues.length === 0 &&
    relationIssues.length === 0 &&
    changed.size === 0

  return {
    solved,
    empty,
    complete,
    tripleCount,
    tripleCells: Array.from(tripleCells),
    lineIssues,
    duplicateLines: duplicateLineIssues,
    relationIssues,
    badCells: Array.from(bad),
    changedGivens: Array.from(changed),
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as BinairoResult
  if (r.solved) return ['完成']

  const bits: string[] = []
  if (typeof r.empty === 'number' && r.empty > 0) bits.push(`还需填 ${r.empty} 格`)
  if (r.tripleCount > 0) bits.push(`${r.tripleCount} 处三连`)
  if (r.lineIssues.length > 0) {
    const rows = r.lineIssues.filter((x) => x.orientation === 'row').length
    const cols = r.lineIssues.length - rows
    if (rows > 0) bits.push(`${rows} 行数量不平衡`)
    if (cols > 0) bits.push(`${cols} 列数量不平衡`)
  }
  if (r.duplicateLines?.length > 0) {
    const rows = r.duplicateLines.filter((x) => x.orientation === 'row').length
    const cols = r.duplicateLines.length - rows
    if (rows > 0) bits.push(`${rows} 行与其它行重复`)
    if (cols > 0) bits.push(`${cols} 列与其它列重复`)
  }
  if (r.relationIssues.length > 0) bits.push(`${r.relationIssues.length} 处关系线索不满足`)
  if (r.changedGivens.length > 0) bits.push('题面预填格被改动')
  if (bits.length === 0) bits.push('继续填色')
  return bits
}

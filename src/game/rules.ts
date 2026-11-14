/**
 * 黑白+ —— 规则引擎
 *
 * R1 每行每列黑/白数量相同；
 * R2 不能有三个及以上同色相连；
 * R3 "=" 同色，"×" 异色。
 */

import {
  BLACK,
  EMPTY,
  REL_DIFF,
  REL_SAME,
  WHITE,
  edgeCells,
  relationsEdgeCount,
  type BinairoPuzzle,
} from './types.ts'

export type RuleKind = 'triple' | 'count' | 'relation'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

export function initialGrid(givens: ArrayLike<number>, size: number): number[] {
  const grid = new Array<number>(size).fill(EMPTY)
  for (let i = 0; i < size; i++) {
    const v = givens[i] ?? EMPTY
    if (v === BLACK || v === WHITE) grid[i] = v
  }
  return grid
}

function opposite(v: number): number {
  return v === BLACK ? WHITE : BLACK
}

export function propagate(
  cells: Int8Array | number[],
  relations: ArrayLike<number>,
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  const rowTarget = w / 2
  const colTarget = h / 2
  let changed = true

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== EMPTY) return false
    cells[i] = value
    onSet?.(i, value, kind)
    changed = true
    return true
  }

  while (changed) {
    changed = false

    // —— R2：三连 ——
    for (let y = 0; y < h; y++) {
      for (let x = 0; x + 2 < w; x++) {
        const a = y * w + x
        const b = a + 1
        const c = a + 2
        const quad = [a, b, c]
        const black = quad.filter((i) => cells[i] === BLACK).length
        const white = quad.filter((i) => cells[i] === WHITE).length
        if (black === 3 || white === 3) return false
        if (black === 2 && white === 0) {
          const empty = quad.find((i) => cells[i] === EMPTY)!
          if (!set(empty, WHITE, 'triple')) return false
        } else if (white === 2 && black === 0) {
          const empty = quad.find((i) => cells[i] === EMPTY)!
          if (!set(empty, BLACK, 'triple')) return false
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y + 2 < h; y++) {
        const a = y * w + x
        const b = a + w
        const c = a + 2 * w
        const quad = [a, b, c]
        const black = quad.filter((i) => cells[i] === BLACK).length
        const white = quad.filter((i) => cells[i] === WHITE).length
        if (black === 3 || white === 3) return false
        if (black === 2 && white === 0) {
          const empty = quad.find((i) => cells[i] === EMPTY)!
          if (!set(empty, WHITE, 'triple')) return false
        } else if (white === 2 && black === 0) {
          const empty = quad.find((i) => cells[i] === EMPTY)!
          if (!set(empty, BLACK, 'triple')) return false
        }
      }
    }

    // —— R1：行列等量 ——
    for (let y = 0; y < h; y++) {
      let black = 0
      let white = 0
      const empties: number[] = []
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (cells[i] === BLACK) black++
        else if (cells[i] === WHITE) white++
        else empties.push(i)
      }
      if (black > rowTarget || white > rowTarget) return false
      if (black === rowTarget) {
        for (const i of empties) if (!set(i, WHITE, 'count')) return false
      } else if (white === rowTarget) {
        for (const i of empties) if (!set(i, BLACK, 'count')) return false
      }
    }
    for (let x = 0; x < w; x++) {
      let black = 0
      let white = 0
      const empties: number[] = []
      for (let y = 0; y < h; y++) {
        const i = y * w + x
        if (cells[i] === BLACK) black++
        else if (cells[i] === WHITE) white++
        else empties.push(i)
      }
      if (black > colTarget || white > colTarget) return false
      if (black === colTarget) {
        for (const i of empties) if (!set(i, WHITE, 'count')) return false
      } else if (white === colTarget) {
        for (const i of empties) if (!set(i, BLACK, 'count')) return false
      }
    }

    // —— R3：关系线索 ——
    const m = relationsEdgeCount(w, h)
    for (let edge = 0; edge < m; edge++) {
      const rel = relations[edge] ?? 0
      if (rel !== REL_SAME && rel !== REL_DIFF) continue
      const pair = edgeCells(edge, w, h)
      if (!pair) continue
      const { a, b } = pair
      if (rel === REL_SAME) {
        if (cells[a] !== EMPTY && cells[b] !== EMPTY) {
          if (cells[a] !== cells[b]) return false
        } else if (cells[a] !== EMPTY) {
          if (!set(b, cells[a]!, 'relation')) return false
        } else if (cells[b] !== EMPTY) {
          if (!set(a, cells[b]!, 'relation')) return false
        }
      } else {
        if (cells[a] !== EMPTY && cells[b] !== EMPTY) {
          if (cells[a] === cells[b]) return false
        } else if (cells[a] !== EMPTY) {
          if (!set(b, opposite(cells[a]!), 'relation')) return false
        } else if (cells[b] !== EMPTY) {
          if (!set(a, opposite(cells[b]!), 'relation')) return false
        }
      }
    }
  }

  return true
}

export function isValidSolution(
  cells: ArrayLike<number>,
  relations: ArrayLike<number>,
  w: number,
  h: number,
): boolean {
  const n = w * h
  for (let i = 0; i < n; i++) {
    if (cells[i] !== BLACK && cells[i] !== WHITE) return false
  }

  const rowTarget = w / 2
  const colTarget = h / 2
  for (let y = 0; y < h; y++) {
    let black = 0
    for (let x = 0; x < w; x++) if (cells[y * w + x] === BLACK) black++
    if (black !== rowTarget) return false
  }
  for (let x = 0; x < w; x++) {
    let black = 0
    for (let y = 0; y < h; y++) if (cells[y * w + x] === BLACK) black++
    if (black !== colTarget) return false
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x + 2 < w; x++) {
      const a = y * w + x
      if (cells[a] === cells[a + 1] && cells[a] === cells[a + 2]) return false
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y + 2 < h; y++) {
      const a = y * w + x
      if (cells[a] === cells[a + w] && cells[a] === cells[a + 2 * w]) return false
    }
  }

  const m = relationsEdgeCount(w, h)
  for (let edge = 0; edge < m; edge++) {
    const rel = relations[edge] ?? 0
    if (rel !== REL_SAME && rel !== REL_DIFF) continue
    const pair = edgeCells(edge, w, h)
    if (!pair) continue
    const same = cells[pair.a] === cells[pair.b]
    if (rel === REL_SAME && !same) return false
    if (rel === REL_DIFF && same) return false
  }
  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

export function solveByRules(
  puzzle: Pick<BinairoPuzzle, 'givens' | 'relations' | 'width' | 'height'>,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const { width: w, height: h } = puzzle
  const size = w * h
  const grid = initialGrid(puzzle.givens, size)
  let usedProbing = false

  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, puzzle.relations, w, h)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }

    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, puzzle.relations, w, h)
      return {
        ok,
        solution: ok ? solution : null,
        contradiction: false,
        saturated: ok,
        usedProbing,
      }
    }

    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }

    usedProbing = true
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let blackImpossible = false
      let whiteImpossible = false
      {
        const trial = Int8Array.from(grid)
        trial[i] = BLACK
        if (!propagate(trial, puzzle.relations, w, h)) blackImpossible = true
      }
      {
        const trial = Int8Array.from(grid)
        trial[i] = WHITE
        if (!propagate(trial, puzzle.relations, w, h)) whiteImpossible = true
      }
      if (blackImpossible && whiteImpossible) {
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (blackImpossible !== whiteImpossible) {
        forced.push({ index: i, value: blackImpossible ? WHITE : BLACK })
      }
    }

    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) grid[index] = value
    }
  }

  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}

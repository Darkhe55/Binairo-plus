/**
 * 黑白+ —— 逻辑解题回放计划
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { isValidSolution, propagate, type RuleKind } from './rules'
import { countSolutions } from './solver'
import {
  asBinairoPuzzle,
  asBinairoState,
  BLACK,
  EMPTY,
  WHITE,
  type BinairoState,
} from './types'

const RULE_INFO: Record<RuleKind | 'probe' | 'search', { rule: number; label: string }> = {
  triple: { rule: 1, label: '不能有三个同色相连' },
  count: { rule: 2, label: '每行每列黑白数量相同' },
  unique: { rule: 3, label: '任意两行、两列不能完全相同' },
  relation: { rule: 4, label: '关系线索：= 同色，× 异色' },
  probe: { rule: 5, label: '反证：另一种颜色会立刻矛盾' },
  search: { rule: 6, label: '回溯试探：该格最终是这一色' },
}

function fallbackSolve(
  grid: number[],
  relations: ArrayLike<number>,
  w: number,
  h: number,
  maxNodes: number,
): number[] | null {
  const size = w * h
  let nodes = 0
  let timedOut = false
  const work = grid.slice()

  const dfs = (): number[] | null => {
    if (timedOut) return null
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return null
    }
    if (!propagate(work, relations, w, h)) return null

    let choice = -1
    for (let i = 0; i < size; i++) {
      if (work[i] === EMPTY) {
        choice = i
        break
      }
    }
    if (choice < 0) return isValidSolution(work, relations, w, h) ? Array.from(work) : null

    const backup = work.slice()
    for (const value of [BLACK, WHITE] as const) {
      work[choice] = value
      const found = dfs()
      if (found) return found
      for (let i = 0; i < size; i++) work[i] = backup[i]!
      if (timedOut) return null
    }
    return null
  }

  return dfs()
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asBinairoPuzzle(puzzle)
  const s = asBinairoState(initialState)
  const w = s.width
  const h = s.height
  const size = w * h
  const relations = p.relations ?? []

  const emptyPlan: LogicPlan = {
    puzzleId: p.id,
    frames: [],
    finalState: null,
    ruleSteps: 0,
    saturated: false,
  }
  if (relations.length !== (w > 1 ? h * (w - 1) : 0) + (h > 1 ? (h - 1) * w : 0)) {
    return emptyPlan
  }

  const grid = s.cells.slice()
  const displayed = s.cells.slice()
  const frames: PlaybackFrame[] = []
  let lastKind = ''
  let streak = 0

  const emit = (index: number, to: number, kind: RuleKind | 'probe' | 'search'): void => {
    const from = displayed[index] ?? EMPTY
    if (from === to) return
    displayed[index] = to
    if (kind === lastKind) streak++
    else {
      lastKind = kind
      streak = 1
    }
    const info = RULE_INFO[kind]
    frames.push({ rule: info.rule, label: info.label, move: { index, from, to }, streak })
  }

  const onSet = (index: number, value: number, kind: RuleKind): void => {
    emit(index, value, kind)
  }

  if (!propagate(grid, relations, w, h, onSet)) return emptyPlan

  let saturated = true
  for (let round = 0; round < size * 2; round++) {
    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) break
    if (frames.length > 8000) {
      saturated = false
      break
    }

    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let blackImpossible = false
      let whiteImpossible = false
      {
        const trial = Int8Array.from(grid)
        trial[i] = BLACK
        if (!propagate(trial, relations, w, h)) blackImpossible = true
      }
      {
        const trial = Int8Array.from(grid)
        trial[i] = WHITE
        if (!propagate(trial, relations, w, h)) whiteImpossible = true
      }
      if (blackImpossible && whiteImpossible) return emptyPlan
      if (blackImpossible !== whiteImpossible) {
        forced.push({ index: i, value: blackImpossible ? WHITE : BLACK })
      }
    }

    if (!forced.length) {
      saturated = false
      break
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) {
        grid[index] = value
        emit(index, value, 'probe')
      }
    }
    if (!propagate(grid, relations, w, h, onSet)) return emptyPlan
  }

  let stillUnknown = false
  for (let i = 0; i < size; i++) {
    if (grid[i] === EMPTY) {
      stillUnknown = true
      break
    }
  }

  if (stillUnknown) {
    // 规则推不动时不能直接猜：先确认剩余空格在规则下是否只有唯一填法。
    // 多解题若强行回溯，会填入某一个合法解，但在用户看来就是「错解」。
    const counted = countSolutions(
      { givens: grid, relations, width: w, height: h },
      2,
      400_000,
    )
    if (counted.timedOut || counted.count > 1) {
      saturated = false
    } else if (counted.count === 0) {
      return emptyPlan
    } else {
      const found = fallbackSolve(grid, relations, w, h, 800_000)
      if (!found) return emptyPlan
      for (let i = 0; i < size; i++) {
        if (grid[i] === found[i]) continue
        grid[i] = found[i]!
        emit(i, found[i]!, 'search')
      }
      saturated = false
    }
  }

  const finalState: BinairoState = {
    puzzleId: s.puzzleId,
    width: w,
    height: h,
    cells: Array.from(grid),
    givens: s.givens.slice(),
  }

  return {
    puzzleId: p.id,
    frames,
    finalState,
    ruleSteps: frames.length,
    saturated,
  }
}

/**
 * 黑白+ —— 回溯求解器
 */

import type { Puzzle, SolveResult } from '../core/types'
import { initialGrid, isValidSolution, propagate, solveByRules } from './rules.ts'
import {
  BLACK,
  EMPTY,
  WHITE,
  type BinairoPuzzle,
  type BinairoState,
} from './types.ts'

export interface CountOutcome {
  count: number
  nodes: number
  timedOut: boolean
}

function search(
  puzzle: Pick<BinairoPuzzle, 'givens' | 'relations' | 'width' | 'height'>,
  limit: number,
  maxNodes: number,
): { solutions: number[][]; nodes: number; timedOut: boolean } {
  const { width: w, height: h } = puzzle
  const size = w * h
  const grid = initialGrid(puzzle.givens, size)
  const solutions: number[][] = []
  let nodes = 0
  let timedOut = false

  const dfs = (): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return
    }
    if (!propagate(grid, puzzle.relations, w, h)) return

    let choice = -1
    let best = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let score = 0
      const x = i % w
      const y = (i / w) | 0
      if (x > 0 && grid[i - 1] !== EMPTY) score++
      if (x + 1 < w && grid[i + 1] !== EMPTY) score++
      if (y > 0 && grid[i - w] !== EMPTY) score++
      if (y + 1 < h && grid[i + w] !== EMPTY) score++
      if (score > best) {
        best = score
        choice = i
      }
    }

    if (choice < 0) {
      if (isValidSolution(grid, puzzle.relations, w, h)) solutions.push(Array.from(grid))
      return
    }

    const backup = Array.from(grid)
    for (const value of [BLACK, WHITE] as const) {
      if (solutions.length >= limit || timedOut) return
      grid[choice] = value
      dfs()
      for (let i = 0; i < size; i++) grid[i] = backup[i]!
    }
  }

  dfs()
  return { solutions, nodes, timedOut }
}

export function countSolutions(
  puzzle: Pick<BinairoPuzzle, 'givens' | 'relations' | 'width' | 'height'>,
  limit = 2,
  maxNodes = 300_000,
): CountOutcome {
  const out = search(puzzle, limit, maxNodes)
  return { count: out.solutions.length, nodes: out.nodes, timedOut: out.timedOut }
}

export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const p = puzzle as BinairoPuzzle
  if (!p.givens || !p.relations) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }

  const byRules = solveByRules(p, true, 240)
  if (byRules.ok && byRules.solution) {
    return {
      solved: true,
      solution: makeState(p, byRules.solution),
      nodes: 0,
      timedOut: false,
    }
  }
  if (byRules.contradiction) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }

  const out = search(p, 1, maxNodes)
  const solution = out.solutions[0]
  return {
    solved: !!solution,
    solution: solution ? makeState(p, solution) : null,
    nodes: out.nodes,
    timedOut: out.timedOut,
  }
}

export function makeState(puzzle: BinairoPuzzle, cells: number[]): BinairoState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: puzzle.givens.slice(),
  }
}

/**
 * 黑白+ —— 题库加载
 */

import { RAW_PUZZLES } from './puzzles-data'
import {
  asBinairoPuzzle,
  decodeBoard,
  decodeCells,
  type BinairoPuzzle,
  type BinairoState,
} from './types'

export const builtinPuzzles: BinairoPuzzle[] = []
const solutions = new Map<string, number[]>()

for (const raw of RAW_PUZZLES) {
  const decoded = decodeBoard(raw.board, raw.width, raw.height)
  if (!decoded) {
    console.warn(`[黑白+] 题面解码失败：${raw.id}`)
    continue
  }
  const puzzle: BinairoPuzzle = {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    givens: decoded.givens,
    relations: decoded.relations,
  }
  builtinPuzzles.push(puzzle)
  if (raw.solution) {
    const solution = decodeCells(raw.solution, raw.width * raw.height)
    if (solution) {
      puzzle.solution = solution
      solutions.set(raw.id, solution)
    }
  }
}

export function getReferenceSolution(id: string): BinairoState | null {
  const cells = solutions.get(id)
  if (!cells) return null
  const puzzle = builtinPuzzles.find((p) => p.id === id)
  if (!puzzle) return null
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: puzzle.givens.slice(),
  }
}

export function puzzleById(id: string): BinairoPuzzle | undefined {
  return builtinPuzzles.find((p) => p.id === id)
}

export function referenceFor(puzzle: BinairoPuzzle): number[] | null {
  return asBinairoPuzzle(puzzle).solution ?? solutions.get(puzzle.id) ?? null
}

export function emptyStateFor(puzzle: BinairoPuzzle): BinairoState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: puzzle.givens.slice(),
    givens: puzzle.givens.slice(),
  }
}

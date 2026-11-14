/**
 * 黑白+ —— SVG 渲染与命中
 */

import type { BoardMetrics, GameState, Puzzle, ValidationResult } from '../core/types'
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
} from './types'

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const cell = 50
  const pad = Math.round(cell * 0.44)
  return {
    cell,
    pad,
    width: puzzle.width,
    height: puzzle.height,
    svgWidth: pad * 2 + puzzle.width * cell,
    svgHeight: pad * 2 + puzzle.height * cell,
    k: 1,
  }
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const m = metricsFor(puzzle)
  const p = asBinairoPuzzle(puzzle)
  const s = asBinairoState(state)
  const r = result as BinairoResult
  const w = puzzle.width
  const h = puzzle.height

  const bad = new Set<number>(r.badCells ?? [])
  const gap = Math.max(2, m.cell * 0.06)
  const inner = m.cell - gap
  const radius = m.cell * 0.16

  const parts: string[] = []
  parts.push(
    `<rect class="bp-board-bg" x="${m.pad - 9}" y="${m.pad - 9}" width="${w * m.cell + 18}" height="${h * m.cell + 18}" rx="${(m.cell * 0.22).toFixed(2)}" />`,
  )

  for (let i = 0; i < w * h; i++) {
    const x = m.pad + (i % w) * m.cell + gap / 2
    const y = m.pad + Math.floor(i / w) * m.cell + gap / 2
    const v = s.cells[i] ?? EMPTY
    const given = (s.givens[i] ?? EMPTY) !== EMPTY

    let cls = 'bp-cell'
    if (v === BLACK) cls += ' black'
    else if (v === WHITE) cls += ' white'
    else cls += ' empty'
    if (given) cls += ' given'
    if (bad.has(i)) cls += ' bad'

    let content = `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${radius.toFixed(2)}" />`

    if (v === BLACK || v === WHITE) {
      content += `<circle class="bp-dot ${v === BLACK ? 'black' : 'white'}" cx="${(x + inner / 2).toFixed(2)}" cy="${(y + inner / 2).toFixed(2)}" r="${(inner * 0.34).toFixed(2)}" />`
    }
    if (given) {
      content += `<circle class="bp-given-ring" cx="${(x + inner / 2).toFixed(2)}" cy="${(y + inner / 2).toFixed(2)}" r="${(inner * 0.43).toFixed(2)}" />`
    }

    if (bad.has(i)) {
      content += `<rect class="bp-error" x="${(x + 1.2).toFixed(2)}" y="${(y + 1.2).toFixed(2)}" width="${(inner - 2.4).toFixed(2)}" height="${(inner - 2.4).toFixed(2)}" rx="${(radius * 0.8).toFixed(2)}" />`
    }

    parts.push(`<g data-index="${i}">${content}</g>`)
  }

  // —— 关系线索 ——
  const relations = p.relations ?? []
  const relParts: string[] = []
  const mEdges = relationsEdgeCount(w, h)
  for (let edge = 0; edge < mEdges; edge++) {
    const rel = relations[edge] ?? 0
    if (rel !== REL_SAME && rel !== REL_DIFF) continue
    const pair = edgeCells(edge, w, h)
    if (!pair) continue
    const { a, b } = pair
    const ax = m.pad + (a % w) * m.cell + m.cell / 2
    const ay = m.pad + Math.floor(a / w) * m.cell + m.cell / 2
    const bx = m.pad + (b % w) * m.cell + m.cell / 2
    const by = m.pad + Math.floor(b / w) * m.cell + m.cell / 2
    const cx = (ax + bx) / 2
    const cy = (ay + by) / 2
    const label = rel === REL_SAME ? '=' : '×'
    relParts.push(
      `<g class="bp-relation ${rel === REL_SAME ? 'same' : 'diff'}"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(m.cell * 0.15).toFixed(2)}" /><text x="${cx.toFixed(2)}" y="${(cy + 0.5).toFixed(2)}" style="font-size:${(m.cell * 0.22).toFixed(2)}px">${label}</text></g>`,
    )
  }
  parts.push(`<g class="bp-relations">${relParts.join('')}</g>`)

  // —— 命中层 ——
  for (let i = 0; i < w * h; i++) {
    parts.push(
      `<rect class="cell-hit" data-index="${i}" x="${(m.pad + (i % w) * m.cell).toFixed(2)}" y="${(m.pad + Math.floor(i / w) * m.cell).toFixed(2)}" width="${m.cell.toFixed(2)}" height="${m.cell.toFixed(2)}" />`,
    )
  }

  return `<svg class="board-svg bp-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(
  m: BoardMetrics,
  puzzle: Puzzle,
  x: number,
  y: number,
): { index: number } | null {
  const col = Math.floor((x - m.pad) / m.cell)
  const row = Math.floor((y - m.pad) / m.cell)
  if (col < 0 || row < 0 || col >= puzzle.width || row >= puzzle.height) return null
  return { index: row * puzzle.width + col }
}

/**
 * 黑白+题库生成配置
 *
 * 生成器题库 + 图片识别导入的题库（scripts/printed-puzzles.json）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { generatePuzzles as generate } from '../src/game/generator.ts'

export const NAME = '黑白+生成器'

const IMPORT_FILE = new URL('./printed-puzzles.json', import.meta.url)

function importedPuzzles() {
  if (!existsSync(IMPORT_FILE)) return []
  const list = JSON.parse(readFileSync(IMPORT_FILE, 'utf8'))
  return Array.isArray(list) ? list : []
}

export function generatePuzzles() {
  const generated = generate()
  const ids = new Set(generated.map((p) => p.id))
  return [...generated, ...importedPuzzles().filter((p) => p && !ids.has(p.id))]
}

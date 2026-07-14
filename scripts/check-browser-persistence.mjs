import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const forbidden = /\b(?:window\.)?(?:localStorage|sessionStorage)\s*[.[]|\bindexedDB\s*[.[]|\bcaches\.open\s*\(/

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(target))
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) files.push(target)
  }
  return files
}

const violations = []
for (const file of await walk(fileURLToPath(new URL('../src', import.meta.url)))) {
  const source = await readFile(file, 'utf8')
  if (forbidden.test(source)) violations.push(file)
}

if (violations.length) {
  console.error(`Browser persistence is forbidden:\n${violations.join('\n')}`)
  process.exit(1)
}

console.log('Browser persistence guard passed.')

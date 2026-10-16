// Drives the guide bench through its run-folder cases with the stand-in `claude` in this folder, so
// they are checked without a model call. Exits 1 on the first case that does not hold.
//   bun bench/stub/check.ts
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STUB = new URL('.', import.meta.url).pathname
const AB = new URL('../ab.ts', import.meta.url).pathname
const scratch = mkdtempSync(join(tmpdir(), 'cc-stretch-bench-check-'))
const guide = (name: string, text: string) => {
  const file = join(scratch, `${name}.txt`)
  writeFileSync(file, text)
  return `${name}=${file}`
}
const GUIDE_A = guide('a', 'Write stretchtext.')
const GUIDE_B = guide('b', 'Write stretchtext, differently.')

/** Runs the bench with the stand-in first on PATH; returns its exit status and output. */
function bench(args: string[], env: Record<string, string> = {}) {
  const run = spawnSync('bun', [AB, ...args], { encoding: 'utf8', env: { ...process.env, ...env, PATH: `${STUB}:${process.env.PATH ?? ''}` } })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}
const tasks = (out: string, arm = GUIDE_A, env: Record<string, string> = {}) =>
  bench(['tasks', '--out', out, '--arm', arm, '--limit', '2', '--writer', 'opus', '--judge', 'haiku', '--concurrency', '2'], env)
const rowsIn = (out: string, file: string) =>
  readFileSync(join(out, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { status: string; reason?: string })
const snapshot = (out: string) =>
  readdirSync(out).sort().map(name => `${name}:${createHash('sha256').update(readFileSync(join(out, name))).digest('hex')}`).join('\n')

let failed = 0
function check(name: string, holds: boolean, detail: string) {
  console.log(`${holds ? 'ok  ' : 'FAIL'} ${name}`)
  if (!holds) {
    failed += 1
    console.log(detail.split('\n').map(line => `     ${line}`).join('\n'))
  }
}

// A fresh run freezes its inputs and grades every answer.
const fresh = join(scratch, 'fresh')
let r = tasks(fresh)
const ok = (out: string, file: string) => rowsIn(out, file).filter(row => row.status === 'ok').length
check('a fresh run writes a manifest, two answers and two grades', r.status === 0 && ok(fresh, 'answers.jsonl') === 2 && ok(fresh, 'graded.jsonl') === 2, r.output)

// A resume with the same inputs has nothing left to do.
const before = snapshot(fresh)
r = tasks(fresh)
check('a resume with the same inputs adds no row', r.status === 0 && snapshot(fresh) === before, r.output)

// A resume with another guide is refused before any call, and changes no file.
r = tasks(fresh, GUIDE_B)
check('a resume with another guide is refused and changes nothing', r.status === 1 && /these differ: arms\.b, arms\.a|these differ: arms\.a, arms\.b/.test(r.output) && snapshot(fresh) === before, r.output)

// So is a resume under another version of Claude Code.
r = tasks(fresh, GUIDE_A, { STUB_VERSION: '9.9.10 (Claude Code)' })
check('a resume under another Claude Code version is refused', r.status === 1 && r.output.includes('claude') && snapshot(fresh) === before, r.output)

// A judge answering outside its words, in its key verdicts or in its labels, leaves failures and
// never grades; a resume with a sound judge grades them.
for (const garbled of ['key', 'labels']) {
  const junk = join(scratch, `junk-${garbled}`)
  r = tasks(junk, GUIDE_A, { STUB_JUDGE: garbled })
  check(`a judge confused in its ${garbled} leaves failure rows and no grade`, r.status === 1 && ok(junk, 'graded.jsonl') === 0 && rowsIn(junk, 'graded.jsonl').every(row => row.status === 'error'), r.output)
  r = tasks(junk)
  check(`after confused ${garbled}, a resume with a sound judge grades what failed`, r.status === 0 && ok(junk, 'graded.jsonl') === 2, r.output)
}

// A call answered by another model stops the run and grades nothing from it.
const changed = join(scratch, 'changed')
r = tasks(changed, GUIDE_A, { STUB_FAIL_MATCH: 'parseDate' })
check('a refused writer call leaves a failure row', r.status === 1 && rowsIn(changed, 'answers.jsonl').some(row => row.status === 'error'), r.output)
r = tasks(changed, GUIDE_A, { STUB_RESOLVE: '-v2' })
check('a writer answering as another model stops the run', r.status === 1 && rowsIn(changed, 'answers.jsonl').some(row => row.reason?.startsWith('model changed') === true), r.output)

// A report skips a last line cut short by an interrupted write, and says so.
appendFileSync(join(fresh, 'answers.jsonl'), '{"arm":"a","repeat":1,"id":"cut')
r = bench(['tasks-report', '--out', fresh])
check('a report skips a cut last line and says so', r.status === 0 && r.output.includes('cut short') && r.output.includes('2 of 2 tasks graded'), r.output)

// A folder from before manifests, or with an unreadable one, is refused.
const old = join(scratch, 'old')
spawnSync('mkdir', ['-p', old])
writeFileSync(join(old, 'answers.jsonl'), '{"arm":"a","repeat":1,"id":"brief","text":"x"}\n')
r = tasks(old)
check('a folder holding rows but no manifest is refused', r.status === 1 && r.output.includes('before run manifests'), r.output)
const broken = join(scratch, 'broken')
spawnSync('mkdir', ['-p', broken])
writeFileSync(join(broken, 'manifest.json'), '{"command":"tasks"}')
r = tasks(broken)
check('an unreadable manifest is refused', r.status === 1 && r.output.includes('not a guide bench manifest'), r.output)

console.log(failed === 0 ? `all cases hold (scratch: ${scratch})` : `${failed} cases failed (scratch: ${scratch})`)
process.exit(failed === 0 ? 0 : 1)

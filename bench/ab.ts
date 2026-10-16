// Compares guides on one frozen set of real replies. Each guide (an arm) rewrites every reply in the
// corpus, several times; each rewrite is then measured: how much of it the reader sees first, where
// its stretches add words around the short form, how many short forms are only labels, and how many
// of the reply's must-know points a blind reader of the shortest version still takes away.
//   bun bench/ab.ts corpus --per-project 15 <~/.claude/projects/<dir>>...      freezes bench/out/corpus.jsonl
//   bun bench/ab.ts run --out <dir> --arm <variant>... [--repeats 3] [--writer haiku]
//                        [--judge haiku] [--effort <level>] [--concurrency 4] [--limit n]
//   bun bench/ab.ts report --out <dir>                                          prints the comparison
// The tasks commands compare guides on replies written from scratch instead: each arm answers every
// task in tasks.ts, and a judge checks each answer, closed and open, against the task's key. Haiku
// writes no stretch unless a prompt asks for them (as of Claude Code 2.1.301), so it cannot write here.
//   bun bench/ab.ts tasks --out <dir> --arm <variant>... [--repeats 1] [--writer opus]
//                         [--judge haiku] [--effort <level>] [--concurrency 4] [--limit n]
//   bun bench/ab.ts tasks-report --out <dir>                                    prints the comparison
// An arm is a guide variant named in guides.ts. A run's first start freezes its inputs in <dir>/manifest.json; a later start with the same inputs
// resumes where it stopped, and one with any other input is refused before a single call.
// Calls `claude -p` in safe mode, so the person's own CLAUDE.md files, skills and plugins stay out.
// Runs under bun, as the plugin's hooks import each other without file extensions. Raw text stays in
// bench/out/, which git ignores.
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { growthOf } from '../hooks/grow.ts'
import { drawnAs, parse, stretches } from '../hooks/parse.ts'
import { VARIANTS } from './guides.ts'
import { ANSWER, CHECK, claimsOf, gradesOf, KEY, LABELS, POINTS, READ, readChecks, readKey, readLabels, readPoints, resultOf, REWRITE } from './grading.ts'
import type { Claim, Grade } from './grading.ts'
import { differences, readManifest, rowsOf } from './manifest.ts'
import type { Manifest } from './manifest.ts'
import { draw, render, words } from './measure.ts'
import { verdictsOf } from './rules.ts'
import type { RuleId } from './rules.ts'
import { TASKS } from './tasks.ts'
import type { Task } from './tasks.ts'
import { turnsOf } from './transcripts.ts'

const CORPUS = new URL('./out/corpus.jsonl', import.meta.url)
const REPO = new URL('..', import.meta.url).pathname
const MIN_WORDS = 40
/** A rewrite keeping less of the original's content words than this is broken (a refusal, a summary), not shorter. */
const VALID_RECALL = 0.9
/** Calls failing in a row before the run stops: a spent usage limit or a lost login fails every call. */
const MAX_FAILURES = 8

type Reply = { id: string; project: string; session: string; turn: number; reply: string }
type Role = 'writer' | 'judge'

const args = process.argv.slice(2)
const command = args.shift()
const take = (name: string) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args.splice(at, 2)[1]
}
const takeAll = (name: string) => {
  const found: string[] = []
  for (let value = take(name); value !== undefined; value = take(name)) found.push(value)
  return found
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

// ---- Run folders -------------------------------------------------------------------------------

const get = (row: unknown, key: string): unknown => (typeof row === 'object' && row !== null ? Reflect.get(row, key) : undefined)
const keyOf = (row: unknown) => `${String(get(row, 'arm'))}|${String(get(row, 'repeat'))}|${String(get(row, 'id'))}`
const isOk = (row: unknown) => get(row, 'status') === 'ok'
const modelsOf = (row: unknown) => {
  const models = get(row, 'models')
  return Array.isArray(models) && models.every(m => typeof m === 'string') ? models : undefined
}
const textOf = (row: unknown) => {
  const text = get(row, 'text')
  return typeof text === 'string' ? text : undefined
}

/** The rows of one of a run's files; a line cut short by an interrupted write is skipped and reported. */
function rows(file: string | URL): unknown[] {
  if (!existsSync(file)) return []
  const { rows: found, isCut } = rowsOf(readFileSync(file, 'utf8'))
  if (isCut) console.error(`${String(file)}: skipped its last line, cut short by an interrupted write`)
  return found
}

/** The manifest these inputs make, with the version of Claude Code and the revision they run against. */
function manifestOf(fields: Omit<Manifest, 'claude' | 'revision'>): Manifest {
  const claude = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim()
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()
  const isDirty = execFileSync('git', ['status', '--porcelain', '--', 'hooks', 'bench'], { cwd: REPO, encoding: 'utf8' }).trim() !== ''
  return { ...fields, claude, revision: { commit, isDirty } }
}

/**
 * Starts the run in `out` with `current`, or resumes it when its manifest holds the same inputs.
 * Anything else stops before a call and changes no file.
 */
function openRun(out: string, current: Manifest, guides: Record<string, string>): void {
  mkdirSync(out, { recursive: true })
  const file = join(out, 'manifest.json')
  if (existsSync(file)) {
    let frozen: Manifest
    try {
      frozen = readManifest(readFileSync(file, 'utf8'))
    } catch (error) {
      return fail(`${file}: ${(error as Error).message}`)
    }
    const changed = differences(frozen, current)
    if (changed.length > 0) fail(`${out} was started with other inputs, and these differ: ${changed.join(', ')}. Start a new --out.`)
    return
  }
  if (readdirSync(out).some(name => name.endsWith('.jsonl'))) fail(`${out} holds rows from before run manifests, which cannot be checked. Start a new --out.`)
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { flag: 'wx' })
  for (const [arm, text] of Object.entries(guides)) writeFileSync(join(out, `guide-${arm}.txt`), text, { flag: 'wx' })
}

/** The run in `out`, as its manifest froze it; a report reads nothing else for its inputs. */
function frozenRun(out: string): Manifest {
  const file = join(out, 'manifest.json')
  if (!existsSync(file)) return fail(`${out} has no manifest.json: it was not started by this runner, or holds rows from before run manifests.`)
  try {
    return readManifest(readFileSync(file, 'utf8'))
  } catch (error) {
    return fail(`${file}: ${(error as Error).message}`)
  }
}

// ---- Claude ----------------------------------------------------------------------------------

let failures = 0
let isHalted = false
/** The models each role has answered with in this run, so a call answered by another stops it. */
const answeredBy: Partial<Record<Role, string>> = {}
/** An empty folder outside any repository: Claude Code puts the working folder's git status in its prompt. */
const BLANK = mkdtempSync(join(tmpdir(), 'cc-stretch-bench-'))

/** Notes the models in `found` as the ones `role` answers with, from rows already in the run. */
function noteModels(role: Role, found: unknown[]) {
  for (const row of found) {
    const models = modelsOf(row)
    if (isOk(row) && models !== undefined) answeredBy[role] ??= models.join(',')
  }
}

/** One `claude -p` answer and the models that gave it. Stdin is closed at once, so Claude Code does not wait for piped input. */
function claude(role: Role, model: string, prompt: string, options: { system?: string; effort?: string } = {}): Promise<{ text: string; models: string[] }> {
  const flags = ['-p', '--model', model, '--safe-mode', '--no-session-persistence', '--tools', '', '--output-format', 'json']
  if (options.effort !== undefined) flags.push('--effort', options.effort)
  if (options.system !== undefined) flags.push('--append-system-prompt', options.system)
  return new Promise((resolve, reject) => {
    const child = execFile('claude', [...flags, prompt], { maxBuffer: 1 << 26, timeout: 900000, cwd: BLANK }, (error, stdout) => {
      try {
        const answer = resultOf(stdout)
        const models = answer.models.join(',')
        if ((answeredBy[role] ??= models) !== models) {
          isHalted = true
          throw new Error(`model changed: the ${role} answered as ${models}, not ${answeredBy[role] ?? ''}`)
        }
        failures = 0
        resolve(answer)
      } catch (parsing) {
        failures += 1
        const killed = error?.killed === true ? `killed (${error.signal ?? 'timeout'}) after the time limit` : undefined
        reject(new Error(killed ?? (parsing as Error).message))
      }
    })
    child.stdin?.end()
  })
}

// ---- Measures ----------------------------------------------------------------------------------

/** The skim with each top-level link's short form numbered, and its long forms in that order. */
function marked(text: string): { skim: string; longs: string[] } {
  const longs: string[] = []
  const skim = parse(text)
    .map(part => {
      if (typeof part === 'string') return part
      if (drawnAs(part) !== 'link') return draw([part], new Set())
      longs.push(draw(part.long ?? [], 'all'))
      return `⟦${longs.length}⟧${part.short}⟦/${longs.length}⟧`
    })
    .join('')
  return { skim, longs }
}

/** How many of the original's content words (four letters or more) the full rewrite still has. */
function recall(original: string, full: string): number {
  const bag = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}_'-]{4,}/gu) ?? [])
  const before = bag(original), after = bag(full)
  return before.size === 0 ? 1 : [...before].filter(w => after.has(w)).length / before.size
}

/** What the reader faces in one rewrite, from its text alone. */
function shape(original: string, text: string) {
  const all = stretches(parse(text)).filter(s => drawnAs(s) === 'link')
  const sides = { before: 0, between: 0, after: 0 }
  let rightOnly = 0
  let colon = 0
  for (const s of all) {
    const g = growthOf(s.short, s.long ?? [])
    sides.before += g.before
    sides.between += g.between
    sides.after += g.after
    if (g.before === 0 && g.between === 0 && g.after > 0) rightOnly += 1
    const short = s.short.trim().replace(/[.:]+$/, '').toLowerCase()
    if (short !== '' && draw(s.long ?? [], 'all').trim().toLowerCase().startsWith(`${short}:`)) colon += 1
  }
  return {
    original: words(original),
    skim: words(render(text, new Set())),
    full: words(render(text, 'all')),
    recall: recall(original, render(text, 'all')),
    stretches: all.length,
    rightOnly,
    colon,
    sides,
  }
}

/** How many marked phrases the judge calls labels, and how many top-level links there are. */
async function labelsIn(judge: string, text: string): Promise<{ labels: number; topLevel: number }> {
  const { skim, longs } = marked(text)
  if (longs.length === 0) return { labels: 0, topLevel: 0 }
  const verdicts = readLabels((await claude('judge', judge, LABELS(skim, longs))).text, longs.length)
  return { labels: verdicts.filter(v => v === 'label').length, topLevel: longs.length }
}

// ---- Commands ----------------------------------------------------------------------------------

/** Freezes a seeded sample of real replies, so every later run reads the same ones. */
function corpus() {
  const perProject = Number(take('--per-project') ?? 15)
  const sample: Reply[] = []
  for (const dir of args) {
    const project = dir.split('/').filter(Boolean).pop() ?? dir
    const turns = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
      .flatMap(f => turnsOf(`${dir}/${f}`)).filter(t => words(t.reply) >= MIN_WORDS)
    let state = 7
    const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    for (let i = turns.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const a = turns[i], b = turns[j]
      if (a !== undefined && b !== undefined) [turns[i], turns[j]] = [b, a]
    }
    for (const t of turns.slice(0, perProject)) sample.push({ id: `${project}#${t.session}#${t.index}`, project, session: t.session, turn: t.index, reply: t.reply })
  }
  mkdirSync(new URL('./out/', import.meta.url), { recursive: true })
  writeFileSync(CORPUS, sample.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(`froze ${sample.length} replies in bench/out/corpus.jsonl`)
}

/** The arms asked for, each a guide variant by name; an unknown name stops the run before anything is written. */
function armsOf() {
  const names = takeAll('--arm')
  if (names.length === 0) fail(`--arm <variant> is required: ${Object.keys(VARIANTS).join(', ')}`)
  return names.map(name => ({ name, guide: VARIANTS[name] ?? fail(`--arm ${name} is no guide variant; guides.ts has ${Object.keys(VARIANTS).join(', ')}`) }))
}

/** The replies of the frozen corpus, read strictly. */
function corpusReplies(): Reply[] {
  return rows(CORPUS).flatMap(row => {
    const [id, project, session, turn, reply] = ['id', 'project', 'session', 'turn', 'reply'].map(key => get(row, key))
    return typeof id === 'string' && typeof project === 'string' && typeof session === 'string' && typeof turn === 'number' && typeof reply === 'string'
      ? [{ id, project, session, turn, reply }]
      : []
  })
}

/**
 * Runs `jobs` a few at a time, stopping once MAX_FAILURES calls in a row have failed or the models
 * changed. Exits 1 when any job failed, so an incomplete run is never mistaken for a finished one.
 */
async function runJobs(jobs: (() => Promise<void>)[], concurrency: number) {
  let next = 0
  let stopped = false
  let failed = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let job = jobs[next++]; job !== undefined && !stopped; job = jobs[next++]) {
      try {
        await job()
      } catch (error) {
        failed += 1
        console.error(`${new Date().toISOString()} ${(error as Error).message}`)
        if (failures >= MAX_FAILURES || isHalted) {
          stopped = true
          console.error(isHalted ? 'stopped: a model changed during the run' : `stopped: ${MAX_FAILURES} calls failed in a row`)
        }
      }
    }
  }))
  console.log(`${stopped ? 'stopped' : 'done'}: ${Math.min(next, jobs.length)} of ${jobs.length} jobs started, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

/** Writes one row; a failed job writes its reason, never a grade. */
function record(file: string, row: Record<string, unknown>) {
  appendFileSync(file, `${JSON.stringify(row)}\n`)
}

async function runAll() {
  const out = take('--out') ?? fail('--out <dir> is required')
  const arms = armsOf()
  const repeats = Number(take('--repeats') ?? 3)
  const writer = take('--writer') ?? 'haiku'
  const judge = take('--judge') ?? 'haiku'
  const effort = take('--effort')
  const concurrency = Number(take('--concurrency') ?? 4)
  const limit = Number(take('--limit') ?? Infinity)
  const replies = corpusReplies().slice(0, limit)
  if (replies.length === 0) fail('no corpus: run `bun bench/ab.ts corpus` first')
  openRun(out, manifestOf({
    command: 'run', repeats, writer, judge, effort: effort ?? 'default',
    arms: Object.fromEntries(arms.map(a => [a.name, sha256(a.guide)])),
    corpus: { ids: replies.map(r => r.id), sha256: sha256(readFileSync(CORPUS, 'utf8')) },
  }), Object.fromEntries(arms.map(a => [a.name, a.guide])))

  const pointsFile = join(out, 'points.jsonl'), rewritesFile = join(out, 'rewrites.jsonl'), judgedFile = join(out, 'judged.jsonl')
  const points = new Map(rows(pointsFile).filter(isOk).flatMap(row => {
    const id = get(row, 'id'), list = get(row, 'points')
    return typeof id === 'string' && Array.isArray(list) ? [[id, list.map(String)] as const] : []
  }))
  const rewrites = new Map(rows(rewritesFile).filter(isOk).flatMap(row => {
    const text = textOf(row)
    return text === undefined ? [] : [[keyOf(row), text] as const]
  }))
  const judgedRows = rows(judgedFile)
  const judged = new Set(judgedRows.filter(isOk).map(keyOf))
  noteModels('writer', rows(rewritesFile))
  noteModels('judge', [...rows(pointsFile), ...judgedRows])

  const jobs: (() => Promise<void>)[] = []
  // Each reply's must-know points come from its original, once, so every arm is checked against the same list.
  for (const r of replies.filter(r => !points.has(r.id))) {
    jobs.push(async () => {
      try {
        const answer = await claude('judge', judge, POINTS(r.reply))
        const found = readPoints(answer.text)
        points.set(r.id, found)
        record(pointsFile, { id: r.id, status: 'ok', models: answer.models, points: found })
      } catch (error) {
        record(pointsFile, { id: r.id, status: 'error', reason: (error as Error).message })
        throw error
      }
    })
  }
  // Arms take turns within each repeat, so a run stopped early still compares them on the same replies.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const r of replies) {
      for (const arm of arms) {
        const id = { arm: arm.name, repeat, id: r.id }
        const k = keyOf(id)
        if (judged.has(k)) continue
        jobs.push(async () => {
          let text = rewrites.get(k)
          if (text === undefined) {
            try {
              const answer = await claude('writer', writer, REWRITE(r.reply), { system: arm.guide, ...(effort !== undefined && { effort }) })
              text = answer.text
              record(rewritesFile, { ...id, status: 'ok', guide: sha256(arm.guide), models: answer.models, text })
            } catch (error) {
              record(rewritesFile, { ...id, status: 'error', guide: sha256(arm.guide), reason: (error as Error).message })
              throw error
            }
          }
          if (shape(r.reply, text).recall < VALID_RECALL) return
          const list = points.get(r.id)
          if (list === undefined) return
          try {
            const { labels, topLevel } = await labelsIn(judge, text)
            const notes = await claude('judge', judge, READ(render(text, new Set())))
            const check = await claude('judge', judge, CHECK(list, notes.text))
            record(judgedFile, { ...id, status: 'ok', models: check.models, labels, topLevel, verdicts: readChecks(check.text, list.length) })
          } catch (error) {
            record(judgedFile, { ...id, status: 'error', reason: (error as Error).message })
            throw error
          }
        })
      }
    }
  }
  await runJobs(jobs, concurrency)
}

async function runTasks() {
  const out = take('--out') ?? fail('--out <dir> is required')
  const arms = armsOf()
  const repeats = Number(take('--repeats') ?? 1)
  const writer = take('--writer') ?? 'opus'
  const judge = take('--judge') ?? 'haiku'
  const effort = take('--effort')
  const concurrency = Number(take('--concurrency') ?? 4)
  const tasks = TASKS.slice(0, Number(take('--limit') ?? Infinity))
  openRun(out, manifestOf({
    command: 'tasks', repeats, writer, judge, effort: effort ?? 'default',
    arms: Object.fromEntries(arms.map(a => [a.name, sha256(a.guide)])),
    tasks,
  }), Object.fromEntries(arms.map(a => [a.name, a.guide])))

  const answersFile = join(out, 'answers.jsonl'), gradedFile = join(out, 'graded.jsonl')
  const answerRows = rows(answersFile), gradedRows = rows(gradedFile)
  const answers = new Map(answerRows.filter(isOk).flatMap(row => {
    const text = textOf(row)
    return text === undefined ? [] : [[keyOf(row), text] as const]
  }))
  const graded = new Set(gradedRows.filter(isOk).map(keyOf))
  noteModels('writer', answerRows)
  noteModels('judge', gradedRows)
  const check = async (text: string, know: string[], never: string[]) => {
    const answer = await claude('judge', judge, KEY(text, know, never))
    return { ...readKey(answer.text, know.length, never.length), models: answer.models }
  }

  const jobs: (() => Promise<void>)[] = []
  // Arms take turns within each repeat, so a run stopped early still compares them on the same tasks.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const task of tasks) {
      for (const arm of arms) {
        const id = { arm: arm.name, repeat, id: task.id }
        const k = keyOf(id)
        if (graded.has(k)) continue
        jobs.push(async () => {
          let text = answers.get(k)
          if (text === undefined) {
            try {
              const answer = await claude('writer', writer, ANSWER(task), { system: arm.guide, ...(effort !== undefined && { effort }) })
              text = answer.text
              record(answersFile, { ...id, status: 'ok', guide: sha256(arm.guide), models: answer.models, text })
            } catch (error) {
              record(answersFile, { ...id, status: 'error', guide: sha256(arm.guide), reason: (error as Error).message })
              throw error
            }
          }
          try {
            const { labels, topLevel } = await labelsIn(judge, text)
            const closed = await check(render(text, new Set()), task.key.know, task.key.never)
            const opened = await check(render(text, 'all'), [...task.key.know, ...task.key.defer], task.key.never)
            record(gradedFile, {
              ...id, status: 'ok', models: closed.models, labels, topLevel,
              skim: { know: closed.know, never: closed.never },
              full: { know: opened.know.slice(0, task.key.know.length), defer: opened.know.slice(task.key.know.length), never: opened.never },
            })
          } catch (error) {
            record(gradedFile, { ...id, status: 'error', reason: (error as Error).message })
            throw error
          }
        })
      }
    }
  }
  await runJobs(jobs, concurrency)
}

/** A grade row of a tasks run, read back as strictly as its judge answers were. */
type Graded = { labels: number; topLevel: number; skim: { know: Grade[]; never: Claim[] }; full: { know: Grade[]; defer: Grade[]; never: Claim[] } }

function gradedOf(row: unknown, task: Task): Graded | undefined {
  if (!isOk(row)) return undefined
  const labels = get(row, 'labels'), topLevel = get(row, 'topLevel'), skim = get(row, 'skim'), full = get(row, 'full')
  if (typeof labels !== 'number' || typeof topLevel !== 'number') return undefined
  const { know, defer, never } = task.key
  return {
    labels,
    topLevel,
    skim: { know: gradesOf(get(skim, 'know'), know.length, 'skim know'), never: claimsOf(get(skim, 'never'), never.length, 'skim never') },
    full: { know: gradesOf(get(full, 'know'), know.length, 'full know'), defer: gradesOf(get(full, 'defer'), defer.length, 'full defer'), never: claimsOf(get(full, 'never'), never.length, 'full never') },
  }
}

function tasksReport() {
  const out = take('--out') ?? fail('--out <dir> is required')
  const run = frozenRun(out)
  if (run.command !== 'tasks' || run.tasks === undefined) return fail(`${out} is not a tasks run`)
  const arms = Object.keys(run.arms)
  const answerRows = rows(join(out, 'answers.jsonl'))
  const texts = new Map(answerRows.filter(isOk).flatMap(row => {
    const text = textOf(row)
    return text === undefined ? [] : [[keyOf(row), text] as const]
  }))
  const gradedRows = new Map(rows(join(out, 'graded.jsonl')).filter(isOk).map(row => [keyOf(row), row]))
  const failed = [...answerRows, ...rows(join(out, 'graded.jsonl'))].filter(row => get(row, 'status') === 'error').length
  const score = (v: string | undefined) => (v === 'yes' ? 1 : v === 'partly' ? 0.5 : 0)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const sd = (xs: number[]) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)))
  const repeats = Array.from({ length: run.repeats }, (_, i) => i + 1)
  const at = (arm: string, rep: number, id: string) => keyOf({ arm, repeat: rep, id })

  // A task counts only where every arm has a graded answer in every repeat, so arms meet the same tasks.
  const tasks = run.tasks.filter(t => arms.every(arm => repeats.every(rep => gradedRows.has(at(arm, rep, t.id)))))
  console.log(`writer ${run.writer} (effort ${run.effort}), judge ${run.judge}, Claude Code ${run.claude}; ${tasks.length} of ${run.tasks.length} tasks graded in every arm and repeat; ${failed} failed calls\n`)

  const cell = (arm: string, task: Task) => {
    const runs = repeats.flatMap(rep => {
      const g = gradedOf(gradedRows.get(at(arm, rep, task.id)), task)
      const text = texts.get(at(arm, rep, task.id))
      return g === undefined || text === undefined ? [] : [{ g, s: shape('', text) }]
    })
    return {
      know: mean(runs.map(r => mean(r.g.skim.know.map(score)))),
      full: mean(runs.map(r => mean([...r.g.full.know, ...r.g.full.defer].map(score)))),
      skimWords: mean(runs.map(r => r.s.skim)),
      fullWords: mean(runs.map(r => r.s.full)),
      stretches: mean(runs.map(r => r.g.topLevel)),
      labels: mean(runs.map(r => r.g.labels)),
      rightOnly: runs.reduce((a, r) => a + r.s.rightOnly, 0),
      allStretches: runs.reduce((a, r) => a + r.s.stretches, 0),
    }
  }
  const table = (title: string, show: (c: ReturnType<typeof cell>) => string) => {
    console.log(`${title}\n\n| task | ${arms.join(' | ')} |\n|${'---|'.repeat(arms.length + 1)}`)
    for (const t of tasks) console.log(`| ${t.id} | ${arms.map(arm => show(cell(arm, t))).join(' | ')} |`)
    console.log('')
  }
  const pct = (x: number) => `${Math.round(100 * x)}%`
  table('Must-know points the skim carries', c => pct(c.know))
  table('Words: skim / full', c => `${Math.round(c.skimWords)} / ${Math.round(c.fullWords)}`)
  table('Top-level stretches (of them, labels)', c => `${c.stretches.toFixed(1)} (${c.labels.toFixed(1)})`)

  const [base, ...rest] = arms
  if (base !== undefined && rest.length > 0) {
    console.log(`Against ${base}, per task: the mean change in must-know points the skim carries, ± its spread across tasks; tasks better / same / worse.\n`)
    for (const arm of rest) {
      const diffs = tasks.map(t => cell(arm, t).know - cell(base, t).know)
      const better = diffs.filter(d => d > 0).length, worse = diffs.filter(d => d < 0).length
      console.log(`- ${arm}: ${pct(mean(diffs))} ± ${pct(sd(diffs))}; ${better} / ${diffs.length - better - worse} / ${worse}`)
    }
    console.log('')
  }
  for (const arm of arms) {
    const all = tasks.map(t => cell(arm, t))
    console.log(`- ${arm}: full reply carries ${pct(mean(all.map(c => c.full)))} of all key points; ${pct(all.reduce((a, c) => a + c.rightOnly, 0) / Math.max(1, all.reduce((a, c) => a + c.allStretches, 0)))} of stretches only add words after the short form`)
  }

  // Layout rules read only the answers, so they count every task each arm answered in every repeat.
  const answered = run.tasks.filter(t => arms.every(arm => repeats.every(rep => texts.has(at(arm, rep, t.id)))))
  const verdicts = new Map(answered.flatMap(t => arms.flatMap(arm => repeats.map(rep => [at(arm, rep, t.id), verdictsOf(texts.get(at(arm, rep, t.id)) ?? '', t)] as const))))
  const ruleTable = (title: string, set: Task[]) => {
    if (set.length === 0) return
    const ids: RuleId[] = [...new Set(set.flatMap(t => verdicts.get(at(arms[0] ?? '', 1, t.id))?.map(v => v.rule) ?? []))]
    console.log(`\n${title}: answers that break each rule, of those it applies to\n\n| rule | ${arms.join(' | ')} |\n|${'---|'.repeat(arms.length + 1)}`)
    for (const rule of ids) {
      const cells = arms.map(arm => {
        const found = set.flatMap(t => repeats.flatMap(rep => verdicts.get(at(arm, rep, t.id))?.filter(v => v.rule === rule) ?? []))
        return `${found.filter(v => !v.holds).length} / ${found.length}`
      })
      console.log(`| ${rule} | ${cells.join(' | ')} |`)
    }
  }
  console.log(`\n${answered.length} of ${run.tasks.length} tasks answered in every arm and repeat`)
  ruleTable('Layout rules, tasks for choosing a guide', answered.filter(t => t.heldOut !== true))
  ruleTable('Layout rules, held-out tasks', answered.filter(t => t.heldOut === true))
  const broken: string[] = []
  for (const [k, found] of verdicts) for (const v of found) if (!v.holds) broken.push(`- ${k.replaceAll('|', ', ')}: ${v.rule}, ${v.evidence}`)
  if (broken.length > 0) console.log(`\nEach broken rule:\n\n${broken.join('\n')}`)

  // A claim the key forbids, in what the reader sees, is a material error whatever the full reply says.
  console.log('\nForbidden claims made (each one blocks adopting its guide until a person has read it):\n')
  let made = 0
  for (const t of tasks) {
    for (const arm of arms) {
      for (const rep of repeats) {
        const g = gradedOf(gradedRows.get(at(arm, rep, t.id)), t)
        for (const [view, verdicts] of [['skim', g?.skim.never], ['full', g?.full.never]] as const) {
          verdicts?.forEach((v, i) => {
            if (v !== 'yes') return
            made += 1
            console.log(`- ${arm}, ${t.id}, repeat ${rep}, ${view}: "${t.key.never[i] ?? ''}"`)
          })
        }
      }
    }
  }
  if (made === 0) console.log('- none')
}

function report() {
  const out = take('--out') ?? fail('--out <dir> is required')
  const run = frozenRun(out)
  if (run.command !== 'run' || run.corpus === undefined) return fail(`${out} is not a corpus run`)
  if (sha256(readFileSync(CORPUS, 'utf8')) !== run.corpus.sha256) fail('bench/out/corpus.jsonl changed after this run started')
  const arms = Object.keys(run.arms)
  const replies = new Map(corpusReplies().filter(r => run.corpus?.ids.includes(r.id)).map(r => [r.id, r]))
  const rewriteRows = rows(join(out, 'rewrites.jsonl'))
  const rewrites = new Map(rewriteRows.filter(isOk).flatMap(row => {
    const text = textOf(row)
    return text === undefined ? [] : [[keyOf(row), text] as const]
  }))
  const points = new Map(rows(join(out, 'points.jsonl')).filter(isOk).flatMap(row => {
    const id = get(row, 'id'), list = get(row, 'points')
    return typeof id === 'string' && Array.isArray(list) ? [[id, list.length] as const] : []
  }))
  const judged = new Map(rows(join(out, 'judged.jsonl')).filter(isOk).flatMap(row => {
    const id = get(row, 'id'), labels = get(row, 'labels'), topLevel = get(row, 'topLevel'), count = typeof id === 'string' ? points.get(id) : undefined
    if (count === undefined || typeof labels !== 'number' || typeof topLevel !== 'number') return []
    return [[keyOf(row), { labels, topLevel, verdicts: gradesOf(get(row, 'verdicts'), count, 'verdicts') }] as const]
  }))
  const score = (v: string | undefined) => (v === 'yes' ? 1 : v === 'partly' ? 0.5 : 0)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const sd = (xs: number[]) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)))
  const pct = (x: number) => `${(100 * x).toFixed(1)}`
  const repeats = Array.from({ length: run.repeats }, (_, i) => i + 1)
  const at = (arm: string, rep: number, id: string) => keyOf({ arm, repeat: rep, id })

  // A reply counts only where every arm has a judged rewrite in every repeat, so arms meet the same replies.
  const ids = [...replies.keys()].filter(id => arms.every(arm => repeats.every(rep => judged.has(at(arm, rep, id)))))
  console.log(`writer ${run.writer} (effort ${run.effort}), judge ${run.judge}, Claude Code ${run.claude}; ${ids.length} of ${replies.size} replies judged in every arm and repeat`)
  const failedCalls = rewriteRows.filter(r => get(r, 'status') === 'error').length
  const broken = [...rewrites].filter(([k, text]) => shape(replies.get(k.split('|')[2] ?? '')?.reply ?? '', text).recall < VALID_RECALL).length
  console.log(`${rewriteRows.length} rewrite attempts: ${failedCalls} failed calls, ${broken} broken rewrites (kept under ${VALID_RECALL * 100}% of the content words)\n`)

  const metrics = ['skim share', 'right-only stretches', 'words added left', 'words added middle', 'colon titles', 'labels', 'top-3 points carried', 'all points carried'] as const
  const perRun = (arm: string, repeat: number) => {
    const found = ids.map(id => ({ s: shape(replies.get(id)?.reply ?? '', rewrites.get(at(arm, repeat, id)) ?? ''), j: judged.get(at(arm, repeat, id)) }))
    const added = found.reduce((a, r) => a + r.s.sides.before + r.s.sides.between + r.s.sides.after, 0)
    const stretchCount = found.reduce((a, r) => a + r.s.stretches, 0)
    const top = found.reduce((a, r) => a + (r.j?.topLevel ?? 0), 0)
    return {
      'skim share': found.reduce((a, r) => a + r.s.skim, 0) / found.reduce((a, r) => a + r.s.original, 0),
      'right-only stretches': found.reduce((a, r) => a + r.s.rightOnly, 0) / stretchCount,
      'words added left': found.reduce((a, r) => a + r.s.sides.before, 0) / added,
      'words added middle': found.reduce((a, r) => a + r.s.sides.between, 0) / added,
      'colon titles': found.reduce((a, r) => a + r.s.colon, 0) / stretchCount,
      labels: found.reduce((a, r) => a + (r.j?.labels ?? 0), 0) / top,
      'top-3 points carried': mean(found.map(r => mean((r.j?.verdicts ?? []).slice(0, 3).map(score)))),
      'all points carried': mean(found.map(r => mean((r.j?.verdicts ?? []).map(score)))),
    }
  }
  console.log(`| measure | ${arms.join(' | ')} |`)
  console.log(`|${'---|'.repeat(arms.length + 1)}`)
  for (const m of metrics) {
    const cells = arms.map(arm => {
      const found = repeats.map(rep => perRun(arm, rep)[m])
      return `${pct(mean(found))} ± ${pct(sd(found))}`
    })
    console.log(`| ${m} (%) | ${cells.join(' | ')} |`)
  }
  console.log('\nEach cell: the mean of the repeats, ± how much the repeats differ (standard deviation).')
}

if (command === 'corpus') corpus()
else if (command === 'run') await runAll()
else if (command === 'report') report()
else if (command === 'tasks') await runTasks()
else if (command === 'tasks-report') tasksReport()
else console.error('usage: bun bench/ab.ts corpus|run|report|tasks|tasks-report ...')

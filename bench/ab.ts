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
//   bun bench/ab.ts override --out <dir> --arm <a> --repeat <n> --task <id> --rule <rule> --holds true|false --reason <why>
//                                    records a person's verdict on one layout rule for one answer
// An arm is a guide variant named in guides.ts. A run's first start freezes its inputs in
// <dir>/manifest.json; a later start with the same inputs resumes where it stopped, and one with any
// other input, or after the code that writes its rows changed, is refused before a single call. One
// run at a time per folder. Calls `claude -p` in safe mode, so the person's own CLAUDE.md files,
// skills and plugins stay out. Runs under bun, as the plugin's hooks import each other without file
// extensions. Raw text stays in bench/out/, which git ignores.
import { execFile, execFileSync } from 'node:child_process'
import { hash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { growthOf } from '../hooks/grow.ts'
import { drawnAs, parse, stretches } from '../hooks/parse.ts'
import { ANSWER, CHECK, claimsOf, gradesOf, KEY, LABELS, pointsOf, POINTS, READ, readChecks, readKey, readLabels, readPoints, resultOf, REWRITE } from './grading.ts'
import type { Claim, Grade } from './grading.ts'
import { VARIANTS } from './guides.ts'
import { differences, readManifest, rowsOf } from './manifest.ts'
import type { Manifest } from './manifest.ts'
import { draw, render, words } from './measure.ts'
import { adjudicate, isRuleId, verdictsOf } from './rules.ts'
import type { Override, RuleId } from './rules.ts'
import { stringsOf, TASKS } from './tasks.ts'
import type { Task } from './tasks.ts'
import { turnsOf } from './transcripts.ts'

const CORPUS = new URL('./out/corpus.jsonl', import.meta.url)
const REPO = new URL('..', import.meta.url).pathname
/** The code that writes a run's rows: this runner, the judge's prompts, and the parser and drawing the skim comes from. */
const RUN_CODE = ['bench/ab.ts', 'bench/grading.ts', 'bench/measure.ts', 'hooks/parse.ts']
const MIN_WORDS = 40
/** A rewrite keeping less of the original's content words than this is broken (a refusal, a summary), not shorter. */
const VALID_RECALL = 0.9
/** Calls failing in a row before the run stops: a spent usage limit or a lost login fails every call. */
const MAX_FAILURES = 8

type Reply = { id: string; project: string; session: string; turn: number; reply: string }
type Role = 'writer' | 'judge'

const sha256 = (text: string) => hash('sha256', text)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

// ---- Commands and their flags ------------------------------------------------------------------

const RUN_FLAGS = ['out', 'arm', 'repeats', 'writer', 'judge', 'effort', 'concurrency', 'limit'] as const
// Each command takes only its own flags, so a misspelt one stops the run instead of being ignored.
const COMMANDS: Record<string, { flags: readonly string[]; run: () => void | Promise<void> }> = {
  corpus: { flags: ['per-project'], run: corpus },
  run: { flags: RUN_FLAGS, run: runAll },
  report: { flags: ['out'], run: report },
  tasks: { flags: RUN_FLAGS, run: runTasks },
  'tasks-report': { flags: ['out'], run: tasksReport },
  override: { flags: ['out', 'arm', 'repeat', 'task', 'rule', 'holds', 'reason'], run: override },
}
const [command = '', ...rest] = process.argv.slice(2)
const chosen = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined
if (chosen === undefined) fail(`usage: bun bench/ab.ts ${Object.keys(COMMANDS).join('|')} ...`)
// A run compares several arms; an override names one answer, so one arm.
const isArmList = command === 'run' || command === 'tasks'
const { values: flags, positionals } = (() => {
  try {
    return parseArgs({
      args: rest,
      options: Object.fromEntries((chosen?.flags ?? []).map(name => [name, { type: 'string', multiple: name === 'arm' && isArmList }] as const)),
      allowPositionals: command === 'corpus',
      strict: true,
    })
  } catch (error) {
    return fail(`${command}: ${messageOf(error)}`)
  }
})()
const flag = (name: string) => {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}
/** A whole number of at least 1 given with `name`, or `fallback` when it is left out. */
const count = (name: string, fallback: number) => {
  const value = flag(name)
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : fail(`--${name} wants a whole number of at least 1, not ${value}`)
}
const outDir = () => flag('out') ?? fail('--out <dir> is required')

// ---- Run folders -------------------------------------------------------------------------------

const get = (row: unknown, key: string): unknown => (typeof row === 'object' && row !== null ? Reflect.get(row, key) : undefined)
const keyOf = (row: unknown) => `${String(get(row, 'arm'))}|${String(get(row, 'repeat'))}|${String(get(row, 'id'))}`
const at = (arm: string, repeat: number, id: string) => keyOf({ arm, repeat, id })
const isOk = (row: unknown) => get(row, 'status') === 'ok'
/** The text of each successful row, by arm, repeat and id; the latest row for a slot wins. */
const textsOf = (found: unknown[]) =>
  new Map(found.filter(isOk).flatMap(row => {
    const text = get(row, 'text')
    return typeof text === 'string' ? [[keyOf(row), text] as const] : []
  }))
/** The must-know points of each reply, from the successful rows of a run's points file. */
const pointsByReply = (found: unknown[]) => new Map(found.filter(isOk).map(row => [String(get(row, 'id')), pointsOf(get(row, 'points'))]))

/** The rows of one of a run's files; a last line cut short by an interrupted write is skipped and reported. */
function rows(file: string | URL): unknown[] {
  if (!existsSync(file)) return []
  const { rows: found, isCut } = rowsOf(readFileSync(file, 'utf8'))
  if (isCut) console.error(`${String(file)}: skipped its last line, cut short by an interrupted write`)
  return found
}

/**
 * Appends one row; a failed job writes its reason, never a grade. A file whose last line an
 * interrupted write cut short loses that line first, so the new row starts a line of its own.
 */
function record(file: string, row: Record<string, unknown>) {
  const size = existsSync(file) ? statSync(file).size : 0
  if (size > 0) {
    const last = Buffer.alloc(1)
    const fd = openSync(file, 'r')
    readSync(fd, last, 0, 1, size - 1)
    closeSync(fd)
    if (last.toString() !== '\n') {
      const text = readFileSync(file, 'utf8')
      const end = text.lastIndexOf('\n') + 1
      // A whole row only missing its newline is kept; a cut one is dropped, and its job runs again.
      if (rowsOf(text.slice(end)).isCut) {
        truncateSync(file, Buffer.byteLength(text.slice(0, end)))
        console.error(`${file}: dropped its last line, cut short by an interrupted write`)
      } else appendFileSync(file, '\n')
    }
  }
  appendFileSync(file, `${JSON.stringify(row)}\n`)
}

/** Runs `work` for one slot and records its row: what it found, or why it failed, which is rethrown so the run counts it. */
async function attempt<T extends Record<string, unknown>>(file: string, slot: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  try {
    const found = await work()
    record(file, { ...slot, status: 'ok', ...found })
    return found
  } catch (error) {
    record(file, { ...slot, status: 'error', reason: messageOf(error) })
    throw error
  }
}

/** The manifest these inputs make, with the code and versions they run against. */
function manifestOf(fields: Omit<Manifest, 'claude' | 'code' | 'revision'>): Manifest {
  const claudeVersion = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim()
  const code = sha256(RUN_CODE.map(file => readFileSync(join(REPO, file), 'utf8')).join('\n'))
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()
  const isDirty = execFileSync('git', ['status', '--porcelain', '--', 'hooks', 'bench'], { cwd: REPO, encoding: 'utf8' }).trim() !== ''
  return { ...fields, claude: claudeVersion, code, revision: { commit, isDirty } }
}

/**
 * Starts the run in `out` with `current`, or resumes it when its manifest holds the same inputs.
 * Anything else stops before a call and changes no file. The manifest is written last, so a start
 * cut short before it leaves a folder the next start simply begins again.
 */
function openRun(out: string, current: Manifest, guides: Record<string, string>): void {
  mkdirSync(out, { recursive: true })
  const file = join(out, 'manifest.json')
  if (existsSync(file)) {
    let frozen: Manifest
    try {
      frozen = readManifest(readFileSync(file, 'utf8'))
    } catch (error) {
      return fail(`${file}: ${messageOf(error)}`)
    }
    const changed = differences(frozen, current)
    if (changed.length > 0) fail(`${out} was started with other inputs, and these differ: ${changed.join(', ')}. Start a new --out.`)
    return
  }
  if (readdirSync(out).some(name => name.endsWith('.jsonl'))) fail(`${out} holds rows from before run manifests, which cannot be checked. Start a new --out.`)
  for (const [arm, text] of Object.entries(guides)) writeFileSync(join(out, `guide-${arm}.txt`), text)
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { flag: 'wx' })
}

/** The run in `out`, as its manifest froze it; a report reads nothing else for its inputs. */
function frozenRun(out: string): Manifest {
  const file = join(out, 'manifest.json')
  if (!existsSync(file)) return fail(`${out} has no manifest.json: it was not started by this runner, or holds rows from before run manifests.`)
  try {
    return readManifest(readFileSync(file, 'utf8'))
  } catch (error) {
    return fail(`${file}: ${messageOf(error)}`)
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
    const models = stringsOf(get(row, 'models'))
    if (isOk(row) && models !== undefined) answeredBy[role] ??= models.join(',')
  }
}

/** One `claude -p` answer and the models that gave it. Stdin is closed at once, so Claude Code does not wait for piped input. */
function claude(role: Role, model: string, prompt: string, options: { system?: string; effort?: string } = {}): Promise<{ text: string; models: string[] }> {
  const args = ['-p', '--model', model, '--safe-mode', '--no-session-persistence', '--tools', '', '--output-format', 'json']
  if (options.effort !== undefined) args.push('--effort', options.effort)
  if (options.system !== undefined) args.push('--append-system-prompt', options.system)
  return new Promise((resolve, reject) => {
    const child = execFile('claude', [...args, prompt], { maxBuffer: 1 << 26, timeout: 900000, cwd: BLANK }, (error, stdout, stderr) => {
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
        // The process's own words say more than "no JSON" when Claude Code refused to start or was killed.
        const why = error?.killed === true
          ? `killed (${error.signal ?? 'timeout'}) after the time limit`
          : [messageOf(parsing), /\S.*/.exec(stderr)?.[0]].filter(Boolean).join(': ') + (error?.code === undefined ? '' : ` (exit ${String(error.code)})`)
        reject(new Error(why))
      }
    })
    child.stdin?.end()
  })
}

// ---- Measures ----------------------------------------------------------------------------------

/** The skim with each link in view numbered, and their long forms, opened, in that order. */
function marked(text: string): { skim: string; longs: string[] } {
  const longs: string[] = []
  const skim = draw(parse(text), new Set(), (link, shown) => {
    longs.push(draw(link.long ?? [], 'all'))
    return `⟦${longs.length}⟧${shown}⟦/${longs.length}⟧`
  })
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
  const links = stretches(parse(text)).filter(s => drawnAs(s) === 'link')
  const sides = { before: 0, between: 0, after: 0 }
  let rightOnly = 0
  let colon = 0
  for (const s of links) {
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
    links: links.length,
    rightOnly,
    colon,
    sides,
  }
}

/** How many links are in view, and how many of their short forms the judge calls labels. */
async function labelsIn(judge: string, text: string): Promise<{ labels: number; linksInView: number }> {
  const { skim, longs } = marked(text)
  if (longs.length === 0) return { labels: 0, linksInView: 0 }
  const verdicts = readLabels((await claude('judge', judge, LABELS(skim, longs))).text, longs.length)
  return { labels: verdicts.filter(v => v === 'label').length, linksInView: longs.length }
}

const score = (v: Grade) => (v === 'yes' ? 1 : v === 'partly' ? 0.5 : 0)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const sd = (xs: number[]) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)))
const repeatsOf = (run: Manifest) => Array.from({ length: run.repeats }, (_, i) => i + 1)

// ---- Commands ----------------------------------------------------------------------------------

/** Freezes a seeded sample of real replies, so every later run reads the same ones. */
function corpus() {
  const perProject = count('per-project', 15)
  const sample: Reply[] = []
  for (const dir of positionals) {
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
  const names = stringsOf(flags.arm) ?? []
  if (names.length === 0) return fail(`--arm <variant> is required: ${Object.keys(VARIANTS).join(', ')}`)
  return names.map(name => ({
    name,
    guide: Object.hasOwn(VARIANTS, name) ? (VARIANTS[name] ?? '') : fail(`--arm ${name} is no guide variant; guides.ts has ${Object.keys(VARIANTS).join(', ')}`),
  }))
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
 * Runs `jobs` a few at a time, stopping once MAX_FAILURES calls in a row have failed or a model
 * changed. Sets exit 1 unless every job finished, so an incomplete run is never mistaken for a
 * finished one, and says whether it stopped.
 */
async function runJobs(jobs: (() => Promise<void>)[], concurrency: number): Promise<boolean> {
  const queue = jobs.values()
  let isStopped = isHalted
  let finished = 0
  let failed = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (const job of queue) {
      if (isStopped) break
      try {
        await job()
        finished += 1
      } catch (error) {
        failed += 1
        console.error(`${new Date().toISOString()} ${messageOf(error)}`)
        if (failures >= MAX_FAILURES || isHalted) {
          isStopped = true
          console.error(isHalted ? 'stopped: a model changed during the run' : `stopped: ${MAX_FAILURES} calls failed in a row`)
        }
      }
    }
  }))
  console.log(`${isStopped ? 'stopped' : 'done'}: ${finished} of ${jobs.length} jobs finished, ${failed} failed`)
  if (finished < jobs.length) process.exitCode = 1
  return isStopped
}

async function runAll() {
  const out = outDir()
  const arms = armsOf()
  const repeats = count('repeats', 3)
  const writer = flag('writer') ?? 'haiku'
  const judge = flag('judge') ?? 'haiku'
  const effort = flag('effort')
  const concurrency = count('concurrency', 4)
  const replies = corpusReplies().slice(0, count('limit', Infinity))
  if (replies.length === 0) fail('no corpus: run `bun bench/ab.ts corpus` first')
  openRun(out, manifestOf({
    command: 'run', repeats, writer, judge, effort: effort ?? 'default',
    arms: Object.fromEntries(arms.map(a => [a.name, sha256(a.guide)])),
    corpus: { ids: replies.map(r => r.id), sha256: sha256(readFileSync(CORPUS, 'utf8')) },
  }), Object.fromEntries(arms.map(a => [a.name, a.guide])))

  const pointsFile = join(out, 'points.jsonl'), rewritesFile = join(out, 'rewrites.jsonl'), judgedFile = join(out, 'judged.jsonl')
  const pointRows = rows(pointsFile), rewriteRows = rows(rewritesFile), judgedRows = rows(judgedFile)
  const points = pointsByReply(pointRows)
  const rewrites = textsOf(rewriteRows)
  const judged = new Set(judgedRows.filter(isOk).map(keyOf))
  noteModels('writer', rewriteRows)
  noteModels('judge', [...pointRows, ...judgedRows])

  // Each reply's must-know points come from its original, once, so every arm is checked against the
  // same list. They are all in place before any rewrite; a reply still without them waits for a resume.
  const isStopped = await runJobs(replies.filter(r => !points.has(r.id)).map(r => async () => {
    const found = await attempt(pointsFile, { id: r.id }, async () => {
      const answer = await claude('judge', judge, POINTS(r.reply))
      return { models: answer.models, points: readPoints(answer.text) }
    })
    points.set(r.id, found.points)
  }), concurrency)
  if (isStopped) return

  const jobs: (() => Promise<void>)[] = []
  // Arms take turns within each repeat, so a run stopped early still compares them on the same replies.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const r of replies) {
      const list = points.get(r.id)
      if (list === undefined) continue
      for (const arm of arms) {
        const slot = { arm: arm.name, repeat, id: r.id }
        if (judged.has(keyOf(slot))) continue
        jobs.push(async () => {
          const text = rewrites.get(keyOf(slot)) ?? (await attempt(rewritesFile, { ...slot, guide: sha256(arm.guide) }, () =>
            claude('writer', writer, REWRITE(r.reply), { system: arm.guide, ...(effort !== undefined && { effort }) }))).text
          if (shape(r.reply, text).recall < VALID_RECALL) return
          await attempt(judgedFile, slot, async () => {
            const { labels, linksInView } = await labelsIn(judge, text)
            const notes = await claude('judge', judge, READ(render(text, new Set())))
            const check = await claude('judge', judge, CHECK(list, notes.text))
            return { models: check.models, labels, linksInView, verdicts: readChecks(check.text, list.length) }
          })
        })
      }
    }
  }
  await runJobs(jobs, concurrency)
}

async function runTasks() {
  const out = outDir()
  const arms = armsOf()
  const repeats = count('repeats', 1)
  const writer = flag('writer') ?? 'opus'
  const judge = flag('judge') ?? 'haiku'
  const effort = flag('effort')
  const concurrency = count('concurrency', 4)
  const tasks = TASKS.slice(0, count('limit', Infinity))
  openRun(out, manifestOf({
    command: 'tasks', repeats, writer, judge, effort: effort ?? 'default',
    arms: Object.fromEntries(arms.map(a => [a.name, sha256(a.guide)])),
    tasks,
  }), Object.fromEntries(arms.map(a => [a.name, a.guide])))

  const answersFile = join(out, 'answers.jsonl'), gradedFile = join(out, 'graded.jsonl')
  const answerRows = rows(answersFile), gradedRows = rows(gradedFile)
  const answers = textsOf(answerRows)
  const graded = new Set(gradedRows.filter(isOk).map(keyOf))
  noteModels('writer', answerRows)
  noteModels('judge', gradedRows)
  const grade = async (text: string, know: string[], never: string[]) => {
    const answer = await claude('judge', judge, KEY(text, know, never))
    return { ...readKey(answer.text, know.length, never.length), models: answer.models }
  }

  const jobs: (() => Promise<void>)[] = []
  // Arms take turns within each repeat, so a run stopped early still compares them on the same tasks.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const task of tasks) {
      for (const arm of arms) {
        const slot = { arm: arm.name, repeat, id: task.id }
        if (graded.has(keyOf(slot))) continue
        jobs.push(async () => {
          const text = answers.get(keyOf(slot)) ?? (await attempt(answersFile, { ...slot, guide: sha256(arm.guide) }, () =>
            claude('writer', writer, ANSWER(task), { system: arm.guide, ...(effort !== undefined && { effort }) }))).text
          await attempt(gradedFile, slot, async () => {
            const { labels, linksInView } = await labelsIn(judge, text)
            const closed = await grade(render(text, new Set()), task.key.know, task.key.never)
            const opened = await grade(render(text, 'all'), [...task.key.know, ...task.key.defer], task.key.never)
            return {
              models: closed.models, labels, linksInView,
              skim: { know: closed.know, never: closed.never },
              full: { know: opened.know.slice(0, task.key.know.length), defer: opened.know.slice(task.key.know.length), never: opened.never },
            }
          })
        })
      }
    }
  }
  await runJobs(jobs, concurrency)
}

/** The overrides recorded in a run, by answer; a malformed row is an error, not a silent skip. */
function overridesIn(out: string): Map<string, Override[]> {
  const found = new Map<string, Override[]>()
  for (const row of rows(join(out, 'overrides.jsonl'))) {
    const [arm, repeat, id, rule, holds, reason, answerSha256] = ['arm', 'repeat', 'id', 'rule', 'holds', 'reason', 'answer'].map(key => get(row, key))
    if (typeof arm !== 'string' || !Number.isInteger(repeat) || typeof id !== 'string' || typeof rule !== 'string' || !isRuleId(rule) || typeof holds !== 'boolean' || typeof reason !== 'string' || typeof answerSha256 !== 'string') {
      return fail(`${join(out, 'overrides.jsonl')}: a row is not an override: ${JSON.stringify(row)}`)
    }
    found.set(keyOf(row), [...(found.get(keyOf(row)) ?? []), { rule, holds, reason, answerSha256 }])
  }
  return found
}

/** Records a person's verdict on one layout rule for one answer, tied to that answer's text. */
function override() {
  const out = outDir()
  const run = frozenRun(out)
  const [arm, id, rule, holds, reason] = ['arm', 'task', 'rule', 'holds', 'reason'].map(flag)
  if (arm === undefined || flag('repeat') === undefined || id === undefined) return fail('--arm, --repeat and --task name the answer')
  const repeat = count('repeat', 1)
  const task = run.tasks?.find(t => t.id === id) ?? fail(`--task ${id} is no task of this run`)
  if (rule === undefined || !isRuleId(rule)) return fail(`--rule ${String(rule)} is no layout rule`)
  if (holds !== 'true' && holds !== 'false') return fail('--holds is true or false')
  if (reason === undefined || reason.trim() === '') return fail('--reason is required: say why the rule is wrong here')
  const text = textsOf(rows(join(out, 'answers.jsonl'))).get(at(arm, repeat, task.id)) ?? fail(`no answer from ${arm}, repeat ${repeat}, for ${task.id}`)
  if (!verdictsOf(text, task).some(v => v.rule === rule)) fail(`${rule} does not apply to ${task.id}`)
  record(join(out, 'overrides.jsonl'), { arm, repeat, id: task.id, rule, holds: holds === 'true', reason, at: new Date().toISOString(), answer: sha256(text) })
  console.log(`recorded: ${rule} ${holds === 'true' ? 'holds' : 'breaks'} for ${arm}, repeat ${repeat}, ${task.id}`)
}

/** A grade row of a tasks run, read back as strictly as its judge answers were. */
type Graded = { labels: number; linksInView: number; skim: { know: Grade[]; never: Claim[] }; full: { know: Grade[]; defer: Grade[]; never: Claim[] } }

/** A successful grade row read back; a malformed one is an error, never a score of nothing. */
function gradedOf(row: unknown, task: Task): Graded {
  const labels = get(row, 'labels'), linksInView = get(row, 'linksInView'), skim = get(row, 'skim'), full = get(row, 'full')
  if (typeof labels !== 'number' || typeof linksInView !== 'number') throw new Error(`the grade of ${keyOf(row)} has no label counts`)
  const { know, defer, never } = task.key
  return {
    labels,
    linksInView,
    skim: { know: gradesOf(get(skim, 'know'), know.length, 'skim know'), never: claimsOf(get(skim, 'never'), never.length, 'skim never') },
    full: { know: gradesOf(get(full, 'know'), know.length, 'full know'), defer: gradesOf(get(full, 'defer'), defer.length, 'full defer'), never: claimsOf(get(full, 'never'), never.length, 'full never') },
  }
}

function tasksReport() {
  const out = outDir()
  const run = frozenRun(out)
  if (run.command !== 'tasks' || run.tasks === undefined) return fail(`${out} is not a tasks run`)
  const arms = Object.keys(run.arms)
  const answerRows = rows(join(out, 'answers.jsonl')), gradedRows = rows(join(out, 'graded.jsonl'))
  const texts = textsOf(answerRows)
  const gradedBy = new Map(gradedRows.filter(isOk).map(row => [keyOf(row), row]))
  const failed = [...answerRows, ...gradedRows].filter(row => get(row, 'status') === 'error').length
  const repeats = repeatsOf(run)
  const slots = (t: Task) => arms.flatMap(arm => repeats.map(rep => ({ arm, rep, k: at(arm, rep, t.id) })))

  // A task counts only where every arm has an answer and its grade in every repeat, so arms meet the same tasks.
  const tasks = run.tasks.filter(t => slots(t).every(({ k }) => gradedBy.has(k) && texts.has(k)))
  console.log(`writer ${run.writer} (effort ${run.effort}), judge ${run.judge}, Claude Code ${run.claude}; ${tasks.length} of ${run.tasks.length} tasks graded in every arm and repeat; ${failed} failed calls\n`)

  // Each answer's numbers, worked out once.
  const each = new Map(tasks.flatMap(t => slots(t).map(({ k }) => [k, { g: gradedOf(gradedBy.get(k), t), s: shape('', texts.get(k) ?? '') }] as const)))
  const cell = (arm: string, task: Task) => {
    const found = repeats.flatMap(rep => each.get(at(arm, rep, task.id)) ?? [])
    return {
      skimPoints: mean(found.map(r => mean(r.g.skim.know.map(score)))),
      fullPoints: mean(found.map(r => mean([...r.g.full.know, ...r.g.full.defer].map(score)))),
      skimWords: mean(found.map(r => r.s.skim)),
      fullWords: mean(found.map(r => r.s.full)),
      linksInView: mean(found.map(r => r.g.linksInView)),
      labels: mean(found.map(r => r.g.labels)),
      rightOnly: found.reduce((a, r) => a + r.s.rightOnly, 0),
      links: found.reduce((a, r) => a + r.s.links, 0),
    }
  }
  const table = (title: string, show: (c: ReturnType<typeof cell>) => string) => {
    console.log(`${title}\n\n| task | ${arms.join(' | ')} |\n|${'---|'.repeat(arms.length + 1)}`)
    for (const t of tasks) console.log(`| ${t.id} | ${arms.map(arm => show(cell(arm, t))).join(' | ')} |`)
    console.log('')
  }
  const pct = (x: number) => `${Math.round(100 * x)}%`
  table('Must-know points the skim carries', c => pct(c.skimPoints))
  table('Words: skim / full', c => `${Math.round(c.skimWords)} / ${Math.round(c.fullWords)}`)
  table('Links in view (of them, labels)', c => `${c.linksInView.toFixed(1)} (${c.labels.toFixed(1)})`)

  const [base, ...others] = arms
  if (base !== undefined && others.length > 0) {
    console.log(`Against ${base}, per task: the mean change in must-know points the skim carries, ± its spread across tasks; tasks better / same / worse.\n`)
    for (const arm of others) {
      const diffs = tasks.map(t => cell(arm, t).skimPoints - cell(base, t).skimPoints)
      const better = diffs.filter(d => d > 0).length, worse = diffs.filter(d => d < 0).length
      console.log(`- ${arm}: ${pct(mean(diffs))} ± ${pct(sd(diffs))}; ${better} / ${diffs.length - better - worse} / ${worse}`)
    }
    console.log('')
  }
  for (const arm of arms) {
    const all = tasks.map(t => cell(arm, t))
    console.log(`- ${arm}: full reply carries ${pct(mean(all.map(c => c.fullPoints)))} of all key points; ${pct(all.reduce((a, c) => a + c.rightOnly, 0) / Math.max(1, all.reduce((a, c) => a + c.links, 0)))} of stretches only add words after the short form`)
  }

  // Layout rules read only the answers, so they count every task each arm answered in every repeat.
  // A person's override shows beside the rule's own count, never in its place.
  const answered = run.tasks.filter(t => slots(t).every(({ k }) => texts.has(k)))
  const overrides = overridesIn(out)
  const ruleVerdicts = new Map(answered.flatMap(t => slots(t).map(({ k }) => {
    const text = texts.get(k) ?? '', answerSha256 = sha256(text)
    return [k, verdictsOf(text, t).map(v => ({ ...v, adjudicated: adjudicate(v, overrides.get(k) ?? [], answerSha256) }))] as const
  })))
  const ruleTable = (title: string, set: Task[]) => {
    if (set.length === 0) return
    const ids: RuleId[] = [...new Set(set.flatMap(t => ruleVerdicts.get(at(arms[0] ?? '', 1, t.id))?.map(v => v.rule) ?? []))]
    console.log(`\n${title}: answers that break each rule, of those it applies to\n\n| rule | ${arms.join(' | ')} |\n|${'---|'.repeat(arms.length + 1)}`)
    for (const rule of ids) {
      const cells = arms.map(arm => {
        const found = set.flatMap(t => repeats.flatMap(rep => ruleVerdicts.get(at(arm, rep, t.id))?.filter(v => v.rule === rule) ?? []))
        const raw = found.filter(v => !v.holds).length, adjudicated = found.filter(v => !v.adjudicated.holds).length
        return `${raw} / ${found.length}${adjudicated === raw ? '' : `, ${adjudicated} / ${found.length} adjudicated`}`
      })
      console.log(`| ${rule} | ${cells.join(' | ')} |`)
    }
  }
  console.log(`\n${answered.length} of ${run.tasks.length} tasks answered in every arm and repeat`)
  ruleTable('Layout rules, tasks for choosing a guide', answered.filter(t => t.heldOut !== true))
  ruleTable('Layout rules, held-out tasks', answered.filter(t => t.heldOut === true))
  const brokenLines: string[] = [], overrideLines: string[] = []
  for (const [k, found] of ruleVerdicts) {
    const where = k.replaceAll('|', ', ')
    for (const v of found) {
      if (!v.holds) brokenLines.push(`- ${where}: ${v.rule}, ${v.evidence}`)
      const { by, stale } = v.adjudicated
      if (by !== undefined) overrideLines.push(`- ${where}: ${v.rule} ${by.holds ? 'holds' : 'breaks'}, by a person: ${by.reason}`)
      for (const o of stale) overrideLines.push(`- ${where}: ${v.rule} ${o.holds ? 'holds' : 'breaks'}, by a person, not applied as the answer changed since: ${o.reason}`)
    }
  }
  if (brokenLines.length > 0) console.log(`\nEach broken rule:\n\n${brokenLines.join('\n')}`)
  if (overrideLines.length > 0) console.log(`\nOverrides:\n\n${overrideLines.join('\n')}`)

  // A claim the key forbids, in what the reader sees, is a material error whatever the full reply says.
  console.log('\nForbidden claims made (each one blocks adopting its guide until a person has read it):\n')
  let made = 0
  for (const t of tasks) {
    for (const { arm, rep, k } of slots(t)) {
      const g = each.get(k)?.g
      if (g === undefined) continue
      for (const [view, claimVerdicts] of [['skim', g.skim.never], ['full', g.full.never]] as const) {
        claimVerdicts.forEach((v, i) => {
          if (v !== 'yes') return
          made += 1
          console.log(`- ${arm}, ${t.id}, repeat ${rep}, ${view}: "${t.key.never[i] ?? ''}"`)
        })
      }
    }
  }
  if (made === 0) console.log('- none')
}

function report() {
  const out = outDir()
  const run = frozenRun(out)
  if (run.command !== 'run' || run.corpus === undefined) return fail(`${out} is not a corpus run`)
  if (sha256(readFileSync(CORPUS, 'utf8')) !== run.corpus.sha256) fail('bench/out/corpus.jsonl changed after this run started')
  const arms = Object.keys(run.arms)
  const ids = new Set(run.corpus.ids)
  const replies = new Map(corpusReplies().filter(r => ids.has(r.id)).map(r => [r.id, r]))
  const rewriteRows = rows(join(out, 'rewrites.jsonl'))
  const rewrites = textsOf(rewriteRows)
  const points = pointsByReply(rows(join(out, 'points.jsonl')))
  const judged = new Map(rows(join(out, 'judged.jsonl')).filter(isOk).map(row => {
    const pointCount = points.get(String(get(row, 'id')))?.length, labels = get(row, 'labels'), linksInView = get(row, 'linksInView')
    if (pointCount === undefined || typeof labels !== 'number' || typeof linksInView !== 'number') throw new Error(`the judgment of ${keyOf(row)} is malformed`)
    return [keyOf(row), { labels, linksInView, verdicts: gradesOf(get(row, 'verdicts'), pointCount, 'verdicts') }] as const
  }))
  const pct = (x: number) => `${(100 * x).toFixed(1)}`
  const repeats = repeatsOf(run)

  // A reply counts only where every arm has a judged rewrite in every repeat, so arms meet the same replies.
  const counted = [...replies.keys()].filter(id => arms.every(arm => repeats.every(rep => judged.has(at(arm, rep, id)) && rewrites.has(at(arm, rep, id)))))
  console.log(`writer ${run.writer} (effort ${run.effort}), judge ${run.judge}, Claude Code ${run.claude}; ${counted.length} of ${replies.size} replies judged in every arm and repeat`)
  const failedCalls = rewriteRows.filter(r => get(r, 'status') === 'error').length
  const broken = [...rewrites].filter(([k, text]) => shape(replies.get(k.split('|')[2] ?? '')?.reply ?? '', text).recall < VALID_RECALL).length
  console.log(`${rewriteRows.length} rewrite attempts: ${failedCalls} failed calls, ${broken} broken rewrites (kept under ${VALID_RECALL * 100}% of the content words)\n`)

  const metrics = ['skim share', 'right-only stretches', 'words added left', 'words added middle', 'colon titles', 'labels', 'top-3 points carried', 'all points carried'] as const
  // Each arm and repeat's measures, worked out once.
  const perRun = (arm: string, repeat: number) => {
    const found = counted.map(id => ({ s: shape(replies.get(id)?.reply ?? '', rewrites.get(at(arm, repeat, id)) ?? ''), j: judged.get(at(arm, repeat, id)) }))
    const added = found.reduce((a, r) => a + r.s.sides.before + r.s.sides.between + r.s.sides.after, 0)
    const links = found.reduce((a, r) => a + r.s.links, 0)
    const inView = found.reduce((a, r) => a + (r.j?.linksInView ?? 0), 0)
    return {
      'skim share': found.reduce((a, r) => a + r.s.skim, 0) / found.reduce((a, r) => a + r.s.original, 0),
      'right-only stretches': found.reduce((a, r) => a + r.s.rightOnly, 0) / links,
      'words added left': found.reduce((a, r) => a + r.s.sides.before, 0) / added,
      'words added middle': found.reduce((a, r) => a + r.s.sides.between, 0) / added,
      'colon titles': found.reduce((a, r) => a + r.s.colon, 0) / links,
      labels: found.reduce((a, r) => a + (r.j?.labels ?? 0), 0) / inView,
      'top-3 points carried': mean(found.map(r => mean((r.j?.verdicts ?? []).slice(0, 3).map(score)))),
      'all points carried': mean(found.map(r => mean((r.j?.verdicts ?? []).map(score)))),
    }
  }
  const measured = new Map(arms.map(arm => [arm, repeats.map(rep => perRun(arm, rep))]))
  console.log(`| measure | ${arms.join(' | ')} |`)
  console.log(`|${'---|'.repeat(arms.length + 1)}`)
  for (const m of metrics) {
    const cells = arms.map(arm => {
      const found = (measured.get(arm) ?? []).map(result => result[m])
      return `${pct(mean(found))} ± ${pct(sd(found))}`
    })
    console.log(`| ${m} (%) | ${cells.join(' | ')} |`)
  }
  console.log('\nEach cell: the mean of the repeats, ± how much the repeats differ (standard deviation).')
}

await chosen?.run()

// Compares guides on one frozen set of real replies. Each guide (an arm) rewrites every reply in the
// corpus, several times; each rewrite is then measured: how much of it the reader sees first, where
// its stretches add words around the short form, how many short forms are only labels, and how many
// of the reply's must-know points a blind reader of the shortest version still takes away.
//   node bench/ab.ts corpus --per-project 15 <~/.claude/projects/<dir>>...      freezes bench/out/corpus.jsonl
//   node bench/ab.ts run --out <dir> --arm <name>=<guide file>... [--repeats 3] [--writer haiku]
//                         [--judge haiku] [--concurrency 4] [--limit n]          resumes where <dir> stopped
//   node bench/ab.ts report --out <dir>                                          prints the comparison
// The tasks commands compare guides on replies written from scratch instead: each arm answers every
// task in tasks.ts, and a judge checks each answer, closed and open, against the task's key. Haiku
// writes no stretch unless a prompt asks for them (as of Claude Code 2.1.301), so it cannot write here.
//   node bench/ab.ts tasks --out <dir> --arm <name>=<guide file>... [--repeats 1] [--writer opus]
//                          [--judge haiku] [--concurrency 4] [--limit n]         resumes where <dir> stopped
//   node bench/ab.ts tasks-report --out <dir>                                    prints the comparison
// Calls `claude -p` in safe mode, so the person's own CLAUDE.md files, skills and plugins stay out.
// Raw text stays in bench/out/, which git ignores.
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { growthOf } from '../hooks/grow.ts'
import { drawnAs, parse, stretches } from '../hooks/parse.ts'
import { draw, render, words } from './measure.ts'
import { TASKS } from './tasks.ts'
import type { Task } from './tasks.ts'
import { turnsOf } from './transcripts.ts'

const CORPUS = new URL('./out/corpus.jsonl', import.meta.url)
const MIN_WORDS = 40
/** A rewrite keeping less of the original's content words than this is broken (a refusal, a summary), not shorter. */
const VALID_RECALL = 0.9
/** Calls failing in a row before the run stops: a spent usage limit or a lost login fails every call. */
const MAX_FAILURES = 8

type Reply = { id: string; project: string; session: string; turn: number; reply: string }
type Rewrite = { arm: string; repeat: number; id: string; text?: string; error?: string }
type Judged = { arm: string; repeat: number; id: string; labels: number; topLevel: number; verdicts: string[] }
/** One answer checked against its task's key: `skim` with every stretch closed, `full` with every one open. */
type Graded = {
  arm: string; repeat: number; id: string; labels: number; topLevel: number
  skim: { know: string[]; never: string[] }
  full: { know: string[]; defer: string[]; never: string[] }
}

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
const lines = <T>(file: string | URL): T[] =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as T) : []

// ---- Claude ----------------------------------------------------------------------------------

let failures = 0
/** An empty folder outside any repository: Claude Code puts the working folder's git status in its prompt. */
const BLANK = mkdtempSync(join(tmpdir(), 'cc-stretch-bench-'))

/** One `claude -p` answer. Stdin is closed at once, so Claude Code does not wait for piped input. */
function claude(model: string, prompt: string, system?: string): Promise<string> {
  const flags = ['-p', '--model', model, '--safe-mode', '--no-session-persistence', '--tools', '', '--output-format', 'json']
  return new Promise((resolve, reject) => {
    const child = execFile('claude', [...flags, ...(system === undefined ? [] : ['--append-system-prompt', system]), prompt],
      { maxBuffer: 1 << 26, timeout: 900000, cwd: BLANK }, (error, stdout) => {
        let result: { result?: string; is_error?: boolean } | undefined
        try {
          result = (JSON.parse(stdout) as { type?: string; result?: string; is_error?: boolean }[]).find(e => e.type === 'result')
        } catch {}
        if (error === null && result?.is_error !== true && typeof result?.result === 'string') {
          failures = 0
          resolve(result.result)
          return
        }
        failures += 1
        const killed = error?.killed === true ? `killed (${error.signal ?? 'timeout'}) after the time limit` : undefined
        reject(new Error((result?.result ?? killed ?? error?.message ?? 'no result').split('\n')[0]))
      })
    child.stdin?.end()
  })
}

const json = <T>(answer: string): T => JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? '{}') as T

// ---- Prompts -----------------------------------------------------------------------------------

const REWRITE = (reply: string) =>
  `Below is a reply you wrote earlier in a coding session, before stretches existed. Rewrite it the way you would write it now, with stretches: keep every fact, step, command, file path, number and decision it contains, leave nothing out, and add nothing new. With every stretch open, the text must say everything the original says. Output only the rewritten reply, nothing before or after it.\n\n<reply>\n${reply}\n</reply>`

const POINTS = (reply: string) =>
  `Below is a reply from a coding assistant. List its must-know points for the person who asked: the main answer, decisions they must make, actions they must take, results they must know. At most eight, the most important first, each one short sentence. Output only JSON of the form {"points":["..."]}.\n\n<reply>\n${reply}\n</reply>`

const READ = (text: string) =>
  `You are reading a reply from a coding assistant in a terminal, and this is all you can see of it. Write down, as a short numbered list, the main answer, every decision you are asked to make, every action you are told to take, and every result you are told about. Output only the list.\n\n<reply>\n${text}\n</reply>`

const CHECK = (points: string[], notes: string) =>
  `Below are the must-know points of a reply, and the notes of a reader who saw some version of it. For each point, in order, judge whether the notes capture it: "yes", "partly" or "no". Output only JSON of the form {"verdicts":["yes","no"]}, one verdict per point.\n\n<points>\n${points.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n</points>\n\n<notes>\n${notes}\n</notes>`

const LABELS = (skim: string, longs: string[]) =>
  `Below is a reply as a reader first sees it. Some phrases are marked ⟦n⟧…⟦/n⟧; a click on one replaces it with its long form, listed under the reply. Judge every marked phrase as it reads in its place, before any click:\n- "gist": it says something itself: a claim, an answer, a finding, a step, or a phrase that completes its sentence with real content.\n- "label": it only names or announces what its long form says, as a heading or a teaser does ("Details.", "What changed.", "Two options exist.", "The fix:").\nOutput only JSON of the form {"verdicts":{"1":"gist"}}, one entry per number.\n\n<reply>\n${skim}\n</reply>\n<long-forms>\n${longs.map((l, i) => `${i + 1}: ${l}`).join('\n')}\n</long-forms>`

const numbered = (items: string[]) => items.map((item, i) => `${i + 1}. ${item}`).join('\n')

const ANSWER = (task: Task) =>
  `I ran these in my project, on my machine, and pasted what they showed. That is all you know about the project; your own working folder is unrelated to it.\n\n<evidence>\n${task.evidence}\n</evidence>\n\n${task.question}`

const KEY = (text: string, know: string[], never: string[]) =>
  `Below is a reply from a coding assistant, as much of it as a reader sees, then a list of points and a list of claims. Judge only what the text itself says; do not fill gaps from the lists.\n- For each point, in order: does the text tell the reader this? "yes", "partly" or "no".\n- For each claim, in order: does the text state it, or leave a reader believing it? "yes" or "no".\nOutput only JSON of the form {"know":["yes"],"never":["no"]}, one entry per point and per claim.\n\n<text>\n${text}\n</text>\n\n<points>\n${numbered(know)}\n</points>\n\n<claims>\n${numbered(never)}\n</claims>`

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

// ---- Commands ----------------------------------------------------------------------------------

/** Freezes a seeded sample of real replies, so every later run reads the same ones. */
function corpus() {
  const perProject = Number(take('--per-project') ?? 15)
  const rows: Reply[] = []
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
    for (const t of turns.slice(0, perProject)) rows.push({ id: `${project}#${t.session}#${t.index}`, project, session: t.session, turn: t.index, reply: t.reply })
  }
  mkdirSync(new URL('./out/', import.meta.url), { recursive: true })
  writeFileSync(CORPUS, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(`froze ${rows.length} replies in bench/out/corpus.jsonl`)
}

function armsOf() {
  return takeAll('--arm').map(spec => {
    const [name, file] = spec.split('=')
    if (name === undefined || file === undefined) throw new Error(`--arm wants <name>=<guide file>, got ${spec}`)
    return { name, guide: readFileSync(file, 'utf8') }
  })
}

/** Runs `jobs` a few at a time, stopping once MAX_FAILURES calls in a row have failed. */
async function runJobs(jobs: (() => Promise<void>)[], concurrency: number) {
  let next = 0
  let stopped = false
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let job = jobs[next++]; job !== undefined && !stopped; job = jobs[next++]) {
      try {
        await job()
      } catch (error) {
        console.error(`${new Date().toISOString()} ${(error as Error).message}`)
        if (failures >= MAX_FAILURES) {
          stopped = true
          console.error(`stopped: ${MAX_FAILURES} calls failed in a row`)
        }
      }
    }
  }))
  console.log(`${stopped ? 'stopped' : 'done'}: ${Math.min(next, jobs.length)} of ${jobs.length} jobs started`)
}

async function runAll() {
  const out = take('--out')
  if (out === undefined) throw new Error('--out <dir> is required')
  const arms = armsOf()
  const repeats = Number(take('--repeats') ?? 3)
  const writer = take('--writer') ?? 'haiku'
  const judge = take('--judge') ?? 'haiku'
  const concurrency = Number(take('--concurrency') ?? 4)
  const limit = Number(take('--limit') ?? Infinity)
  mkdirSync(out, { recursive: true })
  const replies = lines<Reply>(CORPUS).slice(0, limit)
  if (replies.length === 0) throw new Error('no corpus: run `node bench/ab.ts corpus` first')
  writeFileSync(`${out}/config.json`, JSON.stringify({ arms: arms.map(a => a.name), repeats, writer, judge, corpus: replies.length }, null, 2))
  for (const arm of arms) writeFileSync(`${out}/guide-${arm.name}.txt`, arm.guide)

  const key = (r: { arm?: string; repeat?: number; id: string }) => `${r.arm}|${r.repeat}|${r.id}`
  const points = new Map(lines<{ id: string; points: string[] }>(`${out}/points.jsonl`).map(p => [p.id, p.points]))
  const rewrites = new Map(lines<Rewrite>(`${out}/rewrites.jsonl`).filter(r => r.text !== undefined).map(r => [key(r), r]))
  const judged = new Set(lines<Judged>(`${out}/judged.jsonl`).map(key))

  const jobs: (() => Promise<void>)[] = []
  // Each reply's must-know points come from its original, once, so every arm is checked against the same list.
  for (const r of replies.filter(r => !points.has(r.id))) {
    jobs.push(async () => {
      const found = json<{ points?: string[] }>(await claude(judge, POINTS(r.reply))).points ?? []
      if (found.length === 0) throw new Error('no points')
      points.set(r.id, found)
      appendFileSync(`${out}/points.jsonl`, `${JSON.stringify({ id: r.id, points: found })}\n`)
    })
  }
  // Arms take turns within each repeat, so a run stopped early still compares them on the same replies.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const r of replies) {
      for (const arm of arms) {
        const k = key({ arm: arm.name, repeat, id: r.id })
        if (judged.has(k)) continue
        jobs.push(async () => {
          let text = rewrites.get(k)?.text
          if (text === undefined) {
            try {
              text = (await claude(writer, REWRITE(r.reply), arm.guide)).trim()
              appendFileSync(`${out}/rewrites.jsonl`, `${JSON.stringify({ arm: arm.name, repeat, id: r.id, text })}\n`)
            } catch (error) {
              appendFileSync(`${out}/rewrites.jsonl`, `${JSON.stringify({ arm: arm.name, repeat, id: r.id, error: (error as Error).message })}\n`)
              throw error
            }
          }
          if (shape(r.reply, text).recall < VALID_RECALL) return
          const list = points.get(r.id)
          if (list === undefined) return
          const { skim, longs } = marked(text)
          const labelVerdicts = longs.length === 0 ? {} : json<{ verdicts?: Record<string, string> }>(await claude(judge, LABELS(skim, longs))).verdicts ?? {}
          const notes = await claude(judge, READ(render(text, new Set())))
          const verdicts = json<{ verdicts?: string[] }>(await claude(judge, CHECK(list, notes))).verdicts ?? []
          const row: Judged = { arm: arm.name, repeat, id: r.id, labels: Object.values(labelVerdicts).filter(v => v === 'label').length, topLevel: longs.length, verdicts }
          appendFileSync(`${out}/judged.jsonl`, `${JSON.stringify(row)}\n`)
        })
      }
    }
  }
  await runJobs(jobs, concurrency)
}

async function runTasks() {
  const out = take('--out')
  if (out === undefined) throw new Error('--out <dir> is required')
  const arms = armsOf()
  const repeats = Number(take('--repeats') ?? 1)
  const writer = take('--writer') ?? 'opus'
  const judge = take('--judge') ?? 'haiku'
  const concurrency = Number(take('--concurrency') ?? 4)
  const tasks = TASKS.slice(0, Number(take('--limit') ?? Infinity))
  mkdirSync(out, { recursive: true })
  writeFileSync(`${out}/config.json`, JSON.stringify({ arms: arms.map(a => a.name), repeats, writer, judge, tasks: tasks.map(t => t.id) }, null, 2))
  for (const arm of arms) writeFileSync(`${out}/guide-${arm.name}.txt`, arm.guide)

  const key = (r: { arm: string; repeat: number; id: string }) => `${r.arm}|${r.repeat}|${r.id}`
  const answers = new Map(lines<Rewrite>(`${out}/answers.jsonl`).filter(r => r.text !== undefined).map(r => [key(r), r]))
  const graded = new Set(lines<Graded>(`${out}/graded.jsonl`).map(key))
  const check = async (text: string, know: string[], never: string[]) => {
    const v = json<{ know?: string[]; never?: string[] }>(await claude(judge, KEY(text, know, never)))
    if (v.know?.length !== know.length || v.never?.length !== never.length) throw new Error('the judge gave the wrong number of verdicts')
    return { know: v.know, never: v.never }
  }

  const jobs: (() => Promise<void>)[] = []
  // Arms take turns within each repeat, so a run stopped early still compares them on the same tasks.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const task of tasks) {
      for (const arm of arms) {
        const k = key({ arm: arm.name, repeat, id: task.id })
        if (graded.has(k)) continue
        jobs.push(async () => {
          let text = answers.get(k)?.text
          if (text === undefined) {
            try {
              text = (await claude(writer, ANSWER(task), arm.guide)).trim()
              appendFileSync(`${out}/answers.jsonl`, `${JSON.stringify({ arm: arm.name, repeat, id: task.id, text })}\n`)
            } catch (error) {
              appendFileSync(`${out}/answers.jsonl`, `${JSON.stringify({ arm: arm.name, repeat, id: task.id, error: (error as Error).message })}\n`)
              throw error
            }
          }
          const { skim, longs } = marked(text)
          const labelVerdicts = longs.length === 0 ? {} : json<{ verdicts?: Record<string, string> }>(await claude(judge, LABELS(skim, longs))).verdicts ?? {}
          const closed = await check(render(text, new Set()), task.key.know, task.key.never)
          const opened = await check(render(text, 'all'), [...task.key.know, ...task.key.defer], task.key.never)
          const row: Graded = {
            arm: arm.name, repeat, id: task.id,
            labels: Object.values(labelVerdicts).filter(v => v === 'label').length, topLevel: longs.length,
            skim: closed,
            full: { know: opened.know.slice(0, task.key.know.length), defer: opened.know.slice(task.key.know.length), never: opened.never },
          }
          appendFileSync(`${out}/graded.jsonl`, `${JSON.stringify(row)}\n`)
        })
      }
    }
  }
  await runJobs(jobs, concurrency)
}

function tasksReport() {
  const out = take('--out')
  if (out === undefined) throw new Error('--out <dir> is required')
  const config = JSON.parse(readFileSync(`${out}/config.json`, 'utf8')) as { arms: string[]; repeats: number; writer: string; judge: string; tasks: string[] }
  const answers = lines<Rewrite>(`${out}/answers.jsonl`)
  const graded = new Map(lines<Graded>(`${out}/graded.jsonl`).map(g => [`${g.arm}|${g.repeat}|${g.id}`, g]))
  const score = (v: string | undefined) => (v === 'yes' ? 1 : v === 'partly' ? 0.5 : 0)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const sd = (xs: number[]) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)))
  const repeats = Array.from({ length: config.repeats }, (_, i) => i + 1)

  // A task counts only where every arm has a graded answer in every repeat, so arms meet the same tasks.
  const tasks = TASKS.filter(t => config.tasks.includes(t.id) && config.arms.every(arm => repeats.every(rep => graded.has(`${arm}|${rep}|${t.id}`))))
  console.log(`writer ${config.writer}, judge ${config.judge}; ${tasks.length} of ${config.tasks.length} tasks graded in every arm and repeat; ${answers.filter(a => a.error !== undefined).length} failed writer calls\n`)

  const cell = (arm: string, id: string) => {
    const runs = repeats.flatMap(rep => {
      const g = graded.get(`${arm}|${rep}|${id}`)
      const text = answers.find(a => a.arm === arm && a.repeat === rep && a.id === id && a.text !== undefined)?.text
      return g === undefined || text === undefined ? [] : [{ g, text, s: shape('', text) }]
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
    console.log(`${title}\n\n| task | ${config.arms.join(' | ')} |\n|${'---|'.repeat(config.arms.length + 1)}`)
    for (const t of tasks) console.log(`| ${t.id} | ${config.arms.map(arm => show(cell(arm, t.id))).join(' | ')} |`)
    console.log('')
  }
  const pct = (x: number) => `${Math.round(100 * x)}%`
  table('Must-know points the skim carries', c => pct(c.know))
  table('Words: skim / full', c => `${Math.round(c.skimWords)} / ${Math.round(c.fullWords)}`)
  table('Top-level stretches (of them, labels)', c => `${c.stretches.toFixed(1)} (${c.labels.toFixed(1)})`)

  const [base, ...rest] = config.arms
  if (base !== undefined && rest.length > 0) {
    console.log(`Against ${base}, per task: the mean change in must-know points the skim carries, ± its spread across tasks; tasks better / same / worse.\n`)
    for (const arm of rest) {
      const diffs = tasks.map(t => cell(arm, t.id).know - cell(base, t.id).know)
      const better = diffs.filter(d => d > 0).length, worse = diffs.filter(d => d < 0).length
      console.log(`- ${arm}: ${pct(mean(diffs))} ± ${pct(sd(diffs))}; ${better} / ${diffs.length - better - worse} / ${worse}`)
    }
    console.log('')
  }
  for (const arm of config.arms) {
    const all = tasks.map(t => cell(arm, t.id))
    console.log(`- ${arm}: full reply carries ${pct(mean(all.map(c => c.full)))} of all key points; ${pct(all.reduce((a, c) => a + c.rightOnly, 0) / Math.max(1, all.reduce((a, c) => a + c.allStretches, 0)))} of stretches only add words after the short form`)
  }

  // A claim the key forbids, in what the reader sees, is a material error whatever the full reply says.
  console.log('\nForbidden claims made (each one blocks adopting its guide until a person has read it):\n')
  let made = 0
  for (const t of tasks) {
    for (const arm of config.arms) {
      for (const rep of repeats) {
        const g = graded.get(`${arm}|${rep}|${t.id}`)
        for (const [view, verdicts] of [['skim', g?.skim.never], ['full', g?.full.never]] as const) {
          verdicts?.forEach((v, i) => {
            if (v !== 'yes') return
            made += 1
            console.log(`- ${arm}, ${t.id}, repeat ${rep}, ${view}: "${t.key.never[i]}"`)
          })
        }
      }
    }
  }
  if (made === 0) console.log('- none')
}

function report() {
  const out = take('--out')
  if (out === undefined) throw new Error('--out <dir> is required')
  const config = JSON.parse(readFileSync(`${out}/config.json`, 'utf8')) as { arms: string[]; repeats: number; writer: string; judge: string; corpus: number }
  const replies = new Map(lines<Reply>(CORPUS).slice(0, config.corpus).map(r => [r.id, r]))
  const rewrites = lines<Rewrite>(`${out}/rewrites.jsonl`)
  const judged = new Map(lines<Judged>(`${out}/judged.jsonl`).map(j => [`${j.arm}|${j.repeat}|${j.id}`, j]))
  const score = (v: string | undefined) => (v === 'yes' ? 1 : v === 'partly' ? 0.5 : 0)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const sd = (xs: number[]) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)))
  const pct = (x: number) => `${(100 * x).toFixed(1)}`

  // A reply counts only where every arm has a judged rewrite in every repeat, so arms meet the same replies.
  const ids = [...replies.keys()].filter(id => config.arms.every(arm => Array.from({ length: config.repeats }, (_, i) => i + 1).every(rep => judged.has(`${arm}|${rep}|${id}`))))
  console.log(`writer ${config.writer}, judge ${config.judge}; ${ids.length} of ${replies.size} replies judged in every arm and repeat`)
  const failed = rewrites.filter(r => r.error !== undefined).length
  const broken = rewrites.filter(r => r.text !== undefined && shape(replies.get(r.id)?.reply ?? '', r.text).recall < VALID_RECALL).length
  console.log(`${rewrites.length} rewrite attempts: ${failed} failed calls, ${broken} broken rewrites (kept under ${VALID_RECALL * 100}% of the content words)\n`)

  const metrics = ['skim share', 'right-only stretches', 'words added left', 'words added middle', 'colon titles', 'labels', 'top-3 points carried', 'all points carried'] as const
  const perRun = (arm: string, repeat: number) => {
    const rows = ids.map(id => {
      const text = rewrites.find(r => r.arm === arm && r.repeat === repeat && r.id === id && r.text !== undefined)?.text ?? ''
      return { s: shape(replies.get(id)?.reply ?? '', text), j: judged.get(`${arm}|${repeat}|${id}`) }
    })
    const added = rows.reduce((a, r) => a + r.s.sides.before + r.s.sides.between + r.s.sides.after, 0)
    const stretchCount = rows.reduce((a, r) => a + r.s.stretches, 0)
    const top = rows.reduce((a, r) => a + (r.j?.topLevel ?? 0), 0)
    return {
      'skim share': rows.reduce((a, r) => a + r.s.skim, 0) / rows.reduce((a, r) => a + r.s.original, 0),
      'right-only stretches': rows.reduce((a, r) => a + r.s.rightOnly, 0) / stretchCount,
      'words added left': rows.reduce((a, r) => a + r.s.sides.before, 0) / added,
      'words added middle': rows.reduce((a, r) => a + r.s.sides.between, 0) / added,
      'colon titles': rows.reduce((a, r) => a + r.s.colon, 0) / stretchCount,
      labels: rows.reduce((a, r) => a + (r.j?.labels ?? 0), 0) / top,
      'top-3 points carried': mean(rows.map(r => mean((r.j?.verdicts ?? []).slice(0, 3).map(score)))),
      'all points carried': mean(rows.map(r => mean((r.j?.verdicts ?? []).map(score)))),
    }
  }
  const header = `| measure | ${config.arms.join(' | ')} |`
  console.log(header)
  console.log(`|${'---|'.repeat(config.arms.length + 1)}`)
  for (const m of metrics) {
    const cells = config.arms.map(arm => {
      const runs = Array.from({ length: config.repeats }, (_, i) => perRun(arm, i + 1)[m])
      return `${pct(mean(runs))} ± ${pct(sd(runs))}`
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
else console.error('usage: node bench/ab.ts corpus|run|report|tasks|tasks-report ...')

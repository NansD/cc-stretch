// The guide's rules that a reply's text alone can decide, checked with the plugin's own parser and
// drawing rule. Each rule names the guide bullet it checks. A rule never calls a model, and its
// verdicts are not stored: a report computes them from the saved answers, so a corrected rule
// rescores every earlier run. Whether the skim tells the reader what they need is a model's
// judgment instead, in grading.ts.
import { growthOf } from '../hooks/grow.ts'
import { HEADING, LIST_ITEM, QUOTE, TABLE_ROW } from '../hooks/layout.ts'
import { drawnAs, isOpenable, isRule, parse, stretches } from '../hooks/parse.ts'
import type { Segment, Stretch } from '../hooks/parse.ts'
import { draw } from './measure.ts'
import type { Layout } from './tasks.ts'

export type RuleId =
  | 'keeps-short-words'
  | 'inline-short'
  | 'adds-words'
  | 'not-in-heading-or-table'
  | 'no-stretch-when-short'
  | 'items-stay-visible'
  | 'closing-block-last'

/** One rule's verdict on one answer, with what broke it. */
export type RuleVerdict = { rule: RuleId; holds: boolean; evidence: string }

/** A reply as the rules read it: every stretch in it, and its text with each link marked where it stands. */
type Read = { parts: Segment[]; all: Stretch[]; links: Stretch[]; skim: string[]; full: string[] }

type Rule = {
  id: RuleId
  /** The guide bullet the rule checks. */
  bullet: string
  appliesTo: (task: Layout) => boolean
  /** What breaks the rule in this reply, or undefined when it holds. */
  breach: (reply: Read, task: Layout) => string | undefined
}

const quoted = (text: string) => `"${text.trim()}"`
const added = (stretch: Stretch) => {
  const g = growthOf(stretch.short, stretch.long ?? [])
  return g.before + g.between + g.after
}

export const RULES: readonly Rule[] = [
  {
    id: 'keeps-short-words',
    bullet: 'The long form keeps every word of the short form, in the same order, and grows around them.',
    appliesTo: () => true,
    breach: ({ all }) => {
      const broken = all.find(s => drawnAs(s) === 'link' && growthOf(s.short, s.long ?? []).missing > 0)
      return broken && `the long form of ${quoted(broken.short)} drops or reorders its words`
    },
  },
  {
    id: 'inline-short',
    bullet: 'The short form is plain inline text on one line.',
    appliesTo: () => true,
    breach: ({ all }) => {
      const broken = all.find(s => isOpenable(s) && (s.short.includes('\n') || [HEADING, QUOTE, LIST_ITEM].some(mark => mark.test(s.short.trimStart()))))
      return broken && `the short form ${quoted(broken.short)} is not one plain line`
    },
  },
  {
    id: 'adds-words',
    bullet: 'A stretch puts depth where it stands: its long form says more than its short form.',
    appliesTo: () => true,
    breach: ({ all }) => {
      const empty = all.find(s => drawnAs(s) === 'link' && added(s) === 0)
      return empty && `${quoted(empty.short)} opens to nothing new`
    },
  },
  {
    id: 'not-in-heading-or-table',
    bullet: 'Never put a stretch inside a code span, a code block, a table or a heading.',
    appliesTo: () => true,
    breach: ({ full }) => {
      const line = full.find(row => (TABLE_ROW.test(row) || HEADING.test(row)) && MARK.test(row))
      return line && `a stretch sits in the heading or table row ${quoted(unmarked(line))}`
    },
  },
  {
    id: 'no-stretch-when-short',
    bullet: 'A reply that is already short needs no stretches.',
    appliesTo: task => task.needsNoStretch === true,
    breach: ({ all }) => {
      const stretch = all.find(isOpenable)
      return stretch && `a short answer still stretches ${quoted(stretch.short)}`
    },
  },
  {
    id: 'items-stay-visible',
    bullet: 'Stretch list items, not whole lists.',
    appliesTo: task => (task.items?.length ?? 0) > 0,
    breach: (reply, task) => missingItems(reply, task.items ?? []),
  },
  {
    id: 'closing-block-last',
    bullet: "If other instructions require a closing block, make it the reply's last stretch.",
    appliesTo: task => task.closing !== undefined,
    breach: ({ parts }) => {
      const last = [...parts].reverse().find(part => typeof part !== 'string' || part.trim() !== '')
      if (last === undefined || typeof last === 'string') return 'the reply does not end in a stretch'
      if (drawnAs(last) !== 'link') return `the reply ends in ${quoted(last.short)}, which is not a link`
      const rules = draw(last.long ?? [], 'all').split('\n').filter(isRule).length
      return rules >= 2 ? undefined : `the last stretch, ${quoted(last.short)}, holds no block between two rules`
    },
  },
]

/** The verdict of every rule that applies to `task` on the answer `text`. */
export function verdictsOf(text: string, task: Layout): RuleVerdict[] {
  const reply = read(text)
  return RULES.filter(rule => rule.appliesTo(task)).map(rule => {
    const breach = rule.breach(reply, task)
    return { rule: rule.id, holds: breach === undefined, evidence: breach ?? '' }
  })
}

// Each link a line shows is marked by its index in `links` around its text.
const MARK = /⟪(\d+)⟫/
const unmarked = (line: string) => line.replace(/⟪\/?\d+⟫/g, '')

function read(text: string): Read {
  const parts = parse(text)
  const links: Stretch[] = []
  const mark = (s: Stretch, inner: string) => {
    links.push(s)
    return `⟪${links.length - 1}⟫${inner}⟪/${links.length - 1}⟫`
  }
  // The skim marks the links in view; the full text opens every link and marks where each stood.
  const skim = (segments: Segment[]): string =>
    segments
      .map(part => {
        if (typeof part === 'string') return part
        const kind = drawnAs(part)
        if (kind === 'text') return part.short
        if (kind === 'open') return (part.long ?? []).length === 0 ? part.short : skim(part.long ?? [])
        return mark(part, part.short)
      })
      .join('')
  const full = (segments: Segment[]): string =>
    segments
      .map(part => {
        if (typeof part === 'string') return part
        const kind = drawnAs(part)
        if (kind === 'text') return part.short
        if (kind === 'open') return (part.long ?? []).length === 0 ? part.short : full(part.long ?? [])
        return mark(part, full(part.long ?? []))
      })
      .join('')
  const skimLines = skim(parts).split('\n')
  const fullLines = full(parts).split('\n')

  return { parts, all: stretches(parts), links, skim: skimLines, full: fullLines }
}

/**
 * Which items are hidden or share a stretch: every item must be named in the skim, and the items
 * must pair one to one with distinct links that add words, each on a skim line naming its item.
 * Where links on such a line name the item in their short form, the item pairs only with those, so
 * a stretch about something else is not taken for the item's own.
 */
function missingItems({ skim, links }: Read, items: string[][]): string | undefined {
  const names = (item: string[], line: string) => item.some(word => unmarked(line).toLowerCase().includes(word.toLowerCase()))
  const hidden = items.filter(item => !skim.some(line => names(item, line)))
  if (hidden.length > 0) return `not in the skim: ${hidden.map(item => item[0] ?? '').join(', ')}`

  const candidates = items.map(item =>
    skim
      .filter(line => names(item, line))
      .flatMap(line => {
        const onLine = [...line.matchAll(/⟪(\d+)⟫/g)].map(m => Number(m[1]))
        const naming = onLine.filter(i => names(item, links[i]?.short ?? ''))
        return naming.length > 0 ? naming : onLine
      })
      .filter(i => {
        const link = links[i]
        return link !== undefined && added(link) > 0
      }),
  )
  // A one-to-one pairing by augmenting paths, so an item is not refused a link another could spare.
  const holder = new Map<number, number>()
  const place = (item: number, seen: Set<number>): boolean =>
    (candidates[item] ?? []).some(link => {
      if (seen.has(link)) return false
      seen.add(link)
      const other = holder.get(link)
      if (other === undefined || place(other, seen)) {
        holder.set(link, item)
        return true
      }
      return false
    })
  const alone = items.filter((_, i) => !place(i, new Set()))

  return alone.length === 0 ? undefined : `without a stretch of their own: ${alone.map(item => item[0] ?? '').join(', ')}`
}

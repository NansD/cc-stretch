// The guide variants the guide bench compares, by name: the plugin's own guide (g0) and versions of
// it with lines added after one of its bullets, so each differs from g0 only in those lines. A guide
// tried once stays here under its name, so a later run can compare against it.
import { GUIDE } from '../hooks/guide.ts'

const AFTER_LONG = '- The long form must read correctly in the short form'
const AFTER_SHORTEST = '- At its shortest, the reply is one to three short sentences'

const GROW = `- Grow inside the sentence where you can. The best stretch adds a qualifier before a word, a clause between two words and a detail after them, so the short form reads as the same sentence with less in it. A stretch that only adds text after its short form reads like a heading and its body, and the reader has to open it to learn anything. Example: "{{The fix keys the cache on the lockfile.|The fix, in \`ci/cache.ts\`, keys the CI cache on the lockfile as well as \`package.json\`, so a dependency bump no longer reuses a stale cache.}}"`
const FILLER = `- Keep the shortest reading to what the reader needs: the answer, what they must decide or do, and the results. Hedges, reasons, background, caveats, restatements and courtesy go inside long forms, where a reader who wants them finds them.`
const LABEL = `- Each short form says something itself, the gist of its long form. A label for the long form, such as "Details." or "What changed.", is not a short form.`
const TRUE = `- Every short form stays true without a click. A condition, doubt, limit or warning that changes what it claims, or what the reader should do next, stays in the short form itself: "the import probably finishes tonight" never shortens to "the import finishes tonight", nor "safe to rerun once the lock is released" to "safe to rerun".`
const CLAIM = `- To find a short form, write the full sentence, then delete words until what is left is a grammatical claim with the same subject and outcome. A short form makes that claim ("The retry duplicates writes."); it never only announces its topic ("Retry details." or "There is a retry issue.").`

/**
 * `base` with `line` inserted after the bullet that starts with `anchor`, or `base` itself when it
 * already holds `line`: a line the plugin's guide took up keeps every variant that adds it the same.
 */
function withLine(base: string, anchor: string, line: string): string {
  const rows = base.split('\n')
  if (rows.includes(line)) return base
  const at = rows.findIndex(row => row.startsWith(anchor))
  if (at === -1) throw new Error(`no bullet starts with ${anchor}`)
  return [...rows.slice(0, at + 1), line, ...rows.slice(at + 1)].join('\n')
}

const LIST = '- Stretch list items, not whole lists.'

/** Each variant as the lines it adds and the bullet each goes after, in reading order. */
const RECIPES: Readonly<Record<string, readonly (readonly [anchor: string, line: string])[]>> = {
  g0: [],
  /** Grow inside the sentence. */
  g1: [[AFTER_LONG, GROW]],
  /** Keep the shortest reading to what the reader needs. */
  g2: [[AFTER_SHORTEST, FILLER]],
  /** g1 and g2 together. */
  g3: [[AFTER_SHORTEST, FILLER], [AFTER_LONG, GROW]],
  /** A short form is a gist, never a label. */
  g4: [[AFTER_SHORTEST, LABEL]],
  /** Every short form stays true without a click. */
  g5: [[AFTER_SHORTEST, TRUE]],
  /** g5, and a short form makes a claim rather than naming a topic. */
  g6: [[AFTER_SHORTEST, TRUE], [AFTER_LONG, CLAIM]],
  /** Each list item is a stretch of its own, so the list stays in view. */
  g7: [[AFTER_SHORTEST, LIST]],
}

export const VARIANTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RECIPES).map(([name, recipe]) => [name, recipe.reduce((guide, [anchor, line]) => withLine(guide, anchor, line), GUIDE)]),
)

/** The lines each variant adds to g0, in reading order, for a test to hold it to them. */
export const ADDED: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(RECIPES).map(([name, recipe]) => [name, recipe.map(([, line]) => line).filter(line => !GUIDE.split('\n').includes(line))]),
)

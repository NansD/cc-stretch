import type { ClientModule, ClientSurface, TextProps } from 'claude-code'

import { grow, lengthOf } from './grow'
import { isMarkup, layout, link, linkAt, targetsIn, tint, widthOf } from './layout'
import type { Action, Row, Run } from './layout'
import { closeAfter, isLinkable, KEY_SEPARATOR, parse } from './parse'
import type { Segment, Stretch } from './parse'

// Draws one paragraph of a reply that holds stretches. It runs where the reader's screen draws it,
// so a press answers at once and the growth moves on the screen's own frame clock. What the reader
// opens is posted to the hooks module, which keeps it across redraws, notes it for Claude and picks
// its colour.

/**
 * The colours of an open stretch: of the words it added (faded unless it is the newest) and of its
 * closer, which never fades, as a faded closer reads as disabled.
 */
export type Tint = { words: string; closer: string }

/** A stretch the reader asked to open or close from the keyboard, numbered so each ask acts once. */
type Ask = { key: string; action: Action; n: number }

/** While letters show: whether typing one opens or closes, and the letter of each stretch they cover. */
type Letters = { action: Action; keys: Record<string, string> }

/** The paragraph, the stretches the reader already has open in it, the tint of each, the last ask, and its letters. */
export type ReplyProps = { text: string; open: string[]; tints: Record<string, Tint>; ask: Ask | null; letters: Letters | null }

/**
 * What the instance posts to the hooks module when the open stretches change, with the stretch the
 * reader just opened: its short form for the note to Claude, its key for its colour.
 */
export type ReplyPost = { open: string[]; opened?: { short: string; key: string } }

/** A run as drawn: a letter over the first character of a short form or a «, or the rest of that text after it. */
type DrawnRun = Run & { isLetter?: true; isAfterLetter?: true }

type Growth = { key: string; isOpening: boolean; progress: number; duration: number }
/** What is open, what is growing, and the number of the last ask acted on. */
type State = { open: string[]; growth: Growth | null; asked: number }

const FRAME_MS = 16
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// What the last call drew, per instance, so a press is matched against the rows on screen.
const drawn = new WeakMap<object, { rows: Row[]; segments: Segment[] }>()
// The last ask each instance was handed, acted on at its next frame rather than while drawing.
const asks = new WeakMap<object, Ask>()

const Reply: ClientModule<ReplyProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  // An ask made before this instance was drawn is not acted on again.
  const fresh: State = { open: props.open, growth: null, asked: props.ask?.n ?? 0 }
  if (surface.state === undefined) {
    surface.setState(fresh)
    surface.onPointer(event => {
      if (event.type === 'down' && event.button === 'left') press(surface, event.x, event.y)
    })
    surface.every(FRAME_MS, () => tick(surface))
  }
  if (props.ask !== null) asks.set(surface, props.ask)
  const state = surface.state ?? fresh
  const segments = parse(props.text)
  // Read through Maps, which hold own keys only: a stretch keyed `constructor` must not find Object's.
  const tints = new Map(Object.entries(props.tints))
  const rows = lettered(layout(compose(segments, state, tints), surface.columns > 0 ? surface.columns : 80), props.letters)
  drawn.set(surface, { rows, segments })
  // In Claude Code 2.1.302 in WezTerm 20260905-195314-b99b1ca2, the cells that start the next
  // paragraph were seen taking the style this paragraph's last row ends in, a stretch's underline or a
  // letter's background, so a last row that ends styled ends in one plain cell.
  const last = rows.at(-1)?.at(-1)
  const tail = last !== undefined && Object.keys(styleOf(last)).length > 0 ? <Text> </Text> : null

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Text wrap="truncate">
          {row.length === 0 ? ' ' : row.map(run => <Text {...styleOf(run)}>{run.text}</Text>)}
          {i === rows.length - 1 && tail}
        </Text>
      ))}
    </Box>
  )
}

export default Reply

/**
 * The paragraph as the reader sees it now: closed stretches as pressable short forms, open ones in
 * full then a «, the words each added in its tint.
 */
function compose(segments: Segment[], state: State, tints: ReadonlyMap<string, Tint>): string {
  const write = (parts: Segment[]): string => parts.map(part => (typeof part === 'string' ? part : draw(part))).join('')
  const draw = (stretch: Stretch): string => {
    if (stretch.long === undefined || !stretch.isClosed) return stretch.short
    // A short form over several lines is drawn open, or as written when its long form is empty.
    if (!isLinkable(stretch)) return stretch.long.length === 0 ? stretch.short : write(stretch.long)
    const colours = tints.get(stretch.key)
    const paint = (word: string) => (colours === undefined || isMarkup(word) ? word : tint(colours.words, word))
    if (state.growth?.key === stretch.key) return grow(stretch.short, stretch.long, easeInOut(state.growth.progress), draw, paint)
    if (!state.open.includes(stretch.key)) return link('open', stretch.key, stretch.short)
    const closer = link('close', stretch.key, '«')
    const long = grow(stretch.short, stretch.long, 1, draw, paint)
    return closeAfter(long, colours === undefined ? closer : tint(colours.closer, closer), '\n')
  }

  return write(segments)
}

/**
 * The rows with each letter drawn over the first character of what a press on its stretch acts on,
 * its short form or its «, so nothing on screen moves; the rest of that text is marked.
 */
function lettered(rows: Row[], letters: Letters | null): DrawnRun[][] {
  if (letters === null) return rows
  const keys = new Map(Object.entries(letters.keys))
  const done = new Set<string>()
  return rows.map(row =>
    row.flatMap((run): DrawnRun[] => {
      const { link } = run
      const letter = link?.action === letters.action ? keys.get(link.key) : undefined
      if (link === undefined || letter === undefined) return [run]
      if (done.has(link.key)) return [{ ...run, isAfterLetter: true }]
      done.add(link.key)
      const first = GRAPHEMES.segment(run.text).containing(0)?.segment
      if (first === undefined) return [run]
      const rest = run.text.slice(first.length)
      // A letter takes one cell, so a wide first character keeps its second cell as a space.
      const cover: DrawnRun = { ...run, text: widthOf(first) > 1 ? `${letter} ` : letter, isLetter: true }
      return rest === '' ? [cover] : [cover, { ...run, text: rest, isAfterLetter: true }]
    }),
  )
}

function press(surface: ClientSurface<State>, x: number, y: number) {
  const target = linkAt(drawn.get(surface)?.rows ?? [], x, y)
  if (target !== undefined) openOrClose(surface, target.action, target.key)
}

/**
 * Opens or closes stretch `key` as a press on it does; false when no link on screen does that, as
 * for a letter the hooks gave a stretch still growing open, whose « is not drawn yet.
 */
function openOrClose(surface: ClientSurface<State>, action: Action, key: string, asked?: number): boolean {
  const state = surface.state
  const shown = drawn.get(surface)
  if (state === undefined || shown === undefined || !hasLink(shown.rows, action, key)) return false

  // A stretch still shrinking when another press lands is closed at once, so what can be pressed is
  // judged without it: a press inside it, or a letter put up before it closed, does nothing.
  const open = state.growth !== null && !state.growth.isOpening ? closed(state.open, state.growth.key) : state.open
  const stretch = targetsIn(shown.segments, open, action).find(one => one.key === key)
  if (stretch?.long === undefined) return false
  const duration = 1000 * Math.min(1.4, 0.45 + lengthOf(stretch.long) / 70)
  const acted = asked ?? state.asked
  if (action === 'open') {
    const next = [...open.filter(k => k !== stretch.key), stretch.key]
    surface.setState({ open: next, growth: { key: stretch.key, isOpening: true, progress: 0, duration }, asked: acted })
    surface.post({ open: next, opened: { short: stretch.short.trim(), key: stretch.key } } satisfies ReplyPost)
  } else {
    surface.setState({ open, growth: { key: stretch.key, isOpening: false, progress: 1, duration }, asked: acted })
  }

  return true
}

function tick(surface: ClientSurface<State>) {
  const state = surface.state
  const ask = asks.get(surface)
  if (state !== undefined && ask !== undefined && ask.n > state.asked) {
    // The ask is spent with no change when its stretch cannot be pressed for it.
    if (!openOrClose(surface, ask.action, ask.key, ask.n)) surface.setState({ ...state, asked: ask.n })
    return
  }
  if (state?.growth == null) return
  const { growth } = state
  const progress = growth.progress + ((growth.isOpening ? 1 : -1) * FRAME_MS) / growth.duration
  if (progress > 0 && progress < 1) {
    surface.setState({ ...state, growth: { ...growth, progress } })
    return
  }
  // A shrunk stretch, and every stretch inside it, leaves the open list as its growth ends.
  const open = growth.isOpening ? state.open : closed(state.open, growth.key)
  surface.setState({ ...state, open, growth: null })
  if (!growth.isOpening) surface.post({ open } satisfies ReplyPost)
}

/** Whether `rows` draw a link that does `action` to stretch `key`. */
function hasLink(rows: Row[], action: Action, key: string): boolean {
  return rows.some(row => row.some(run => run.link?.action === action && run.link.key === key))
}

function closed(open: string[], key: string): string[] {
  return open.filter(k => k !== key && !k.startsWith(`${key}${KEY_SEPARATOR}`))
}

function styleOf(run: DrawnRun): TextProps {
  return {
    ...(run.bold && { bold: true }),
    ...(run.italic && { italic: true }),
    ...(run.underline && { underline: true }),
    ...(run.dim && { dimColor: true }),
    ...(run.tint && { color: run.tint }),
    ...(run.code && { color: 'permission' }),
    // Underlined, in the text's own colour, marks what a press acts on, leaving colour to code and
    // to the words a click added. A closer is tinted like them, in its stretch's unfaded colour.
    ...(run.link && { underline: true }),
    // A letter is drawn bold on the theme's error colour, and the rest of its short form or « on its
    // permission colour, both in inverse text.
    ...(run.isAfterLetter && { color: 'inverseText', backgroundColor: 'permission' }),
    ...(run.isLetter && { color: 'inverseText', backgroundColor: 'error', bold: true }),
  }
}

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}

import type { ClientModule, ClientSurface, TextProps } from 'claude-code'

import { grow, lengthOf } from './grow'
import { isMarkup, layout, link, linkAt, tint } from './layout'
import type { Row, Run } from './layout'
import { closeAfter, isLinkable, KEY_SEPARATOR, parse, stretches } from './parse'
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

/** The paragraph, the stretches the reader already has open in it, and the tint of each. */
export type ReplyProps = { text: string; open: string[]; tints: Record<string, Tint> }

/**
 * What the instance posts to the hooks module when the open stretches change, with the stretch the
 * reader just opened: its short form for the note to Claude, its key for its colour.
 */
export type ReplyPost = { open: string[]; opened?: { short: string; key: string } }

type Growth = { key: string; isOpening: boolean; progress: number; duration: number }
type State = { open: string[]; growth: Growth | null }

const FRAME_MS = 16

// What the last call drew, per instance, so a press is matched against the rows on screen.
const drawn = new WeakMap<object, { rows: Row[]; segments: Segment[] }>()

const Reply: ClientModule<ReplyProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ open: props.open, growth: null })
    surface.onPointer(event => {
      if (event.type === 'down' && event.button === 'left') press(surface, event.x, event.y)
    })
    surface.every(FRAME_MS, () => tick(surface))
  }
  const state = surface.state ?? { open: props.open, growth: null }
  const segments = parse(props.text)
  const rows = layout(compose(segments, state, props.tints), surface.columns > 0 ? surface.columns : 80)
  drawn.set(surface, { rows, segments })

  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Text wrap="truncate">{row.length === 0 ? ' ' : row.map(run => <Text {...styleOf(run)}>{run.text}</Text>)}</Text>
      ))}
    </Box>
  )
}

export default Reply

/**
 * The paragraph as the reader sees it now: closed stretches as pressable short forms, open ones in
 * full then a «, the words each added in its tint.
 */
function compose(segments: Segment[], state: State, tints: Record<string, Tint>): string {
  const write = (parts: Segment[]): string => parts.map(part => (typeof part === 'string' ? part : draw(part))).join('')
  const draw = (stretch: Stretch): string => {
    if (stretch.long === undefined || !stretch.isClosed) return stretch.short
    // A short form over several lines is drawn open, or as written when its long form is empty.
    if (!isLinkable(stretch)) return stretch.long.length === 0 ? stretch.short : write(stretch.long)
    const colours = tints[stretch.key]
    const paint = (word: string) => (colours === undefined || isMarkup(word) ? word : tint(colours.words, word))
    if (state.growth?.key === stretch.key) return grow(stretch.short, stretch.long, easeInOut(state.growth.progress), draw, paint)
    if (!state.open.includes(stretch.key)) return link('open', stretch.key, stretch.short)
    const closer = link('close', stretch.key, '«')
    const long = grow(stretch.short, stretch.long, 1, draw, paint)
    return closeAfter(long, colours === undefined ? closer : tint(colours.closer, closer), '\n')
  }

  return write(segments)
}

function press(surface: ClientSurface<State>, x: number, y: number) {
  const state = surface.state
  const shown = drawn.get(surface)
  if (state === undefined || shown === undefined) return
  const target = linkAt(shown.rows, x, y)
  if (target === undefined) return
  const stretch = stretches(shown.segments).find(one => one.key === target.key)
  if (stretch?.long === undefined) return

  // A stretch still shrinking when another press lands is closed at once.
  const open = state.growth !== null && !state.growth.isOpening ? closed(state.open, state.growth.key) : state.open
  const duration = 1000 * Math.min(1.4, 0.45 + lengthOf(stretch.long) / 70)
  if (target.action === 'open') {
    const next = [...open.filter(key => key !== stretch.key), stretch.key]
    surface.setState({ open: next, growth: { key: stretch.key, isOpening: true, progress: 0, duration } })
    surface.post({ open: next, opened: { short: stretch.short.trim(), key: stretch.key } } satisfies ReplyPost)
  } else {
    surface.setState({ open, growth: { key: stretch.key, isOpening: false, progress: 1, duration } })
  }
}

function tick(surface: ClientSurface<State>) {
  const state = surface.state
  if (state?.growth == null) return
  const { growth } = state
  const progress = growth.progress + ((growth.isOpening ? 1 : -1) * FRAME_MS) / growth.duration
  if (progress > 0 && progress < 1) {
    surface.setState({ ...state, growth: { ...growth, progress } })
    return
  }
  // A shrunk stretch, and every stretch inside it, leaves the open list as its growth ends.
  const open = growth.isOpening ? state.open : closed(state.open, growth.key)
  surface.setState({ open, growth: null })
  if (!growth.isOpening) surface.post({ open } satisfies ReplyPost)
}

function closed(open: string[], key: string): string[] {
  return open.filter(k => k !== key && !k.startsWith(`${key}${KEY_SEPARATOR}`))
}

function styleOf(run: Run): TextProps {
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
  }
}

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}

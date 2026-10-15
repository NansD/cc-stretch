import { atom, memberOf, read, update } from 'claude-code'
import type { Register, RenderInput, SessionMessage } from 'claude-code'

import { GUIDE } from './guide'
import { closeAfter, codeSpanEnd, hideLongForms, isLinkable, isOpenable, KEY_SEPARATOR, paragraphsOf, parentOf, parse, stretches } from './parse'
import type { Segment, StreamState, Stretch } from './parse'
import type { ReplyPost, ReplyProps, Tint } from './reply'

const openStretches = atom({ plugin: 'cc-stretch', key: 'open' } as const, [])
const seen = atom({ plugin: 'cc-stretch', key: 'seen' } as const, [])
const openGroups = atom({ plugin: 'cc-stretch', key: 'groups' } as const, false)
const stretchOrder = atom({ plugin: 'cc-stretch', key: 'order' } as const, { order: {}, count: 0 })
const newestReply = atom({ plugin: 'cc-stretch', key: 'newest' } as const, '')

// The words a stretch adds are drawn in Claude Code's own theme colours (its 2.1.300 values for
// warning, autoAccept, planMode and claude), mixed 45% toward the text colour so they tint rather
// than shout. Each open stretch keeps its colour; all but the newest take a faded form of it, mixed
// 35% toward the background, quieter but still that colour.
const BASE = {
  dark: [[255, 193, 7], [175, 135, 255], [72, 150, 140], [215, 119, 87]],
  light: [[150, 108, 30], [135, 0, 255], [0, 102, 102], [215, 119, 87]],
}
const mix = (rgb: number[], toward: number, share: number) => rgb.map(v => Math.round(v + (toward - v) * share))
const hex = (rgb: number[]) => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
const paletteOf = (base: number[][], text: number, background: number) =>
  base.map(rgb => mix(rgb, text, 0.45)).map(soft => ({ soft: hex(soft), faded: hex(mix(soft, background, 0.35)) }))
const PALETTES = { dark: paletteOf(BASE.dark, 255, 0), light: paletteOf(BASE.light, 0, 255) }
/** How many colours open stretches take in turn. */
const HUES = BASE.dark.length

// Every link the mod draws is answered by the mod: a click opens or closes,
// and the link is never followed. A ctrl- or cmd-click opens it in a browser,
// so it points at a reserved name that resolves nowhere.
const HREF = 'https://cc-stretch.invalid/'


export const register: Register = on => {
  // While a reply streams, Claude Code draws its lines as they arrive, before the reply reaches
  // the AssistantMessage site below. Showing each stretch as its short form there too keeps the
  // raw markup from flashing past. One filter state per message, until its final flush; null for a
  // message left as written.
  const streams = new Map<string, StreamState | null>()
  on('classic.MessageDisplay', async ($, e, next) => {
    const answer = await next(e)
    // The desktop app draws a finished reply from this display text, so hiding the long forms here
    // would strip the markup its links are made from. Decided on a message's first flush, so a
    // surface that attaches or leaves midway cannot half-filter it.
    let state = streams.get(e.message_id)
    if (state === undefined) state = (await $.session.surfaces()).includes('desktop') ? null : { open: [], fence: undefined }
    if (e.final) streams.delete(e.message_id)
    else streams.set(e.message_id, state)
    if (state === null) return answer

    return { ...answer, displayContent: hideLongForms(answer.displayContent ?? e.delta, state) }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.surfaces.length === 0) return composed

    return {
      sections: [
        ...composed.sections,
        { id: 'cc-stretch:guide', text: GUIDE, scope: 'session' },
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)

    const opened = await read($, seen)
    // A stretch that is not a link is drawn open, so it is neither opened nor unopened.
    const written = stretches(parse(lastReply(await $.session.messages())))
      .filter(isLinkable)
      .map(stretch => stretch.short.trim())
    const unopened = written.filter(short => !opened.includes(short))
    await update($, seen, () => [])
    await update($, newestReply, () => '')
    if (opened.length === 0 && unopened.length === 0) return next(e)

    const quote = (list: string[]) => list.map(s => `"${s}"`).join(', ')
    // A prompt cannot tell whether the reply was drawn where clicks land, so with no clicks the
    // note names both cases.
    const note =
      opened.length > 0
        ? `Stretchtext: since your last reply the reader opened ${quote(opened)}.${unopened.length > 0 ? ` They did not open ${quote(unopened)}.` : ''}`
        : 'Stretchtext: no click on a stretch of your last reply was recorded. The reader may have read only the short forms; where clicks do not reach the plugin (the classic renderer, apps other than the terminal and the Claude desktop app), every stretch was drawn open.'

    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  // Tool calls fold to Claude Code's own one-line summary of their group once
  // the group is done, with a link to open it. A live group, or one holding an
  // error, is drawn as the engine draws it, and so are the desktop app's own tool rows.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!canPress(e) || e.props.isActive || e.props.calls.some(call => call.isErrored)) return next(e)

    const open = memberOf(openGroups, e)
    const isOpen = await read($, open)
    const { Box, Markdown } = $.ui.resolve(e)
    const toggle = (
      <Markdown
        key="tools"
        text={`[${isOpen ? '▾ fold' : '▸ show'}](${HREF})`}
        pressableLinks={[HREF]}
        onLinkPress={() => update($, open, was => !was)}
      />
    )
    const drawn = await next({ ...e, props: { ...e.props, isExpanded: isOpen } })

    return isOpen ? (
      <Box flexDirection="column">
        {drawn}
        <Box paddingLeft={2}>{toggle}</Box>
      </Box>
    ) : (
      <Box flexDirection="row" alignItems="flex-end" gap={1}>
        {drawn}
        {toggle}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // A stretch still streaming has no closing braces yet; drawing it here keeps the raw markup
    // off the screen until it closes and becomes pressable.
    const parts = parse(e.props.text)
    const all = stretches(parts)
    if (e.props.isSummary === true || all.length === 0) return next(e)

    // The desktop app draws markdown links and hands a press on one to the plugin: the whole block is
    // one Markdown whose closed stretches are links that open in place, each open one ending in a «.
    if (e.surface === 'desktop') {
      const { Markdown } = $.ui.resolve(e)
      const open = memberOf(openStretches, { requestId: `${e.requestId}#desktop` })
      const links: string[] = []
      const text = linkedMarkdown(parts, await read($, open), all, links)
      // Open that stretch, or close it with every stretch inside it. Opening one is what the next
      // prompt reports, as a press in the terminal is.
      const press = async (href: string) => {
        const [action, index] = href.slice(HREF.length).split('/')
        const stretch = all[Number(index)]
        if (stretch === undefined) return
        const { key } = stretch
        if (action === 'close') {
          await update($, open, list => list.filter(k => k !== key && !k.startsWith(key + KEY_SEPARATOR)))
          return
        }
        if (action !== 'open') return
        await update($, open, list => (list.includes(key) ? list : [...list, key]))
        const short = stretch.short.trim()
        await update($, seen, list => (list.includes(short) ? list : [...list, short]))
      }
      return <Markdown key="stretch" text={text} pressableLinks={links} onLinkPress={link => void press(link.href)} />
    }

    const marker = e.props.isFirstOfReply ? '⏺ ' : '  '
    if (canPress(e)) {
      // A paragraph holding a stretch is drawn by a Client, on the screen's side; the rest is
      // Claude Code's own markdown.
      const { Box, Client, Markdown, Text } = $.ui.resolve(e)
      const [{ order, count }, newest] = await Promise.all([read($, memberOf(stretchOrder, { requestId: e.requestId })), read($, newestReply)])
      // The theme matters only once a stretch in this reply is open and so tinted.
      const isLight =
        Object.keys(order).length > 0 &&
        (await $.config.list().catch(() => [])).some(row => row.key === 'theme' && String(row.value).startsWith('light'))
      const palette = isLight ? PALETTES.light : PALETTES.dark
      const parts = await Promise.all(
        paragraphsOf(e.props.text).map(async (paragraph, i) => {
          if (!paragraph.hasStretch) return <Markdown text={paragraph.text} />
          const key = `paragraph-${i}`
          const open = await read($, memberOf(openStretches, { requestId: `${e.requestId}#${key}` }))
          const tints = tintsOf(order, key, newest === e.requestId ? count - 1 : -1, palette)
          return <Client key={key} module="./reply.tsx" props={{ text: paragraph.text, open, tints } satisfies ReplyProps} width="100%" />
        }),
      )
      return (
        <Box flexDirection="row">
          <Text>{marker}</Text>
          <Box flexDirection="column" flexShrink={1} gap={1}>
            {parts}
          </Box>
        </Box>
      )
    }

    // Where a press is not known to land, every stretch is drawn open and nothing is hidden.
    const { Box, Markdown, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text>{marker}</Text>
        <Box flexDirection="column" flexShrink={1}>
          <Markdown text={writeOpen(parts)} />
        </Box>
      </Box>
    )
  })

  // A paragraph's Client posts the stretches open in it whenever they change, and the one the reader
  // just opened. Kept here, they survive a redraw, reach the next prompt and keep their colours.
  on('ui.message', async ($, e, next) => {
    const post = e.module.endsWith('reply.tsx') ? replyPostOf(e.data) : undefined
    if (post === undefined) return next(e)
    await update($, memberOf(openStretches, { requestId: `${e.requestId}#${e.element}` }), () => post.open)
    const { opened } = post
    if (opened !== undefined) await update($, seen, list => (list.includes(opened.short) ? list : [...list, opened.short]))

    // Each open stretch keeps the count it was opened at, across the reply's paragraphs; a nested
    // one skips its parent's colour. The newest is the open stretch with the reply's last count.
    const here = `${e.element}#`
    await update($, memberOf(stretchOrder, { requestId: e.requestId }), ({ order, count }) => {
      const kept = Object.fromEntries(Object.entries(order).filter(([at]) => !at.startsWith(here) || post.open.includes(at.slice(here.length))))
      if (opened === undefined) return { order: kept, count }
      const parent = kept[`${here}${parentOf(opened.key)}`]
      const n = parent !== undefined && count % HUES === parent % HUES ? count + 1 : count
      return { order: { ...kept, [`${here}${opened.key}`]: n }, count: n + 1 }
    })
    if (opened !== undefined) await update($, newestReply, () => e.requestId)
    return next(e)
  })
}

/**
 * The tint of each open stretch in one paragraph: its colour by the count it was opened at, faded
 * unless it was opened at `newest`.
 */
function tintsOf(order: Record<string, number>, paragraph: string, newest: number, palette: { soft: string; faded: string }[]): Record<string, Tint> {
  const here = `${paragraph}#`
  return Object.fromEntries(
    Object.entries(order)
      .filter(([at]) => at.startsWith(here))
      .flatMap(([at, n]) => {
        const colours = palette[n % palette.length]
        return colours === undefined ? [] : [[at.slice(here.length), { words: n === newest ? colours.soft : colours.faded, closer: colours.soft }]]
      }),
  )
}

/**
 * A reply as markdown for the desktop: each closed stretch a link, each open one its long form then a
 * «, on a line of its own after a rule or a code fence. A link names its stretch by its place in `all`, not by its key, which can hold any character and
 * run past the 2048 characters a `pressableLinks` entry may have (Claude Code 2.1.295).
 */
function linkedMarkdown(parts: Segment[], open: readonly string[], all: Stretch[], links: string[]): string {
  return parts
    .map(part => {
      if (typeof part === 'string') return part
      if (!isOpenable(part) || part.long === undefined) return part.short
      // A short form over several lines is drawn open, or as written when its long form is empty.
      if (!isLinkable(part)) return part.long.length === 0 ? part.short : linkedMarkdown(part.long, open, all, links)
      const index = all.indexOf(part)
      if (open.includes(part.key)) {
        const close = `${HREF}close/${index}`
        links.push(close)
        return closeAfter(linkedMarkdown(part.long, open, all, links), `[«](${close})`, '\n\n')
      }
      const href = `${HREF}open/${index}`
      links.push(href)
      return `[${labelOf(part.short)}](${href})`
    })
    .join('')
}

/**
 * A short form as link text. Outside code spans, where an escape would show, a link inside it becomes
 * its text and target (the pattern `layout.ts` draws that way in the terminal), and brackets and
 * backslashes are escaped.
 */
function labelOf(short: string): string {
  const plain = (text: string) => text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/([[\]\\])/g, '\\$1')
  let label = ''
  let from = 0
  for (let at = short.indexOf('`'); at !== -1; at = short.indexOf('`', from)) {
    const stop = codeSpanEnd(short, at)
    label += plain(short.slice(from, at)) + short.slice(at, stop)
    from = stop
  }

  return label + plain(short.slice(from))
}

/** A reply with every stretch drawn as its long form. */
function writeOpen(parts: Segment[]): string {
  return parts.map(part => (typeof part === 'string' ? part : part.long === undefined ? part.short : writeOpen(part.long))).join('')
}

/** A Client's post, if it is one: the open stretches, and the one just opened. */
function replyPostOf(data: unknown): ReplyPost | undefined {
  if (typeof data !== 'object' || data === null || !('open' in data) || !Array.isArray(data.open)) return undefined
  const open = data.open.filter((key): key is string => typeof key === 'string')
  const opened: unknown = 'opened' in data ? data.opened : undefined
  if (typeof opened !== 'object' || opened === null || !('short' in opened) || !('key' in opened)) return { open }
  const { short, key } = opened

  return typeof short === 'string' && typeof key === 'string' ? { open, opened: { short, key } } : { open }
}

/** The text of the model's last reply: its rows after the person's last prompt. */
function lastReply(messages: SessionMessage[]): string {
  const texts: string[] = []
  for (const message of [...messages].reverse()) {
    if (message.role === 'user' && (message.toolResults?.length ?? 0) === 0 && message.text !== '') break
    if (message.role === 'assistant') texts.unshift(message.text)
  }

  return texts.join('\n')
}

// A press on a Client, or on the tool-call fold's link, is known to land only in the fullscreen
// terminal. In the desktop app (Claude Code 2.1.293) a press on a Client's one-cell « missed, so the
// desktop draws stretches as Markdown links instead (above).
function canPress<E extends Pick<RenderInput, 'surface' | 'viewport'>>(e: E): e is E & { surface: 'terminal' } {
  return e.surface === 'terminal' && e.viewport?.isFullscreen === true
}


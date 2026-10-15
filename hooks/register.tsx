import { atom, memberOf, read, update } from 'claude-code'
import type { Register, RenderInput, SessionMessage } from 'claude-code'

import { GUIDE } from './guide'
import { hideLongForms, isOpenable, KEY_SEPARATOR, paragraphsOf, parse, stretches } from './parse'
import type { Segment, StreamState } from './parse'
import type { ReplyPost, ReplyProps } from './reply'

const openStretches = atom({ plugin: 'cc-stretch', key: 'open' } as const, [])
const seen = atom({ plugin: 'cc-stretch', key: 'seen' } as const, [])
const openGroups = atom({ plugin: 'cc-stretch', key: 'groups' } as const, false)

// Every link the mod draws is answered by the mod: a click opens or closes,
// and the link is never followed. A ctrl- or cmd-click opens it in a browser,
// so it points at a reserved name that resolves nowhere.
const HREF = 'https://cc-stretch.invalid/'


export const register: Register = on => {
  // While a reply streams, Claude Code draws its lines as they arrive, before the reply reaches
  // the AssistantMessage site below. Showing each stretch as its short form there too keeps the
  // raw markup from flashing past. One filter state per message, until its final flush.
  const streams = new Map<string, StreamState>()
  on('classic.MessageDisplay', async ($, e, next) => {
    const answer = await next(e)
    // The desktop app draws a finished reply from this display text, so hiding the long forms here
    // would strip the markup its links are made from. Only a session drawn by terminals alone gets
    // the filter.
    if (!(await $.session.surfaces()).every(surface => surface === 'terminal')) return answer
    const state = streams.get(e.message_id) ?? { open: [], fence: undefined }
    const shown = hideLongForms(answer.displayContent ?? e.delta, state)
    if (e.final) streams.delete(e.message_id)
    else streams.set(e.message_id, state)

    return { ...answer, displayContent: shown }
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
    const written = stretches(parse(lastReply(await $.session.messages())))
      .filter(isOpenable)
      .map(stretch => stretch.short.trim())
    const unopened = written.filter(short => !opened.includes(short))
    await update($, seen, () => [])
    if (opened.length === 0 && unopened.length === 0) return next(e)

    const quote = (list: string[]) => list.map(s => `"${s}"`).join(', ')
    // A prompt cannot tell whether the reply was drawn where clicks land, so with no clicks the
    // note names both cases.
    const note =
      opened.length > 0
        ? `Stretchtext: since your last reply the reader opened ${quote(opened)}.${unopened.length > 0 ? ` They did not open ${quote(unopened)}.` : ''}`
        : 'Stretchtext: no click on a stretch of your last reply was recorded. Where clicks do not reach the plugin (the classic renderer, other apps), every stretch was drawn open.'

    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  // Tool calls fold to Claude Code's own one-line summary of their group once
  // the group is done, with a link to open it. A live group, or one holding an
  // error, is drawn as the engine draws it.
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
    if (e.props.isSummary === true || stretches(parse(e.props.text)).length === 0) return next(e)

    // The desktop app draws markdown links and hands a press on one to the plugin: the whole block is
    // one Markdown whose closed stretches are links that open in place, each open one ending in a «.
    if (e.surface === 'desktop') {
      const { Markdown } = $.ui.resolve(e)
      const parts = parse(e.props.text)
      const open = memberOf(openStretches, { requestId: `${e.requestId}#desktop` })
      const links: string[] = []
      const text = linkedMarkdown(parts, await read($, open), links)
      // Open that stretch, or close it with every stretch inside it. Opening one is what the next
      // prompt reports, as a press in the terminal is.
      const press = async (href: string) => {
        const [action, encoded] = href.slice(HREF.length).split('/')
        const key = decodeURIComponent(encoded ?? '')
        if (action === 'close') {
          await update($, open, list => list.filter(k => k !== key && !k.startsWith(key + KEY_SEPARATOR)))
          return
        }
        if (action !== 'open') return
        await update($, open, list => (list.includes(key) ? list : [...list, key]))
        const short = stretches(parts).find(stretch => stretch.key === key)?.short.trim()
        if (short !== undefined) await update($, seen, list => (list.includes(short) ? list : [...list, short]))
      }
      return <Markdown key="stretch" text={text} pressableLinks={links} onLinkPress={link => void press(link.href)} />
    }

    const marker = e.props.isFirstOfReply ? '⏺ ' : '  '
    if (canPress(e)) {
      // A paragraph holding a stretch is drawn by a Client, on the screen's side; the rest is
      // Claude Code's own markdown.
      const { Box, Client, Markdown, Text } = $.ui.resolve(e)
      const parts = await Promise.all(
        paragraphsOf(e.props.text).map(async (paragraph, i) => {
          if (!paragraph.hasStretch) return <Markdown text={paragraph.text} />
          const key = `paragraph-${i}`
          const open = await read($, memberOf(openStretches, { requestId: `${e.requestId}#${key}` }))
          return <Client key={key} module="./reply.tsx" props={{ text: paragraph.text, open } satisfies ReplyProps} width="100%" />
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
          <Markdown text={writeOpen(parse(e.props.text))} />
        </Box>
      </Box>
    )
  })

  // A paragraph's Client posts the stretches open in it whenever they change, and the short form
  // of one the reader just opened. Kept here, they survive a redraw and reach the next prompt.
  on('ui.message', async ($, e, next) => {
    const post = e.module.endsWith('reply.tsx') ? replyPostOf(e.data) : undefined
    if (post === undefined) return next(e)
    await update($, memberOf(openStretches, { requestId: `${e.requestId}#${e.element}` }), () => post.open)
    const opened = post.opened
    if (opened !== undefined) await update($, seen, list => (list.includes(opened) ? list : [...list, opened]))
    return next(e)
  })
}

/** A reply as markdown for the desktop: each closed stretch a link, each open one its long form then a «. */
function linkedMarkdown(parts: Segment[], open: readonly string[], links: string[]): string {
  return parts
    .map(part => {
      if (typeof part === 'string') return part
      if (!isOpenable(part) || part.long === undefined) return part.short
      // A markdown link cannot span lines, so a short form written over several is drawn open, or
      // as written when its long form is empty.
      if (part.short.includes('\n')) return part.long.length === 0 ? part.short : linkedMarkdown(part.long, open, links)
      if (open.includes(part.key)) {
        const close = `${HREF}close/${encodeURIComponent(part.key)}`
        links.push(close)
        return `${linkedMarkdown(part.long, open, links)} [«](${close})`
      }
      const href = `${HREF}open/${encodeURIComponent(part.key)}`
      links.push(href)
      return `[${part.short.replace(/([[\]\\])/g, '\\$1')}](${href})`
    })
    .join('')
}

/** A reply with every stretch drawn as its long form. */
function writeOpen(parts: Segment[]): string {
  return parts.map(part => (typeof part === 'string' ? part : part.long === undefined ? part.short : writeOpen(part.long))).join('')
}

/** A Client's post, if it is one: the open stretches, and the one just opened. */
function replyPostOf(data: unknown): ReplyPost | undefined {
  if (typeof data !== 'object' || data === null || !('open' in data) || !Array.isArray(data.open)) return undefined
  const open = data.open.filter((key): key is string => typeof key === 'string')
  const opened = 'opened' in data && typeof data.opened === 'string' ? data.opened : undefined

  return opened === undefined ? { open } : { open, opened }
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

// A press on a Client is known to land only in the fullscreen terminal: in the desktop app (Claude
// Code 2.1.293) a press on a one-cell « missed. The desktop draws Markdown links instead (above).
function canPress<E extends Pick<RenderInput, 'surface' | 'viewport'>>(e: E): e is E & { surface: 'terminal' } {
  return e.surface === 'terminal' && e.viewport?.isFullscreen === true
}


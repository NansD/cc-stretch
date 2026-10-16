import type { On, RenderSurface } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { grow } from '../hooks/grow'
import { layout, link, linkAt, tint, widthOf } from '../hooks/layout'
import { hideLongForms, paragraphsOf, parse, stretches } from '../hooks/parse'

const REPLY = [
  'The build fails {{on a stale cache|because the cache key hashes only `package.json`{{, set in one file|, set in `ci/cache.ts`}}}}.',
  'Braces in code stay: `{{a|b}}`.',
  '',
  '{{The fix is one line.|Add the lockfile to the key:',
  '```yaml',
  'key: {{hash}}',
  '```',
  '}}',
].join('\n')

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const MAIN_SCREEN = { columns: 100, rows: 40, isFullscreen: false }
const HREF = 'https://cc-stretch.invalid/'
const FIRST = 'paragraph-0'
const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  tools: [],
  outputStyle: null,
  traits: [],
} as const

const mountReply = ($: Engine, viewport: typeof FULLSCREEN, text = REPLY, surface: 'terminal' | 'desktop' = 'terminal', requestId = 'reply-1') =>
  $.ui.mount({
    plugin: 'cc-stretch',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId,
    viewport,
  })
type Mounted = Awaited<ReturnType<typeof mountReply>>

const shown = async (ui: Mounted) => (await ui.find({ type: 'Markdown' }))?.text ?? ''

/** Whether the reply carries the note saying why its stretches are open. */
const hasNote = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).some(piece => piece.text?.includes('NO_FLICKER') === true)

/** The text a node shows, its children's strings joined. */
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'children' in node) return textOf(node.children)
  return ''
}

/** The rows a paragraph's Client draws, as plain text. */
const rowsOf = async (ui: Mounted, key = FIRST): Promise<string[]> => {
  const tree = await ui.drawn({ in: key })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf)
}
const textIn = async (ui: Mounted, key = FIRST) => (await rowsOf(ui, key)).join('\n')

/** Presses `phrase` where the Client drew it, as a mouse does: down, then up. The last one when `last`. */
const pressOn = async (ui: Mounted, phrase: string, { key = FIRST, last = false } = {}) => {
  const rows = await rowsOf(ui, key)
  const y = last ? rows.findLastIndex(row => row.includes(phrase)) : rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const row = rows[y] ?? ''
  const x = widthOf(row.slice(0, last ? row.lastIndexOf(phrase) : row.indexOf(phrase)))
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
}

describe('grow', () => {
  const NELSON = 'Stretchtext, a kind of hypertext, is basically a form of writing closely related to other prose.'
  const plain = (text: string, progress: number, short = 'Stretchtext is a form of writing.') =>
    grow(short, parse(text), progress, () => '')

  test('starts from the short form and ends at the long form', async () => {
    expect(plain(NELSON, 0)).toBe('Stretchtext, is a form of writing')
    expect(plain(NELSON, 1)).toBe(NELSON)
  })

  test('opens every seam at once, keeping the anchors in order', async () => {
    const half = plain(NELSON, 0.5)
    expect(half).toMatch(/^Stretchtext, a .*is .*a form of writing closely/)
    expect(half.split(/\s+/).every(word => NELSON.includes(word))).toBe(true)
    expect(half.length).toBeGreaterThan(plain(NELSON, 0).length)
    expect(half.length).toBeLessThan(NELSON.length)
  })

  test('grows to the left of an anchor and to the right of the last', async () => {
    expect(grow('cache', parse('the stale cache'), 0.5, () => '')).toBe('stale cache')
    expect(grow('cache', parse('cache of old modules'), 0.5, () => '')).toBe('cache of ')
  })

  test('a nested stretch holding the short words anchors them, and a later repeat does not', async () => {
    const long = parse('wraps values, plus {{a way to chain|two operations, a way to chain}} functions. You have to try it.')
    const shown = grow('wraps values, plus a way to chain functions.', long, 0, nested => `[${nested.short}]`)
    expect(shown).toBe('wraps values, plus [a way to chain] functions.')
  })

  test('punctuation standing after an anchor stays with it', async () => {
    const long = parse('In short, it returns {{a value|a value, wrapped}} .')
    expect(grow('it returns a value.', long, 0, nested => `[${nested.short}]`)).toBe('it returns [a value] .')
  })

  test('a long form without the short words arrives in reading order', async () => {
    expect(grow('x', parse('one two three four'), 0.5, () => '')).toBe('one two ')
  })
})

describe('streaming', () => {
  test('shows each stretch as its short form, across flushes, and drops lines of hidden depth', async () => {
    const state = { open: [], fence: undefined }
    expect(hideLongForms('The build fails {{on a stale cache|because the cache key', state)).toBe('The build fails on a stale cache')
    expect(hideLongForms('hashes only `package.json`.\nStill hidden.\n}}, written {{x|y}} there.\n\nNext `{{a|b}}` line.', state)).toBe(', written x there.\n\nNext `{{a|b}}` line.')
    expect(hideLongForms('}} done.', { open: [{ isLong: true }], fence: undefined })).toBe(' done.')
  })

  for (const surfaces of [['terminal'], ['terminal', 'mobile'], ['terminal', 'vscode']] satisfies RenderSurface[][]) {
    test(`the display of a streaming reply never shows the markup with ${surfaces.join(' and ')} attached`, async ($, on) => {
      on('classic.MessageDisplay', () => ({}))
      on('session.surfaces', () => ({ value: surfaces }))
      const flush = (index: number, delta: string, final = false) =>
        $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index, final, delta })
      expect((await flush(0, 'A monad is {{a wrapper|a wrapper, like')).displayContent).toBe('A monad is a wrapper')
      expect((await flush(1, 'Maybe or List,}} with two operations.', true)).displayContent).toBe(' with two operations.')
    })
  }

  test('a message keeps the filter it started with when the desktop attaches or leaves midway', async ($, on) => {
    let surfaces: RenderSurface[] = ['terminal']
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: surfaces }))
    const flush = (message: string, index: number, delta: string, final = false) =>
      $.classic.MessageDisplay({ turn_id: 't', message_id: message, index, final, delta })
    expect((await flush('m1', 0, 'A monad is {{a wrapper|a wrapper, like')).displayContent).toBe('A monad is a wrapper')
    surfaces = ['terminal', 'desktop']
    expect((await flush('m1', 1, 'Maybe or List,}} with two operations.', true)).displayContent).toBe(' with two operations.')

    expect((await flush('m2', 0, 'A monad is {{a wrapper|a wrapper, like')).displayContent).toBeUndefined()
    surfaces = ['terminal']
    expect((await flush('m2', 1, 'Maybe or List,}} with two operations.', true)).displayContent).toBeUndefined()
  })

  // Claude Code 2.1.299 and 2.1.300 hand the AssistantMessage site the display text the filter left.
  test('a reply the filter drew short is drawn from its markup, pressable', async ($, on) => {
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    let shownText = ''
    for (const [index, delta] of ['A monad is {{a wrapper|a wrapper, like\n', 'Maybe or List,}} with two operations.\n', ''].entries()) {
      const flush = await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index, final: index === 2, delta })
      shownText += flush.displayContent ?? ''
    }
    expect(shownText).toBe('A monad is a wrapper\n with two operations.\n')

    const ui = await mountReply($, FULLSCREEN, shownText.trim())
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    expect(pieces.find(piece => piece.text === 'a wrapper')?.props).toMatchObject({ underline: true })
    await pressOn(ui, 'a wrapper')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('Maybe or List, «')
    await ui.unmount()
  })

  test('a reply filtered before the plugin loaded is found among the session\'s messages', async ($, on) => {
    on('session.messages', () => ({ value: [{ role: 'assistant', text: REPLY, toolUses: [] }] }))
    const ui = await mountReply($, FULLSCREEN, hideLongForms(REPLY, { open: [], fence: undefined }))
    expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
    expect(await textIn(ui, 'paragraph-1')).toBe('The fix is one line.')
    await ui.unmount()
  })

  test('a filtered reply that held no stretch is drawn by the engine, without a search', async ($, on) => {
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    let searches = 0
    on('session.messages', () => {
      searches++
      return { value: [] }
    })
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index: 0, final: true, delta: 'Plain answer.' })
    const ui = await mountReply($, FULLSCREEN, 'Plain answer.')
    expect(await ui.find({ text: 'engine' })).toBeDefined()
    expect(searches).toBe(0)
    await ui.unmount()
  })
})

describe('parse', () => {
  test('keys nested stretches by their short forms and leaves braces in code as text', async () => {
    const found = stretches(parse(REPLY))
    expect(found.map(s => [s.key, s.short])).toEqual([
      ['on a stale cache', 'on a stale cache'],
      ['on a stale cache › , set in one file', ', set in one file'],
      ['The fix is one line.', 'The fix is one line.'],
    ])
    expect(JSON.stringify(found[2]?.long)).toContain('key: {{hash}}')
    expect(stretches(parse('{{a|1}} {{a|2}}')).map(s => s.key)).toEqual(['a', 'a~2'])
  })

  test('a stretch still streaming is not closed, and one with no long form opens nothing', async () => {
    const [, partial] = parse('Lead {{partial|long so far')
    expect(typeof partial !== 'string' && partial).toMatchObject({ short: 'partial', isClosed: false })
    const [, plain] = parse('Lead {{plain}} end')
    expect(typeof plain !== 'string' && plain).toMatchObject({ short: 'plain', long: undefined, isClosed: true })
  })
})

describe('layout', () => {
  test('wraps words to the width and keeps a pressable phrase findable by its cells', async () => {
    const rows = layout(`one two three ${link('open', 'k', 'four five')} six`, 12)
    expect(rows.map(row => row.map(run => run.text).join(''))).toEqual(['one two', 'three four', 'five six'])
    expect(linkAt(rows, 6, 1)).toEqual({ action: 'open', key: 'k' })
    expect(linkAt(rows, 0, 1)).toBeUndefined()
    expect(linkAt(rows, 0, 2)).toEqual({ action: 'open', key: 'k' })
  })

  test('a press a cell beside a one-cell closer lands on it', async () => {
    const rows = layout(`done ${link('close', 'k', '«')}`, 40)
    expect(linkAt(rows, 5, 0)).toEqual({ action: 'close', key: 'k' })
    expect(linkAt(rows, 6, 0)).toEqual({ action: 'close', key: 'k' })
    expect(linkAt(rows, 4, 0)).toEqual({ action: 'close', key: 'k' })
  })

  test('draws bold, code and list items, and keeps a fenced block as written', async () => {
    const rows = layout(['- **bold** and `code`', '```', 'let x = {{y}}', '```'].join('\n'), 40)
    expect(rows[0]?.map(run => [run.text, run.bold === true, run.code === true])).toEqual([
      ['- ', false, false],
      ['bold', true, false],
      [' and ', false, false],
      ['code', false, true],
    ])
    expect(rows[1]?.map(run => run.text).join('')).toBe('  let x = {{y}}')
  })

  test('a code span or a link label tinted word by word draws whole, and the tint ends where its words do', async () => {
    const added = (word: string) => tint('#d3bdff', word)
    const text = `${added('Run')} ${added('`claude')} ${added('plugin')} install\` and ${added('[the')} ${added('docs')} page](https://x.invalid/a) now`
    const runs = layout(text, 80)[0] ?? []
    expect(runs.map(run => run.text).join('')).toBe('Run claude plugin install and the docs page (https://x.invalid/a) now')
    expect(runs.filter(run => run.code).map(run => run.text)).toEqual(['claude plugin install'])
    expect(runs.filter(run => run.underline).map(run => [run.text, run.tint])).toEqual([['the docs ', '#d3bdff'], ['page', undefined]])
    expect(runs.find(run => run.text.includes('and'))?.tint).toBeUndefined()
  })

  test('counts wide characters as two cells', async () => {
    expect(widthOf('漢字ab')).toBe(6)
    expect(layout('漢字漢字 漢字', 8).map(row => row.map(run => run.text).join(''))).toEqual(['漢字漢字', '漢字'])
  })
})

describe('paragraphs', () => {
  test('cuts at blank lines outside stretches and fences, and keeps plain neighbours together', async () => {
    const text = ['Plain one.', '', 'Plain two.', '', 'With {{a|a long', '', 'form}}.', '', '```', '', '```', 'After.'].join('\n')
    expect(paragraphsOf(text)).toEqual([
      { text: 'Plain one.\n\nPlain two.', hasStretch: false },
      { text: 'With {{a|a long\n\nform}}.', hasStretch: true },
      { text: '```\n\n```\nAfter.', hasStretch: false },
    ])
  })
})

test('a press grows a stretch in place, nested ones too, and « shrinks it back', async $ => {
  const ui = await mountReply($, FULLSCREEN)
  expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
  expect(await textIn(ui, 'paragraph-1')).toBe('The fix is one line.')
  expect((await ui.find({ type: 'Text' }))?.text).toBe('⏺ ')
  // A pressable phrase is underlined; code beside it is not.
  const pieces = await ui.findAll({ type: 'Text', in: FIRST })
  expect(pieces.find(piece => piece.text === 'on a stale cache')?.props).toMatchObject({ underline: true })
  expect(pieces.find(piece => piece.text === '{{a|b}}')?.props).toMatchObject({ color: 'permission' })
  expect(pieces.find(piece => piece.text === '{{a|b}}')?.props).not.toHaveProperty('underline')

  await pressOn(ui, 'on a stale cache')
  // The first frames show the short form's words, not the whole long form.
  expect(await textIn(ui)).not.toContain('hashes only')
  await ui.advance(300)
  expect(await textIn(ui)).not.toContain('because the cache key hashes only package.json')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain('because the cache key hashes only package.json, set in one file «.')

  await pressOn(ui, ', set in one file')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain(', set in ci/cache.ts « «.')

  await pressOn(ui, '«', { last: true })
  await ui.advance(300)
  expect(await textIn(ui)).not.toContain('«')
  expect(await textIn(ui)).not.toContain('on a stale cache')
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')

  // Shrinking the outer stretch closed the one inside it too.
  await pressOn(ui, 'on a stale cache')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain(', set in one file «.')
  await ui.unmount()
})

test('what the reader opened survives the reply being drawn again', async $ => {
  const first = await mountReply($, FULLSCREEN)
  await pressOn(first, 'The fix is one line.', { key: 'paragraph-1' })
  await first.advance(2000)
  await first.unmount()

  const again = await mountReply($, FULLSCREEN)
  expect(await textIn(again, 'paragraph-1')).toContain('Add the lockfile to the key:')
  expect(await textIn(again, 'paragraph-1')).toContain('  key: {{hash}}')
  expect(await textIn(again)).toContain('on a stale cache.')
  await again.unmount()
})

test('in the terminal, a « after a rule or a code fence goes on its own line and stays pressable', async $ => {
  const text = ['{{Status.|---', '', '- [x] Done', '', '---}}', '', 'Then {{the fix|the fix:', '```', 'key: 1', '```', '}}'].join('\n')
  const ui = await mountReply($, FULLSCREEN, text)
  await pressOn(ui, 'Status.')
  await pressOn(ui, 'the fix', { key: 'paragraph-1' })
  await ui.advance(2000)
  const rows = await rowsOf(ui)
  expect(rows.at(-2)).toMatch(/^─+$/)
  expect(rows.at(-1)).toBe('«')
  expect((await rowsOf(ui, 'paragraph-1')).slice(-2)).toEqual(['  key: 1', '«'])
  await pressOn(ui, '«', { last: true })
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('Status.')
  await ui.unmount()
})

test('the words a stretch adds take its colour, faded once another opens or the reader writes again', async ($, on) => {
  const text = 'One {{cat|cat, black,}} and {{dog|dog, brown,}} here.'
  on('session.messages', () => ({ value: [{ role: 'assistant', text, toolUses: [] }] }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const ui = await mountReply($, FULLSCREEN, text)
  const colourOf = async (text: string) => (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text?.trim() === text)?.props.color
  await pressOn(ui, 'cat')
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('One cat, black, « and dog here.')
  expect(await colourOf('black,')).toBe('#ffdd77')
  expect(await colourOf('cat,')).toBeUndefined()

  await pressOn(ui, 'dog')
  await ui.advance(2000)
  expect(await colourOf('brown,')).toBe('#d3bdff')
  expect(await colourOf('black,')).toBe('#a6904d')
  // A closer keeps its stretch's unfaded colour, as a faded one reads as disabled.
  const closers = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.text === '«')
  expect(closers.map(piece => piece.props.color)).toEqual(['#ffdd77', '#d3bdff'])

  await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
  expect(await colourOf('brown,')).toBe('#897ba6')
  await ui.unmount()
})

test('a short form written over several lines is drawn open in the terminal too', async $ => {
  const ui = await mountReply($, FULLSCREEN, ['Two steps: {{- one', '- two|- one, first', '- two, second}}'].join('\n'))
  expect(await textIn(ui)).toBe('Two steps: - one, first\n- two, second')
  await ui.unmount()
})

test('on the main screen, every stretch is drawn open, and the first such reply says why', async $ => {
  const ui = await mountReply($, MAIN_SCREEN)
  expect(await shown(ui)).toContain(', set in `ci/cache.ts`')
  expect(await shown(ui)).toContain('key: {{hash}}')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await hasNote(ui)).toBe(true)
  await ui.unmount()

  const later = await mountReply($, MAIN_SCREEN, REPLY, 'terminal', 'reply-2')
  expect(await hasNote(later)).toBe(false)
  await later.unmount()
  // Drawn again, the first reply keeps it.
  const again = await mountReply($, MAIN_SCREEN)
  expect(await hasNote(again)).toBe(true)
  await again.unmount()
})

test('in fullscreen or the phone app, no reply says why stretches are open', async $ => {
  const ui = await mountReply($, FULLSCREEN)
  expect(await hasNote(ui)).toBe(false)
  await ui.unmount()
  // The phone app also reports it is not fullscreen, and has no /tui to run.
  const phone = await $.ui.mount({
    plugin: 'cc-stretch',
    surface: 'mobile',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: true },
    requestId: 'reply-1',
    viewport: MAIN_SCREEN,
  })
  expect((await phone.findAll({ type: 'Text' })).some(piece => piece.text?.includes('NO_FLICKER') === true)).toBe(false)
  await phone.unmount()
})

describe('desktop app', () => {
  // A link names its stretch by its place among the reply's stretches.
  const linkTo = (action: 'open' | 'close', key: string, text = REPLY) =>
    `${HREF}${action}/${stretches(parse(text)).findIndex(stretch => stretch.key === key)}`
  const OUTER = 'on a stale cache'
  const INNER = `${OUTER} › , set in one file`

  test('a stretch is a link that grows in place, and « shrinks it with what it holds', async $ => {
    const ui = await mountReply($, FULLSCREEN, REPLY, 'desktop')
    const press = (action: 'open' | 'close', key: string) => ui.press({ key: 'stretch', link: { href: linkTo(action, key) } })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await shown(ui)).toContain(`The build fails [on a stale cache](${linkTo('open', OUTER)}).`)
    expect(await shown(ui)).not.toContain('`package.json`')

    await press('open', OUTER)
    expect(await shown(ui)).toContain(
      `The build fails because the cache key hashes only \`package.json\`[, set in one file](${linkTo('open', INNER)}) [«](${linkTo('close', OUTER)}).`,
    )
    await press('open', INNER)
    expect(await shown(ui)).toContain(', set in `ci/cache.ts`')

    await press('close', OUTER)
    expect(await shown(ui)).toContain(`The build fails [on a stale cache](${linkTo('open', OUTER)}).`)
    await press('open', OUTER)
    expect(await shown(ui)).not.toContain('ci/cache.ts')
    // Code keeps its braces, and a stretch holding a fence opens to it whole.
    expect(await shown(ui)).toContain('Braces in code stay: `{{a|b}}`.')
    await press('open', 'The fix is one line.')
    expect(await shown(ui)).toContain('key: {{hash}}')
    await ui.unmount()
  })

  test('a short form written over several lines is drawn open, as a link cannot span them', async $ => {
    const list = ['{{- Admin: https://admin.example.com', '- `example.com` is a test address.|}}'].join('\n')
    const listed = ['{{- one', '- two|- one, first', '- two, second}}'].join('\n')
    const ui = await mountReply($, FULLSCREEN, `${list}\n\n${listed}`, 'desktop')
    expect(await shown(ui)).toBe(['- Admin: https://admin.example.com', '- `example.com` is a test address.', '', '- one, first', '- two, second'].join('\n'))
    await ui.unmount()
  })

  test('a short form with brackets, a link, code or hundreds of characters still opens', async $ => {
    const long = '缓存'.repeat(150)
    const text = [
      'Steps: {{1) install|1) install the plugin}}.',
      'Cause: {{`arr[0]` is empty|`arr[0]` is empty when the list is}}.',
      'Read {{the [guide](https://example.com/g)|the [guide](https://example.com/g), part two}}.',
      `Note: {{${long}|${long}, and more}}.`,
    ].join('\n\n')
    const ui = await mountReply($, FULLSCREEN, text, 'desktop')
    const drawn = await shown(ui)
    expect(drawn).toContain(`[1) install](${linkTo('open', '1) install', text)})`)
    expect(drawn).toContain(`[\`arr[0]\` is empty](${linkTo('open', '`arr[0]` is empty', text)})`)
    expect(drawn).toContain(`[the guide (https://example.com/g)](${linkTo('open', 'the [guide](https://example.com/g)', text)})`)
    for (const key of ['1) install', '`arr[0]` is empty', long]) {
      await ui.press({ key: 'stretch', link: { href: linkTo('open', key, text) } })
    }
    expect(await shown(ui)).toContain('1) install the plugin [«]')
    expect(await shown(ui)).toContain('`arr[0]` is empty when the list is [«]')
    expect(await shown(ui)).toContain(`${long}, and more [«]`)
    await ui.unmount()
  })

  test('a « after a rule or a code fence goes on its own line', async $ => {
    const text = ['{{Status.|---', '', '- [x] Done', '', '---}}', '', 'Then {{the fix|the fix:', '```', 'key: {{hash}}', '```', '}}'].join('\n')
    const ui = await mountReply($, FULLSCREEN, text, 'desktop')
    await ui.press({ key: 'stretch', link: { href: linkTo('open', 'Status.', text) } })
    await ui.press({ key: 'stretch', link: { href: linkTo('open', 'the fix', text) } })
    expect(await shown(ui)).toContain(`- [x] Done\n\n---\n\n[«](${linkTo('close', 'Status.', text)})`)
    expect(await shown(ui)).toContain(`key: {{hash}}\n\`\`\`\n\n[«](${linkTo('close', 'the fix', text)})`)
    await ui.unmount()
  })

  test('a short form over several lines is neither opened nor unopened in the next note', async ($, on) => {
    const text = ['Two steps: {{- one', '- two|- one, first', '- two, second}}', '', 'Then {{a stretch|a stretch, longer}}.'].join('\n')
    on('session.messages', () => ({
      value: [
        { role: 'user', text: 'how?', toolUses: [] },
        { role: 'assistant', text, toolUses: [] },
      ],
    }))
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })

    const ui = await mountReply($, FULLSCREEN, text, 'desktop')
    await ui.press({ key: 'stretch', link: { href: linkTo('open', 'a stretch', text) } })
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context).toEqual(['Stretchtext: since your last reply the reader opened "a stretch".'])
    await ui.unmount()
  })

  test('what the reader opened is told to the model with the next prompt', async ($, on) => {
    on('session.messages', () => ({
      value: [
        { role: 'user', text: 'why does CI fail?', toolUses: [] },
        { role: 'assistant', text: REPLY, toolUses: [] },
      ],
    }))
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })

    const ui = await mountReply($, FULLSCREEN, REPLY, 'desktop')
    await ui.press({ key: 'stretch', link: { href: linkTo('open', OUTER) } })
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context).toEqual([
      'Stretchtext: since your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".',
    ])
    await ui.unmount()
  })

  for (const surfaces of [['desktop'], ['terminal', 'desktop']] satisfies RenderSurface[][]) {
    test(`a reply streaming with ${surfaces.join(' and ')} attached keeps its markup, which the desktop's links are made from`, async ($, on) => {
      on('classic.MessageDisplay', () => ({}))
      on('session.surfaces', () => ({ value: surfaces }))
      const flush = await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index: 0, final: true, delta: 'A monad is {{a wrapper|a wrapper.}}' })
      expect(flush.displayContent).toBeUndefined()
    })
  }
})

test('a reply without a stretch is drawn by the engine', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await mountReply($, FULLSCREEN, 'Plain answer.')
  expect(await ui.find({ text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('paragraphs without a stretch stay with Claude Code\'s own markdown', async $ => {
  const ui = await mountReply($, FULLSCREEN, ['Intro with `code`.', '', 'Then {{a stretch|a stretch, longer}}.'].join('\n'))
  expect(await shown(ui)).toBe('Intro with `code`.')
  expect(await textIn(ui, 'paragraph-1')).toBe('Then a stretch.')
  await ui.unmount()
})

test('a stretch still streaming shows its short form and none of its markup', async $ => {
  const ui = await mountReply($, FULLSCREEN, 'Still streaming {{a stretch|its long form so f')
  expect(await textIn(ui)).toBe('Still streaming a stretch')
  await ui.unmount()
})

test('the system prompt carries the guide while something draws', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  const drawn = await $.prompt.compose({ ...COMPOSE, surfaces: ['terminal'] })
  expect(drawn.sections.at(-1)?.id).toBe('cc-stretch:guide')
  const headless = await $.prompt.compose({ ...COMPOSE, surfaces: [] })
  expect(headless.sections.some(s => s.id === 'cc-stretch:guide')).toBe(false)
})

test('the next prompt tells the model which stretches were opened and which not', async ($, on) => {
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'why does CI fail?', toolUses: [] },
      { role: 'assistant', text: REPLY, toolUses: [] },
    ],
  }))
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text, context: e.context }
  })

  const ui = await mountReply($, FULLSCREEN)
  await pressOn(ui, 'on a stale cache')
  await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([
    'Stretchtext: since your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".',
  ])

  await $.prompt.submit({ text: 'and?', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([
    'Stretchtext: no click on a stretch of your last reply was recorded. The reader may have read only the short forms; where clicks do not reach the plugin (the classic renderer, apps other than the terminal and the Claude desktop app), every stretch was drawn open.',
  ])
  await ui.unmount()
})

describe('tool calls', () => {
  const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const mountGroup = ($: Engine, isExpanded: boolean) =>
    $.ui.mount({
      plugin: 'cc-stretch',
      surface: 'terminal',
      component: 'ToolGroup',
      props: { calls: [call], isActive: false, isExpanded },
      requestId: 'group-1',
      viewport: FULLSCREEN,
    })
  const engineDraws = (on: On) =>
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'every call' : 'Ran 1 shell command'}</Text>
    })

  // Claude Code folds a finished group to its one-line summary and opens it on a click on that line.
  // A group the plugin redrew kept its own state, so that click drew the open group's panel behind
  // the folded line and opened nothing.
  test('a group of tool calls is drawn as Claude Code draws it', async ($, on) => {
    engineDraws(on)
    for (const isExpanded of [false, true]) {
      const ui = await mountGroup($, isExpanded)
      expect(await ui.find({ text: isExpanded ? 'every call' : 'Ran 1 shell command' })).toBeDefined()
      expect(await ui.find({ key: 'tools' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

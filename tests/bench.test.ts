import { describe, expect, test } from 'claude-code/testing'

import { measure, openedFrom, render, words } from '../bench/measure.ts'
import { growthOf } from '../hooks/grow.ts'
import { parse } from '../hooks/parse.ts'
import { verdictsOf } from '../bench/rules.ts'
import type { RuleId } from '../bench/rules.ts'
import type { Layout } from '../bench/tasks.ts'

const REPLY = 'The build {{fails|fails on {{a stale cache|a cache keyed only by the lockfile}}}}. Fix `{{x|y}}` first.'

describe('benchmark measures', () => {
  test('skim closes every stretch, full opens every one, read opens only what the reader opened', async () => {
    expect(render(REPLY, new Set())).toBe('The build fails. Fix `{{x|y}}` first.')
    expect(render(REPLY, 'all')).toBe('The build fails on a cache keyed only by the lockfile. Fix `{{x|y}}` first.')
    expect(render(REPLY, new Set(['fails']))).toBe('The build fails on a stale cache. Fix `{{x|y}}` first.')
    expect(measure(REPLY, new Set(['fails']))).toEqual({ skim: 6, full: 14, read: 10 })
  })

  test('draws a short form over two lines open, and an unclosed stretch as its short form', async () => {
    expect(render('A {{b\nc|d e}} f', new Set())).toBe('A d e f')
    expect(render('A {{b\nc|}} f', new Set())).toBe('A b\nc f')
    expect(render('A {{b|c', new Set())).toBe('A b')
    expect(render('A {{b|c', 'all')).toBe('A b')
  })

  test('counts where the added words land around the short form', async () => {
    expect(growthOf('The build fails on a stale cache.', parse('The CI build fails, about one run in five, on a stale dependency cache keyed only by package.json.'))).toEqual({ before: 0, between: 7, after: 4, missing: 0 })
    expect(growthOf('Two options exist.', parse('Two options exist. One is a command, the other a hover.'))).toEqual({ before: 0, between: 0, after: 8, missing: 0 })
    expect(growthOf('Three options exist.', parse('Two options exist.')).missing).toBe(1)
  })

  test('counts words that hold a letter or a digit, not markup or punctuation', async () => {
    expect(words('A *b* -- `c` 42 ---')).toBe(4)
  })

  test('reads the opened stretches back from a reading note', async () => {
    expect([...openedFrom('Stretchtext: since your last reply the reader opened "a b", "c". They did not open "d".')]).toEqual(['a b', 'c'])
    expect(openedFrom('Stretchtext: the reader opened no stretch of your last reply.').size).toBe(0)
  })
})

describe('layout rules', () => {
  const ITEMS = [['memory'], ['sqlite'], ['redis']]
  /** Whether `rule` holds for `text` under `task`; a rule that does not apply is a test error. */
  const holds = (rule: RuleId, text: string, task: Layout = {}) => {
    const verdict = verdictsOf(text, task).find(v => v.rule === rule)
    if (verdict === undefined) throw new Error(`${rule} does not apply`)
    return verdict.holds
  }
  const cases = (rule: RuleId, task: Layout, fail: string[], pass: string[]) => {
    for (const text of fail) expect([text, holds(rule, text, task)]).toEqual([text, false])
    for (const text of pass) expect([text, holds(rule, text, task)]).toEqual([text, true])
  }

  test('keeps-short-words: the long form keeps the short form’s words in order', async () => {
    cases('keeps-short-words', {}, ['{{The build fails.|CI is broken by a stale cache.}}', '{{fails on a cache|on a cache it fails}}'], [
      '{{The build fails on a stale cache.|The CI build fails, about one run in five, on a stale dependency cache keyed only by `package.json`.}}',
      '{{The fix is one line.|The fix is one line: add the lockfile to the key.}}',
    ])
  })

  test('inline-short: the short form is one plain line', async () => {
    cases('inline-short', {}, ['A {{first line\nsecond line|both lines, opened}} b.', '{{- Memory is temporary.|- Memory is temporary and resets on restart.}}', '{{## Setup|## Setup, step by step}}'], [
      'Run {{`npm test` first|`npm test` first, then the build}}.',
    ])
  })

  test('adds-words: a stretch opens to something new', async () => {
    cases('adds-words', {}, ['- {{Memory is temporary.|Memory is temporary.}}', 'A {{b|}} c.'], ['- {{Memory is temporary.|Memory is temporary, and resets on restart.}}'])
  })

  test('not-in-heading-or-table: no stretch in a heading or a table row', async () => {
    cases('not-in-heading-or-table', {}, ['## {{Setup|Setting up the repo}}\n\nText.', '| tool | note |\n|---|---|\n| bun | {{runs it|runs the bench}} |'], [
      'Use a {{pipe|pipe, the `|` character,}} between columns.',
      'Write `{{a|b}}` to make a stretch.',
      '{{Setup takes a minute.|## Setup\n\nSetup takes a minute.}}',
    ])
  })

  test('no-stretch-when-short: a short answer has no stretch', async () => {
    cases('no-stretch-when-short', { needsNoStretch: true }, ['{{Use git log.|Use git log --oneline -5.}}'], ['git log --oneline -5', 'CSV, JSON, Parquet'])
  })

  test('items-stay-visible: each list item stays in view with a stretch of its own', async () => {
    const own = (name: string) => `{{${name} is one option.|${name} is one option, with its tradeoff.}}`
    cases('items-stay-visible', { items: ITEMS }, [
      '{{Three options.|- Memory is temporary.\n- SQLite persists.\n- Redis is shared.}}',
      `- ${own('Memory')}\n- ${own('SQLite')}\n{{One more.|- Redis is shared.}}`,
      '- Memory is temporary.\n- SQLite persists.\n- Redis is shared.',
      '- {{Memory is temporary.|Memory is temporary.}}\n- {{SQLite persists.|SQLite persists.}}\n- {{Redis is shared.|Redis is shared.}}',
      '{{Memory, SQLite and Redis all work.|Memory is fast, SQLite persists, Redis is shared.}}',
    ], [
      `- ${own('Memory')}\n- ${own('SQLite')}\n- ${own('Redis')}`,
      `${own('Memory')} It is the one to pick.\n\n- ${own('SQLite')}\n- ${own('Redis')}`,
      `1. ${own('Memory')}\n2. ${own('SQLite')}\n* ${own('Redis')}`,
      `Three options, memory, SQLite and Redis:\n\n- ${own('Memory')}\n- ${own('SQLite')}\n- ${own('Redis')}`,
    ])
  })

  test('closing-block-last: a required closing block is the last stretch', async () => {
    const block = '---\nDone: the parser.\nNext: the export.\n---'
    cases('closing-block-last', { closing: 'End with a status block.' }, [
      `The parser is merged.\n\n${block}`,
      `The parser is merged.\n\n{{Status: parser done.|\n${block}}}\n\nThat is all.`,
    ], [`The parser is merged.\n\n{{Status: parser done, export next.|\n${block}}}`])
  })

  test('a rule a task does not ask for is not checked', async () => {
    expect(verdictsOf('git log', {}).map(v => v.rule)).toEqual(['keeps-short-words', 'inline-short', 'adds-words', 'not-in-heading-or-table'])
  })
})

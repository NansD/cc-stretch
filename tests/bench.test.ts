import { describe, expect, test } from 'claude-code/testing'

import { measure, openedFrom, render, words } from '../bench/measure.ts'
import { growthOf } from '../hooks/grow.ts'
import { parse } from '../hooks/parse.ts'

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
    expect(growthOf('The build fails on a stale cache.', parse('The CI build fails, about one run in five, on a stale dependency cache keyed only by package.json.'))).toEqual({ before: 0, between: 7, after: 4 })
    expect(growthOf('Two options exist.', parse('Two options exist. One is a command, the other a hover.'))).toEqual({ before: 0, between: 0, after: 8 })
  })

  test('counts words that hold a letter or a digit, not markup or punctuation', async () => {
    expect(words('A *b* -- `c` 42 ---')).toBe(4)
  })

  test('reads the opened stretches back from a reading note', async () => {
    expect([...openedFrom('Stretchtext: since your last reply the reader opened "a b", "c". They did not open "d".')]).toEqual(['a b', 'c'])
    expect(openedFrom('Stretchtext: the reader opened no stretch of your last reply.').size).toBe(0)
  })
})

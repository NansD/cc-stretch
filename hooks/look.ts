// How a phrase the reader can press is marked: text marks that turn on or off one by one, and a
// highlight. Shared by the hooks module, the reply and the toolbar.

import { contrastOn } from './contrast'

/** Every text mark a phrase can carry, in the order the toolbar shows them. */
export const MARK_NAMES = ['bold', 'italic', 'underline', 'strikethrough', 'dim'] as const
export type Mark = (typeof MARK_NAMES)[number]

/** The marks a pressable phrase carries and its highlight; '' for none. */
export type Look = { marks: Mark[]; highlight: string }

/** The default: underlined, in the text's own colour. */
export const DEFAULT_LOOK: Look = { marks: ['underline'], highlight: '' }

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The marks named in a list (commas or spaces, any case), in toolbar order, unknown names dropped. */
export function marksOf(value: unknown): Mark[] {
  const names = textOf(value).toLowerCase().split(/[\s,;]+/)
  return MARK_NAMES.filter(mark => names.includes(mark))
}

/**
 * The look the options set. `marks` left empty keeps the default underline, so a highlight alone
 * adds to it; `none` takes every mark away. A value that names no mark (a typo) keeps the default
 * too, so stretches never lose their mark by accident.
 */
export function lookOf(options: Record<string, unknown>): Look {
  const named = textOf(options.marks)
  const parsed = marksOf(named)
  const marks = named.toLowerCase() === 'none' ? [] : parsed.length > 0 ? parsed : DEFAULT_LOOK.marks
  return { marks, highlight: textOf(options.highlight) }
}

/** The `marks` setting that reads back as `marks`: `none` for none, as an empty one means the default. */
export function marksSetting(marks: readonly Mark[]): string {
  return marks.length === 0 ? 'none' : marks.join(',')
}

/** A look held in state, checked: what the toolbar stored, or null when there is none. */
export function storedLook(value: unknown): Look | null {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { marks?: unknown }).marks)) return null
  const { marks, highlight } = value as { marks: unknown[]; highlight?: unknown }
  return { marks: marksOf(marks.join(',')), highlight: textOf(highlight) }
}

/** Whether two looks draw a phrase the same. */
export function isSameLook(a: Look, b: Look): boolean {
  return a.highlight === b.highlight && a.marks.length === b.marks.length && a.marks.every(mark => b.marks.includes(mark))
}

/**
 * The text props a look gives a pressable phrase. Dim and the highlight leave a tinted closer and
 * code alone; on a highlight the text turns dark or light so it reads.
 */
export function lookProps(look: Look, isPlainText: boolean) {
  const has = (mark: Mark) => look.marks.includes(mark)
  return {
    ...(has('bold') && { bold: true }),
    ...(has('italic') && { italic: true }),
    ...(has('underline') && { underline: true }),
    ...(has('strikethrough') && { strikethrough: true }),
    ...(has('dim') && isPlainText && { dimColor: true }),
    ...(look.highlight !== '' && isPlainText && { backgroundColor: look.highlight, ...contrastOn(look.highlight) }),
  }
}

// How a phrase the reader can press is marked, as independent parts: text marks that turn on or off
// one by one, a text colour and a highlight. Shared by the hooks module, the reply and the toolbar.

import { contrastOn } from './contrast'

/** Every text mark a phrase can carry, in the order the toolbar shows them. */
export const MARK_NAMES = ['bold', 'italic', 'underline', 'strikethrough', 'dim', 'inverse'] as const
export type Mark = (typeof MARK_NAMES)[number]

/** The marks a pressable phrase carries, its text colour and its highlight; '' for none. */
export type Look = { marks: Mark[]; text: string; highlight: string }

/** The default: underlined, in the text's own colour. */
export const DEFAULT_LOOK: Look = { marks: ['underline'], text: '', highlight: '' }

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The marks named in a list (commas or spaces, any case), in toolbar order, unknown names dropped. */
export function marksOf(value: unknown): Mark[] {
  const names = textOf(value).toLowerCase().split(/[\s,;]+/)
  return MARK_NAMES.filter(mark => names.includes(mark))
}

/**
 * The look the options set. linkMarks left empty keeps the default underline, so a colour or a
 * highlight alone adds to it; `none` takes every mark away. A value that names no mark (a typo)
 * keeps the default too, so stretches never lose their mark by accident.
 */
export function lookOf(options: Record<string, unknown>): Look {
  const named = textOf(options.linkMarks)
  const parsed = marksOf(named)
  const marks = named.toLowerCase() === 'none' ? [] : parsed.length > 0 ? parsed : DEFAULT_LOOK.marks
  return { marks, text: textOf(options.linkTextColor), highlight: textOf(options.linkHighlight) }
}

/** A look held in state, checked: what the toolbar stored, or null when it is not one. */
export function storedLook(value: unknown): Look | null {
  // Anything but a stored look (an older shape, say) is ignored.
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { marks?: unknown }).marks)) return null
  const { marks, text, highlight } = value as { marks: unknown[]; text?: unknown; highlight?: unknown }
  return { marks: marksOf(marks.join(',')), text: textOf(text), highlight: textOf(highlight) }
}

/**
 * The text props a look gives a pressable phrase. Colour parts (text colour, highlight, dim, inverse)
 * leave a tinted closer and code alone; a highlight without a text colour turns the text dark or light
 * so it reads.
 */
export function lookProps(look: Look, isPlainText: boolean) {
  const has = (mark: Mark) => look.marks.includes(mark)
  return {
    ...(has('bold') && { bold: true }),
    ...(has('italic') && { italic: true }),
    ...(has('underline') && { underline: true }),
    ...(has('strikethrough') && { strikethrough: true }),
    ...(has('dim') && isPlainText && { dimColor: true }),
    // Inverse would swap a highlight with its text and undo the contrast, so a highlight wins.
    ...(has('inverse') && isPlainText && look.highlight === '' && { inverse: true }),
    ...(look.highlight !== '' && isPlainText && { backgroundColor: look.highlight, ...contrastOn(look.highlight) }),
    ...(look.text !== '' && isPlainText && { color: look.text }),
  }
}

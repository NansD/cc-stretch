// What a reader faces in one reply, in words, using the plugin's own parser:
//   skim  every stretch closed: the reply as it first appears
//   full  every stretch open: everything the model wrote
//   read  the stretches the reader actually opened, and nothing else
import { drawnAs, parse } from '../hooks/parse.ts'
import type { Segment, Stretch } from '../hooks/parse.ts'

/** The reply's text with the stretches whose short form is in `opened` open (all of them for 'all'). */
export function render(reply: string, opened: ReadonlySet<string> | 'all'): string {
  return draw(parse(reply), opened)
}

/**
 * `parts` as the terminal draws them, with the stretches whose short form is in `opened` open. A
 * short form over several lines is drawn open whatever is opened, or as written when its long form
 * is empty. `mark`, when given, wraps the text drawn in each link's place, open or closed.
 */
export function draw(parts: Segment[], opened: ReadonlySet<string> | 'all', mark = (_: Stretch, drawn: string) => drawn): string {
  return parts
    .map(part => {
      if (typeof part === 'string') return part
      const long = part.long ?? []
      switch (drawnAs(part)) {
        case 'text':
          return part.short
        case 'open':
          return long.length === 0 ? part.short : draw(long, opened, mark)
        case 'link': {
          return mark(part, opened === 'all' || opened.has(part.short.trim()) ? draw(long, opened, mark) : part.short)
        }
      }
    })
    .join('')
}

/** Words a person reads: whitespace-separated tokens holding a letter or a digit. */
export function words(text: string): number {
  return text.split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length
}

export type Measure = { skim: number; full: number; read?: number }

export function measure(reply: string, opened?: ReadonlySet<string>): Measure {
  const skim = words(render(reply, new Set()))
  const full = words(render(reply, 'all'))
  return opened === undefined ? { skim, full } : { skim, full, read: words(render(reply, opened)) }
}

/** The reader's opened stretches from a note such as `Stretchtext: ... opened "a", "b". They did not open "c".` */
export function openedFrom(note: string): Set<string> {
  if (/opened no stretch/.test(note)) return new Set()
  const part = /opened (.*?)(?:\. They did not open|\.$)/s.exec(note)?.[1] ?? ''
  return new Set([...part.matchAll(/"([^"]*)"/g)].map(m => (m[1] ?? '').trim()))
}

// The text colour that reads on a highlight, shared by the reply and the toolbar.

const DARK = '#1c1c1c'
const LIGHT = '#f2f2f2'

/** The relative luminance of a `#rgb` or `#rrggbb` colour, as WCAG defines it; undefined for anything else. */
export function luminanceOf(colour: string): number | undefined {
  const short = /^#([0-9a-f]{3})$/i.exec(colour)?.[1]
  const hex = short === undefined ? /^#([0-9a-f]{6})$/i.exec(colour)?.[1] : [...short].map(c => c + c).join('')
  if (hex === undefined) return undefined
  const [r = 0, g = 0, b = 0] = [0, 2, 4]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/**
 * Text that reads on a highlight: near black or near white, whichever contrasts more. Nothing for
 * a colour that is not hex (a theme name), whose luminance is unknown here.
 */
export function contrastOn(background: string): { color?: string } {
  const bg = luminanceOf(background)
  if (bg === undefined) return {}
  const dark = luminanceOf(DARK) ?? 0
  const light = luminanceOf(LIGHT) ?? 1
  return { color: ratio(bg, dark) >= ratio(bg, light) ? DARK : LIGHT }
}

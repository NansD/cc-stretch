// The text colour that reads on a highlight, shared by the reply and the toolbar; only the reply passes dim.

type Rgb = [number, number, number]

const DARK: Rgb = [0x1c, 0x1c, 0x1c]
const LIGHT: Rgb = [0xf2, 0xf2, 0xf2]
/**
 * How far dim moves text toward its background: as of Claude Code 2.1.302 its dim grey sits 40% of the
 * way from text to background on both themes (153 between 255 and 0, 102 between 0 and 255).
 */
const DIM_SHARE = 0.4

/** A colour written as `#rrggbb`. */
export const hex = (rgb: readonly number[]) => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`

/** The red, green and blue of a `#rgb` or `#rrggbb` colour; undefined for anything else. */
function rgbOf(colour: string): Rgb | undefined {
  const short = /^#([0-9a-f]{3})$/i.exec(colour)?.[1]
  const digits = short === undefined ? /^#([0-9a-f]{6})$/i.exec(colour)?.[1] : [...short].map(c => c + c).join('')
  if (digits === undefined) return undefined
  const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16)
  return [channel(0), channel(2), channel(4)]
}

/** The relative luminance of a colour, as WCAG defines it. */
function luminance(rgb: Rgb): number {
  const linear = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

/** The relative luminance of a `#rgb` or `#rrggbb` colour; undefined for anything else. */
export function luminanceOf(colour: string): number | undefined {
  const rgb = rgbOf(colour)
  return rgb === undefined ? undefined : luminance(rgb)
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/**
 * Text that reads on a highlight: near black or near white, whichever contrasts more, and under dim
 * moved toward the highlight as dim moves text toward its background. Nothing for a colour that is
 * not hex (a theme name), whose luminance is unknown here.
 */
export function contrastOn(background: string, isDim = false): { color?: string } {
  const backgroundRgb = rgbOf(background)
  if (backgroundRgb === undefined) return {}
  const bg = luminance(backgroundRgb)
  const text = ratio(bg, luminance(DARK)) >= ratio(bg, luminance(LIGHT)) ? DARK : LIGHT
  if (!isDim) return { color: hex(text) }
  const toward = (at: 0 | 1 | 2) => Math.round(text[at] + (backgroundRgb[at] - text[at]) * DIM_SHARE)
  return { color: hex([toward(0), toward(1), toward(2)]) }
}

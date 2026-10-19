// The context meter: cells in the terminal, CSS pixels on desktop.
export const BAR_CELLS = 5
export const METER_PX = 36

export type Severity = 'success' | 'warning' | 'claude' | 'error'

// The theme's own hues, for the SVG meter, which cannot read theme keys.
const SEVERITY_HEX: Record<Severity, string> = {
  success: '#4eba65',
  warning: '#e8b339',
  claude: '#d77757',
  error: '#ef5a6f',
}

function oneDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent))
}

export function short(n: number): string {
  if (n >= 1_000_000) {
    return `${oneDecimal(n / 1_000_000)}M`
  }
  if (n >= 1_000) {
    return `${oneDecimal(n / 1_000)}k`
  }
  return String(n)
}

export function colorFor(percent: number): Severity {
  if (percent >= 90) {
    return 'error'
  }
  if (percent >= 75) {
    return 'claude'
  }
  if (percent >= 50) {
    return 'warning'
  }
  return 'success'
}

// The terminal meter: a heavy line for the fill over a light line for the track,
// at least one cell filled once anything is used, as the desktop meter's dot.
export function bar(percent: number, cells = BAR_CELLS): { fill: string; track: string } {
  const p = clampPercent(percent)
  const filled = p === 0 ? 0 : Math.max(1, Math.round((p / 100) * cells))
  return { fill: '━'.repeat(filled), track: '─'.repeat(cells - filled) }
}

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'week',
  spend_limit: 'spend',
}
const LIMIT_ORDER = ['five_hour', 'seven_day', 'spend_limit']

// A rate-limit window's short name: `five_hour` is "5h", an unknown kind is spelled out.
export function limitLabel(kind: string): string {
  return LIMIT_LABELS[kind] ?? kind.replace(/_/g, ' ')
}

// The 5-hour window first, then the weekly one, then any other.
export function sortLimits<T extends { kind: string }>(limits: readonly T[]): T[] {
  const rank = (kind: string) => {
    const at = LIMIT_ORDER.indexOf(kind)
    return at === -1 ? LIMIT_ORDER.length : at
  }
  return [...limits].sort((a, b) => rank(a.kind) - rank(b.kind))
}

// How long until a window resets: "37m", "4h 27m", "2d 5h"; "now" once it is due.
export function resetIn(ms: number): string {
  if (!(ms > 0)) {
    return 'now'
  }
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const DOTS = ['·  ', '·· ', '···', ' ··', '  ·', '   ']
export const GLOW_CELLS = 2

export function spinner(frame: number): string {
  return SPINNER[frame % SPINNER.length] ?? ''
}

export function dots(frame: number): string {
  return DOTS[Math.floor(frame / 2) % DOTS.length] ?? ''
}

// The terminal loading meter: a short heavy segment sweeping back and forth
// over the light track.
export function sweep(frame: number): { before: string; glow: string; after: string } {
  const span = BAR_CELLS - GLOW_CELLS
  const step = frame % (2 * span)
  const at = step <= span ? step : 2 * span - step
  return {
    before: '─'.repeat(at),
    glow: '━'.repeat(GLOW_CELLS),
    after: '─'.repeat(span - at),
  }
}

// A placeholder for a figure still loading: a grey pill that pulses.
export function skeletonSvg(width: number, height: number): string {
  const r = height / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="#808080" fill-opacity="0.2">` +
    `<animate attributeName="fill-opacity" values="0.12;0.34;0.12" dur="1.4s" repeatCount="indefinite"/>` +
    `</rect></svg>`
  )
}

// The desktop meter while loading: the empty track with a highlight gliding across.
export function shimmerSvg(width = METER_PX, height = 6): string {
  const r = height / 2
  const glow = Math.round(width / 3)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><clipPath id="t"><rect width="${width}" height="${height}" rx="${r}"/></clipPath>` +
    `<linearGradient id="g"><stop offset="0" stop-color="#b0b0b0" stop-opacity="0"/>` +
    `<stop offset="0.5" stop-color="#b0b0b0" stop-opacity="0.75"/>` +
    `<stop offset="1" stop-color="#b0b0b0" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="#80808047"/>` +
    `<g clip-path="url(#t)"><rect x="${-glow}" width="${glow}" height="${height}" fill="url(#g)">` +
    `<animate attributeName="x" from="${-glow}" to="${width}" dur="1.2s" repeatCount="indefinite"/>` +
    `</rect></g></svg>`
  )
}

// The desktop meter: a rounded pill, its fill never thinner than its height
// once anything is used, so 1% still shows as a dot.
export function meterSvg(percent: number, width = METER_PX, height = 6): string {
  const p = clampPercent(percent)
  const r = height / 2
  const fillWidth = p === 0 ? 0 : Math.max(height, Math.round((p / 100) * width))
  const fill =
    fillWidth > 0
      ? `<rect width="${fillWidth}" height="${height}" rx="${r}" fill="${SEVERITY_HEX[colorFor(p)]}"/>`
      : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="#80808047"/>` +
    fill +
    `</svg>`
  )
}

// A rate limit's pill text: "5h 9% ↻ 4h 27m", or "5h 9%" without the reset.
export function limitText(label: string, percent: number, reset?: string): string {
  return reset === undefined ? `${label} ${percent}%` : `${label} ${percent}% ↻ ${reset}`
}

// The desktop pill: rounded ends, monospace text in coloured runs. Drawn as an
// SVG since a Box has no rounded corners, and an SVG never wraps or shrinks.
const PILL_FONT_PX = 12
const PILL_CHAR_PX = 7.2
const PILL_PAD_PX = 8
const PILL_HEIGHT_PX = 20
// Grey that reads on light and dark themes alike, for the pill's dim runs.
export const PILL_DIM_HEX = '#8e8e8e'

export type PillRun = { text: string; color: string }

export function severityHex(percent: number): string {
  return SEVERITY_HEX[colorFor(percent)]
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function pillSvg(runs: readonly PillRun[]): { source: string; width: number; height: number } {
  const chars = runs.reduce((n, run) => n + [...run.text].length, 0)
  const width = Math.ceil(chars * PILL_CHAR_PX + 2 * PILL_PAD_PX)
  const height = PILL_HEIGHT_PX
  const spans = runs.map(run => `<tspan fill="${run.color}">${escapeXml(run.text)}</tspan>`).join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${height / 2}" fill="#000000" fill-opacity="0.18"/>` +
    `<text x="${PILL_PAD_PX}" y="${height / 2}" dominant-baseline="central" xml:space="preserve" ` +
    `font-family="ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace" font-size="${PILL_FONT_PX}">` +
    spans +
    `</text></svg>`
  return { source, width, height }
}

// What the band would hold, in cells, to decide what fits.
export type BandSizes = {
  cost: number
  prompts: number
  limits: readonly { full: number; compact: number }[]
  gauge: number
}

// Fits the band to its width: the full band if it fits, else without the reset
// countdowns, else without the prompt count as well.
export function planBand(columns: number, sizes: BandSizes): { showsResets: boolean; showsPrompts: boolean } {
  const widthOf = (showsResets: boolean, showsPrompts: boolean) => {
    const pills = sizes.limits.map(limit => (showsResets ? limit.full : limit.compact) + 2)
    const pillsWidth = pills.length > 0 ? pills.reduce((a, b) => a + b, 0) + pills.length - 1 : 0
    const left = [sizes.cost, showsPrompts ? sizes.prompts : 0, pillsWidth].filter(w => w > 0)
    const leftWidth = left.reduce((a, b) => a + b, 0) + 2 * Math.max(0, left.length - 1)
    return 2 + leftWidth + 2 + sizes.gauge
  }
  const plans = [
    { showsResets: true, showsPrompts: true },
    { showsResets: false, showsPrompts: true },
    { showsResets: false, showsPrompts: false },
  ]
  return plans.find(plan => widthOf(plan.showsResets, plan.showsPrompts) <= columns) ?? plans[2]!
}

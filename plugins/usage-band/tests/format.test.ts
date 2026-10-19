import { describe, expect, test } from 'claude-code/testing'

import {
  BAR_CELLS,
  GLOW_CELLS,
  METER_PX,
  bar,
  colorFor,
  dots,
  limitLabel,
  limitText,
  meterSvg,
  pillSvg,
  planBand,
  resetIn,
  shimmerSvg,
  short,
  skeletonSvg,
  sortLimits,
  spinner,
  sweep,
} from '../hooks/format'

describe('short', () => {
  test('leaves numbers under a thousand as they are', async () => {
    expect(short(0)).toBe('0')
    expect(short(999)).toBe('999')
  })

  test('abbreviates thousands with one decimal, dropping ".0"', async () => {
    expect(short(1_000)).toBe('1k')
    expect(short(1_234)).toBe('1.2k')
    expect(short(117_400)).toBe('117.4k')
    expect(short(200_000)).toBe('200k')
  })

  test('abbreviates millions with one decimal, dropping ".0"', async () => {
    expect(short(1_000_000)).toBe('1M')
    expect(short(1_250_000)).toBe('1.3M')
    expect(short(1_200_000)).toBe('1.2M')
  })
})

describe('colorFor', () => {
  test('picks the severity theme colour at each threshold', async () => {
    expect(colorFor(0)).toBe('success')
    expect(colorFor(49)).toBe('success')
    expect(colorFor(50)).toBe('warning')
    expect(colorFor(74)).toBe('warning')
    expect(colorFor(75)).toBe('claude')
    expect(colorFor(89)).toBe('claude')
    expect(colorFor(90)).toBe('error')
    expect(colorFor(120)).toBe('error')
  })
})

describe('bar', () => {
  test('is always five cells, fill plus track', async () => {
    for (const p of [-5, 0, 4, 5, 37, 50, 99, 100, 150]) {
      const { fill, track } = bar(p)
      expect(fill.length + track.length).toBe(BAR_CELLS)
    }
  })

  test('fills round(percent / 10) cells, at least one once used, clamped to the bar', async () => {
    expect(bar(0)).toEqual({ fill: '', track: '─────' })
    expect(bar(4)).toEqual({ fill: '━', track: '────' })
    expect(bar(37)).toEqual({ fill: '━━', track: '───' })
    expect(bar(60)).toEqual({ fill: '━━━', track: '──' })
    expect(bar(100)).toEqual({ fill: '━━━━━', track: '' })
    expect(bar(150)).toEqual({ fill: '━━━━━', track: '' })
  })
})

describe('meterSvg', () => {
  const fillWidth = (svg: string) => /<rect width="(\d+)"[^>]*fill="#[0-9a-f]{6}"\/>/.exec(svg)?.[1]

  test('draws only the track when empty', async () => {
    expect(fillWidth(meterSvg(0))).toBeUndefined()
  })

  test('scales the fill to the width, never thinner than a dot', async () => {
    expect(METER_PX).toBe(36)
    expect(fillWidth(meterSvg(1))).toBe('6')
    expect(fillWidth(meterSvg(50))).toBe('18')
    expect(fillWidth(meterSvg(100))).toBe('36')
    expect(fillWidth(meterSvg(150))).toBe('36')
  })

  test('colours the fill by severity', async () => {
    expect(meterSvg(12)).toContain('#4eba65')
    expect(meterSvg(95)).toContain('#ef5a6f')
  })
})

describe('loading frames', () => {
  test('the sweep fills the meter and bounces between the ends', async () => {
    const at = (f: number) => sweep(f).before.length
    for (let f = 0; f < 30; f++) {
      const { before, glow, after } = sweep(f)
      expect(before.length + glow.length + after.length).toBe(BAR_CELLS)
      expect(glow.length).toBe(GLOW_CELLS)
    }
    expect([0, 1, 2, 3, 4, 5, 6].map(at)).toEqual([0, 1, 2, 3, 2, 1, 0])
  })

  test('the spinner and dots cycle', async () => {
    expect(spinner(0)).toBe('⠋')
    expect(spinner(10)).toBe('⠋')
    expect(dots(0)).toBe('·  ')
    expect(dots(4)).toBe('···')
    expect(dots(12)).toBe('·  ')
  })

  test('the desktop placeholders animate inside the SVG', async () => {
    expect(skeletonSvg(36, 8)).toContain('attributeName="fill-opacity"')
    expect(shimmerSvg()).toContain('attributeName="x"')
    expect(shimmerSvg()).toContain('width="36"')
  })
})

describe('rate limits', () => {
  test('a short bar takes any number of cells', async () => {
    expect(bar(40, 3)).toEqual({ fill: '━', track: '──' })
    expect(bar(100, 3)).toEqual({ fill: '━━━', track: '' })
  })

  test('windows have short names, unknown kinds spelled out', async () => {
    expect(limitLabel('five_hour')).toBe('5h')
    expect(limitLabel('seven_day')).toBe('week')
    expect(limitLabel('spend_limit')).toBe('spend')
    expect(limitLabel('seven_day_opus')).toBe('seven day opus')
  })

  test('the 5-hour window comes first, then the weekly, then others', async () => {
    const kinds = sortLimits([{ kind: 'other' }, { kind: 'seven_day' }, { kind: 'five_hour' }]).map(l => l.kind)
    expect(kinds).toEqual(['five_hour', 'seven_day', 'other'])
  })

  test('the reset countdown reads in minutes, hours or days', async () => {
    expect(resetIn(0)).toBe('now')
    expect(resetIn(-5)).toBe('now')
    expect(resetIn(30_000)).toBe('1m')
    expect(resetIn(37 * 60_000)).toBe('37m')
    expect(resetIn((4 * 60 + 27) * 60_000)).toBe('4h 27m')
    expect(resetIn((53 * 60) * 60_000)).toBe('2d 5h')
  })
})

describe('pills', () => {
  test('a limit reads label, share and reset', async () => {
    expect(limitText('5h', 9, '4h 27m')).toBe('5h 9% ↻ 4h 27m')
    expect(limitText('week', 3)).toBe('week 3%')
  })

  test('the desktop pill has rounded ends and sizes to its text', async () => {
    const pill = pillSvg([
      { text: '5h ', color: '#8e8e8e' },
      { text: '9%', color: '#4eba65' },
    ])
    expect(pill.height).toBe(20)
    expect(pill.source).toContain('rx="10"')
    expect(pill.source).toContain('<tspan fill="#4eba65">9%</tspan>')
    expect(pill.width).toBe(Math.ceil(5 * 7.2 + 16))
    const longer = pillSvg([{ text: '5h 9% ↻ 4h 27m', color: '#8e8e8e' }])
    expect(longer.width).toBeGreaterThan(pill.width)
  })

  test('the pill escapes its text', async () => {
    expect(pillSvg([{ text: 'a<b&c', color: '#000' }]).source).toContain('a&lt;b&amp;c')
  })
})

describe('fitting the band', () => {
  // A cost of 5 cells, a prompt count of 8, two limits and a 20-cell gauge:
  // 76 cells in full, 58 without the resets, 48 without the prompt count either.
  const sizes = {
    cost: 5,
    prompts: 8,
    limits: [
      { full: 14, compact: 5 },
      { full: 16, compact: 7 },
    ],
    gauge: 20,
  }

  test('shows everything when it fits', async () => {
    expect(planBand(76, sizes)).toEqual({ showsResets: true, showsPrompts: true })
  })

  test('drops the resets first, then the prompt count', async () => {
    expect(planBand(75, sizes)).toEqual({ showsResets: false, showsPrompts: true })
    expect(planBand(58, sizes)).toEqual({ showsResets: false, showsPrompts: true })
    expect(planBand(57, sizes)).toEqual({ showsResets: false, showsPrompts: false })
    expect(planBand(20, sizes)).toEqual({ showsResets: false, showsPrompts: false })
  })

  test('counts no gap for figures the band does not have', async () => {
    expect(planBand(26, { cost: 0, prompts: 0, limits: [], gauge: 20 })).toEqual({ showsResets: true, showsPrompts: true })
  })
})

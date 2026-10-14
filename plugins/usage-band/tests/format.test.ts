import { describe, expect, test } from 'claude-code/testing'

import {
  BAR_CELLS,
  GLOW_CELLS,
  bar,
  colorFor,
  dots,
  limitLabel,
  meterSvg,
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
  test('is always ten cells, fill plus track', async () => {
    for (const p of [-5, 0, 4, 5, 37, 50, 99, 100, 150]) {
      const { fill, track } = bar(p)
      expect(fill.length + track.length).toBe(BAR_CELLS)
    }
  })

  test('fills round(percent / 10) cells, at least one once used, clamped to the bar', async () => {
    expect(bar(0)).toEqual({ fill: '', track: '──────────' })
    expect(bar(4)).toEqual({ fill: '━', track: '─────────' })
    expect(bar(5)).toEqual({ fill: '━', track: '─────────' })
    expect(bar(37)).toEqual({ fill: '━━━━', track: '──────' })
    expect(bar(100)).toEqual({ fill: '━━━━━━━━━━', track: '' })
    expect(bar(150)).toEqual({ fill: '━━━━━━━━━━', track: '' })
  })
})

describe('meterSvg', () => {
  const fillWidth = (svg: string) => /<rect width="(\d+)"[^>]*fill="#[0-9a-f]{6}"\/>/.exec(svg)?.[1]

  test('draws only the track when empty', async () => {
    expect(fillWidth(meterSvg(0))).toBeUndefined()
  })

  test('scales the fill to the width, never thinner than a dot', async () => {
    expect(fillWidth(meterSvg(1))).toBe('6')
    expect(fillWidth(meterSvg(50))).toBe('36')
    expect(fillWidth(meterSvg(100))).toBe('72')
    expect(fillWidth(meterSvg(150))).toBe('72')
  })

  test('colours the fill by severity', async () => {
    expect(meterSvg(12)).toContain('#4eba65')
    expect(meterSvg(95)).toContain('#ef5a6f')
  })
})

describe('loading frames', () => {
  test('the sweep stays ten cells and bounces between the ends', async () => {
    const at = (f: number) => sweep(f).before.length
    for (let f = 0; f < 30; f++) {
      const { before, glow, after } = sweep(f)
      expect(before.length + glow.length + after.length).toBe(BAR_CELLS)
      expect(glow.length).toBe(GLOW_CELLS)
    }
    expect([0, 1, 7, 8, 13, 14].map(at)).toEqual([0, 1, 7, 6, 1, 0])
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
    expect(shimmerSvg()).toContain('width="72"')
  })
})

describe('rate limits', () => {
  test('a short bar takes any number of cells', async () => {
    expect(bar(40, 5)).toEqual({ fill: '━━', track: '───' })
    expect(bar(100, 5)).toEqual({ fill: '━━━━━', track: '' })
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

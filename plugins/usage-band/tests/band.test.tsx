import { expect, mock, test } from 'claude-code/testing'

function props(bodyColumns: number) {
  return {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  }
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

const TURN = {
  answer: 'done',
  durationMs: 10,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
} as const

test('draws cost on the left and the context gauge on the right, on every surface', async ($, on) => {
  on('session.start', () => ({ cwd: '/' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 160_000, window: 200_000 },
      rateLimits: [],
      cost: { usd: 1.234 },
    },
  }))
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: props(120) })
    const row = await ui.find({ type: 'Box' })
    expect(row?.props.justifyContent).toBe('space-between')
    expect((await ui.find({ key: 'spend' }))?.text).toBe('$1.23')
    const percent = await ui.find({ type: 'Text', text: /%$/ })
    expect(percent?.text).toBe('80%')
    expect(percent?.props.color).toBe('claude')
    expect((await ui.find({ key: 'context' }))?.text).toBe('160k / 200k')
    expect(await ui.find({ type: 'Text', text: /[↑↓]/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('draws an SVG meter on desktop and a line meter in the terminal', async ($, on) => {
  on('session.start', () => ({ cwd: '/' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 24_000, window: 200_000 }, rateLimits: [] } }))
  await $.session.start(START)

  const desktop = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props: props(120) })
  const svg = await desktop.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('Context 12% full')
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect((await terminal.find({ key: 'meter' }))?.text).toBe('━────')
  expect(await terminal.find({ key: 'spend' })).toBeUndefined()
  await terminal.unmount()
})

test('takes a fresh reading when a turn completes', async ($, on) => {
  let usd = 1
  on('session.start', () => ({ cwd: '/' }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200_000 }, rateLimits: [], cost: { usd } } }))
  await $.session.start(START)
  usd = 2.5
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect((await ui.find({ key: 'spend' }))?.text).toBe('$2.50')
  expect((await ui.find({ key: 'context' }))?.text).toBe('0 / 200k')
  await ui.unmount()
})

test('shows an animated placeholder until the first reading arrives', async ($, on) => {
  const clock = mock.clock(on)
  let isReady = false
  on('session.start', () => ({ cwd: '/' }))
  on('session.usage', () =>
    isReady
      ? { value: { startedAt: 0, context: { tokens: 24_000, window: 200_000 }, rateLimits: [], cost: { usd: 1 } } }
      : { deny: 'not ready' },
  )
  await $.session.start(START)

  const terminal = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect((await terminal.find({ key: 'spend' }))?.text).toBe('⠋')
  expect((await terminal.find({ key: 'meter' }))?.text).toBe('━━───')
  await clock.advance(100)
  expect((await terminal.find({ key: 'spend' }))?.text).toBe('⠙')
  expect((await terminal.find({ key: 'meter' }))?.text).toBe('─━━──')

  const desktop = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props: props(120) })
  const shimmer = (await desktop.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Loading context meter')
  expect(shimmer?.props.isInteractive).toBe(true)
  expect(String(shimmer?.props.source)).toContain('<animate')

  isReady = true
  await clock.advance(300)
  expect((await terminal.find({ key: 'spend' }))?.text).toBe('$1.00')
  expect((await terminal.find({ key: 'context' }))?.text).toBe('24k / 200k')
  expect((await desktop.find({ type: 'Svg' }))?.props.alt).toBe('Context 12% full')
  await terminal.unmount()
  await desktop.unmount()
})

test('gives up on the placeholder when no reading ever comes', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/' }))
  on('session.usage', () => ({ deny: 'never' }))
  // Stands for the engine's own band beneath the plugin.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect(await ui.find({ key: 'loading' })).toBeDefined()
  await clock.advance(30_100)
  expect(await ui.find({ key: 'loading' })).toBeUndefined()
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  await ui.unmount()
})

const NOW = Date.parse('2026-10-14T10:00:00Z')

const LIMITS = [
  { kind: 'seven_day', percentUsed: 3, resetsAt: '2026-10-19T05:00:00Z' },
  { kind: 'five_hour', percentUsed: 9.4, resetsAt: '2026-10-14T14:27:00Z' },
]

test('shows the cost and prompts as text and each rate limit in a pill with its reset', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: '/' }))
  on('session.turns', () => ({ value: 14 }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 24_000, window: 200_000 }, rateLimits: LIMITS, cost: { usd: 3.8 } },
  }))
  await $.session.start(START)

  // Terminal: the pills are runs of text on the band, in order.
  const terminal = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: props(140) })
  expect((await terminal.find({ key: 'spend' }))?.text).toBe('$3.80')
  expect((await terminal.find({ key: 'prompts' }))?.text).toBe('14 prompts')
  const left = (await terminal.find({ key: 'left' }))?.text ?? ''
  expect(left.indexOf('$3.80')).toBeLessThan(left.indexOf('14 prompts'))
  expect(left.indexOf('14 prompts')).toBeLessThan(left.indexOf('5h'))
  expect(left.indexOf('5h')).toBeLessThan(left.indexOf('week'))
  expect((await terminal.find({ key: 'limit-five_hour' }))?.text).toBe('5h9%↻ 4h 27m')
  expect((await terminal.find({ key: 'limit-seven_day' }))?.text).toBe('week3%↻ 4d 19h')
  expect((await terminal.find({ type: 'Text', text: '9%' }))?.props.color).toBe('success')
  await clock.advance(60_000)
  expect((await terminal.find({ key: 'limit-five_hour' }))?.text).toContain('↻ 4h 26m')
  await terminal.unmount()

  // Desktop: each pill is an SVG with rounded ends; cost and context are plain text.
  const desktop = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props: props(140) })
  const pills = (await desktop.findAll({ type: 'Svg' })).filter(svg => !String(svg.props.alt).startsWith('Context'))
  expect(pills.map(svg => svg.props.alt)).toEqual(['5h 9% ↻ 4h 26m', 'week 3% ↻ 4d 18h'])
  expect(String(pills[0]?.props.source)).toContain('rx="10"')
  expect(String(pills[0]?.props.source)).toContain('<tspan fill="#4eba65">9%</tspan>')
  for (const key of ['spend', 'prompts', 'gauge']) {
    expect((await desktop.find({ key }))?.props.backgroundColor).toBeUndefined()
  }
  await desktop.unmount()
})

test('fits the band to its width: resets go first, then the prompt count', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: '/' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 24_000, window: 200_000 }, rateLimits: LIMITS, cost: { usd: 1 } },
  }))
  await $.session.start(START)

  // 76 cells in full, 58 without the resets (the sizes in format.test.ts).
  const mount = (columns: number) =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: props(columns) })

  const full = await mount(76)
  expect((await full.find({ key: 'limit-five_hour' }))?.text).toContain('↻')
  expect((await full.find({ key: 'prompts' }))?.text).toBe('1 prompt')
  await full.unmount()

  const medium = await mount(70)
  expect((await medium.find({ key: 'limit-five_hour' }))?.text).toBe('5h9%')
  expect((await medium.find({ key: 'prompts' }))?.text).toBe('1 prompt')
  await medium.unmount()

  const narrow = await mount(50)
  expect(await narrow.find({ key: 'prompts' })).toBeUndefined()
  expect((await narrow.find({ key: 'limit-five_hour' }))?.text).toBe('5h9%')
  expect((await narrow.find({ key: 'gauge' }))?.text).toBe('24k / 200k12%━────')
  await narrow.unmount()

  const desktop = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props: props(70) })
  const alts = (await desktop.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
  expect(alts).toContain('5h 9%')
  expect(alts).toContain('week 3%')
  await desktop.unmount()
})

test('hides the limits when the account reports none', async ($, on) => {
  on('session.start', () => ({ cwd: '/' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200_000 }, rateLimits: [] } }))
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: props(140) })
  expect(await ui.find({ key: 'limits' })).toBeUndefined()
  await ui.unmount()
})

test('takes rate limits pushed by session.measure', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: '/' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200_000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.start(START)
  await $.session.measure({
    context: { tokens: 0, window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: '2026-10-14T10:30:00Z' }],
    changed: ['rateLimits'],
  })

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: props(140) })
  const percent = await ui.find({ type: 'Text', text: '91%' })
  expect(percent?.props.color).toBe('error')
  expect((await ui.find({ key: 'limit-five_hour' }))?.text).toContain('↻ 30m')
  await ui.unmount()
})

import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import {
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
} from './format'

type Limit = { kind: string; percent: number; resetsAt?: number }

type Reading = {
  percent: number
  tokens: number
  window: number
  usd?: number
  limits: Limit[]
  prompts?: number
}

// One loading frame every FRAME_MS; a fresh reading is tried every
// RETRY_FRAMES frames, and the band gives up after GIVE_UP_FRAMES.
const FRAME_MS = 100
const RETRY_FRAMES = 3
const GIVE_UP_FRAMES = 300
// The reset countdowns move on once a minute.
const CLOCK_MS = 60_000
// Below this width (in cells) the band drops the prompt count.
const PROMPTS_MIN_COLUMNS = 80
// The rate-limit pills' recessed background on desktop.
const PILL_BG = '#0000002e'

let reading: Reading | null = null
let now = 0
let frame = 0
let ticker: Timer | null = null
let clockTicker: Timer | null = null
let isRetrying = false
// Only the terminal's placeholder needs a redraw per frame; the desktop's
// animates inside its SVG and would restart if redrawn.
let animatesTerminal = false

function toLimit(limit: SessionRateLimit): Limit {
  const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
  return {
    kind: limit.kind,
    percent: Math.round(limit.percentUsed),
    resetsAt: Number.isNaN(resetsAt) ? undefined : resetsAt,
  }
}

// Folds the usage figures into the reading; false when they have no window yet.
function applyUsage(
  context: SessionContextUsage | undefined,
  cost: SessionCost | undefined,
  rateLimits: readonly SessionRateLimit[] | undefined,
): boolean {
  if (!context || !context.window) {
    return false
  }
  const tokens = context.tokens ?? 0
  const percent = Math.round(context.percent ?? (tokens / context.window) * 100)
  reading = {
    percent,
    tokens,
    window: context.window,
    usd: cost?.usd,
    limits: sortLimits(rateLimits ?? []).map(toLimit),
    prompts: reading?.prompts,
  }
  return true
}

async function takeReading($: EngineInterface): Promise<void> {
  try {
    const [usage, prompts, at] = await Promise.all([
      $.session.usage(),
      $.session.turns().catch(() => undefined),
      $.clock.now().catch(() => now),
    ])
    now = at
    if (!applyUsage(usage.context, usage.cost, usage.rateLimits)) {
      return
    }
    if (reading !== null && prompts !== undefined) {
      reading.prompts = prompts
    }
    stopLoading()
    $.ui.invalidate('ui.render')
  } catch {
    // Keep the last reading.
  }
}

function stopLoading(): void {
  ticker?.cancel()
  ticker = null
}

function startLoading($: EngineInterface): void {
  if (ticker !== null) {
    return
  }
  frame = 0
  ticker = $.clock.every(FRAME_MS, () => {
    frame += 1
    if (frame > GIVE_UP_FRAMES) {
      stopLoading()
      $.ui.invalidate('ui.render')
      return
    }
    if (frame % RETRY_FRAMES === 0 && !isRetrying) {
      isRetrying = true
      void takeReading($).finally(() => {
        isRetrying = false
      })
    }
    if (animatesTerminal) {
      $.ui.invalidate('ui.render')
    }
  })
}

function startClock($: EngineInterface): void {
  if (clockTicker !== null) {
    return
  }
  clockTicker = $.clock.every(CLOCK_MS, () => {
    void $.clock
      .now()
      .then(at => {
        now = at
        if (reading?.limits.some(limit => limit.resetsAt !== undefined)) {
          $.ui.invalidate('ui.render')
        }
      })
      .catch(() => {})
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    reading = null
    animatesTerminal = false
    startLoading($)
    startClock($)
    // Read right away rather than after the session has finished starting;
    // a reading that is not ready yet is retried by the loading ticker.
    void takeReading($)
    const result = await next(e)
    await takeReading($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await takeReading($)

    return result
  })

  // Pushed when a figure moves, a rate-limit window among them.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (applyUsage(e.context, e.cost, e.rateLimits)) {
      stopLoading()
      $.ui.invalidate('ui.render')
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const current = reading

    if (current === null) {
      if (ticker === null) {
        return next(e)
      }
      let spend
      let figures
      let meter
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)
        spend = <Svg source={skeletonSvg(36, 8)} alt="Loading cost" width={36} height={8} isInteractive />
        figures = <Svg source={skeletonSvg(64, 8)} alt="Loading context" width={64} height={8} isInteractive />
        meter = <Svg source={shimmerSvg()} alt="Loading context meter" width={72} height={6} isInteractive />
      } else {
        animatesTerminal = true
        const { before, glow, after } = sweep(frame)
        spend = <Text dimColor>{spinner(frame)}</Text>
        figures = <Text dimColor>{dots(frame)}</Text>
        meter = (
          <Box key="meter" flexDirection="row">
            <Text color="inactive">{before}</Text>
            <Text color="subtle">{glow}</Text>
            <Text color="inactive">{after}</Text>
          </Box>
        )
      }

      return (
        <Box key="loading" flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" paddingX={1}>
          <Box key="spend" flexDirection="row">
            {spend}
          </Box>
          <Box key="gauge" flexDirection="row" alignItems="center" gap={1}>
            {figures}
            {meter}
          </Box>
        </Box>
      )
    }

    const columns = e.props.bodyColumns ?? 80
    const showsPrompts = columns >= PROMPTS_MIN_COLUMNS && current.prompts !== undefined
    const severity = colorFor(current.percent)

    // A meter at any size: an SVG pill on desktop, a line of cells in the terminal.
    const meterOf = (key: string, percent: number, alt: string, width: number, height: number, cells: number) => {
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)
        return <Svg source={meterSvg(percent, width, height)} alt={alt} width={width} height={height} />
      }
      const { fill, track } = bar(percent, cells)
      return (
        <Box key={key} flexDirection="row">
          <Text color={colorFor(percent)}>{fill}</Text>
          <Text color="inactive">{track}</Text>
        </Box>
      )
    }

    const { usd, prompts, limits } = current

    // The rate limits sit in recessed pills, a translucent black that darkens
    // any theme (desktop only; the terminal draws them on the band). Cost,
    // prompts and the context gauge stay plain text.
    const pillProps = e.surface === 'desktop' ? { backgroundColor: PILL_BG } : {}

    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" paddingX={1}>
        <Box key="left" flexDirection="row" alignItems="center" gap={2}>
          {usd !== undefined ? (
            <Box key="spend" flexDirection="row">
              <Text>{`$${usd.toFixed(2)}`}</Text>
            </Box>
          ) : null}
          {showsPrompts ? (
            <Box key="prompts" flexDirection="row">
              <Text dimColor>{`${prompts} ${prompts === 1 ? 'prompt' : 'prompts'}`}</Text>
            </Box>
          ) : null}
          {limits.length > 0 ? (
            <Box key="limits" flexDirection="row" alignItems="center" gap={1}>
              {limits.map(limit => (
                <Box key={`limit-${limit.kind}`} flexDirection="row" gap={1} paddingX={1} {...pillProps}>
                  <Text dimColor>{limitLabel(limit.kind)}</Text>
                  <Text color={colorFor(limit.percent)}>{`${limit.percent}%`}</Text>
                  {limit.resetsAt !== undefined ? (
                    <Text dimColor>{`↻ ${resetIn(limit.resetsAt - now)}`}</Text>
                  ) : null}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
        <Box key="gauge" flexDirection="row" alignItems="center" gap={1}>
          <Box key="context" flexDirection="row">
            <Text>{short(current.tokens)}</Text>
            <Text dimColor>{` / ${short(current.window)}`}</Text>
          </Box>
          <Text bold color={severity}>{`${current.percent}%`}</Text>
          {meterOf('meter', current.percent, `Context ${current.percent}% full`, 72, 6, 10)}
        </Box>
      </Box>
    )
  })
}

import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import {
  BAR_CELLS,
  METER_PX,
  PILL_DIM_HEX,
  bar,
  colorFor,
  dots,
  limitLabel,
  limitText,
  meterSvg,
  pillSvg,
  planBand,
  resetIn,
  severityHex,
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
        figures = <Svg source={skeletonSvg(56, 8)} alt="Loading context" width={56} height={8} isInteractive />
        meter = <Svg source={shimmerSvg()} alt="Loading context meter" width={METER_PX} height={6} isInteractive />
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

    const { usd, prompts, limits } = current
    const costText = usd !== undefined ? `$${usd.toFixed(2)}` : ''
    const promptsText = prompts !== undefined ? `${prompts} ${prompts === 1 ? 'prompt' : 'prompts'}` : ''
    const contextText = `${short(current.tokens)} / ${short(current.window)}`
    const percentText = `${current.percent}%`
    const resetOf = (limit: Limit) => (limit.resetsAt === undefined ? undefined : resetIn(limit.resetsAt - now))

    // Fit the band to its width rather than let a figure wrap: drop the reset
    // countdowns first, then the prompt count.
    const { showsResets, showsPrompts } = planBand(e.props.bodyColumns ?? 80, {
      cost: costText.length,
      prompts: promptsText.length,
      limits: limits.map(limit => ({
        full: limitText(limitLabel(limit.kind), limit.percent, resetOf(limit)).length,
        compact: limitText(limitLabel(limit.kind), limit.percent).length,
      })),
      gauge: contextText.length + 1 + percentText.length + 1 + BAR_CELLS,
    })
    const severity = colorFor(current.percent)

    // A rate limit's pill. On desktop an SVG, for its rounded ends; in the
    // terminal plain runs of text on the band.
    const pillOf = (limit: Limit) => {
      const label = limitLabel(limit.kind)
      const reset = showsResets ? resetOf(limit) : undefined
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)
        const runs = [
          { text: `${label} `, color: PILL_DIM_HEX },
          { text: `${limit.percent}%`, color: severityHex(limit.percent) },
          ...(reset === undefined ? [] : [{ text: ` ↻ ${reset}`, color: PILL_DIM_HEX }]),
        ]
        const pill = pillSvg(runs)
        return <Svg source={pill.source} alt={limitText(label, limit.percent, reset)} width={pill.width} height={pill.height} />
      }
      return (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{label}</Text>
          <Text color={colorFor(limit.percent)}>{`${limit.percent}%`}</Text>
          {reset !== undefined ? <Text dimColor>{`↻ ${reset}`}</Text> : null}
        </Box>
      )
    }

    const meter =
      e.surface === 'desktop'
        ? (() => {
            const { Svg } = $.ui.resolve(e)
            return <Svg source={meterSvg(current.percent)} alt={`Context ${current.percent}% full`} width={METER_PX} height={6} />
          })()
        : (() => {
            const { fill, track } = bar(current.percent)
            return (
              <Box key="meter" flexDirection="row" flexShrink={0}>
                <Text color={severity}>{fill}</Text>
                <Text color="inactive">{track}</Text>
              </Box>
            )
          })()

    // Cost, prompts and the rate-limit pills on the left; the context gauge on
    // the right. Nothing shrinks, so no figure wraps onto a second row.
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" paddingX={1}>
        <Box key="left" flexDirection="row" alignItems="center" gap={2} flexShrink={0}>
          {usd !== undefined ? (
            <Box key="spend" flexDirection="row" flexShrink={0}>
              <Text wrap="truncate-end">{costText}</Text>
            </Box>
          ) : null}
          {showsPrompts && prompts !== undefined ? (
            <Box key="prompts" flexDirection="row" flexShrink={0}>
              <Text dimColor wrap="truncate-end">{promptsText}</Text>
            </Box>
          ) : null}
          {limits.length > 0 ? (
            <Box key="limits" flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
              {limits.map(limit => (
                <Box key={`limit-${limit.kind}`} flexDirection="row" flexShrink={0}>
                  {pillOf(limit)}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
        <Box key="gauge" flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
          <Box key="context" flexDirection="row" flexShrink={0}>
            <Text>{short(current.tokens)}</Text>
            <Text dimColor>{` / ${short(current.window)}`}</Text>
          </Box>
          <Text bold color={severity}>{percentText}</Text>
          {meter}
        </Box>
      </Box>
    )
  })
}

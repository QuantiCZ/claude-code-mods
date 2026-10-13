// Usage Band: current session usage above the prompt.
//
// Based on the token-weather sample (anthropics/claude-code-playground).
// session.start / turn.complete: read $.session.usage() (the status line's
// figures plus the /cost total) and keep it, adding each main-loop turn's
// token counts to a running total.
// ui.render (AbovePrompt): one line with context %, tokens, session totals
// and cost when the host keeps a ledger.
import type { EngineInterface, Register } from 'claude-code'

type Reading = {
  percent: number
  tokens: number
  window: number
  usd?: number
}

const BAR_WIDTH = 10

// Module variables start over on a reload; the band redraws from the next reading.
let reading: Reading | null = null
let tokensIn = 0
let tokensOut = 0

function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

function colorFor(percent: number): string {
  if (percent >= 90) return 'red'
  if (percent >= 75) return 'magenta'
  if (percent >= 50) return 'yellow'
  return 'green'
}

function bar(percent: number): string {
  const filled = Math.min(BAR_WIDTH, Math.round((percent / 100) * BAR_WIDTH))
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

async function takeReading($: EngineInterface) {
  try {
    const { context, cost } = await $.session.usage()
    if (!context || !context.window) return
    const tokens = context.tokens ?? 0
    const percent = Math.round(context.percent ?? (tokens / context.window) * 100)
    reading = { percent, tokens, window: context.window, usd: cost?.usd }
    $.ui.invalidate('ui.render')
  } catch {
    // No reading this time; the band keeps the last one.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    reading = null
    tokensIn = 0
    tokensOut = 0
    await takeReading($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result

    if (e.usage) {
      tokensIn +=
        e.usage.input_tokens + e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens
      tokensOut += e.usage.output_tokens
    }
    await takeReading($)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey || reading === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const color = colorFor(reading.percent)
    const isWide = (e.props.bodyColumns ?? 80) >= 70

    return (
      <Box flexDirection="row" paddingX={1}>
        <Text color={color} bold>
          {bar(reading.percent)} {reading.percent}%
        </Text>
        <Text dimColor>
          {'  '}
          {short(reading.tokens)} / {short(reading.window)} context
        </Text>
        {isWide && tokensIn + tokensOut > 0 ? (
          <Text dimColor>
            {'  ·  session ↑'}
            {short(tokensIn)} ↓{short(tokensOut)}
          </Text>
        ) : null}
        {reading.usd !== undefined ? (
          <Text dimColor>
            {'  ·  $'}
            {reading.usd.toFixed(2)}
          </Text>
        ) : null}
      </Box>
    )
  })
}

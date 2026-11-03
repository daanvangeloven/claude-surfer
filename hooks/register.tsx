import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Run } from '../types'

const PANE = 'claude-surfer'
const DELAY_MS = 15_000 // a turn counts as long after this
const TICK_MS = 120
const LANES = 3
const ARC = [0, 1, 2, 2, 1, 0] // jump height by jumpT; 0 = on the ground
const START: Run = { t: 0, lane: 1, x: 1, coins: 0, jumpT: 0 }
const run = atom({ plugin: 'claude-surfer', key: 'run' } as const, START, {
  shape: 'run-2',
})

let always = false // /surfer toggles: open at once on every prompt, not only long ones
let wait: { cancel: () => void } | undefined
let tick: { cancel: () => void } | undefined

// The track is a pure function of the world row, so the run needs no stored map.
// 'train' = change lane, 'bar' = jump it, 'coin' = grab it.
type Thing = { lane: number; kind: 'train' | 'bar' | 'coin' } | undefined
function thing(n: number): Thing {
  if (n < 6) return undefined
  const h = Math.imul(n ^ (n >>> 7), 2654435761) >>> 0
  const lane = (h >>> 8) % LANES
  const roll = h % 7
  if (roll === 0) return { lane, kind: 'train' }
  if (roll === 1) return { lane, kind: 'bar' }
  if (roll <= 3) return { lane, kind: 'coin' }
  return undefined
}

function blocked(n: number, lane: number) {
  const th = thing(n)

  return th?.lane === lane && th.kind === 'train'
}

function step(r: Run): Run {
  const t = r.t + 1
  let lane = r.lane
  // look 3 rows ahead; dodge a train by moving to the nearest lane free of trains
  const ahead = [t + 1, t + 2, t + 3]
  if (ahead.some(n => blocked(n, lane))) {
    const free = [lane - 1, lane + 1].filter(
      l => l >= 0 && l < LANES && !ahead.some(n => blocked(n, l)),
    )
    if (free.length) lane = free[0]
  }
  // slide toward the lane, half a lane a tick, so a switch is seen
  const x = r.x + Math.max(-0.5, Math.min(0.5, lane - r.x))
  const bar = thing(t + 2)
  const jumpT =
    r.jumpT > 0
      ? (r.jumpT + 1) % ARC.length
      : bar?.kind === 'bar' && bar.lane === lane
        ? 1
        : 0
  const here = thing(t)

  return {
    t,
    lane,
    x,
    jumpT,
    coins: r.coins + (here?.kind === 'coin' && here.lane === Math.round(x) ? 1 : 0),
  }
}

const LEGS = ['  ▘▘ ▝▝  ', '   ▘ ▝   ', '  ▝▝ ▘▘  ', '   ▘ ▝   ']

// 2.5D: rows near the top are far, so lanes shrink toward a vanishing point.
function draw(r: Run, W: number, H: number): string[] {
  const maxLane = Math.max(3, Math.floor((W - 2) / LANES))
  const geo = (i: number) => {
    const laneW = Math.max(3, Math.round(3 + (i / (H - 1)) * (maxLane - 3)))

    return { laneW, x0: Math.floor((W - LANES * laneW) / 2) }
  }
  const grid: string[][] = []
  for (let i = 0; i < H; i++) {
    const n = r.t + (H - 1 - i)
    const { laneW, x0 } = geo(i)
    const row = Array<string>(W).fill(' ')
    for (let l = 0; l < LANES; l++) {
      for (let c = 1; c < laneW; c++) row[x0 + l * laneW + c] = n % 2 === 0 ? '.' : ' '
    }
    for (let k = 0; k <= LANES; k++) {
      row[x0 + k * laneW] = k === 0 ? '/' : k === LANES ? '\\' : ':'
    }
    const th = thing(n)
    if (th) {
      const s = x0 + th.lane * laneW + 1
      const iw = laneW - 1
      const fill =
        th.kind === 'train'
          ? '█'.repeat(iw)
          : th.kind === 'bar'
            ? '▀'.repeat(iw)
            : iw >= 5
              ? '(o)'.padStart(Math.ceil((iw + 3) / 2)).padEnd(iw)
              : 'o'.padStart(Math.ceil((iw + 1) / 2)).padEnd(iw)
      for (let c = 0; c < iw; c++) row[s + c] = fill[c]
    }
    grid.push(row)
  }

  const b = geo(H - 1)
  const cx = Math.round(b.x0 + (r.x + 0.5) * b.laneW)
  const lift = ARC[r.jumpT]
  const sprite = [' ▐▛███▜▌ ', '▝▜█████▛▘', r.jumpT ? '   ▘ ▝   ' : LEGS[r.t % 4]]
  sprite.forEach((line, k) => {
    const y = H - 3 + k - lift
    for (let c = 0; c < line.length; c++) {
      const x = cx - 4 + c
      if (y >= 0 && x >= 0 && x < W && line[c] !== ' ') grid[y][x] = line[c]
    }
  })
  if (lift) for (let c = -1; c <= 1; c++) grid[H - 1][cx + c] = '_'

  return grid.map(row => row.join(''))
}

function stop($: any) {
  wait?.cancel()
  tick?.cancel()
  wait = tick = undefined
  void $.ui.close({ id: PANE })
}

async function start($: any) {
  await update($, run, () => START)
  await $.ui.open({ id: PANE, title: 'Claude Surfer', columns: 44, rows: 18 })
  tick?.cancel()
  tick = $.clock.every(TICK_MS, () => void update($, run, step))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'surfer',
      description: 'Toggle the Claude Surfer pane opening right away on every prompt (it always opens on long turns)',
    })

    return next(e)
  })

  on('command.run', { command: 'surfer' }, async $ => {
    always = !always

    return {
      text: always
        ? 'Claude Surfer on: it runs during each prompt.'
        : 'Claude Surfer off: it only opens on long turns.',
    }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      stop($)
      wait = $.clock.after(always ? 0 : DELAY_MS, () => void start($))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) stop($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, run)
    const props = e.props as {
      bodyColumns?: number
      placement?: 'dock' | 'inline'
      scroll?: { bodyRows?: number }
    }
    const W = Math.min(44, props.bodyColumns ?? 40)
    // the pane's own body, less the header and footer lines; Claude is on the last row
    const H = Math.max(6, Math.min(props.placement === 'dock' ? 30 : 16, (props.scroll?.bodyRows ?? 12) - 2))

    return (
      <Box flexDirection="column">
        <Text bold>CLAUDE SURFER  coins {r.coins}  dist {r.t}m</Text>
        {draw(r, W, H).map(l => (
          <Text>{l}</Text>
        ))}
        <Text dimColor>{r.jumpT ? 'jump!' : 'running…'}</Text>
      </Box>
    )
  })
}

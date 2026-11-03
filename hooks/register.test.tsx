import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'claude-surfer',
  component: 'Pane',
  requestId: 'claude-surfer',
  props: {
    title: 'Claude Surfer',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const DONE = { turnId: 't1', durationMs: 1, isAborted: false, reason: 'answer' } as const
const START = { text: 'go', turnId: 't1' } as const

test('a long turn opens the pane and the run advances', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('turn.start', (_, e) => e)
  on('turn.complete', () => ({ text: 'done' }))

  await $.turn.start(START)
  await clock.advance(10_000)
  expect(opened).toEqual([])

  await clock.advance(5_001 + 1_600)
  expect(opened).toEqual(['claude-surfer'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const head = await ui.find({ type: 'Text', text: /CLAUDE SURFER/ })
  const dist = Number(/dist (\d+)m/.exec(head?.text ?? '')?.[1])
  expect(dist).toBeGreaterThanOrEqual(8)
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/})).toBeTruthy()
  await ui.unmount()

  await $.turn.complete(DONE)
  expect(closed).toContain('claude-surfer')
})

test('a short turn never opens the pane', async ($, on) => {
  const clock = mock.clock(on)
  let isOpened = false
  on('ui.open', () => {
    isOpened = true

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('turn.start', (_, e) => e)
  on('turn.complete', () => ({ text: 'done' }))

  await $.turn.start(START)
  await clock.advance(5_000)
  await $.turn.complete(DONE)
  await clock.advance(30_000)

  expect(isOpened).toBe(false)
})

export type Run = { t: number; lane: number; x: number; coins: number; jumpT: number }

declare module 'claude-code' {
  interface PluginState {
    'claude-surfer': { run: Shaped<Run> }
  }
}

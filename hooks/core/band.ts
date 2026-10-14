import type { Comment } from './types'

// The band above the prompt as a pure state machine: what it shows, when it hides,
// which new comment deserves a toast. The engine side only draws `state` and feeds events in.

export type BandState = {
  open: number
  isHidden: boolean
  /** createdAt of the newest comment seen, to notice a new one */
  lastSeen: number
  lastSortAt: number
}

export const initialBand: BandState = { open: 0, isHidden: false, lastSeen: 0, lastSortAt: 0 }

export type BandUpdate = { state: BandState; toast?: string; changed: boolean }

export function applyComments(state: BandState, open: readonly Comment[]): BandUpdate {
  const newest = open.reduce((n, c) => Math.max(n, c.createdAt ?? 0), 0)
  let toast: string | undefined
  if (state.lastSeen && newest > state.lastSeen) {
    const c = open.find(x => (x.createdAt ?? 0) === newest)
    if (c) toast = `Новый комментарий для Claude: ${c.path.split('/').pop()}:${c.line} — ${c.text.slice(0, 60)}`
  }
  const changed = state.open !== open.length || newest !== state.lastSeen
  if (!changed) return { state, changed: false }
  return {
    state: { ...state, open: open.length, lastSeen: newest || state.lastSeen, isHidden: open.length > state.open ? false : state.isHidden },
    toast,
    changed: true,
  }
}

export function hide(state: BandState): BandState {
  return { ...state, isHidden: true }
}

/** whether a press of "sort out" sends the prompt now, and the state after it */
export function sortOut(state: BandState, nowMs: number, cooldownMs: number): { send: boolean; state: BandState } {
  if (state.open === 0 || nowMs - state.lastSortAt < cooldownMs) return { send: false, state }
  return { send: true, state: { ...state, lastSortAt: nowMs } }
}

export function statusLine(state: BandState): string | undefined {
  return state.open ? `IDE · ${state.open}` : undefined
}

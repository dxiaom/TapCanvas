// Shared, imperative recovery state for canvas video nodes, keyed by retained node+source identity.
// Focus transitions hand playback to a fresh native video surface because Chromium can lose the
// picture compositor when a source-bound element changes hosts. This record preserves time/play/frame
// state for that handoff as well as offscreen release and later virtualization recovery. Manual
// playback intent is retained separately from transient hover preview playback so pointer/focus
// changes do not unexpectedly stop an action the user explicitly started.
export type PlaybackState = {
  time: number
  playing: boolean
  hasFrame: boolean
  /** True when the current playback was explicitly started by the user. */
  manualPlayback: boolean
}

const store = new Map<string, PlaybackState>()

/** 每个节点只保留最新播放源的恢复状态：重新生成会产出新 src，旧 src 条目若不清理会随操作数无界增长。 */
function pruneOtherEntriesForNode(key: string): void {
  const nodePrefix = `${key.split('::')[0]}::`
  for (const existingKey of store.keys()) {
    if (existingKey !== key && existingKey.startsWith(nodePrefix)) store.delete(existingKey)
  }
}

export function saveVideoPlayback(key: string | null | undefined, state: PlaybackState): void {
  if (!key) return
  pruneOtherEntriesForNode(key)
  store.set(key, state)
}

export function readVideoPlayback(key: string | null | undefined): PlaybackState | undefined {
  if (!key) return undefined
  return store.get(key)
}

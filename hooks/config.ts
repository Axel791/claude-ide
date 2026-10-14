// Everything tunable in one place: ports, timings, texts.

export const PORT = 8030
export const BASE = `http://127.0.0.1:${PORT}`

export const TIMING = {
  /** how often the band above the prompt re-reads the open comments */
  bandRefreshMs: 3000,
  /** the band's "sort out" button ignores presses closer than this */
  sortOutCooldownMs: 10_000,
  /** a focus older than this is not attached to the prompt: the person moved on */
  focusMaxAgeMs: 15 * 60 * 1000,
  /** waiting for a freshly spawned server, in polls of pollMs */
  serverStartPolls: 25,
  serverStartPollMs: 200,
}

export const TOOLS = {
  list: 'review_list',
  resolve: 'review_resolve',
  open: 'ide_open',
} as const

export const TEXT = {
  commandDescription: 'Ссылка на редактор claude-ide для этой сессии; /ide open пробует открыть панель, /ide <путь> добавляет проект',
  commandHint: '[open] [путь к проекту]',
  sortOutPrompt: 'Разбери открытые комментарии из claude-ide: поправь код и закрой каждый через review_resolve.',
  openPanePrompt: (url: string) => `Открой панель браузера Claude по адресу ${url} инструментом панели браузера (preview_start или navigate). Больше ничего не делай и ответь одной строкой.`,
  listTool: 'Lists the open line comments the user left in the claude-ide editor (file, lines, text, id).',
  openTool: 'Opens something in the user\'s claude-ide editor beside the chat: a file (optionally at a line, or in the diff view) or a project folder, which is added to the session. Use it when the user asks to open, show or look at a file or project in the IDE. Absolute paths.',
  resolveTool: 'Marks a claude-ide comment resolved after you handled it, storing your short reply under the arrow in the editor. Use status "open" to reopen one with a question instead.',
}

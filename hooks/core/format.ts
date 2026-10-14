import type { Comment, Focus } from './types'

// Text the model reads: one line per comment, and the context blocks attached to a prompt.

export function formatComment(c: Comment): string {
  const where = `${c.root ?? ''}/${c.path}:${c.line}${c.endLine > c.line ? `-${c.endLine}` : ''}`
  const first = (c.snippet.split('\n')[0] ?? '').trim()
  const snippet = first ? `\n    > ${first}` : ''
  return `- [${c.id}] ${where} — ${c.text}${snippet}`
}

export function commentsBlock(open: readonly Comment[]): string | null {
  if (open.length === 0) return null
  return (
    `<claude-ide-comments>\nОткрытые комментарии пользователя из редактора claude-ide (${open.length}). ` +
    `Если сообщение пользователя о них или просит их разобрать, поправь код и для каждого вызови review_resolve с коротким ответом. ` +
    `Если сообщение о другом, не трогай их, но держи в уме.\n` +
    open.map(formatComment).join('\n') +
    `\n</claude-ide-comments>`
  )
}

export function focusBlock(focus: Focus | null): string | null {
  if (!focus || !focus.path || !focus.snippet) return null
  const where = `${focus.path}:${focus.line}${focus.endLine > focus.line ? `-${focus.endLine}` : ''}`
  const what = focus.selected ? `выделил строки ${focus.line}–${focus.endLine}` : `курсор на строке ${focus.line}`
  return (
    `<claude-ide-focus>\nПользователь сейчас смотрит в редакторе claude-ide на ${where} (${what}). ` +
    `Если он пишет «тут», «это», «эту функцию» без пути, речь об этом месте.\n` +
    '```\n' + focus.snippet.slice(0, 2000) + '\n```\n</claude-ide-focus>'
  )
}

/** the blocks a prompt.submit hook attaches, in order; empty when there is nothing to say */
export function promptContext(open: readonly Comment[], focus: Focus | null): string[] {
  return [commentsBlock(open), focusBlock(focus)].filter((b): b is string => b !== null)
}

export function isFresh(focus: Focus, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - focus.updatedAt * 1000 <= maxAgeMs
}

export function pluralComments(n: number): string {
  const word = n === 1 ? 'комментарий' : n < 5 ? 'комментария' : 'комментариев'
  return `${n} ${word}`
}

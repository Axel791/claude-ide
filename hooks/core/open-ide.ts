import type { IdeClient } from './ide-client'
import type { Session } from './types'

// Opening the editor: make sure the server runs, register the project in the session's
// workspace, show the page in the Browser pane, or in the system browser when the pane refuses.

export type OpenIdePorts = {
  /** starts the server when it is down; resolves once it answers, or false */
  ensureServer: () => Promise<boolean>
  /** opens the url in the Browser pane; a note says why not */
  openPane: (url: string) => Promise<{ ok: true } | { ok: false; note: string }>
  /** asks Claude, inside its own turn, to open the url in the Browser pane: the permission
   *  classifier answers only there, so a plugin's own call is refused in auto mode */
  askClaude: (url: string) => Promise<boolean>
  /** opens the url in the system browser */
  openSystem: (url: string) => Promise<boolean>
  manualHint: string
}

/** `link`: register the project and print the url (the default); `open`: also try to show it */
export type OpenMode = 'link' | 'open'

export async function openIde(server: IdeClient, ports: OpenIdePorts, s: Session, target: string, mode: OpenMode = 'link'): Promise<string> {
  if (!(await ports.ensureServer())) return `claude-ide: сервер не поднялся. ${ports.manualHint}`
  let name: string
  try {
    name = (await server.addProject(s.id, target)).name
  } catch (err) {
    return `claude-ide: не добавил проект ${target}: ${String(err)}`
  }
  const url = server.pageUrl(s.id, s.cwd)
  if (mode === 'link') return `claude-ide: ${name} готов, открой в панели браузера: ${url}`
  const pane = await ports.openPane(url)
  if (pane.ok) return `claude-ide: открыл ${name} в панели браузера: ${url}`
  if (await ports.askClaude(url)) return `claude-ide: проект ${name} добавлен, Claude открывает панель браузера: ${url}`
  if (await ports.openSystem(url)) return `claude-ide: панель браузера не открылась (${pane.note.split(';')[0]}), открыл ${name} в системном браузере: ${url}`
  return `claude-ide: проект ${name} добавлен. Открой ${url} в панели браузера. (${pane.note})`
}

/** the project folder a file belongs to: the session folder when the file is inside it */
export function rootOf(path: string, cwd: string): string {
  return path.startsWith(cwd + '/') ? cwd : path.slice(0, path.lastIndexOf('/'))
}

/** the nearest folder with a .git above the file, the session folder when the file is inside it,
 *  else the file's own folder; `exists` is injected so the engine stays out of this file */
export async function projectRootOf(path: string, cwd: string, exists: (p: string) => Promise<boolean>): Promise<string> {
  if (cwd && path.startsWith(cwd + '/')) return cwd
  let dir = path.slice(0, path.lastIndexOf('/'))
  for (let i = 0; i < 8 && dir && dir !== '/'; i++) {
    if (await exists(`${dir}/.git`)) return dir
    dir = dir.slice(0, dir.lastIndexOf('/'))
  }
  return path.slice(0, path.lastIndexOf('/'))
}

export type OpenRequest = { path?: string; line?: number; mode?: string }

/** what Claude's ide_open asks for, checked and normalised */
export function parseOpenRequest(input: OpenRequest): { path: string; line?: number; mode: 'code' | 'diff' } | { error: string } {
  const path = (input.path ?? '').trim()
  if (!path.startsWith('/')) return { error: 'ide_open needs an absolute path' }
  const line = typeof input.line === 'number' && input.line > 0 ? Math.floor(input.line) : undefined
  return { path, line, mode: input.mode === 'diff' ? 'diff' : 'code' }
}

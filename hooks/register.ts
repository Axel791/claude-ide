import type { EngineInterface, Register } from 'claude-code'

import { BASE, PORT, TEXT, TIMING, TOOLS } from './config'
import { applyComments, hide, initialBand, sortOut, statusLine } from './core/band'
import type { BandState } from './core/band'
import { Comments } from './core/comments'
import { isFresh, formatComment, pluralComments, promptContext } from './core/format'
import { IdeClient } from './core/ide-client'
import { openIde, rootOf } from './core/open-ide'
import type { OpenIdePorts, OpenMode } from './core/open-ide'
import { ReviewFile } from './core/review-file'
import type { Focus, ResolveInput, Session } from './core/types'

// claude-ide, the composition root.
//
// This is the only file that touches the engine's `$`: the loader follows `$` only inside
// one file, so every `$.noun.method` call lives here, wrapped into plain functions the
// core modules take as dependencies. The core (./core) is pure and unit-tested on its own.
//
//   /ide [path]       opens the editor in the Browser pane for this session's workspace
//   prompt.submit     attaches open comments and the editor focus to the prompt
//   AbovePrompt       the band: open comments count, open / sort out / hide
//   ToolUse           an "open in IDE" button on Edit/Write/Read rows
//   review_list / review_resolve   the tools Claude uses to read and close comments

// ---------------------------------------------------------------- adapters over $

function clientOf($: EngineInterface): IdeClient {
  return new IdeClient(BASE, (url, init) => $.http.fetch(url, init))
}

function reviewFileOf($: EngineInterface): ReviewFile {
  return new ReviewFile({ exists: p => $.fs.exists(p), read: p => $.fs.read(p), write: (p, t) => $.fs.write(p, t) })
}

function commentsOf($: EngineInterface): Comments {
  return new Comments(clientOf($), reviewFileOf($))
}

async function sessionOf($: EngineInterface): Promise<Session> {
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {
    // a test host without a session
  }
  let id = cwd
  try {
    id = await $.session.id()
  } catch {
    // older hosts: the folder keys the workspace
  }
  return { id, cwd }
}

let serverStarted = false
async function ensureServer($: EngineInterface): Promise<boolean> {
  const client = clientOf($)
  if (await client.isUp()) return true
  if (!serverStarted) {
    serverStarted = true
    const script = `${$.plugin.root}/server/server.py`
    void (async () => {
      try {
        const child = $.process.spawn({ argv: ['python3', script, '--port', String(PORT)] })
        for await (const piece of child) if ('text' in piece) $.ui.log(`claude-ide server: ${piece.text.trim()}`, { to: 'debug' })
      } catch (err) {
        $.ui.log(`claude-ide server failed: ${String(err)}`, { to: 'debug' })
      }
      serverStarted = false
    })()
  }
  for (let i = 0; i < TIMING.serverStartPolls; i++) {
    await $.clock.sleep(TIMING.serverStartPollMs)
    if (await client.isUp()) return true
  }
  return false
}

async function openPane($: EngineInterface, url: string): Promise<{ ok: true } | { ok: false; note: string }> {
  const names = (await $.tool.list()).map(t => t.name)
  const candidates = names.filter(n => /browser/i.test(n) && /preview_start$|navigate$/.test(n)).sort((a, b) => (a.endsWith('preview_start') ? -1 : 1) - (b.endsWith('preview_start') ? -1 : 1))
  const notes: string[] = []
  if (candidates.length === 0) notes.push(`нет инструмента браузера среди ${names.filter(n => n.startsWith('mcp__')).length} MCP-инструментов`)
  for (const tool of candidates) {
    try {
      const r = await $.tool.call({ tool, url } as never)
      if (r.deny === undefined && r.isError !== true) return { ok: true }
      notes.push(`${tool}: ${r.deny ?? (r.text ?? 'isError')}`.slice(0, 200))
    } catch (err) {
      notes.push(`${tool}: ${String(err)}`.slice(0, 200))
    }
  }
  return { ok: false, note: notes.join('; ') }
}

async function openSystem($: EngineInterface, url: string): Promise<boolean> {
  try {
    return (await $.process.run(['open', url], { timeoutMs: 5000 })).exitCode === 0
  } catch {
    return false
  }
}

async function askClaude($: EngineInterface, url: string): Promise<boolean> {
  try {
    await $.prompt.submit({ text: TEXT.openPanePrompt(url) })
    return true
  } catch {
    return false
  }
}

function openIdePorts($: EngineInterface): OpenIdePorts {
  return {
    ensureServer: () => ensureServer($),
    openPane: url => openPane($, url),
    askClaude: url => askClaude($, url),
    openSystem: url => openSystem($, url),
    manualHint: `Запусти вручную: python3 ${$.plugin.root}/server/server.py --port ${PORT}`,
  }
}

async function openEditor($: EngineInterface, target?: string, mode: OpenMode = 'link'): Promise<string> {
  const s = await sessionOf($)
  return openIde(clientOf($), openIdePorts($), s, target || s.cwd, mode)
}

async function currentFocus($: EngineInterface, s: Session): Promise<Focus | null> {
  try {
    const f = await clientOf($).focus(s.id)
    return f && isFresh(f, Date.now(), TIMING.focusMaxAgeMs) ? f : null
  } catch {
    return null
  }
}

async function openInIde($: EngineInterface, path: string, mode: 'code' | 'diff'): Promise<void> {
  const client = clientOf($)
  const s = await sessionOf($)
  if (!(await client.isUp())) $.ui.toast(await openEditor($))  // the link, the page opens it when shown
  try {
    await client.openInPage(s.id, path, mode, rootOf(path, s.cwd))
    $.ui.toast(`IDE: ${path.split('/').pop()}`)
  } catch (err) {
    $.ui.toast(`claude-ide: ${String(err)}`)
  }
}

// ---------------------------------------------------------------- the band's state (module-level; a reload resets it)

let band: BandState = initialBand

async function refreshBand($: EngineInterface): Promise<void> {
  const open = await commentsOf($).open(await sessionOf($))
  const u = applyComments(band, open)
  band = u.state
  if (u.toast) $.ui.toast(u.toast)
  if (u.changed) $.ui.invalidate('ui.render')
  $.ui.status(statusLine(band))
}

// ---------------------------------------------------------------- wiring

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'ide', description: TEXT.commandDescription, argumentHint: TEXT.commandHint, immediate: true })
    await $.tool.register({ name: TOOLS.list, description: TEXT.listTool, inputSchema: { type: 'object', properties: {} } })
    await $.tool.register({
      name: TOOLS.resolve,
      description: TEXT.resolveTool,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The comment id from the prompt context or review_list' },
          reply: { type: 'string', description: 'What you did or answered, one or two sentences' },
          status: { type: 'string', enum: ['resolved', 'open'], description: 'Default resolved' },
        },
        required: ['id', 'reply'],
      },
    })
    $.clock.every(TIMING.bandRefreshMs, () => { void refreshBand($) })
    return started
  })

  // /ide [path] prints the link; /ide open [path] also tries to show the page
  on('command.run', { command: 'ide' }, async ($, e) => {
    const [first, ...rest] = e.args.trim().split(/\s+/)
    const mode: OpenMode = first === 'open' ? 'open' : 'link'
    const target = (mode === 'open' ? rest.join(' ') : e.args.trim()) || undefined
    return { text: await openEditor($, target, mode) }
  })

  on('prompt.submit', async ($, e, next) => {
    const s = await sessionOf($)
    const blocks = promptContext(await commentsOf($).open(s), await currentFocus($, s))
    return blocks.length ? next({ ...e, context: [...(e.context ?? []), ...blocks] }) : next(e)
  })

  on('tool.call', { tool: `mcp__claude-ide__${TOOLS.list}` }, async $ => {
    const open = await commentsOf($).open(await sessionOf($))
    return { result: open.length ? open.map(formatComment).join('\n') : 'No open comments.' }
  })

  on('tool.call', { tool: `mcp__claude-ide__${TOOLS.resolve}` }, async ($, e) => {
    const input = e as unknown as ResolveInput
    if (!input.id || !input.reply) return { deny: `${TOOLS.resolve} needs id and reply` }
    const c = await commentsOf($).resolve(await sessionOf($), input.id, input.status === 'open' ? 'open' : 'resolved', input.reply)
    if (!c) return { deny: `no comment with id ${input.id}` }
    $.ui.toast(`claude-ide: ${c.path}:${c.line} ${c.status === 'resolved' ? 'решён' : 'открыт снова'}`)
    return { result: `Comment ${c.id} (${c.path}:${c.line}) is now ${c.status}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || band.isHidden || band.open === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return Box({
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Text({ color: 'warning', children: ['➤'] }),
        Text({ children: [`IDE · ${pluralComments(band.open)} для Claude`] }),
        Button({ key: 'ide-open', label: 'ссылка', plain: true, onPress: () => { void openEditor($).then(t => $.ui.toast(t)) } }),
        Button({ key: 'ide-sort', label: 'разобрать', plain: true, onPress: () => {
          const r = sortOut(band, Date.now(), TIMING.sortOutCooldownMs)
          band = r.state
          if (r.send) void $.prompt.submit({ text: TEXT.sortOutPrompt })
        } }),
        Button({ key: 'ide-hide', label: 'скрыть', plain: true, dimColor: true, onPress: () => { band = hide(band); $.ui.invalidate('ui.render') } }),
      ],
    })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const theirs = await next(e)
    const tool = e.props.tool
    if (!['Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit'].includes(tool)) return theirs
    const input = (e.props.input ?? {}) as { file_path?: string; notebook_path?: string }
    const path = input.file_path ?? input.notebook_path
    if (!path) return theirs
    const { Box, Button } = $.ui.resolve(e)
    return Box({
      flexDirection: 'column',
      children: [
        theirs,
        Box({ flexDirection: 'row', children: [Button({ key: `ide-${e.props.tool_use_id}`, label: 'открыть в IDE', plain: true, dimColor: true, onPress: () => { void openInIde($, path, tool === 'Read' ? 'code' : 'diff') } })] }),
      ],
    })
  })
}

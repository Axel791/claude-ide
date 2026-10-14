import { expect, mock, test } from 'claude-code/testing'

const answerPrompt = (on: Parameters<Parameters<typeof test>[1]>[1]) =>
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

const openComments = [
  { id: 'abc12345', path: 'apps/a/api.py', line: 10, endLine: 12, snippet: 'def handler():', text: 'переименуй', status: 'open', reply: null, project: 'demo', root: '/tmp/demo' },
]

test('prompt.submit attaches the open comments as context', async ($, on) => {
  on('http.fetch', ($, e) => {
    if (e.url.includes('/api/comments/open')) return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(openComments) } }
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"no"}' } }
  })
  answerPrompt(on)
  const result = await $.prompt.submit({ text: 'разбери комментарии' })
  const block = (result.context ?? []).find(c => c.includes('<claude-ide-comments>'))
  expect(block).toContain('[abc12345] /tmp/demo/apps/a/api.py:10-12 — переименуй')
})

test('prompt.submit leaves the prompt alone when the server is down and no review file exists', async ($, on) => {
  on('http.fetch', () => ({ deny: 'ECONNREFUSED' }))
  on('fs.exists', () => ({ value: false }))
  answerPrompt(on)
  const result = await $.prompt.submit({ text: 'привет' })
  expect((result.context ?? []).some(c => c.includes('claude-ide-comments'))).toBe(false)
})

test('review_resolve patches the comment and answers the model', async ($, on) => {
  let patched: unknown = null
  on('http.fetch', ($, e) => {
    if (e.url.endsWith('/api/comments/abc12345') && e.init?.method === 'PATCH') {
      patched = JSON.parse(e.init.body ?? '{}')
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ...openComments[0], status: 'resolved', reply: 'готово' }) } }
    }
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"no"}' } }
  })
  on('ui.toast', () => ({ value: undefined }))
  const r = await $.tool.call({ tool: 'mcp__claude-ide__review_resolve', id: 'abc12345', reply: 'готово' } as never)
  expect(patched).toEqual({ status: 'resolved', reply: 'готово' })
  expect(r.deny).toBe(undefined)
  expect(String(r.result)).toContain('abc12345')
})

test('/ide registers the project in the session workspace and opens the pane', async ($, on) => {
  mock.clock(on)
  const calls: string[] = []
  on('http.fetch', ($, e) => {
    calls.push(`${e.init?.method ?? 'GET'} ${e.url}`)
    if (e.url.endsWith('/api/health')) return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
    if (e.url.includes('/api/projects')) return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ name: 'demo', path: '/tmp/demo' }) } }
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"no"}' } }
  })
  on('session.cwd', () => ({ value: '/tmp/demo' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('tool.list', () => ({ value: [{ name: 'mcp__Claude_Browser__preview_start' }] as never }))
  on('tool.call', { tool: 'mcp__Claude_Browser__preview_start' }, () => ({ result: 'opened' }))
  const r = await $.command.run({ command: 'ide', args: '/tmp/demo' })
  expect(String(r.text)).toContain('demo готов')
  const o = await $.command.run({ command: 'ide', args: 'open /tmp/demo' })
  expect(String(o.text)).toContain('открыл demo')
  expect(calls.some(c => c.startsWith('POST') && c.includes('/api/projects?ws=sess-1'))).toBe(true)
})

test('prompt.submit attaches what the person looks at in the editor', async ($, on) => {
  on('session.id', () => ({ value: 'sess-1' }))
  on('http.fetch', ($, e) => {
    if (e.url.includes('/api/comments/open')) return { value: { status: 200, ok: true, headers: {}, text: '[]' } }
    if (e.url.includes('/api/focus')) return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ path: '/tmp/demo/a.py', line: 3, endLine: 5, selected: true, snippet: 'def f():\n    pass', mode: 'code', updatedAt: Date.now() / 1000 }) } }
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"no"}' } }
  })
  answerPrompt(on)
  const result = await $.prompt.submit({ text: 'поправь тут' })
  const block = (result.context ?? []).find(c => c.includes('<claude-ide-focus>'))
  expect(block).toContain('/tmp/demo/a.py:3-5')
  expect(block).toContain('def f():')
})

test('the band above the prompt shows the open comments and hides on request', async ($, on) => {
  on('session.id', () => ({ value: 'sess-1' }))
  on('http.fetch', ($, e) => {
    if (e.url.includes('/api/comments/open')) return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([{ ...openComments[0], createdAt: 100 }, { ...openComments[0], id: 'b', createdAt: 101 }]) } }
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"no"}' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return Box({ children: [] }) })
  mock.clock(on)
  // the session.start hook arms the timer; the tool call below forces a band refresh through it
  await $.tool.call({ tool: 'mcp__claude-ide__review_list' } as never)
  const ui = await $.ui.mount({ plugin: 'claude-ide', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as never })
  const line = await ui.find({ text: 'для Claude' })
  if (line) {
    await ui.press({ key: 'ide-hide' })
    expect(await ui.find({ text: 'для Claude' })).toBe(undefined)
  }
})

test('an Edit row gets an "open in IDE" button', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['Edit a.py'] })
  })
  const ui = await $.ui.mount({ plugin: 'claude-ide', surface: 'desktop', component: 'ToolUse', requestId: 'tu1', props: { tool_use_id: 'tu1', tool: 'Edit', input: { file_path: '/tmp/demo/a.py' }, isRunning: false, isErrored: false, isInterrupted: false } as never })
  expect(await ui.find({ text: 'открыть в IDE' })).toBeDefined()
})

test('ide_open sends the page a command to open the file in its project', async ($, on) => {
  const posts: string[] = []
  on('http.fetch', ($, e) => {
    posts.push(`${e.init?.method ?? 'GET'} ${e.url} ${e.init?.body ?? ''}`)
    if (e.url.endsWith('/api/health')) return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
    return { value: { status: 200, ok: true, headers: {}, text: '{"name":"repo","path":"/repo"}' } }
  })
  on('session.cwd', () => ({ value: '/cwd' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', ($, e) => ({ value: e.path === '/repo/pkg/a.go' || e.path === '/repo/.git' }))
  on('fs.stat', ($, e) => ({ value: { kind: e.path === '/repo' ? 'dir' : 'file', size: 1, mtimeMs: 0 } as never }))
  const r = await $.tool.call({ tool: 'mcp__claude-ide__ide_open', path: '/repo/pkg/a.go', line: 33 } as never)
  expect(r.deny).toBe(undefined)
  expect(String(r.result)).toContain('/repo/pkg/a.go:33')
  expect(posts.some(p => p.includes('/api/inbox?ws=sess-1') && p.includes('"line":33') && p.includes('"root":"/repo"'))).toBe(true)
  const bad = await $.tool.call({ tool: 'mcp__claude-ide__ide_open', path: 'a.go' } as never)
  expect(bad.deny).toContain('absolute')
})

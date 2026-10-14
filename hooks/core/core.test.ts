import { expect, test } from 'claude-code/testing'

import { applyComments, hide, initialBand, sortOut, statusLine } from './band'
import { commentsBlock, focusBlock, formatComment, isFresh, pluralComments, promptContext } from './format'
import { IdeClient } from './ide-client'
import { openIde, parseOpenRequest, projectRootOf, rootOf } from './open-ide'
import { ReviewFile } from './review-file'
import type { Comment } from './types'

const c = (over: Partial<Comment> = {}): Comment => ({ id: 'a1', path: 'src/x.py', line: 3, endLine: 3, snippet: 'def f():', text: 'почему?', status: 'open', reply: null, root: '/p', ...over })

test('formatComment names the place, the text and the first snippet line', async () => {
  expect(formatComment(c({ endLine: 5, snippet: 'def f():\n  pass' }))).toBe('- [a1] /p/src/x.py:3-5 — почему?\n    > def f():')
  expect(formatComment(c({ snippet: '' }))).toBe('- [a1] /p/src/x.py:3 — почему?')
})

test('promptContext holds only what there is', async () => {
  expect(promptContext([], null)).toEqual([])
  const blocks = promptContext([c()], { path: '/p/a.py', line: 1, endLine: 2, selected: true, snippet: 'x', mode: 'code', updatedAt: 0 })
  expect(blocks.length).toBe(2)
  expect(blocks[0]).toContain('<claude-ide-comments>')
  expect(blocks[1]).toContain('/p/a.py:1-2')
  expect(commentsBlock([])).toBe(null)
  expect(focusBlock(null)).toBe(null)
})

test('isFresh compares seconds against milliseconds', async () => {
  const f = { path: '/p', line: 1, endLine: 1, selected: false, snippet: 'x', mode: 'code', updatedAt: 1000 }
  expect(isFresh(f, 1000 * 1000 + 60_000, 15 * 60_000)).toBe(true)
  expect(isFresh(f, 1000 * 1000 + 16 * 60_000, 15 * 60_000)).toBe(false)
})

test('the band counts, toasts the newest and hides until a new comment', async () => {
  let s = initialBand
  let u = applyComments(s, [c({ createdAt: 10 })])
  expect(u.state.open).toBe(1)
  expect(u.toast).toBe(undefined) // the first sight is not news
  s = hide(u.state)
  u = applyComments(s, [c({ createdAt: 10 }), c({ id: 'b2', createdAt: 11, text: 'ещё' })])
  expect(u.toast).toContain('ещё')
  expect(u.state.isHidden).toBe(false)
  expect(applyComments(u.state, [c({ createdAt: 10 }), c({ id: 'b2', createdAt: 11 })]).changed).toBe(false)
  expect(statusLine(u.state)).toBe('IDE · 2')
  expect(statusLine(initialBand)).toBe(undefined)
  expect(pluralComments(1)).toBe('1 комментарий')
  expect(pluralComments(3)).toBe('3 комментария')
  expect(pluralComments(7)).toBe('7 комментариев')
})

test('sort out sends once per cooldown and never with nothing open', async () => {
  expect(sortOut(initialBand, 1000, 500).send).toBe(false)
  const s = { ...initialBand, open: 2 }
  const first = sortOut(s, 1000, 500)
  expect(first.send).toBe(true)
  expect(sortOut(first.state, 1200, 500).send).toBe(false)
  expect(sortOut(first.state, 1600, 500).send).toBe(true)
})

test('IdeClient builds urls with the workspace and reads errors', async () => {
  const calls: string[] = []
  const client = new IdeClient('http://h', async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.includes('/api/health')) return { ok: true, status: 200, text: '{"ok":true}' }
    if (url.includes('/api/projects')) return { ok: false, status: 400, text: '{"error":"not a directory"}' }
    return { ok: true, status: 200, text: '[]' }
  })
  expect(client.url('/api/comments/open', 'w1')).toBe('http://h/api/comments/open?ws=w1')
  expect(client.pageUrl('w1', '/a b')).toBe('http://h/?ws=w1&cwd=%2Fa%20b')
  expect(await client.isUp()).toBe(true)
  await expect(client.addProject('w1', '/nope')).rejects.toThrow('not a directory')
  expect(await client.openComments('w1')).toEqual([])
  expect(calls.some(x => x === 'POST http://h/api/projects?ws=w1')).toBe(true)
})

test('ReviewFile reads, filters and writes back without the root field', async () => {
  const disk: Record<string, string> = { '/p/.claude/review.json': JSON.stringify({ comments: [c({ root: undefined }), c({ id: 'z', status: 'resolved', root: undefined })] }) }
  const rf = new ReviewFile({ exists: async p => p in disk, read: async p => disk[p] ?? '', write: async (p, t) => { disk[p] = t } })
  expect((await rf.open('/p')).map(x => x.id)).toEqual(['a1'])
  const done = await rf.resolve('/p', 'a1', 'resolved', 'готово')
  expect(done?.status).toBe('resolved')
  expect(JSON.parse(disk['/p/.claude/review.json']!).comments[0].root).toBe(undefined)
  expect(await rf.open('/q')).toEqual([])
})

test('openIde reports each outcome and rootOf picks the session folder', async () => {
  const client = new IdeClient('http://h', async url => ({ ok: true, status: 200, text: url.includes('/api/projects') ? '{"name":"demo","path":"/d"}' : '{"ok":true}' }))
  const s = { id: 'w1', cwd: '/d' }
  const ports = { ensureServer: async () => true, openPane: async () => ({ ok: true as const }), askClaude: async () => false, openSystem: async () => true, manualHint: 'hint' }
  expect(await openIde(client, ports, s, '/d')).toContain('demo готов, открой в панели браузера: http://h/?ws=w1')
  expect(await openIde(client, ports, s, '/d', 'open')).toContain('открыл demo в панели')
  const refused = { ...ports, openPane: async () => ({ ok: false as const, note: 'refused; more' }) }
  expect(await openIde(client, { ...refused, askClaude: async () => true }, s, '/d', 'open')).toContain('Claude открывает панель')
  expect(await openIde(client, refused, s, '/d', 'open')).toContain('в системном браузере')
  expect(await openIde(client, { ...ports, ensureServer: async () => false }, s, '/d')).toContain('hint')
  expect(rootOf('/d/src/a.py', '/d')).toBe('/d')
  expect(rootOf('/e/src/a.py', '/d')).toBe('/e/src')
})

test('ide_open requests are checked and the project root is found', async () => {
  expect(parseOpenRequest({ path: 'rel/a.py' })).toEqual({ error: 'ide_open needs an absolute path' })
  expect(parseOpenRequest({ path: '/p/a.py', line: 12.7, mode: 'diff' })).toEqual({ path: '/p/a.py', line: 12, mode: 'diff' })
  expect(parseOpenRequest({ path: '/p/a.py', line: -1 })).toEqual({ path: '/p/a.py', line: undefined, mode: 'code' })
  const exists = async (p: string) => p === '/repo/.git'
  expect(await projectRootOf('/cwd/src/a.py', '/cwd', exists)).toBe('/cwd')
  expect(await projectRootOf('/repo/pkg/sub/a.go', '/cwd', exists)).toBe('/repo')
  expect(await projectRootOf('/loose/a.txt', '/cwd', exists)).toBe('/loose')
})

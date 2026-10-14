import type { Comment } from './types'

// The project's own review file, read and written through injected fs functions: the
// fallback when the server is down, so Claude still sees and closes comments.

export type Fs = {
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
}

export class ReviewFile {
  constructor(private readonly fs: Fs) {}

  path(root: string): string {
    return `${root}/.claude/review.json`
  }

  async all(root: string): Promise<Comment[]> {
    const p = this.path(root)
    if (!(await this.fs.exists(p))) return []
    try {
      return ((JSON.parse(await this.fs.read(p)) as { comments?: Comment[] }).comments ?? []).map(c => ({ ...c, root }))
    } catch {
      return []
    }
  }

  async open(root: string): Promise<Comment[]> {
    return (await this.all(root)).filter(c => c.status === 'open')
  }

  async resolve(root: string, id: string, status: 'open' | 'resolved', reply: string): Promise<Comment | null> {
    const list = await this.all(root)
    const c = list.find(x => x.id === id)
    if (!c) return null
    c.status = status
    c.reply = reply
    const stored = list.map(({ root: _r, ...rest }) => rest)
    await this.fs.write(this.path(root), JSON.stringify({ comments: stored }, null, 2))
    return c
  }
}

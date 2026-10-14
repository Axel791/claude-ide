import type { Comment, Focus, Project } from './types'

// The local server's API as the mod uses it, over an injected `http` function so the
// engine's `$` never enters this file. Every method throws when the server does not answer.

export type HttpResponse = { ok: boolean; status: number; text: string }
export type Http = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>

export class IdeClient {
  constructor(private readonly base: string, private readonly http: Http) {}

  url(path: string, ws = ''): string {
    return `${this.base}${path}${ws ? `${path.includes('?') ? '&' : '?'}ws=${ws}` : ''}`
  }

  pageUrl(ws: string, cwd: string): string {
    return ws ? `${this.base}/?ws=${ws}&cwd=${encodeURIComponent(cwd)}` : `${this.base}/`
  }

  private async json(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const r = await this.http(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const parsed: unknown = r.text ? JSON.parse(r.text) : null
    if (!r.ok) {
      const msg = parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : `HTTP ${r.status}`
      throw new Error(msg)
    }
    return parsed
  }

  async isUp(): Promise<boolean> {
    try {
      return (await this.http(this.url('/api/health'))).ok
    } catch {
      return false
    }
  }

  addProject(ws: string, path: string): Promise<Project> {
    return this.json(this.url('/api/projects', ws), 'POST', { path }) as Promise<Project>
  }

  openComments(ws: string): Promise<Comment[]> {
    return this.json(this.url('/api/comments/open', ws)) as Promise<Comment[]>
  }

  resolveComment(id: string, status: 'open' | 'resolved', reply: string): Promise<Comment> {
    return this.json(this.url(`/api/comments/${encodeURIComponent(id)}`), 'PATCH', { status, reply }) as Promise<Comment>
  }

  focus(ws: string): Promise<Focus | null> {
    return this.json(this.url('/api/focus', ws)) as Promise<Focus | null>
  }

  /** a command for the page: open a file (in the diff view for an edit) */
  openInPage(ws: string, path: string, mode: 'code' | 'diff', root: string, line?: number): Promise<unknown> {
    return this.json(this.url('/api/inbox', ws), 'POST', { open: { path, mode, root, ...(line ? { line } : {}) } })
  }

  /** a command for the page: add a project folder to the workspace */
  openProjectInPage(ws: string, path: string): Promise<unknown> {
    return this.json(this.url('/api/inbox', ws), 'POST', { project: path })
  }
}

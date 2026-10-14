// The mod's domain: what a comment, a focus and a session are. No engine here.

export type CommentStatus = 'open' | 'resolved'

export type Comment = {
  id: string
  path: string
  line: number
  endLine: number
  snippet: string
  text: string
  status: CommentStatus
  reply: string | null
  createdAt?: number
  project?: string
  /** the project folder the path is relative to; absent in a bare review file */
  root?: string
}

/** what the person looks at in the editor: a file, a cursor line or a selection */
export type Focus = {
  path: string
  line: number
  endLine: number
  selected: boolean
  snippet: string
  mode: string
  /** seconds since the epoch, as the server stamps it */
  updatedAt: number
}

export type Project = { name: string; path: string }

/** the Claude Code session the mod runs in: its id keys the workspace, its folder seeds it */
export type Session = { id: string; cwd: string }

export type ResolveInput = { id?: string; reply?: string; status?: string }

import type { IdeClient } from './ide-client'
import type { ReviewFile } from './review-file'
import type { Comment, Session } from './types'

// Comments as the mod sees them: the server first, the session's own review file when
// the server is down. One place decides that, every hook uses it.

export class Comments {
  constructor(private readonly server: IdeClient, private readonly file: ReviewFile) {}

  async open(s: Session): Promise<Comment[]> {
    try {
      return await this.server.openComments(s.id)
    } catch {
      return this.file.open(s.cwd)
    }
  }

  async resolve(s: Session, id: string, status: 'open' | 'resolved', reply: string): Promise<Comment | null> {
    try {
      return await this.server.resolveComment(id, status, reply)
    } catch {
      return this.file.resolve(s.cwd, id, status, reply)
    }
  }
}

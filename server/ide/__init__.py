"""claude-ide server: a stdlib-only HTTP server behind the editor page.

Layers, inner to outer:
  config    paths, limits, what is hidden
  store     SQLite: projects, workspaces, UI state, focus, inbox, comment log
  files     the project tree and file contents, within the project root
  git       status, diff, branches, checkout
  comments  the project's .claude/review.json
  http      the router: URLs to the services above
  app       wiring and the entry point
"""

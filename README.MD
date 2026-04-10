# ADE — Agentic Dev Environment

A multi-agent terminal workspace. Run parallel AI coding sessions inside one project.

ADE is a desktop app that lets you open a project and split it into a grid of terminals — each running its own shell, Claude Code session, Codex session, or any CLI agent. All terminals share the same repo. Git integration is built in.

Think tmux or iTerm2 splits, but purpose-built for working with multiple AI agents at once.

## What it does

- Open projects as workspace tabs
- Each workspace is a grid of real terminal panes (2, 3, 4, 6, 8, or 9)
- Every pane is a full PTY — run shells, Claude Code, Codex, or anything
- All panes in a workspace share the same working directory
- Create multiple workspaces, switch between them
- Git-aware: see branch, diffs, changed files, stage and commit

## Screenshot

The UI is a grid of terminal panes with workspace tabs at the top:

```
[Workspace 1] [Workspace 2] [+]
┌─────────────┬─────────────┬─────────────┐
│ claude code  │ codex        │ bash         │
│ > debug bug  │ > write docs │ > npm test   │
│              │              │              │
├─────────────┼─────────────┼─────────────┤
│ claude code  │ codex        │ git status   │
│ > refactor   │ > add tests  │ > git diff   │
│              │              │              │
└─────────────┴─────────────┴─────────────┘
```

## Stack

- **Electron** — desktop shell
- **xterm.js** + **node-pty** — real terminal emulation
- **Vanilla JS** — renderer (no framework)
- **TypeScript** — backend services

## Project structure

```
electron/
  main.js              Electron main process
  preload.js           Context bridge (IPC)
  terminal-manager.js  PTY session lifecycle, shell detection
backend/
  src/
    contracts.ts       Type definitions, port interfaces
    WorkspaceBackend.ts  Orchestrator (projects, chats, sessions, git, voice)
    platform.ts        OS detection, shell resolution, path normalization
index.html             UI shell
renderer.js            Frontend logic (workspaces, tabs, terminal grid)
```

## Getting started

```bash
git clone https://github.com/user/Agentic-Development-Environment.git
cd Agentic-Development-Environment
npm install
npm run dev
```

Requires Node.js 18+ and a working C++ toolchain for `node-pty` (node-gyp).

On Windows, the app detects PowerShell, WSL, and cmd. On macOS/Linux it uses zsh or bash.

## How workspaces work

1. Press **+** to create a new workspace
2. Pick a name, directory (browse or type), and pane count
3. All panes open as terminals in that directory
4. Switch between workspaces via tabs — terminals stay alive
5. Close a tab to kill its terminals

## Roadmap

- [ ] Provider selector per pane (Claude Code, Codex, shell)
- [ ] Git integration panel (branch, diffs, staging, commits)
- [ ] Voice typing into focused pane
- [ ] Chat history persistence
- [ ] Pane resize / drag to rearrange
- [ ] Agent-to-agent awareness (which agent changed which files)
- [ ] Configurable grid layouts
- [ ] Settings / preferences

## Why this exists

Most AI coding tools give you one assistant panel inside an IDE, or one CLI session. ADE gives you a grid of them — all working in the same repo, all visible at once. It's built for the workflow where you have one agent debugging, another refactoring, another writing docs, and another investigating a deploy issue, all at the same time.

## Contributing

This is an open-source project. Contributions welcome.

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Open a PR

See [AGENTS.md](AGENTS.md) for guidelines on how AI agents should work in this codebase.

## License

MIT

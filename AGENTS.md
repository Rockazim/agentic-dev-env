# AGENTS.md

Guidelines for AI agents (Claude Code, Codex, Copilot, etc.) working in this codebase.

## Project overview

ADE is an Electron desktop app that runs a grid of terminal panes per workspace. The frontend is vanilla JS, the backend services are TypeScript, and the terminal layer uses xterm.js + node-pty.

## Architecture

```
electron/           Electron main process (Node.js, CommonJS)
  main.js           Window creation, IPC handlers, app lifecycle
  preload.js        Context bridge — exposes adeDesktop API to renderer
  terminal-manager.js  PTY spawning, shell profile detection, session management

backend/src/        Backend services (TypeScript, not yet wired into Electron)
  contracts.ts      All types, interfaces, and port definitions
  WorkspaceBackend.ts  Main orchestrator, in-memory store, stub services
  platform.ts       OS detection, shell resolution, path helpers

index.html          UI shell — workspace tabs, grid, new-workspace dialog
renderer.js         Frontend logic — workspace state, xterm instances, tab management
```

## Key patterns

- **Ports and adapters**: Backend services are defined as interfaces in `contracts.ts` and implemented as stubs in `WorkspaceBackend.ts`. Real implementations will replace the stubs.
- **IPC bridge**: All communication between renderer and main process goes through `preload.js`. The renderer calls `window.adeDesktop.*` methods which map to `ipcMain.handle` in `main.js`.
- **No framework**: The frontend is vanilla JS with direct DOM manipulation. Do not introduce React, Vue, Svelte, or any UI framework unless explicitly asked.
- **CommonJS in Electron**: `electron/` files use `require()`. Do not convert to ESM.
- **ESM in renderer**: `renderer.js` uses `import` statements with explicit paths to node_modules.

## Conventions

- Use `const` over `let` when the binding is not reassigned.
- Functions and variables: `camelCase`. Types and interfaces: `PascalCase`.
- No semicolons are not a convention here — this codebase uses semicolons.
- Keep files focused. If a file is doing two unrelated things, split it.
- Terminal theme colors are defined once in `renderer.js` as `TERM_THEME`. Reference the CSS variables in `index.html` for UI colors.

## Do

- Read the file before editing it.
- Run `npm run dev` to test changes (launches Electron).
- Keep the vanilla JS approach — no build step, no bundler, no transpilation for the frontend.
- When adding IPC channels: add handler in `main.js`, expose in `preload.js`, call in `renderer.js`.
- When adding backend services: define the port interface in `contracts.ts`, implement in a new file or `WorkspaceBackend.ts`.
- Preserve the existing visual style (dark theme, monospace, terminal aesthetic).

## Don't

- Don't add UI frameworks (React, Vue, etc.) to the renderer.
- Don't add bundlers (webpack, vite, esbuild) for the frontend.
- Don't modify the xterm.js theme without checking it matches the CSS variables.
- Don't use `nodeIntegration: true` — all Node access goes through the preload bridge.
- Don't commit `CLAUDE.md`, `node_modules/`, `dist/`, or `out/`.
- Don't add dependencies without a clear reason. This project stays lean.

## Testing

No test framework is set up yet. When it is, tests will live alongside source files or in a `__tests__` directory. For now, test by running `npm run dev` and verifying behavior in the app.

## Building

```bash
npm install          # install deps + rebuild node-pty
npm run dev          # launch in dev mode
npm run dist:win     # package for Windows
npm run dist:mac     # package for macOS
```

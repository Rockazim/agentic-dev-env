# Backend System Design

## Goal

Build a local-first desktop backend for a multi-agent coding workspace where:

* one project can host multiple AI chats at the same time
* each chat can run tools and stream terminal output
* git state is always visible
* chat history is durable
* Windows 10 and Windows 11 are first-class targets
* macOS is supported where provider CLIs and permissions allow it

## Recommended Technical Direction

Use an Electron desktop shell with a local TypeScript backend process per open project.

Why this direction:

* Windows terminal and process management are the hardest part of this app
* Electron and Node have the most mature cross-platform tooling for PTY sessions, child processes, file watching, and git integration
* the backend stays local, which matches the repo-aware and tool-using workflow in the README
* macOS support remains viable without splitting the architecture

For the MVP, do not build a remote web backend. The backend should run on the user's machine and operate directly on the checked-out repo.

## High-Level Architecture

```text
Renderer UI
  React/Vite or similar
       |
       v
Electron Main Process
  window lifecycle
  secure IPC bridge
  project daemon supervisor
       |
       v
Workspace Backend Process (one per open project)
  project service
  chat/thread service
  provider registry
  session manager
  git service
  file watcher
  persistence service
  voice service
       |
       +--> provider CLI sessions (Codex, Claude Code, future adapters)
       +--> git executable
       +--> repo filesystem
       +--> sqlite database
```

## Core Backend Responsibilities

### 1. Project Service

Owns project discovery and lifecycle.

Responsibilities:

* open and close projects
* validate repo roots
* restore the last workspace layout
* maintain one backend process per open project tab

Why it matters:

* a project is the main isolation boundary in the README
* per-project isolation avoids one broken chat crashing every workspace

### 2. Chat and Thread Service

Owns chat metadata and conversation history.

Responsibilities:

* create and restore chat panes
* store messages, provider choice, and pane position
* track which chat initiated which tool run or file change
* stream message updates back to the renderer

### 3. Provider Registry

Normalizes Codex, Claude Code, and future providers behind one interface.

Responsibilities:

* detect whether a provider CLI is installed
* advertise provider capabilities
* start provider sessions
* translate provider-specific output into a common event stream

Design rule:

* the UI should not know whether a provider is backed by a CLI, a PTY, or an API transport

### 4. Session Manager

Owns tool execution and terminal streaming.

Responsibilities:

* launch a PTY-backed shell or provider process per chat session
* stream stdout, stderr, exit status, and prompts
* attach command metadata to the owning project and chat
* enforce command policy and approval hooks

Design rule:

* every running chat session is an addressable entity with its own lifecycle and event stream

### 5. Git Service

Owns repo-awareness and change attribution.

Responsibilities:

* read current branch and HEAD
* compute changed files and diffs
* stage, unstage, and commit
* snapshot git state so the UI can compare what changed during a chat run

Design rule:

* git calls should run from one backend service instead of from the renderer

### 6. Persistence Service

Stores durable state locally.

Use SQLite in WAL mode.

Why SQLite:

* works well on Windows and macOS
* local-first and zero-admin
* handles structured state better than flat JSON once sessions and diffs grow

Persist:

* projects
* chat threads
* chat messages
* provider sessions
* terminal output metadata
* git snapshots
* UI layout state

### 7. File Watcher and Repo Index

Keeps the UI current when files or git state change outside the app.

Responsibilities:

* watch the repo for file changes
* debounce noisy updates
* trigger git refreshes
* support future features like repo search, jump-to-file, and change summaries

### 8. Voice Service

Owns audio capture and transcription.

Responsibilities:

* capture audio from the selected microphone
* store only short-lived audio buffers unless the user opts in
* return transcript text into the focused chat input

Design rule:

* keep the interface stable even if the transcription provider changes later

## Process Model

Use three execution layers:

1. Renderer process for UI only
2. Electron main process for app lifecycle and secure IPC
3. Workspace backend child process for repo work, providers, tools, and git

Why not run everything in Electron main:

* PTY sessions and provider output can be noisy
* repo scanning and git diff work can block UI-adjacent work
* child-process isolation makes crash recovery cleaner

## Event and IPC Model

Use typed request/response calls for commands plus a project-scoped event stream for updates.

Command examples:

* `project/open`
* `chat/create`
* `chat/send-message`
* `session/start`
* `session/write-stdin`
* `session/terminate`
* `git/status`
* `git/stage`
* `git/commit`
* `voice/transcribe`

Event examples:

* `project/state-updated`
* `chat/message-appended`
* `session/output`
* `session/exited`
* `git/status-updated`
* `provider/availability-changed`
* `voice/transcript-ready`

## Data Model

Suggested tables:

* `projects`
* `project_layouts`
* `chat_threads`
* `chat_messages`
* `provider_profiles`
* `session_runs`
* `session_events`
* `git_snapshots`
* `file_change_attribution`

Minimal fields:

### `projects`

* `id`
* `name`
* `root_path`
* `path_key`
* `created_at`
* `last_opened_at`

### `chat_threads`

* `id`
* `project_id`
* `title`
* `provider_id`
* `pane_id`
* `created_at`
* `updated_at`

### `chat_messages`

* `id`
* `thread_id`
* `role`
* `content`
* `created_at`
* `provider_message_id`

### `session_runs`

* `id`
* `thread_id`
* `provider_id`
* `transport`
* `status`
* `started_at`
* `ended_at`
* `working_directory`

### `session_events`

* `id`
* `session_id`
* `event_type`
* `payload_json`
* `occurred_at`

### `git_snapshots`

* `id`
* `project_id`
* `branch_name`
* `head_sha`
* `snapshot_json`
* `created_at`

## Windows 10 and Windows 11 Design Notes

Windows is the primary platform, so design around it first.

### Shell Strategy

Preferred shell order:

1. `pwsh.exe`
2. `powershell.exe`
3. `cmd.exe`

Do not assume Git Bash is present.

### PTY Strategy

Use ConPTY on supported Windows 10 and Windows 11 systems.

Fallback plan:

* if ConPTY is unavailable, allow plain process spawning for provider CLIs
* keep the PTY abstraction clean so an alternate adapter can be added later

### Path Strategy

Store both:

* native absolute path for actual process execution
* normalized relative path with forward slashes for app-level bookkeeping

This avoids path separator bugs when diffs, events, and chat history are rendered on different platforms.

### Git Strategy

Use the installed `git.exe` from PATH or a configured override.

Do not shell out through UI code.

### File Watching

Windows file watching can be noisy. Debounce and coalesce events before refreshing git state or file trees.

### Packaging

Package installers should:

* detect missing git
* detect missing provider CLIs
* show actionable setup instructions instead of failing silently

## macOS Design Notes

macOS should work with the same architecture, with these adjustments:

* prefer `zsh` and fall back to `bash`
* handle TCC prompts for microphone and protected folders
* surface missing provider CLI installs clearly
* keep signing and notarization as a release concern, not an MVP blocker

The backend contract should not change between Windows and macOS. Only the platform adapter should vary.

## Security Model

This app is intentionally powerful, so keep the boundary explicit.

Rules:

* renderer never gets direct filesystem or shell access
* all tool execution goes through the backend session manager
* every session is tied to a project root
* dangerous commands can require explicit approval before execution
* audit events should record which chat triggered each tool run

## Suggested Repository Layout

```text
desktop/
  src/
    main/
    preload/
    renderer/
backend/
  src/
    contracts.ts
    platform.ts
    WorkspaceBackend.ts
    services/
    providers/
    persistence/
shared/
  src/
    ipc/
    types/
docs/
  backend-system-design.md
```

## MVP Build Order

1. Project open and restore
2. Chat thread persistence
3. Provider registry and one provider adapter
4. PTY-backed session manager
5. Terminal streaming in the UI
6. Git status and diff viewing
7. Apply or reject changes
8. Voice typing
9. Multi-provider support

## Non-Goals For The First Cut

* remote multi-user collaboration
* cloud-hosted repo execution
* advanced branch management
* full IDE replacement features

## Recommendation

Start with a local Electron app and a per-project Node backend process. That matches the README, fits Windows 10 and Windows 11 best, and still leaves a clean path for macOS support without redesigning the core backend.

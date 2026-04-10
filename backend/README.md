# Backend Scaffold

This folder is a design-first scaffold for the local backend described in [../docs/backend-system-design.md](../docs/backend-system-design.md).

It is not a full runnable app yet. The intent is to lock down the shape of the backend before wiring Electron, the renderer, and real provider adapters.

## What Is Here

* `src/contracts.ts`
  Common backend types and service contracts
* `src/platform.ts`
  Host detection and Windows/macOS-aware runtime helpers
* `src/WorkspaceBackend.ts`
  A thin orchestration layer that shows how the backend services fit together

## Design Rules

* keep the backend local-first
* isolate repo work inside a project-scoped backend process
* treat Windows 10 and Windows 11 as the primary compatibility target
* keep macOS differences inside platform adapters instead of leaking them into UI code

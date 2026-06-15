# AxiOwl Desktop

AxiOwl Desktop is a Tauri v2 desktop application with:

- a React/Vite frontend in `src/`
- a Rust backend in `src-tauri/`
- direct Codex CLI integration for auth, session history, model discovery, and prompt execution

## Current Runtime

The active app runtime is Tauri plus Rust.

Electron, Express, and local HTTP fallback paths are not part of the active MVP runtime.

## MVP Scope

The current MVP focuses on:

- local workspace selection and editing
- Codex authentication status and device login
- historical session loading
- model selection
- prompt execution with live streaming
- approval and cancellation
- native desktop menu and window integration

## Important Status

This repository is still in active MVP completion work.

The codebase has been migrated onto a Tauri/Rust runtime path, but the full desktop flows still need final runtime acceptance testing before MVP can be called complete.

## Smoke Checks

A repeatable local smoke harness is available at:

- `scripts/mvp-smoke.ps1`

Examples:

- `powershell -ExecutionPolicy Bypass -File .\scripts\mvp-smoke.ps1 -SkipBuild`
- `powershell -ExecutionPolicy Bypass -File .\scripts\mvp-smoke.ps1`

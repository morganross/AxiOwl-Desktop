# AxiOwl / Qexow Codex Runtime Dependency Audit

Last updated: 2026-06-15.

Purpose:

- explain exactly why the current Rust app calls external Codex programs
- distinguish acceptable MVP runtime dependencies from weak or still-concerning ones
- prevent ambiguity between:
  - "Rust-native desktop shell"
  - "Rust reimplementation of app glue"
  - "Rust replacement for Codex itself"

## Executive Statement

The current app is a Rust-native Tauri desktop application.

It is **not** a Rust reimplementation of the Codex engine, Codex auth service, Codex quota service, or Codex model catalog.

Instead, the current MVP architecture is:

- Rust owns desktop lifecycle, windowing, menus, file/workspace boundaries, session parsing, validation, logging, and user-visible failure handling
- Rust discovers and proves a usable local Codex runtime
- Rust launches that Codex runtime as a managed subprocess when live Codex-backed behavior is required
- Rust communicates with Codex through direct process execution or stdio RPC

That means the app is not "Rust running the old Electron app".

But it also means the app is not yet a self-contained "all behavior rewritten in Rust with no external Codex process dependency" system.

## Core Architectural Truth

Current architecture in one sentence:

> AxiOwl is now a Rust desktop host for Codex-backed workflows, not a Rust reimplementation of Codex itself.

This distinction matters because some external-program launches are correct for the MVP, while others would indicate an architectural shortcut or hidden fallback.

## Dependency Classification

The table below classifies each current external Codex dependency.

| Area | Current behavior | Proof | Classification | Why |
| --- | --- | --- | --- | --- |
| Runtime discovery validation | Rust probes candidate executables with `codex --version` | `src-tauri/src/codex_runtime.rs` | Acceptable MVP dependency | The app must prove a real Codex runtime exists before it can use Codex-backed features |
| Device login start | Rust launches `codex login --device-auth` | `src-tauri/src/auth.rs` | Acceptable MVP dependency | Login belongs to Codex identity/runtime behavior, not to the desktop shell |
| Logout | Rust launches `codex logout` | `src-tauri/src/auth.rs` | Acceptable MVP dependency | Logout is also Codex runtime behavior |
| Model catalog | Rust launches `codex debug models` | `src-tauri/src/process.rs` | Acceptable MVP dependency | This is live runtime truth; inventing a local model list would be worse |
| Prompt execution | Rust launches `codex app-server --stdio` and streams a managed run | `src-tauri/src/process.rs` | Acceptable MVP dependency | The desktop app is intentionally a native shell around Codex execution for MVP |
| Quota lookup | Rust launches `codex app-server --stdio` and issues `account/rateLimits/read` | `src-tauri/src/quota.rs` | Acceptable but high-risk MVP dependency | Live quota truth should come from the real Codex runtime, but this path must be aggressively discovered and continuously re-proved |

## What The App Is Not Doing

The current code does **not** show any evidence that the active MVP runtime is:

- launching Electron to provide the old desktop runtime
- launching Express as the active API backend for the desktop app
- calling the old HTTP API surface as its primary runtime path
- reading a fake static quota file as the source of truth
- using `cmd /c start`, `where.exe`, or `taskkill` in the current hardened runtime path

That means the main issue is not "Rust is secretly running the old app".

The real issue is narrower and more important:

- the app still depends on the external Codex runtime for several product-critical features
- those dependencies must therefore be treated as first-class subsystems, not as casual variables

## Why Quota Was Calling An External Program

Quota lookup currently works like this:

1. Rust resolves a Codex executable through aggressive runtime discovery.
2. Rust launches `codex app-server --stdio`.
3. Rust sends an initialize request.
4. Rust sends `account/rateLimits/read`.
5. Rust parses the JSON response into the desktop quota DTO.

Proof:

- [`quota.rs:48`](C:/Users/kjhgf/OneDrive/Documents/New%20project/AxiOwl-Desktop/src-tauri/src/quota.rs#L48)
- [`quota.rs:59`](C:/Users/kjhgf/OneDrive/Documents/New%20project/AxiOwl-Desktop/src-tauri/src/quota.rs#L59)
- [`quota.rs:144`](C:/Users/kjhgf/OneDrive/Documents/New%20project/AxiOwl-Desktop/src-tauri/src/quota.rs#L144)

So quota was calling an external program because:

- the desktop app does not own Codex quota logic
- the chosen MVP design is to ask the real Codex runtime for live quota truth
- the Rust layer then translates that truth into app UI state

This is not automatically wrong.

The real failure was that external dependency management was not yet robust enough.

## What Failed In The Quota Incident

The specific failure:

`Failed to start Codex app-server for quota lookup: The system cannot find the path specified. (os error 3)`

means the quota request failed before any quota response existed.

Immediate cause:

- Rust selected or retained a Codex executable path
- Windows could not actually start that path
- therefore the app-server process never came up
- therefore quota could not be requested

This was a runtime-discovery / runtime-proof failure, not fundamentally a quota-math failure.

## Clean-Room Assessment

Based on the current source, this is the closest accurate classification:

1. **Not supported by current evidence:** "The new app reuses the old Electron/Express runtime as the active runtime."
2. **Supported by current evidence:** "The new app launches the external Codex runtime for Codex-owned features."
3. **Partially supported by architecture history, but not proven from this audit alone:** "Developers may have matched old observable behavior while rewriting desktop glue in Rust."
4. **Supported by current source posture:** "Rust owns the desktop shell and bridges to Codex for live Codex capabilities."

This means the strongest current concern is not "old app still running".

It is:

- the product boundary is still partly "Rust shell + external Codex runtime"
- every such boundary now requires aggressive discovery, proof, monitoring, logging, and loud user-visible failure handling

## Required Attitude For External Dependencies

For AxiOwl, a path to Codex is not a mere variable.

It is a continuously managed truth domain.

That means the desktop app should treat Codex dependency state as its own active subsystem:

- discover aggressively from every legitimate source
- prove each candidate by execution, not by existence alone
- reject stale or inaccessible candidates loudly
- expose discovery evidence in the UI
- re-prove cached truth before reuse
- log every attempt verbosely
- fail loudly to the user when proof is missing
- continue gathering evidence rather than silently guessing

## Remaining Engineering Obligations

The following work is still justified even after the current runtime hardening:

1. Keep tightening Codex discovery and proof paths anywhere a stale path can still survive too long.
2. Audit every Codex launch site so each one has:
   - explicit purpose
   - verbose log trail
   - runtime report attached to failure
   - user-visible actionable error
3. Re-run packaged acceptance after the latest runtime-hardening wave.
4. Verify the login and quota flows end to end against a fresh working Codex runtime.
5. Continue removing any remaining assumptions that treat Codex location or availability as static state.

## Bottom Line

The current app is closer to:

- **"use Rust to host and orchestrate the real Codex runtime"**

than to:

- **"use Rust to run the old app"**

or:

- **"fully replace every Codex-owned behavior with Rust-native logic"**

That is the honest current architecture.

It is viable for the MVP, but only if the Codex runtime boundary is handled with aggressive discovery, continuous proof, verbose logging, and loud user-facing failures.

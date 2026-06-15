# AxiOwl / Qexow Tauri MVP Progress Status

Last updated: 2026-06-15.

Companion audit artifact:

- [MVP_EVIDENCE_CHECKLIST.md](C:/Users/kjhgf/OneDrive/Documents/New%20project/AxiOwl-Desktop/MVP_EVIDENCE_CHECKLIST.md)
  - requirement-by-requirement proof map for the current MVP
  - classifies each planning-doc requirement as `Proven`, `Partial`, or `Missing`
  - identifies the highest-value remaining runtime proofs still needed
- [CODEX_RUNTIME_DEPENDENCY_AUDIT.md](C:/Users/kjhgf/OneDrive/Documents/New%20project/AxiOwl-Desktop/CODEX_RUNTIME_DEPENDENCY_AUDIT.md)
  - explains exactly why the current Rust app launches external Codex programs
  - distinguishes acceptable MVP Codex-runtime dependencies from architectural shortcuts
  - records the current honest architecture boundary: Rust-native desktop shell plus Codex-backed runtime features

## Executive Status

The repository now contains a real Tauri v2 desktop app with a Rust backend and a React/Vite frontend running through a Tauri adapter layer.

The current honest architecture boundary is:

- Rust owns the native desktop shell, workspace/file boundaries, session parsing, validation, logging, and user-visible error handling
- live Codex-owned capabilities still come from the external Codex runtime, launched and managed by the Rust backend

That means the current MVP is:

- no longer the old Electron/Express runtime
- not a fully self-contained Rust reimplementation of Codex itself
- a Rust-native desktop host around aggressively discovered, explicitly managed Codex runtime behavior

The active MVP path is:

- `src/`
- `src/lib/desktopApi.js`
- `src-tauri/`

The old Electron/Express runtime is no longer the active runtime path for the app, and the repo-root Electron entry files that previously created that runtime have been removed.

MVP is still incomplete. The codebase is beyond scaffolding, but it is not yet proven as a fully working tested MVP because a smaller set of end-to-end packaged-app requirements still remain unverified after the latest cleanup pass:

- packaged login/logout device flow through a full successful external browser round-trip after the latest auth hardening
- explicit minimize command verification in the packaged app
- real Explorer right-click invocation of the registered context-menu entries
- a full packaged UI acceptance rerun after the aggressive Codex runtime discovery changes

Additional architectural obligation now documented explicitly:

- every Codex subprocess dependency must continue to be treated as a first-class truth domain with aggressive discovery, re-validation, verbose logging, and loud user-facing failures

The current packaged acceptance harness is now aligned with the real Codex `approvalPolicy = "on-request"` behavior:

- destructive commands can require approval
- some low-risk commands can begin immediately without a separate approval pause
- cancellation coverage therefore must handle either path instead of assuming approval always appears first
- explicit `New Thread` transitions now require a true fresh-thread reset before the next acceptance step continues

Latest runtime-cache hardening completed:

- Codex runtime cache entries are no longer trusted merely because the cached file still exists
- before each use, the cached executable is re-proved with the same `--version` validation used during aggressive discovery
- if the cached executable cannot be re-validated, the cache is discarded loudly and full discovery runs again instead of letting a later quota/login/model/process call fail from a stale path assumption
- this directly hardens the class of failures where a previously discovered Codex path later becomes invalid while still looking superficially present on disk

Verification for the runtime-cache hardening:

- `cargo test` passed with 51 tests
- added focused Rust coverage proving that a stale cached runtime file is discarded when re-validation fails

Latest runtime-status visibility completed:

- added a first-class Tauri command for Codex runtime truth instead of forcing users to infer discovery state from quota/login/process failures:
  - `get_codex_runtime_status`
- the command returns:
  - whether a usable Codex runtime is currently proven
  - the active `CODEX_HOME` profile path
  - the selected executable path, discovery source, and version when available
  - the recorded aggressive-discovery attempts when discovery fails
- the login screen now renders a runtime-status panel before sign-in so discovery failures are visible at the entry point of the app instead of only after secondary feature failures

Verification for runtime-status visibility:

- `cargo test` passed with 52 tests
- `npm run build` passed
- the only current frontend build warning remains Vite's existing large chunk-size warning

Latest authenticated-shell runtime visibility completed:

- the authenticated sidebar now renders a compact Codex runtime status card alongside quota information
- the desktop shell therefore exposes both:
  - quota truth
  - runtime discovery truth
  during normal signed-in use
- runtime status is refreshed again after successful login and on the periodic desktop refresh interval, so the shell does not keep stale discovery state indefinitely

Verification for authenticated-shell runtime visibility:

- `npm run build` passed
- `cargo test` passed with 52 tests

Latest runtime diagnostics inspection completed:

- both desktop entry points now expose a shared runtime-diagnostics modal:
  - unauthenticated login screen
  - authenticated sidebar shell
- the modal renders the full typed discovery report:
  - active Codex profile path
  - selected executable
  - discovery source
  - version
  - every recorded aggressive-discovery attempt with status, path when present, and detail text
- this makes runtime discovery inspectable in the product UI instead of forcing diagnosis through logs or secondary feature failures

Verification for runtime diagnostics inspection:

- `npm run build` passed
- `cargo test` passed with 52 tests

Latest runtime-linked error messaging completed:

- user-facing failures now explicitly point back to Codex runtime diagnostics when runtime proof is unavailable instead of appearing as isolated feature-level problems
- this now covers at least:
  - quota fetch failures
  - auth-status fetch failures
  - login-start failures
  - model-catalog load failures
  - prompt launch failures
  - streamed prompt error completions
- the frontend uses a shared runtime-messaging helper so diagnostics hints stay consistent across surfaces

Verification for runtime-linked error messaging:

- `npm run build` passed
- `cargo test` passed with 52 tests

Latest workspace/editor error specificity cleanup completed:

- generic workspace-surface failures were tightened to describe the actual failed action instead of broad `Failed to load...` wording
- this now includes:
  - sibling workspace discovery
  - workspace selection
  - workspace creation
  - active workspace root lookup in the editor
  - active workspace file listing in the editor
  - editor save failure state now carries specific failure detail for the active file instead of only a bare generic failure marker

Verification for workspace/editor error specificity cleanup:

- `npm run build` passed
- `cargo test` passed with 52 tests

Latest session/history error visibility cleanup completed:

- session-list refresh failures now surface a more specific sidebar error:
  - historical session loading
- thread-level session-history failures are no longer log-only in the main cases:
  - initial session-history load
  - completed-run history refresh
  - cancelled-run history refresh
  - errored-run history refresh
  - background session-history polling
- the thread view now renders a visible status banner when those history refresh paths fail, instead of silently keeping the failure in console output only

Verification for session/history error visibility cleanup:

- `npm run build` passed
- `cargo test` passed with 52 tests

Latest file/open-path error visibility cleanup completed:

- file-open and file-refresh failures now surface a visible desktop status banner instead of remaining console-only in the main app shell
- startup-file resolution failures now surface a visible desktop status banner instead of only logging startup-options lookup failure
- second-instance / forwarded open-path handling failures now surface a visible desktop status banner instead of remaining console-only
- successful file-open and open-path flows clear the desktop status banner again, preventing stale error residue

Verification for file/open-path error visibility cleanup:

- `npm run build` passed
- `cargo test` passed with 52 tests

Latest save/logout/background-refresh error cleanup completed:

- app-shell error visibility now also covers:
  - active session token-usage lookup
  - desktop app metadata lookup
  - logout failure
- login device-auth polling failures now use the same runtime-aware error hinting path as login-start failures
- thread approval/cancel feedback is now more specific:
  - no active approval target
  - approval send failure
  - run cancellation failure

Verification for save/logout/background-refresh error cleanup:

- `npm run build` passed
- `cargo test` passed with 52 tests

Latest aggressive-discovery cleanup completed:

- added a first-class Rust `codex_runtime` module instead of deriving `codex.exe` from the app home directory
- Codex executable discovery now checks explicit overrides, `LOCALAPPDATA\OpenAI\Codex\bin`, versioned local Codex bins, PATH entries, and WindowsApps package resource paths
- each candidate is canonicalized, version-probed with `--version`, accepted or rejected with a recorded reason, and written to `~/.codex/logs/qexow.log`
- the app now rejects PATH/WindowsApps candidates that exist but cannot run, including the observed WindowsApps `Access is denied` path
- spawned Codex commands now receive `CODEX_HOME` from the app's resolved `.codex` profile path, while executable discovery is independent from `AXIOWL_HOME_DIR`
- quota, model discovery, login/logout, and app-server prompt execution all use the same runtime resolver
- smoke/probe scripts now use a shared `scripts/codex-runtime-discovery.cjs` resolver instead of hardcoding the Codex executable path
- quota/model/process start failures now return selected runtime details or a full discovery report to the frontend instead of only logging them
- invalid/unreadable auth files now return an auth error in `get_auth_status` so the login surface can fail loudly to the user
- window state now uses `AppState.paths.codex_dir` instead of calling `dirs::home_dir()` independently
- verbose Rust logging was added with rotation at `~/.codex/logs/qexow.log`
- Tauri core capability exposure was reduced from `core:default` to event listen/unlisten permissions required by the React adapter

Verification for the aggressive-discovery cleanup:

- `cargo check` passed with no warnings
- `cargo test` passed with 45 tests
- `npm run build` passed
- `npm run tauri:build` passed and produced:
  - `src-tauri\target\release\axiowl-desktop.exe`
  - `src-tauri\target\release\bundle\nsis\AxiOwl_0.1.9_x64-setup.exe`
- script resolver checks passed:
  - `node --check scripts\codex-runtime-discovery.cjs`
  - `node --check scripts\app-server-rate-limits.cjs`
  - `node --check scripts\app-server-probe.cjs`
  - `node scripts\codex-runtime-discovery.cjs`
- live release WebView probe succeeded after capability hardening:
  - `get_auth_status` invoked successfully from the WebView
  - `get_quota` invoked successfully from the WebView and failed loudly because the current Codex account state is unauthenticated
  - the user-facing quota error included the selected Codex executable, discovery source, version, and discovery attempt count
- the corresponding log recorded 43 Codex discovery attempts, including the rejected WindowsApps PATH candidate with `Access is denied`, then selected:
  - `C:\Users\kjhgf\AppData\Local\OpenAI\Codex\bin\codex.exe`

Latest boundary/fail-loud cleanup completed after that verification:

- added `src-tauri/src/workspace_store.rs` so active workspace/file operations go through an explicit local workspace-store trait instead of scattered direct filesystem access
- added `src-tauri/src/events.rs` so important MVP domain events are published into the verbose Rust log rather than disappearing:
  - `workspace.changed`
  - `file.created`
  - `file.saved`
  - `execution.completed`
- wired file create/save operations to publish inspectable events, including a SHA-256 content digest for saves instead of logging file contents
- wired workspace open/select/create operations to publish the active workspace root
- wired managed Codex run completion to publish the run id, session id if known, and completion outcome before cleanup
- reran the banned-placeholder sweep against active runtime surfaces:
  - `src/`
  - `src-tauri/src/`
  - `scripts/`
  - Tauri/package config files
- no active mock/demo/fake/dummy/placeholder runtime data was found; remaining hits were Rust language keywords such as `static` / `'static`
- the cleanup keeps MVP local-only behavior; it does not introduce LSP, Docker, remote execution, plugins, shadow Git, or multi-window scope

Verification for the latest boundary/fail-loud cleanup:

- `cargo test` passed with 45 tests
- `npm run build` passed
- `npm run tauri:build` passed and produced:
  - `src-tauri\target\release\axiowl-desktop.exe`
  - `src-tauri\target\release\bundle\nsis\AxiOwl_0.1.9_x64-setup.exe`
- the only frontend build warning remains Vite's existing large chunk-size warning

Latest native-runtime launch cleanup completed after the auth-expiry fixes:

- removed the Windows browser-launch shell intermediary from the product runtime:
  - the login device-auth browser handoff no longer uses `cmd /C start`
  - Windows now uses native `ShellExecuteW` for the default-browser URL open
- removed `where.exe` from Codex runtime discovery:
  - PATH entries are scanned directly
  - discovery now records that `where.exe` fallback is disabled by runtime policy
- removed `taskkill` from managed-run cancellation:
  - Windows process-tree shutdown now uses native ToolHelp process enumeration plus `OpenProcess` / `TerminateProcess`
- this cleanup matters because the refactor goal is a native desktop app posture, not a Rust wrapper around shell-era helper commands

Verification for the native-runtime launch cleanup:

- `cargo test` passed with 49 tests after the runtime-launch changes and runtime-policy guard additions
- runtime-policy regression tests now explicitly guard against reintroducing:
  - `Command::new("cmd")` in the Windows browser-open path
  - `Command::new("where.exe")` in Codex runtime discovery
  - `taskkill` in managed-run cancellation
- the Rust suite also now guards the shared Node discovery helper against reintroducing `spawnSync("where.exe", ...)`
- no runtime proof was executed in this pass because the current constraint is source-only / no visible terminal or console windows

Latest cleanup pass completed before the next heavy packaged rerun:

- quota no longer collapses multiple real Codex rate-limit buckets into one silently chosen bucket; the Rust contract now preserves the primary returned bucket plus additional real buckets when present
- auth now rejects expired JWT auth state instead of treating any decodable token payload as authenticated
- logout now returns a real failure when `codex logout` exits unsuccessfully instead of quietly returning a false success-shaped payload
- login polling in the React login screen now stops cleanly and surfaces polling failures instead of leaving an unhandled async loop behind
- editor file-open logic no longer leaves behind blank placeholder tabs when a real file read fails
- auth-expiry detection now normalizes revoked/invalid-token Codex failures into a clean `Authentication expired. Please sign in again.` path instead of dumping raw stderr/router failures into the chat stream
- login-start failures from Tauri now reach React as real `Error` messages rather than opaque thrown strings
- device login now attempts to open the external browser from the Rust login path when Codex returns a device-auth URL
- lightweight verification completed for this batch:
  - `cargo test`
  - `node --check scripts/packaged-auth-acceptance.cjs`
  - `npm run build`
- additional live installed-app window-command proof completed without a rebuild:
  - `toggle_maximize_window` expanded the installed `AxiOwl` window from `1280x1075` to `2560x1397` and then restored it to the original size
  - `toggle_fullscreen_window` expanded the installed `AxiOwl` window to `2544x1381` and then restored it to the original size
  - this confirms the native maximize and fullscreen command wiring in the live installed desktop app

Latest packaged-runtime verification completed after the auth-expiry fixes:

- `npm run tauri:build` completed successfully on the updated worktree
- the fresh packaged release binary launched successfully under the WebView debug bridge
- the full packaged UI acceptance suite passed on the fresh build:
  - quota visibility
  - native shortcuts
  - workspace creation
  - file open/edit/save/reopen
  - approval flow
  - cancel flow
  - historical session replay
  - open-path forwarding
- current live quota rendering now shows multiple real Codex buckets in the packaged UI, for example:
  - `Codex (pro)` with its own 5-hour and weekly limits
  - `GPT-5.3-Codex-Spark (pro)` with its own 5-hour and weekly limits
- a fresh new-thread packaged run was also re-verified after the auth parser changes; the updated binary rendered a live assistant reply instead of immediately failing on sign-in
- direct packaged-runtime auth probes then revealed the current remaining external auth issue on this machine:
  - `get_auth_status` can return unauthenticated after logout, correctly moving the app to the login surface
  - a direct `trigger_login` call failed once with the real Codex stderr cause:
    - `device code request failed with status 429 Too Many Requests`
  - the app now surfaces that as a concrete user-facing login-start failure rather than the previous generic `Authentication error. Could not start login.`
- the packaged auth acceptance harness was updated so future runs fail with the real login error text instead of a generic timeout when login start fails before device instructions appear

## What Is Implemented

### Desktop Shell

- Tauri v2 app scaffold under `src-tauri/`
- Vite-based frontend build for Tauri
- Tauri package scripts in `package.json`
- Tauri command registration through Rust
- native window/menu integration
- single-instance plugin wiring

### Rust Backend Modules

- `app_state`
- `auth`
- `commands`
- `dto`
- `files`
- `native`
- `paths`
- `process`
- `quota`
- `sessions`
- `workspace`

### Frontend Integration

- Tauri-only adapter in `src/lib/desktopApi.js`
- React app routed through Tauri `invoke()` and event listeners
- no active HTTP API fallback in the frontend adapter
- no active Electron IPC path in the frontend adapter

### Codex Runtime Integration

- real Codex CLI spawn from Rust
- run registry keyed by `runId`
- Codex `app-server --stdio` transport for managed prompt runs
- app-server JSON-RPC handshake from Rust
- agent-message streaming through app-server notification deltas
- real command-approval handling through app-server server requests
- cancellation by killing the active app-server child process
- session resume/new-session handling through `thread/resume` and `thread/start`
- model discovery through `codex debug models`
- explicit desktop launcher override for:
  - `approvalPolicy = "on-request"`
  - `sandbox = "workspace-write"`

### Workspace / File Safety

- canonical path checks
- workspace-root enforcement
- relative-path validation for create operations
- text-focused file handling with size limits

## Cleanup Completed

The following cleanup work has been completed in the active Tauri MVP path:

- removed Express proxying from `vite.config.js`
- removed Electron/Express dependencies and scripts from `package.json`
- removed frontend HTTP fallback behavior from `src/lib/desktopApi.js`
- removed frontend Electron fallback behavior from `src/lib/desktopApi.js`
- removed fake model fallback data from the Rust process layer
- removed stale quota-log parsing and fake quota success behavior
- replaced stale quota/session-telemetry parsing with a live `codex app-server` `account/rateLimits/read` query
- removed synthetic diff generation that fabricated file patch content
- removed browser `prompt()` / `alert()` workspace flows in the active app UI
- removed fake `Untitled Session` naming in active session handling
- removed synthetic historical session fallback names like `Session abc123`; the app now falls back to the real session UUID when no user title exists
- removed placeholder-only sidebar controls such as `Search not implemented` and `Settings not implemented`
- removed synthetic auth metadata like `User`, `free`, and `API Key User`
- removed the generic sidebar identity fallback label `Authenticated`; the UI now reflects either real account info or the real auth method
- removed frontend adapter shape-fallback logic that silently accepted invalid command payloads such as `result.files || []`
- removed frontend quota success masking (`data.success ?? true`) so missing or malformed quota payloads no longer present as successful
- removed the always-on approval hint in the composer footer; the approval prompt now appears only when the runtime has actually emitted an approval request
- removed the hardcoded About dialog version string; the dialog now reads the packaged app version from the real Tauri runtime
- removed canned empty-state suggestion prompts from the thread view
- removed optimistic session-list entries that were fabricated in the React layer
- removed Rust-side mutation of `~/.codex/session_index.jsonl` for session title backfilling
- removed frontend token-usage caching from `localStorage`; session token usage is now loaded from real Codex session files
- removed the out-of-scope `Build Workspace` action and its Rust command/process registry from the active MVP desktop surface
- removed dead copied UI scaffolding that was not part of the active runtime path:
  - `src/components/ReviewPane/ReviewPane.jsx`
  - `src/components/ReviewPane/ReviewPane.css`
  - `src/components/TitleBar/TitleBar.jsx`
  - `src/components/TitleBar/TitleBar.css`
- removed obsolete repo-root runtime files:
  - `main.js`
  - `server.js`
  - `preload.js`
  - `loading.html`
  - `test-ui.js`
  - `get_quota.py`
  - `models.json`

## Current Behavior Decisions

These are intentional current MVP behaviors, not placeholder behavior:

- quota comes from a live app-server rate-limit query and surfaces a real error if Codex cannot provide it
- file-change events currently open changed files but do not render a real patch/hunk diff
- the UI is preserved in broad structure, but the runtime behind it is being replaced with Rust/Tauri services

## Latest Evidence From 2026-06-15

The strongest currently verified MVP path is now:

- real Codex auth check
- real model discovery
- live account rate-limit query
- real approval request / approval acceptance / command execution
- packaged Windows bundle build
- packaged app launch
- packaged app prompt submission and assistant reply rendering
- packaged app quota visibility
- packaged app workspace create/edit/save/reopen
- packaged app approval flow
- packaged app cancellation flow

Fresh checks completed in this pass:

- `powershell -ExecutionPolicy Bypass -File .\scripts\mvp-smoke.ps1`
- `npm run build`
- `npm run tauri:build`
- silent NSIS reinstall of:
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\src-tauri\target\release\bundle\nsis\AxiOwl_0.1.9_x64-setup.exe`
- packaged app launch from:
  - `C:\Users\kjhgf\AppData\Local\AxiOwl\axiowl-desktop.exe`

Observed results:

- `scripts/mvp-smoke.ps1` now verifies:
  - Codex login status
  - model discovery
  - live app-server rate limits
  - app-server approval request
  - approval acceptance
  - turn completion
- full build-and-bundle smoke passed
- packaged app WebView booted successfully at `http://tauri.localhost/`
- packaged UI quota text matched the live Codex rate-limit probe:
  - UI showed `45%` / `44%` remaining during the first packaged check
  - later UI refresh showed `44%` / `44%`, matching the live moving account window
- a packaged app prompt round-trip was verified end-to-end:
  - session file `rollout-2026-06-14T23-06-53-019ec9e3-d8ec-7921-be1f-9aac7d299663.jsonl` contains both the user message and assistant final answer for `PKG_UI_E2E_1781503612480`
  - packaged WebView DOM contains the assistant message bubble rendering `PKG_UI_E2E_1781503612480`

Frontend/runtime bug fixed in the same pass:

- new-session prompt runs could finish in Codex and persist the assistant reply to the session file, but the packaged UI could miss the final rendered answer
- `ThreadView.jsx` now resyncs from persisted session history when a run ends or errors, so the installed app shows the final assistant reply even if the live stream and the history-loader timing briefly miss each other

Additional cancel-path fixes prepared before the next heavy packaged test:

- the frontend now distinguishes a real cancelled run from an ordinary successful end event
- the thread view now appends a visible cancelled message and refreshes history after cancellation
- the Stop action now immediately closes the approval-reply state to avoid an `Approve`/`Stop` race
- `scripts/packaged-ui-acceptance.cjs` now waits for either:
  - a real approval request
  - or the active run Stop control
- the packaged cancel scenario now uses a longer-running command so the stop action has a real interception window

## Latest Packaged Acceptance Evidence From 2026-06-15

The installed Windows app was rebuilt, reinstalled, relaunched, and exercised again after additional thread-state and cancellation fixes.

Fresh packaged checks completed in this pass:

- `npm run tauri:build`
- silent NSIS reinstall of:
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\src-tauri\target\release\bundle\nsis\AxiOwl_0.1.9_x64-setup.exe`
- packaged app launch with WebView debug port `9444`
- `node .\scripts\packaged-ui-acceptance.cjs http://127.0.0.1:9444`
- `powershell -ExecutionPolicy Bypass -File .\scripts\mvp-smoke.ps1 -SkipBuild`

Observed packaged acceptance results:

- live quota section rendered and showed real remaining percentages
- native desktop shortcuts succeeded in the packaged app:
  - `Ctrl+B` hid and restored the sidebar
  - `Ctrl+E` hid and restored the editor pane
  - `Ctrl+N` opened the new-workspace dialog
  - `Ctrl+S` saved the active edited file
- workspace creation through the packaged UI succeeded
- workspace file list refresh succeeded
- file open, edit, save, close, and reopen succeeded
- destructive approval flow completed and removed the target directory
- stop/cancel flow interrupted the long-running command before file creation
- the packaged cancel verification confirmed:
  - `cancel_should_not_exist.txt` was not created
- historical session replay succeeded through the packaged UI:
  - a real session containing marker `HIST-1781507014626` was created
  - the packaged sidebar exposed the session row for UUID `019eca18-454d-7943-9e5f-c7b580b0a739`
  - selecting that session through the packaged UI replayed the expected historical message content
- second-instance open-path forwarding succeeded:
  - launching `C:\Users\kjhgf\AppData\Local\AxiOwl\axiowl-desktop.exe` with file path `C:\Users\kjhgf\AxiOwl\ui-packaged-smoke-1781507014626\forward_target.txt`
  - forwarded the file into the already-running packaged app
  - the running packaged window opened the forwarded file and rendered its expected contents
- the lightweight smoke script still passed after the same code changes:
  - login status
  - model discovery
  - live rate limits
  - app-server approval request / approval acceptance / turn completion

Installed shell integration evidence gathered in the same pass:

- the packaged executable exists at:
  - `C:\Users\kjhgf\AppData\Local\AxiOwl\axiowl-desktop.exe`
- installed registry entries exist under:
  - `HKCU\Software\Classes\*\shell\Open in AxiOwl`
  - `HKCU\Software\Classes\Directory\shell\Open in AxiOwl`
  - `HKCU\Software\Classes\Directory\Background\shell\Open in AxiOwl`
- registry command values point to the packaged executable with the expected shell placeholders:
  - file entry command uses `"%1"`
  - directory background entry command uses `"%V"`

Product/runtime fixes completed to achieve that pass:

- selecting `New Thread` now forces a real fresh-thread reset even when the user was already on a null-session draft
- the packaged acceptance harness now waits for that real fresh-thread reset instead of assuming a click alone is enough
- cancellation UI now creates a concrete assistant-side cancelled message even when the run is stopped before any prior assistant token arrives
- packaged historical-session acceptance now resolves the authoritative session UUID from the real Codex session files and uses the packaged sidebar row for that UUID
- packaged open-path acceptance now drives the real single-instance forwarder by launching a second packaged process with a file argument
- packaged native-shortcut acceptance now validates the installed desktop shortcut behaviors directly in the running binary

## Fresh Evidence From 2026-06-15

The following checks were run successfully after the latest runtime cleanup and event-bridge fixes:

- `cargo test`
- `npm run build`
- `npm run tauri:build`
- `npm run tauri:dev` smoke launch
- `powershell -ExecutionPolicy Bypass -File .\scripts\mvp-smoke.ps1 -SkipBuild`
- `cargo build --release`

Observed results:

- Rust tests passed: `30 passed`
- Vite production build completed successfully
- Tauri packaged build completed successfully
- repo-local Codex smoke harness passed
- release executable rebuilt successfully after the latest native/runtime fixes
- NSIS installer was produced successfully at:
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\src-tauri\target\release\bundle\nsis\AxiOwl_0.1.9_x64-setup.exe`
- `tauri:dev` launched the Vite dev server and started `target\\debug\\axiowl-desktop.exe`
- `scripts/mvp-smoke.ps1` now provides a repeatable local check for:
  - Codex login status
  - model discovery
  - app-server approval request / approval acceptance / turn completion

Real Codex CLI JSON output was also captured locally and used to correct active runtime assumptions:

- assistant text is emitted as `item.completed` with `item.type = "agent_message"`
- shell/tool execution is emitted as `item.started` / `item.completed` with `item.type = "command_execution"`
- file edits are emitted as `item.started` / `item.completed` with `item.type = "file_change"`
- model/runtime failures can emit `type = "error"` with a `message` field, not only an `error` field

The active app code has been updated to match those observed event shapes.

## Additional Fresh Evidence From The App-Server Runtime Swap

The managed run transport has now been moved off the old `codex exec --json` bridge and onto the real `codex app-server --stdio` integration path used by rich clients.

New local evidence captured during this pass:

- authoritative app-server probe logs were captured at:
  - `output\app-server-probe\observe.log`
  - `output\app-server-probe\accept.log`
- the observe probe showed a real approval server request:
  - `SERVER item/commandExecution/requestApproval`
- the accept probe showed the full approval lifecycle:
  - approval request emitted
  - client approval response sent
  - `SERVER serverRequest/resolved`
  - command completed with `status = "completed"` and `exitCode = 0`
  - `SERVER turn/completed`
- the updated local smoke script now verifies that app-server path directly instead of the older `exec --json` path
- the updated smoke run succeeded with:
  - Codex login status
  - model discovery
  - app-server approval request observed
  - app-server approval acceptance observed
  - turn completion observed

Additional Rust/runtime cleanup completed in the same pass:

- session-index parsing no longer invents `updated_at = now()` when the source data is missing that field
- session file discovery and workspace file recursion no longer silently swallow read failures
- sidebar/editor state now preserves the last known real workspace/session data and surfaces load failures instead of blanking to synthetic empty states

Current verification state after the app-server refactor:

- `cargo check` passed after the transport rewrite
- `cargo test` passed after the transport rewrite with `37` passing Rust tests
- `npm run build` passed after the transport rewrite
- `npm run tauri:build` passed after the transport rewrite
- the updated app-server smoke script passed
- a fresh NSIS installer was produced successfully at:
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\src-tauri\target\release\bundle\nsis\AxiOwl_0.1.9_x64-setup.exe`

Additional evidence gathered from the local Codex configuration and auth state:

- local `~/.codex/config.toml` was set to:
  - `approval_policy = "never"`
  - `sandbox_mode = "danger-full-access"`
- the desktop app no longer relies on those unsafe defaults for managed runs
- local `~/.codex/auth.json` contains the expected live keys used by the Rust auth parser:
  - top-level keys include `auth_mode`, `OPENAI_API_KEY`, `tokens`, and `last_refresh`
  - `tokens` contains `id_token`, `access_token`, `refresh_token`, and `account_id`

Additional approval-path evidence from local destructive-shell probes:

- a real `codex exec` run that attempted to delete a temp file emitted JSON only up to the initial assistant message
- the run then blocked waiting for stdin approval
- the only visible runtime signal for that wait state was the stderr line:
  - `Reading additional input from stdin...`
- the Tauri bridge previously filtered that line out as noise, which meant the desktop app could miss a real approval wait
- the bridge now converts that wait signal into an `approval_request` event and preserves the pending command label when available

Additional process-lifecycle fix from live smoke evidence:

- a harmless `codex exec --json "reply with exactly ok"` run emitted `Reading additional input from stdin...` even though no protected command was pending
- that meant the desktop bridge could falsely surface an approval request for ordinary non-tool replies
- the Rust process bridge now only emits `approval_request` when a real pending command exists
- the bridge also closes the managed stdin pipe after terminal turn events when no command is pending, so harmless runs do not keep an unnecessary open stdin handle
- focused Rust coverage now includes:
  - generic stdin wait without pending command does not become approval
  - stdin closes after terminal lifecycle events when no pending command exists

Additional quota evidence and fix:

- a real local Codex session file was inspected and confirmed to contain `event_msg.payload.type = "token_count"`
- that payload also contains real `rate_limits.primary` and `rate_limits.secondary` blocks with:
  - `used_percent`
  - `resets_at`
  - real plan/rate-limit metadata from Codex
- the Rust quota module now reads the newest available session telemetry instead of returning a placeholder unavailable state by default
- focused Rust coverage now includes parsing the newest quota snapshot from session files
- quota snapshot selection now prefers the newest real telemetry event timestamp, not filesystem modified time
- that prevents stale quota when an older `token_count` event lives inside a newer-touched session file
- live desktop proof on 2026-06-15:
  - real local telemetry from `C:\Users\kjhgf\.codex\sessions\2026\06\14\rollout-2026-06-14T14-57-21-019ec823-ab56-76c3-a0ff-de87b4db9d41.jsonl` reported `primary.used_percent = 43.0` and `secondary.used_percent = 54.0`
  - the running packaged app at `C:\Users\kjhgf\AppData\Local\AxiOwl\axiowl-desktop.exe` was inspected through the live WebView debug endpoint on `http://127.0.0.1:9444/json/list`
  - the live DOM showed `5-Hour Limit: 57% remaining` and `Weekly Quota: 46% remaining`
  - those on-screen values match the real telemetry-derived remaining percentages exactly

Additional auth-path evidence and fix:

- the live `~/.codex/auth.json` on this machine includes a top-level `OPENAI_API_KEY` key even when the real ChatGPT auth path is being used
- the Rust parser previously treated mere presence of `OPENAI_API_KEY` as authenticated, even if the value was `null` or blank
- that could have produced a false authenticated state if token parsing failed while the key still existed
- the auth parser now requires a non-empty API key string before using the API-key auth path
- focused Rust tests now cover:
  - null API key does not authenticate
  - blank API key does not authenticate
  - non-empty API key does authenticate

Additional device-login evidence and fix:

- a real `codex login --device-auth` prompt was captured against a temporary empty `CODEX_HOME`
- the live prompt includes ANSI color sequences around the device URL and one-time code
- the original URL parser could capture trailing ANSI reset codes in the returned URL string
- the login parser now strips ANSI escape sequences before returning the device URL/code pair
- focused Rust coverage now includes:
  - parsing device-auth output with ANSI color codes
  - stripping ANSI sequences from captured values

Additional workspace/editor flow fix:

- switching or creating a workspace from the sidebar correctly cleared open tabs, but previously did not trigger the editor-pane workspace refresh
- that could leave the workspace root and file list stale after a workspace change
- the app now triggers a workspace refresh whenever the active workspace changes from the sidebar flow

Additional native-window evidence and fix:

- the live release app was launched locally and confirmed to create a responding native window titled `AxiOwl`
- the saved window state file at `~/.codex/window_state.json` was found containing minimized/off-screen coordinates:
  - `{"x":-32000,"y":-32000,"width":176,"height":87,"isMaximized":false}`
- that state can make the desktop app appear not to launch even while the process is running
- the native window-state layer now rejects implausible minimized/off-screen coordinates and tiny minimized shell sizes during both restore and save
- a rebuilt release executable was then launched against that intentionally bad saved state and opened at a normal visible rect:
  - `104,104,1216,839`
- focused Rust coverage now includes:
  - rejecting minimized/off-screen saved window states
  - accepting normal saved window states

Additional Rust-core proof added in this pass:

- focused tests now cover workspace creation, workspace selection validation, open-path workspace switching, ignored-directory file listing, file create/write/read round trips, binary-file rejection, and outside-workspace read rejection
- those tests, combined with process and native window-state coverage, raised the Rust suite from `16` passing tests to `27`

Additional session-history fix:

- a real local Codex run was observed to write the session JSONL file immediately, while `~/.codex/session_index.jsonl` did not update for that run
- the app no longer mutates `~/.codex/session_index.jsonl` to paper over that gap
- historical sessions are now derived from the real session files as well as the session index when present
- session titles now come from real user-message/session-file content when available, instead of React-side optimistic placeholders or Rust-side synthetic session-index writes
- focused Rust coverage now includes parsing a real session summary from a session JSONL file

Additional real-session usage cleanup:

- the frontend previously showed token usage from a browser `localStorage` cache, which could display stale or invented values after a reload or session switch
- the Rust session layer now exposes real per-session usage by parsing `event_msg.payload.type = "token_count"` entries from the actual session JSONL file
- the thread footer now hides usage metrics when no real value exists instead of fabricating `0 / Unavailable`
- the session-usage parser also reads real `model_context_window` values from session telemetry when present
- focused Rust coverage now includes:
  - parsing real session usage from `token_count` events
  - falling back to `input_tokens + output_tokens` if a real `total_tokens` field is absent

Additional packaged cancel-flow proof and fix:

- the packaged desktop app was reinstalled from the latest NSIS bundle and launched with WebView remote debugging enabled
- a real packaged UI flow created workspace `ui-cancel-pass-1781491988011`
- the app then sent a real long-running prompt:
  - `Run exactly this shell command in the active workspace: cmd /c ping -n 10 127.0.0.1 >nul && echo should-not-exist>cancel_should_stop.txt`
- before the fix, the stop button could become clickable but the run stayed stuck in `Agent Working`
- root cause: the Rust wait task held the child-process mutex for the full run lifetime, which could block `cancel_run`
- the cancel path now terminates the managed process tree by PID instead of waiting on the child mutex
- after the fix, the packaged desktop evidence was:
  - `BUILD_WORKSPACE_PRESENT=false`
  - `STOP_CLICK_OK=true`
  - `STOP_HIDDEN_AFTER_CANCEL=true`
  - `CANCELLED_FILE_EXISTS=false`
  - `BODY_HAS_AGENT_WORKING=false`
  - `BODY_HAS_STOP=false`
- a verification screenshot was captured at:
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\output\playwright\cancel-flow-success.png`

Additional packaged session-history and editor proof:

- the packaged desktop app was reinstalled and exercised again through the real Tauri WebView
- a new packaged session was created whose title correctly surfaced the real user prompt instead of AGENTS/environment wrapper text:
  - `create a file named history_fix_note_3.txt in the active workspace with exactly this text: history title proof three`
- visible sidebar history after the fix no longer showed new `agents.md` / `Purpose: compact single-source...` pollution for new sessions
- packaged history-selection proof then clicked that real session title and confirmed the loaded thread body contained:
  - `history_fix_note_3.txt`
  - `history title proof three`
- verification screenshots were captured at:
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\output\playwright\session-history-title-fix-3.png`
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\output\playwright\session-history-selection-proof.png`

Additional packaged file-edit/save proof:

- a packaged UI flow created workspace `ui-acceptance-final-1781493809246`
- Codex created `acceptance_final_note.txt` inside that workspace through the packaged app
- the built-in editor then opened the file, replaced its content, and saved it
- authoritative disk verification showed:
  - file path: `C:\Users\kjhgf\AxiOwl\ui-acceptance-final-1781493809246\acceptance_final_note.txt`
  - final content: `edited final acceptance`

Additional packaged startup/open-path proof:

- the packaged app was tested with a live already-running instance plus second-launch file arguments
- a real single-instance forwarding test launched:
  - `C:\Users\kjhgf\AxiOwl\ui-forward-file\forward_target.txt`
- before the latest fix, the forwarded file opened in the editor but the sidebar workspace selector stayed stale
- root cause: the sidebar only refreshed workspace state on initial mount and user-driven workspace actions, not after native `open-path` events
- the frontend sidebar now refreshes when the app-level workspace refresh key changes, including native file-open routing
- packaged single-instance proof after the fix showed:
  - `FORWARDED_WORKSPACE=ui-forward-file`
  - `FORWARDED_PATH=\\?\C:\Users\kjhgf\AxiOwl\ui-forward-file\forward_target.txt`
  - `FORWARDED_EDITOR_TEXT=forward open proof`
- a packaged startup-file-open test then launched the app fresh with:
  - `C:\Users\kjhgf\AxiOwl\ui-startup-file\startup_target.txt`
- packaged startup proof showed:
  - `STARTUP_WORKSPACE=ui-startup-file`
  - `STARTUP_PATH=\\?\C:\Users\kjhgf\AxiOwl\ui-startup-file\startup_target.txt`
  - `STARTUP_EDITOR_TEXT=startup open proof`
- verification screenshots were captured at:
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\output\playwright\single-instance-forward-proof.png`
  - `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\output\playwright\startup-file-open-proof.png`

Additional approval-path reality check:

- direct local Codex probes under the same managed arguments showed that the recurring early stderr line `Reading additional input from stdin...` is often an initial stdin/prompt-continuation handshake, not by itself proof of a real approval checkpoint
- for harmless replies and ordinary workspace-local shell commands, Codex still completed successfully after stdin closure or null-stdin startup
- for outside-workspace writes, Codex sometimes refused the action directly instead of pausing for a user approval step
- a true end-to-end packaged approval-acceptance proof is still missing, so approval remains an explicit open MVP risk

Additional approval probe results and current Codex behavior:

- broader direct probes were run against the live local Codex CLI using the same managed arguments the desktop app uses:
  - `--ask-for-approval on-request`
  - `--sandbox workspace-write`
  - `exec ... --json --skip-git-repo-check`
- those probes covered:
  - workspace-local file deletion
  - workspace-local directory deletion
  - outside-workspace writes
  - network fetches
  - `npm install`
  - `git push`
  - launching `calc.exe`
  - setting a user environment variable
- across those probes, no reproducible `pending command + stdin wait` approval checkpoint was found
- the observed current behavior was instead:
  - harmless or permitted commands execute directly
  - some risky shell deletes are returned as `command_execution.status = "declined"` with `exit_code = -1`
  - some disallowed actions are refused or policy-blocked without an approval pause
- this means the current unresolved approval gap is not just a frontend issue; with the current Codex behavior on this machine, a reproducible real approval prompt has still not been proven
- additional direct `on-request` evidence from 2026-06-15:
  - a destructive in-workspace delete run emitted the initial prompt-stdin wait, then executed far enough to attempt the command, and finally hard-blocked with `codex_core::tools::router ... rejected: blocked by policy`
  - an outside-workspace write run emitted only the initial prompt-stdin wait and then completed without creating the outside file and without any later approval pause
  - these results strengthen the conclusion that the current local `exec --json` path is tending toward refusal or policy block rather than a user-approvable second stdin checkpoint

Additional packaged-build proof from 2026-06-15:

- the freshly built installer at `C:\Users\kjhgf\OneDrive\Documents\New project\AxiOwl-Desktop\src-tauri\target\release\bundle\nsis\AxiOwl_0.1.9_x64-setup.exe` was reinstalled silently over the existing desktop app
- the installed binary at `C:\Users\kjhgf\AppData\Local\AxiOwl\axiowl-desktop.exe` changed on disk after reinstall:
  - previous size/time: `11725824` bytes at `2026-06-14 21:26:18`
  - updated size/time: `11751424` bytes at `2026-06-14 21:51:10`
- the installed app was relaunched with WebView remote debugging and inspected live through `http://127.0.0.1:9444/json/list`
- a real packaged-app prompt then launched a managed `codex.exe` child whose command line included:
  - `--ask-for-approval on-request`
  - `--sandbox workspace-write`
  - `--json`
  - persisted non-default model/reasoning/speed arguments
- the packaged app created `C:\Users\kjhgf\AxiOwl\approval-auto-probe\package_args_proof.txt` with the exact content `package_args_proof`
- a second packaged-app delete flow showed the same intended MVP behavior:
  - the UI surfaced `Command Blocked`
  - Codex then removed the file through the workspace patch path
  - authoritative disk verification showed `C:\Users\kjhgf\AxiOwl\approval-auto-probe\package_delete_me.txt` no longer existed
- packaged quota proof was re-checked after the new run:
  - live local telemetry then reported `55` primary remaining and `46` secondary remaining
  - the live installed DOM showed `5-Hour Limit: 55% remaining` and `Weekly Quota: 46% remaining`

Additional interface-level finding:

- current official OpenAI Codex documentation describes `codex exec` as the non-interactive surface
- the same docs describe `codex app-server` as the deep-integration surface for rich clients, including authentication, conversation history, approvals, and streamed agent events
- this makes the remaining approval gap look increasingly like an interface mismatch risk in the MVP architecture, not just a frontend event-bridge bug

Additional policy-block UI proof and fix:

- packaged desktop verification against a real blocked workspace delete showed that the UI previously surfaced an ugly raw stderr router error line while the agent continued recovery work
- the Rust process bridge now filters `codex_core::tools::router` stderr duplicates because the real command result already arrives through `command_execution`
- the thread UI now renders a clearer summary when a command returns `status = "declined"`:
  - `Command Blocked: Codex policy rejected ...`
- after rebuilding the packaged app and re-running a real blocked delete flow, the live desktop UI showed:
  - the friendly `Command Blocked` message
  - no raw `codex_core::tools::router` timestamp/error line in the visible thread
  - follow-up recovery work continuing in the same run
- a real packaged file-delete flow then completed successfully after the initial shell-policy block:
  - prompt: `Delete the file delete_me.txt in the active workspace using a shell command.`
  - Codex first had the shell delete blocked by policy
  - Codex then checked the file and removed it through the patch tool path
  - the run exited back to the idle UI state
  - authoritative disk verification showed:
    - `C:\\Users\\kjhgf\\AxiOwl\\approval-auto-probe\\delete_me.txt`
    - `exists = false`

Additional prompt-argument proof for model/reasoning/speed:

- the installed desktop app was driven through a real new-thread prompt using non-default selectors:
  - model: `gpt-5.4-mini`
  - reasoning: `high`
  - speed: `fast`
- while that run was active, the real child `codex.exe` process command line was captured from Windows process inspection
- the live command line included:
  - `--model gpt-5.4-mini`
  - `-c model_reasoning_effort=\"high\"`
  - `-c service_tier=\"fast\"`
- that proves the desktop app passes the selected model/reasoning/speed values into the real Codex CLI process rather than keeping them only in React state

Additional session-resume proof:

- the new-thread run created a real historical session whose sidebar item title attribute was:
  - `019ec982-d4e9-7ee3-8cc0-246725f20968`
- a second prompt was then sent from that same active session in the installed desktop app
- while that second run was active, the real child `codex.exe` command line was captured again
- the live command line included:
  - `exec resume 019ec982-d4e9-7ee3-8cc0-246725f20968`
  - the same persisted non-default model/reasoning/speed values
- the active sidebar session remained the same UUID after the second run
- authoritative disk verification showed the resumed session effect in:
  - `C:\\Users\\kjhgf\\AxiOwl\\approval-auto-probe\\model_option_proof.txt`
  - final file content:
    - `model proof`
    - `resume proof`
- the real Codex session file for that UUID was also located at:
  - `C:\\Users\\kjhgf\\.codex\\sessions\\2026\\06\\14\\rollout-2026-06-14T21-20-55-019ec982-d4e9-7ee3-8cc0-246725f20968.jsonl`
- that session file contains:
  - `turn_context.payload.model = "gpt-5.4-mini"`
  - `collaboration_mode.settings.reasoning_effort = "high"`

Additional command-failure UI proof and cleanup:

- the installed desktop app was driven through a real failing prompt:
  - `FAIL_PROBE_1781499993003 Run exactly this shell command in the active workspace: cmd /c exit 7`
- the visible desktop thread then showed a structured failure message:
  - `Command Failed: ... exited with status 1.`
- the run returned to the idle UI state:
  - no `Agent Working`
  - no Stop button
- the Rust stderr bridge was then tightened again because the thread could still leak a duplicate diagnostic bundle from Codex router stderr
- focused Rust coverage now includes:
  - router-error line detection
  - timestamp-based diagnostic-block suppression boundaries
- after rebuilding and reinstalling, the same failing prompt path still showed the friendly `Command Failed` message and completed cleanly, without restoring the earlier raw router timestamp/error duplication

Additional live-streaming proof:

- the installed desktop app was driven through a real long-running prompt:
  - `STREAM_PROBE_1781499994004 Run exactly this shell command in the active workspace: cmd /c ping -n 8 127.0.0.1 >nul && echo stream proof>stream_probe.txt`
- during the run, before completion, the live UI showed:
  - `Agent Working`
  - the Stop button
  - an in-thread terminal block for the running command
- after the run, the same thread returned to idle state and still contained the stream/file proof text
- this is explicit packaged-runtime evidence that prompt execution updates are surfaced live in the desktop UI, not only after the process exits

Additional desktop-shortcut proof and fix:

- packaged desktop verification showed that the intended `Ctrl+B`, `Ctrl+E`, and `Ctrl+N` actions were not firing reliably through Playwright key injection against the live app
- to keep the MVP desktop behavior dependable, the app now adds an explicit desktop keydown shortcut handler in the React shell for:
  - `Ctrl/Cmd+B` -> toggle sidebar
  - `Ctrl/Cmd+E` -> toggle editor pane
  - `Ctrl/Cmd+N` -> open new-workspace form
  - `Ctrl/Cmd+S` -> trigger save
- after rebuilding the packaged app and relaunching the real release executable, live desktop verification over the WebView debug bridge showed:
  - initial container class: `app-container desktop-mode`
  - after `Ctrl+B`: `app-container desktop-mode sidebar-hidden`
  - after `Ctrl+E`: `app-container desktop-mode sidebar-hidden editor-hidden`
  - after toggling back: layout returned to the baseline class
  - after `Ctrl+N`: the real workspace-create input `#new-workspace-name` became visible
- this proves working keyboard shortcut behavior in the packaged desktop runtime even though native menu-bar click behavior still needs separate manual verification

Additional native menu-bar proof:

- the live packaged release window was inspected through the real Win32 menu API, confirming that the native menu exists with the expected top-level items:
  - `File`
  - `View`
  - `About`
- the real submenu item IDs exposed by the window at runtime were:
  - `1000` -> `New Workspace`
  - `1001` -> `Save File`
  - `1003` -> `Toggle Sidebar`
  - `1004` -> `Toggle Editor`
  - `1005` -> `About AxiOwl`
- those native menu item IDs were then invoked through `WM_COMMAND` against the real packaged desktop window, and the packaged UI responded correctly:
  - invoking `1000` opened the real workspace-create form and surfaced `#new-workspace-name`
  - invoking `1003` toggled the container into `sidebar-hidden`
  - invoking `1004` toggled the container into `editor-hidden`
  - invoking `1005` opened the About modal and showed `Version 0.1.9`
  - invoking `1003` and `1004` again returned the layout to the baseline class `app-container desktop-mode`
- this proves the actual native menu event wiring in the packaged desktop runtime, not just the React-side shortcut fallback

Additional Explorer context-menu registration proof:

- after launching the packaged release build, the app's Windows registry integration was inspected directly with `reg query`
- the expected current-user Explorer menu keys exist:
  - `HKCU\\Software\\Classes\\*\\shell\\Open in AxiOwl`
  - `HKCU\\Software\\Classes\\Directory\\shell\\Open in AxiOwl`
  - `HKCU\\Software\\Classes\\Directory\\Background\\shell\\Open in AxiOwl`
- each key currently contains:
  - label `Open in AxiOwl`
  - icon pointing at the packaged release executable
  - command values using:
    - `\"...\\axiowl-desktop.exe\" \"%1\"` for files/directories
    - `\"...\\axiowl-desktop.exe\" \"%V\"` for directory background
- combined with the already-proven startup/open-path and single-instance forwarding behavior, this is strong evidence that the packaged desktop build has a working Explorer-integration registration path

Additional installed-app packaging and relaunch proof:

- the freshly built NSIS installer was run again against the local machine
- the installed executable at:
  - `C:\\Users\\kjhgf\\AppData\\Local\\AxiOwl\\axiowl-desktop.exe`
  was updated and then launched directly with WebView debugging enabled
- after launching the installed executable, the Explorer registration key updated from the repo-local release build path to the installed app path:
  - `HKCU\\Software\\Classes\\*\\shell\\Open in AxiOwl\\command`
  - value became:
    - `\"C:\\Users\\kjhgf\\AppData\\Local\\AxiOwl\\axiowl-desktop.exe\" \"%1\"`
- this confirms that the installed app reclaims context-menu ownership correctly when it is the packaged build the user actually runs

Additional installed-app open-path forwarding proof:

- with the installed app already running, a second launch was started against:
  - `C:\\Users\\kjhgf\\AxiOwl\\installed-forward-file\\installed_forward_target.txt`
- the already-running installed instance then switched to:
  - workspace `installed-forward-file`
  - editor file `installed_forward_target.txt`
  - editor content `installed forward proof`
- this extends the earlier single-instance/open-path proof from the repo-local packaged release executable to the installed desktop app path as well

Additional isolated-auth verification and fix:

- packaged desktop verification against a temporary empty profile initially failed to isolate auth state because Windows home-directory resolution on this machine did not follow a simple profile-env swap
- the Rust app state now supports an explicit `AXIOWL_HOME_DIR` override for deterministic isolated launches and testability
- focused Rust coverage now includes preferring `AXIOWL_HOME_DIR` when it is set
- after rebuilding the packaged app and launching the real release executable with:
  - `AXIOWL_HOME_DIR=C:\\Users\\kjhgf\\AppData\\Local\\Temp\\axiowl-auth-missing-profile`
- the live desktop UI showed the unauthenticated login surface with:
  - `Welcome to AxiOwl`
  - `Sign In`
  - `Uses Codex device authentication`
- that isolated launch showed no authenticated sidebar shell, confirming that a missing `auth.json` path now cleanly renders the login screen in the real desktop runtime

Additional authenticated-shell proof:

- after restoring the normal packaged app launch, the live desktop UI again showed the authenticated shell instead of the login screen
- the sidebar identity area showed the real account values:
  - `Morgan Egging`
  - `morganross@rossmorr.com`
- this confirms the active app is no longer falling back to a synthetic generic identity label for the authenticated state

## Work Remaining For MVP

### Runtime Proof

- re-run the packaged desktop app after the latest cleanup pass and confirm the newest auth/login-error behavior in the real Tauri WebView

### Auth

- verify device login flow returns usable URL/code
- verify logout updates the UI correctly
- verify the packaged UI recovers cleanly after restoring auth during the scripted login/logout acceptance flow
- verify a full successful external-browser sign-in round-trip after the current Codex device-auth rate limit clears

### Workspace / Files

- verify workspace listing
- verify workspace creation
- verify workspace switching
- verify file listing
- verify file open
- verify file edit and save
- verify invalid path rejection from real UI actions

### Sessions

- verify historical session list from real local Codex data
- verify reading session history
- verify session switching with no stale state leakage

### Prompt Execution

- verify new-session prompt execution
- verify session resume execution
- verify streaming output appears live in the UI
- verify model/reasoning/speed selection is passed correctly
- verify error output is visible when Codex fails
- verify file-change events surface correctly in the editor flow

### Approval / Cancellation

- verify a real approval-requesting Codex run if the local Codex version exposes one under the managed MVP arguments
- verify approval is sent only to the intended `runId`
- verify stop cancels the intended run
- verify run cleanup after cancel/exit

### Native Desktop

- verify explicit minimize behavior in the packaged app
- verify installed-app Explorer click flow end to end if needed beyond registry-plus-forwarding proof

## Known Gaps And Risks

- the codebase has not yet been re-proven end to end after the latest quota/auth/file-open cleanup pass
- the codebase has not yet been re-proven end to end after the latest auth-expiry and login-error normalization cleanup pass
- approval is still one of the highest-risk flows because it depends on real Codex CLI stdin behavior
- current local Codex behavior under the MVP-managed arguments appears to prefer direct execution, refusal, or `declined` policy blocks rather than a reproducible approval pause; a true approval checkpoint is still unproven
- Codex shell execution on Windows may report wrapper-level exit codes (for example `cmd /c exit 7` surfaced to the UI as exit status `1` through the PowerShell wrapper), so the desktop app currently reflects Codex's observed wrapper result rather than reconstructing the inner shell exit code
- quota now uses real local Codex app-server telemetry and preserves multiple buckets; that sidebar presentation is now proven on the fresh packaged build
- file-change reporting is still MVP-simple and does not provide a true diff renderer
- keyboard shortcut behavior, native menu event wiring, installed-path context-menu ownership, installed-app open-path forwarding, and live maximize/fullscreen window-command behavior are now all proven; the remaining desktop uncertainty is mainly explicit minimize behavior and whether an actual Explorer click needs separate manual proof beyond the registry-plus-forwarding evidence
- the remaining auth uncertainty is no longer stale-shell behavior; it is the external Codex device-login round-trip under real service conditions, including transient `429 Too Many Requests` responses during device-code creation
- the status doc that existed before this update overstated some completed areas and described removed fallback behavior; this version corrects that

## Current Assessment

The project is no longer "Rust running the old app" in the active runtime path. It is a Tauri/Rust desktop app with a preserved React UI and a partially completed MVP backend migration.

The main remaining gap is no longer basic scaffolding. The remaining gap is proving and fixing the real runtime flows until the app satisfies the planning-doc MVP requirements under actual desktop use.

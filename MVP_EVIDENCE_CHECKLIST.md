# AxiOwl / Qexow MVP Evidence Checklist

Last updated: 2026-06-15.

Purpose:

- translate the planning-doc MVP into auditable requirements
- show what is currently proven by authoritative evidence
- show what is only partially proven or still missing proof
- make the remaining heavy verification pass precise instead of guess-based

Evidence grading used here:

- `Proven`: current evidence directly demonstrates the requirement
- `Partial`: some evidence exists, but it does not fully prove the requirement scope
- `Missing`: no current authoritative proof was found

Primary evidence sources used:

- [MVP_PROGRESS_STATUS.md](C:/Users/kjhgf/OneDrive/Documents/New%20project/AxiOwl-Desktop/MVP_PROGRESS_STATUS.md)
- [task.md](C:/Users/kjhgf/.gemini/antigravity/brain/084d03f3-8012-4f99-9479-82f5a5845566/task.md)
- [implementation_plan.md](C:/Users/kjhgf/.gemini/antigravity/brain/084d03f3-8012-4f99-9479-82f5a5845566/implementation_plan.md)
- [migration_details.md](C:/Users/kjhgf/.gemini/antigravity/brain/084d03f3-8012-4f99-9479-82f5a5845566/migration_details.md)

## 1. Desktop Shell

| Requirement | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| Tauri v2 app scaffold exists and runs as the active runtime path | Proven | `src-tauri/` exists; Electron/Express runtime removed from active path; status report says Tauri is the active MVP runtime | none |
| Frontend is routed through Tauri adapter rather than HTTP/Electron fallback | Proven | `src/lib/desktopApi.js` is Tauri-only; status report records removed HTTP/Electron fallback behavior | none |
| Native menu actions work | Proven | status report records live packaged Win32 menu invocation proof for `New Workspace`, `Save File`, `Toggle Sidebar`, `Toggle Editor`, `About AxiOwl` | none |
| Native maximize and fullscreen commands work | Proven | status report records live installed-app maximize/fullscreen command verification | none |
| Native minimize command works | Missing | no direct current proof recorded | real packaged minimize verification |
| Single-instance forwarding works | Proven | status report records startup-file-open and second-instance forwarding proof, including installed-app path forwarding | none |
| Explorer context-menu registration exists | Proven | registry keys and command values are recorded in status report | none |
| Explorer right-click invocation itself works end to end | Partial | registration plus forwarding proof is strong; no direct current click proof recorded | real Explorer click verification if strict end-to-end proof is required |

## 2. Auth

| Requirement | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| Missing/invalid auth renders unauthenticated login screen | Proven | status report records isolated launch with `AXIOWL_HOME_DIR` override and missing auth profile showing login screen | none |
| Authenticated state renders real account identity | Proven | status report records real sidebar identity values after restoring normal launch | none |
| Login start surfaces real device-auth URL/code or real failure | Proven | Rust login path parses URL/code; status report records real `429 Too Many Requests` surfaced as concrete login-start failure | none |
| Windows browser handoff uses native API, not shell helper | Proven | source and tests show `ShellExecuteW`; regression test exists | none |
| Logout failure is loud | Proven | Rust logout now returns real failure; app shell now surfaces logout failure visibly | none |
| Logout success updates UI correctly | Partial | code path exists and prior runtime work suggests it; no latest end-to-end proof after newest cleanup pass | real packaged logout verification |
| Full successful external-browser sign-in round-trip works after latest cleanup | Missing | current blocking evidence is transient `429 Too Many Requests`; no recent successful round-trip proof after latest changes | real login round-trip after service allows device-code issuance |

## 3. Workspace / Files

| Requirement | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| Workspace listing works | Proven | packaged UI acceptance previously passed workspace listing/refresh; user-facing errors now tightened | none, though a fresh rerun would strengthen recency |
| Workspace creation works | Proven | packaged UI acceptance and native menu proof recorded | none |
| Workspace switching works | Partial | source exists and UX is wired; indirect evidence from startup/open-path/workspace create; no explicit recent packaged switch proof called out by name | explicit packaged workspace-switch proof |
| File listing works | Proven | packaged UI acceptance and editor file-list proof recorded | none |
| File open works | Proven | packaged UI acceptance, startup-file-open proof, installed forwarded-open proof | none |
| File edit/save/reopen works | Proven | packaged UI acceptance records edit/save/reopen flow | none |
| File refresh after Codex change works | Partial | code path and file-change handling exist; packaged delete/patch behavior suggests it; no direct latest explicit proof focused on refresh display after newest cleanup | targeted file-change refresh proof |
| Invalid path rejection is enforced | Partial | Rust path validation/tests exist; no explicit current packaged UI proof for rejected invalid path action | real invalid-path UI action proof |
| File operations remain within workspace boundaries | Proven at source level, Partial at runtime | canonical path / workspace-root checks and unit tests exist | direct runtime rejection proof would strengthen this |

## 4. Sessions / History

| Requirement | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| Historical session list loads from real Codex data | Proven | packaged UI acceptance previously passed historical session replay; session list parsing tests exist | none |
| Session history read works | Proven | packaged UI acceptance previously passed historical session replay; thread history loading is wired | none |
| Session switching avoids stale state leakage | Partial | new-thread reset behavior and thread-state cleanup were fixed; no latest explicit packaged proof dedicated to cross-session stale-state leakage after newest cleanup | targeted session-switch proof |
| Background running-session polling works | Partial | code path exists; latest cleanup adds visible banner on failure; no explicit current proof that polling keeps UI consistent under latest changes | targeted background-running session proof |
| Session usage/token usage loads from real session data | Proven | Rust session parser tests exist; status report records authoritative token usage loading from real Codex session files | none |

## 5. Prompt Execution / Streaming

| Requirement | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| New-session prompt execution works | Proven | packaged runtime proof shows new-thread prompt success and assistant reply rendering | none |
| Existing-session resume execution works | Proven | status report records live `exec resume <uuid>` command-line capture and persisted file/session proof | none |
| Streaming output appears live in UI | Proven | status report records explicit live-streaming proof with in-thread terminal block while run was still active | none |
| Model/reasoning/speed are passed to Codex | Proven | status report records live command-line capture proving selected model/reasoning/speed arguments | none |
| Model catalog loads from real Codex models | Proven | Rust and frontend use `codex debug models`; packaged and smoke evidence already recorded | none |
| Prompt errors are visible in UI | Proven | status report records friendly `Command Failed` and `Command Blocked` rendering; frontend error hardening exists | none |
| File-change events surface in editor flow | Partial | code exists and status report references auto-open on file changes; no dedicated latest proof focused on visual editor refresh under newest cleanup | targeted file-change event proof |

## 6. Approval / Cancellation

| Requirement | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| Cancel stops the intended run | Proven | packaged acceptance previously passed cancel flow; long-running command stop proof exists | none |
| Run cleanup after cancel/exit works | Proven | run registry cleanup exists; prior packaged stop proof showed UI returned to idle state | none |
| Approval messages are routed to intended runId | Partial | architecture and code support per-run approval; no direct fresh proof specifically isolating competing runs | targeted multi-run or per-run approval proof |
| Real approval-requesting run exists and can be accepted end to end | Missing | current status explicitly says true approval-acceptance proof is still missing and local Codex behavior trends toward refusal/decline/policy block | real approval-checkpoint proof if Codex version exposes one |

## 7. Native Desktop Packaging / Install

| Requirement | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| `npm run tauri:build` produces working bundle | Proven | multiple prior successful build records and NSIS installer outputs recorded | none |
| Installed app relaunches and runs | Proven | status report records reinstall, installed binary path update, and relaunched app proof | none |
| Installed app owns context-menu registration | Proven | status report records registry path updated to installed app executable | none |
| Installed app open-path forwarding works | Proven | status report records installed-app forward proof | none |

## 8. Clean-Room / Native Runtime Posture

| Requirement | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| Active runtime no longer depends on Express server | Proven | status report and source cleanup say Express removed from active runtime | none |
| Frontend no longer uses active HTTP API fallback | Proven | adapter is Tauri-only | none |
| Windows browser launch no longer uses `cmd /c start` | Proven | source + tests | none |
| Runtime discovery no longer uses `where.exe` | Proven | source + tests | none |
| Windows cancellation no longer uses `taskkill` | Proven | source + tests | none |
| Codex runtime discovery is aggressive and inspectable | Proven | runtime resolver, diagnostics modal, status report, and tests exist | none |

## 9. Verification Gates From Planning Docs

| Gate | Status | Current Evidence | Missing Proof / Next Check |
| --- | --- | --- | --- |
| `cargo check` | Proven | recorded as passed in status report | none |
| `cargo test` | Proven | currently passes with 52 tests | none |
| `npm run build` | Proven | currently passes | none |
| `npm run tauri:build` | Proven historically, Partial for current latest source-only pass | prior status records multiple successful builds; latest source-only pass has not rerun heavy bundle step | rerun when heavy verification is allowed |
| full packaged desktop acceptance after latest cleanup wave | Missing | latest status still says a full packaged rerun after the aggressive/runtime cleanup remains outstanding | controlled heavy packaged rerun |

## 10. Highest-Value Remaining Proof Gaps

These are the current blockers between "substantial progress" and "fully working tested MVP":

1. Successful real external-browser login round-trip after current `429` device-auth limitation clears.
2. Fresh packaged acceptance rerun after the latest cleanup sequence, not just earlier packaged proof.
3. Explicit packaged minimize verification.
4. Direct Explorer right-click invocation proof if stricter end-to-end evidence is required beyond registry + forwarding proof.
5. True approval-acceptance proof if the local Codex interface/version exposes a real approval checkpoint.

## 11. Current Assessment

From current evidence, the MVP is:

- `Proven` in large parts of the desktop shell, workspace/files, sessions, prompt execution, packaging, and native runtime posture
- `Partial` in a smaller set of flows where source and older runtime evidence are strong but the latest full rerun is still missing
- `Missing` in a narrow set of high-value runtime proofs, especially:
  - fresh login round-trip
  - fresh packaged rerun after latest cleanup
  - explicit minimize proof
  - real approval-acceptance proof

This means the project is not blocked by missing architecture anymore.
It is mainly gated by a precise final verification pass and a small number of still-unproven runtime behaviors.

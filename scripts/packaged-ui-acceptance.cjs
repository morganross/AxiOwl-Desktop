const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const cdpUrl = process.argv[2] || "http://127.0.0.1:9444";
const workspaceRoot = path.join(process.env.USERPROFILE, "AxiOwl");
const installedExePath = path.join(process.env.LOCALAPPDATA, "AxiOwl", "axiowl-desktop.exe");
const codexSessionsRoot = path.join(process.env.USERPROFILE, ".codex", "sessions");
const workspaceName = `ui-packaged-smoke-${Date.now()}`;
const workspaceDir = path.join(workspaceRoot, workspaceName);
const editFile = path.join(workspaceDir, "edit_target.txt");
const forwardFile = path.join(workspaceDir, "forward_target.txt");
const approvalDir = path.join(workspaceDir, "approval-delete");
const cancelFile = path.join(workspaceDir, "cancel_should_not_exist.txt");
const updatedContent = `updated-${Date.now()}`;
const forwardContent = `forwarded-${Date.now()}`;
const historyMarker = `HIST-${Date.now()}`;
const historyPrompt = `Reply with exactly ${historyMarker} and nothing else.`;
const approvalHintText = 'Approval requested above. Type "Approve" to continue.';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(check, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function logStep(message) {
  console.log(`STEP ${message}`);
}

async function focusNewThread(page) {
  await page.locator(".sidebar .item").first().click();
  await waitForCondition(async () => {
    const item = page.locator(".sidebar .item").first();
    const className = await item.getAttribute("class").catch(() => "");
    return typeof className === "string" && className.includes("active");
  }, 10000, "new thread selection");
  await waitForText(page, "How can I help you today?", 10000, "new thread welcome state");
}

async function sendChat(page, text) {
  const input = page.getByLabel("Message AxiOwl");
  await input.fill(text);
  await page.getByTitle("Send message").click();
}

async function approvalPending(page) {
  const text = await page.locator(".chat-hint").first().innerText().catch(() => "");
  return text.includes(approvalHintText);
}

async function approvePendingAction(page) {
  await waitForCondition(() => approvalPending(page), 120000, "approval request");
  await sendChat(page, "Approve");
}

async function waitForApprovalOrRunning(page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const actionRequired = await approvalPending(page);
    if (actionRequired) {
      return "approval";
    }

    const stopVisible = await page
      .locator(".stop-run-btn")
      .first()
      .isVisible()
      .catch(() => false);
    if (stopVisible) {
      return "running";
    }

    await sleep(250);
  }

  throw new Error("Timed out waiting for approval request or active run controls");
}

async function waitForNotWorking(page) {
  await waitForCondition(async () => {
    const stopButton = page.locator(".stop-run-btn");
    return (await stopButton.count()) === 0 || !(await stopButton.first().isVisible().catch(() => false));
  }, 30000, "the run to stop");
}

async function waitForIdle(page) {
  await waitForCondition(async () => {
    const stopButton = page.locator(".stop-run-btn");
    const stopVisible =
      (await stopButton.count()) > 0 && (await stopButton.first().isVisible().catch(() => false));
    if (stopVisible) {
      return false;
    }
    return !(await approvalPending(page));
  }, 30000, "the run to become idle");
}

async function keepApprovingUntil(page, checkComplete, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await checkComplete()) {
      return;
    }
    if (await approvalPending(page)) {
      await sendChat(page, "Approve");
      await page.waitForTimeout(750);
      continue;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForText(page, text, timeoutMs, label) {
  await waitForCondition(
    async () => page.locator(`text=${text}`).first().isVisible().catch(() => false),
    timeoutMs,
    label,
  );
}

async function waitForAppContainerClass(page, className, shouldExist, timeoutMs, label) {
  await waitForCondition(async () => {
    const classes = await page.locator(".app-container").first().getAttribute("class").catch(() => "");
    const hasClass = typeof classes === "string" && classes.includes(className);
    return shouldExist ? hasClass : !hasClass;
  }, timeoutMs, label);
}

async function waitForSessionSidebarEntry(page, marker, timeoutMs, label) {
  await waitForCondition(async () => {
    const items = await page.locator(".sidebar .item").allInnerTexts().catch(() => []);
    return items.some((item) => item.includes(marker));
  }, timeoutMs, label);
}

async function openHistoricalSession(page, sessionUuid) {
  await page.locator(`.sidebar .item[title="${sessionUuid}"]`).first().click();
  await waitForCondition(async () => {
    const item = page.locator(`.sidebar .item[title="${sessionUuid}"]`).first();
    const className = await item.getAttribute("class").catch(() => "");
    return typeof className === "string" && className.includes("active");
  }, 10000, "historical session selection");
}

function forwardFileToRunningApp(targetPath) {
  const child = spawn(installedExePath, [targetPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function collectSessionFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function extractSessionUuidFromPath(sessionPath) {
  const match = sessionPath.match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
  return match ? match[1] : null;
}

function findSessionUuidContaining(marker) {
  const files = collectSessionFiles(codexSessionsRoot)
    .map((sessionPath) => ({
      sessionPath,
      mtimeMs: fs.statSync(sessionPath).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files.slice(0, 25)) {
    const content = fs.readFileSync(file.sessionPath, "utf8");
    if (!content.includes(marker)) {
      continue;
    }
    const uuid = extractSessionUuidFromPath(file.sessionPath);
    if (uuid) {
      return uuid;
    }
  }

  return null;
}

async function main() {
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.rmSync(workspaceDir, { recursive: true, force: true });

  logStep(`workspace=${workspaceDir}`);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  logStep("quota visibility");
  await waitForText(page, "Quota Status", 15000, "quota section");
  await waitForCondition(
    async () => {
      const labels = await page.locator(".quota-meter-pct").allInnerTexts().catch(() => []);
      return labels.some((label) => /% remaining/i.test(label));
    },
    20000,
    "live quota percentages",
  );

  logStep("native shortcuts");
  await page.locator("body").click();
  await page.keyboard.press("Control+B");
  await waitForAppContainerClass(page, "sidebar-hidden", true, 10000, "sidebar hide shortcut");
  await page.keyboard.press("Control+B");
  await waitForAppContainerClass(page, "sidebar-hidden", false, 10000, "sidebar show shortcut");
  await page.keyboard.press("Control+E");
  await waitForAppContainerClass(page, "editor-hidden", true, 10000, "editor hide shortcut");
  await page.keyboard.press("Control+E");
  await waitForAppContainerClass(page, "editor-hidden", false, 10000, "editor show shortcut");
  await page.keyboard.press("Control+N");
  await page.locator("#new-workspace-name").waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await waitForCondition(
    async () => !(await page.locator("#new-workspace-name").first().isVisible().catch(() => false)),
    10000,
    "workspace dialog close",
  );

  const workspaceSelect = page.locator("select.workspace-select");
  const initialWorkspace = await workspaceSelect.inputValue();

  logStep("create workspace through UI");
  await page.locator(".workspace-add-btn").click();
  await page.locator("#new-workspace-name").fill(workspaceName);
  await page.locator(".workspace-save-btn").click();
  await waitForCondition(
    async () => (await workspaceSelect.inputValue()) === workspaceName,
    15000,
    "new workspace selection",
  );

  fs.writeFileSync(editFile, "original-content\n", "utf8");
  fs.writeFileSync(forwardFile, `${forwardContent}\n`, "utf8");
  fs.rmSync(approvalDir, { recursive: true, force: true });
  fs.mkdirSync(approvalDir, { recursive: true });
  fs.writeFileSync(path.join(approvalDir, "proof.txt"), "delete me\n", "utf8");
  fs.rmSync(cancelFile, { force: true });

  logStep("refresh workspace file list");
  const allOptions = await workspaceSelect.locator("option").evaluateAll((options) =>
    options.map((option) => option.value),
  );
  const alternateWorkspace = allOptions.find((value) => value && value !== workspaceName);
  if (alternateWorkspace) {
    await workspaceSelect.selectOption(alternateWorkspace);
    await waitForCondition(
      async () => (await workspaceSelect.inputValue()) === alternateWorkspace,
      10000,
      "alternate workspace selection",
    );
  } else if (initialWorkspace && initialWorkspace !== workspaceName) {
    await workspaceSelect.selectOption(initialWorkspace);
  }
  await workspaceSelect.selectOption(workspaceName);
  await waitForCondition(
    async () => (await workspaceSelect.inputValue()) === workspaceName,
    10000,
    "workspace reselection",
  );
  await page.locator(".editor-file-item.file", { hasText: "edit_target.txt" }).waitFor({ timeout: 20000 });

  logStep("open and edit file");
  await page.locator(".editor-file-item.file", { hasText: "edit_target.txt" }).click();
  await page.locator(".editor-filepath", { hasText: "edit_target.txt" }).waitFor({ timeout: 10000 });
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(updatedContent);
  await page.keyboard.press("Control+S");
  await waitForCondition(
    async () => fs.existsSync(editFile) && fs.readFileSync(editFile, "utf8").includes(updatedContent),
    10000,
    "saved file content",
  );

  logStep("close and reopen file");
  await page.locator(".tab-close-btn").click();
  await page.locator(".editor-file-item.file", { hasText: "edit_target.txt" }).click();
  await page.locator(".editor-filepath", { hasText: "edit_target.txt" }).waitFor({ timeout: 10000 });
  await waitForCondition(
    async () => (await page.locator(".cm-content").first().innerText()).includes(updatedContent),
    10000,
    "reopened editor content",
  );

  logStep("approval flow");
  await focusNewThread(page);
  await sendChat(
    page,
    "Run exactly this shell command in the active workspace: Remove-Item -LiteralPath .\\approval-delete -Recurse -Force",
  );
  await keepApprovingUntil(
    page,
    async () => !fs.existsSync(approvalDir),
    45000,
    "approved delete to finish",
  );
  await waitForNotWorking(page);
  await waitForIdle(page);

  logStep("cancel flow");
  await focusNewThread(page);
  await sendChat(
    page,
    "Run exactly this shell command in the active workspace: Start-Sleep -Seconds 60; Set-Content -LiteralPath .\\cancel_should_not_exist.txt -Value cancelled",
  );
  await keepApprovingUntil(
    page,
    async () => page.locator(".stop-run-btn").first().isVisible().catch(() => false),
    45000,
    "cancel run controls",
  );
  await page.locator(".stop-run-btn").waitFor({ timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.locator(".stop-run-btn").click();
  await waitForNotWorking(page);
  await page.waitForTimeout(3000);
  if (fs.existsSync(cancelFile)) {
    throw new Error(`Cancel verification failed; file was created at ${cancelFile}`);
  }

  logStep("historical session replay");
  await focusNewThread(page);
  await sendChat(page, historyPrompt);
  await waitForNotWorking(page);
  await waitForText(page, historyMarker, 30000, "historical session assistant reply");
  let historySessionUuid = null;
  await waitForCondition(() => {
    historySessionUuid = findSessionUuidContaining(historyMarker);
    return Boolean(historySessionUuid);
  }, 20000, "historical session file");
  await waitForCondition(
    async () => page.locator(`.sidebar .item[title="${historySessionUuid}"]`).first().isVisible().catch(() => false),
    20000,
    "historical session sidebar entry",
  );
  await focusNewThread(page);
  await openHistoricalSession(page, historySessionUuid);
  await waitForText(page, historyMarker, 15000, "historical session replay");

  logStep("open-path forwarding");
  await page.locator(".tab-close-btn").click();
  forwardFileToRunningApp(forwardFile);
  await page.locator(".editor-filepath", { hasText: "forward_target.txt" }).waitFor({ timeout: 15000 });
  await waitForCondition(
    async () => (await page.locator(".cm-content").first().innerText()).includes(forwardContent),
    15000,
    "forwarded file content",
  );

  console.log(`RESULT workspace=${workspaceDir}`);
  console.log(`RESULT editedFile=${editFile}`);
  console.log(`RESULT approvalDeleted=${!fs.existsSync(approvalDir)}`);
  console.log(`RESULT cancelFileExists=${fs.existsSync(cancelFile)}`);
  console.log(`RESULT historicalSessionMarker=${historyMarker}`);
  console.log(`RESULT historicalSessionUuid=${historySessionUuid}`);
  console.log(`RESULT forwardFile=${forwardFile}`);

  await browser.close();
}

main().catch((error) => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exit(1);
});

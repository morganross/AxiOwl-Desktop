const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const cdpUrl = process.argv[2] || "http://127.0.0.1:9444";
const authPath = path.join(process.env.USERPROFILE, ".codex", "auth.json");
const backupPath = path.join(process.env.USERPROFILE, ".codex", "auth.json.axiowl-auth-acceptance-backup");

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

async function waitForDeviceInstructionsOrError(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const instructionsVisible = await page
      .locator("text=Complete sign-in in your browser")
      .first()
      .isVisible()
      .catch(() => false);
    if (instructionsVisible) {
      return { kind: "instructions" };
    }

    const errorText = await page
      .locator(".login-error")
      .first()
      .innerText()
      .catch(() => "");
    if (errorText.trim()) {
      return { kind: "error", message: errorText.trim() };
    }

    await sleep(250);
  }

  throw new Error("Timed out waiting for device auth instructions or login error");
}

function backupAuth() {
  if (!fs.existsSync(authPath)) {
    throw new Error(`Auth file not found at ${authPath}`);
  }
  fs.copyFileSync(authPath, backupPath);
}

function restoreAuth() {
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, authPath);
  }
}

async function main() {
  backupAuth();
  let browser;

  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const page = browser.contexts()[0].pages()[0];
    await page.bringToFront();

    await waitForCondition(
      async () => page.locator("text=Quota Status").first().isVisible().catch(() => false),
      15000,
      "authenticated app shell",
    );

    await page.getByRole("button", { name: "Logout" }).click();
    await waitForCondition(
      async () => page.locator("text=Welcome to AxiOwl").first().isVisible().catch(() => false),
      15000,
      "login screen",
    );

    await page.getByRole("button", { name: /Sign In/i }).click();
    const loginStart = await waitForDeviceInstructionsOrError(page, 20000);
    if (loginStart.kind === "error") {
      throw new Error(`Login start failed: ${loginStart.message}`);
    }

    const deviceUrl = await page.locator("a[href*='auth.openai.com']").first().innerText();
    const deviceCode = (await page.locator(".device-code-box").first().innerText()).trim();

    restoreAuth();

    await waitForCondition(
      async () => page.locator("text=Quota Status").first().isVisible().catch(() => false),
      20000,
      "authenticated app shell after auth restore",
    );

    console.log(`RESULT deviceUrl=${deviceUrl}`);
    console.log(`RESULT deviceCode=${deviceCode}`);
    console.log(`RESULT restoredAuth=true`);
  } finally {
    restoreAuth();
    if (browser) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exit(1);
});

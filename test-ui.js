import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACTS = 'C:\\Users\\kjhgf\\.gemini\\antigravity\\brain\\084d03f3-8012-4f99-9479-82f5a5845566';

(async () => {
  const helloWorldPath = path.join(process.cwd(), 'hello_world.md');
  if (fs.existsSync(helloWorldPath)) {
    console.log('[Cleanup] Deleting existing hello_world.md to ensure Codex produces a fresh diff...');
    fs.unlinkSync(helloWorldPath);
  }
  console.log('=== Playwright UI Test: Chat Input + Session Navigation ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark'
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

  try {
    // ── 1. Load app ──────────────────────────────────────────────────────────
    console.log('\n[1] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000');

    // Wait for the new textarea-based input
    console.log('[1] Waiting for chat textarea...');
    await page.waitForSelector('.chat-textarea', { timeout: 15000 });
    console.log('[1] ✓ Chat textarea found.');

    // ── 2. Screenshot initial state ──────────────────────────────────────────
    await page.screenshot({ path: path.join(ARTIFACTS, 'initial_state.png') });
    console.log('[2] ✓ Initial state screenshot saved.');

    // ── 3. Historical session navigation ─────────────────────────────────────
    console.log('\n[3] Checking for historical sessions in sidebar...');
    await page.waitForSelector('.section:has-text("Historical Sessions")', { timeout: 10000 });

    const sessionItems = page.locator('.section:has-text("Historical Sessions") .item-list .item:not([style*="pointer-events: none"])');
    const count = await sessionItems.count();
    console.log(`[3] Found ${count} historical sessions.`);

    if (count > 15) {
      throw new Error(`FAIL: Sidebar shows ${count} sessions (max 15).`);
    }

    if (count > 0) {
      const firstText = (await sessionItems.nth(0).innerText()).trim();
      console.log(`[3] Clicking first session: "${firstText.substring(0, 40)}..."`);
      await sessionItems.nth(0).click();

      // Header should update to match session title
      await page.waitForFunction((expected) => {
        const h = document.querySelector('.thread-header h2');
        return h && h.innerText.trim() === expected.trim();
      }, firstText, { timeout: 10000 });
      console.log('[3] ✓ Thread header updated to session title.');

      await page.screenshot({ path: path.join(ARTIFACTS, 'historical_session_loaded.png') });

      // Navigate back to New Thread
      await page.locator('.section:has-text("Agents") .item:has-text("New Thread")').click();
      await page.waitForFunction(() => {
        const h = document.querySelector('.thread-header h2');
        return h && h.innerText.trim() === 'New Thread';
      }, { timeout: 10000 });
      console.log('[3] ✓ Back to New Thread.');
    } else {
      console.log('[3] No historical sessions, skipping navigation test.');
    }

    // ── 4. Verify input UI ───────────────────────────────────────────────────
    console.log('\n[4] Verifying chat input UI...');
    const textarea = page.locator('.chat-textarea');
    await textarea.waitFor({ timeout: 5000 });

    // Verify send button is present
    await page.waitForSelector('.send-btn', { timeout: 5000 });
    console.log('[4] ✓ Send button found.');

    // ── 5. Model selector ────────────────────────────────────────────────────
    console.log('\n[5] Checking model selector...');
    await page.waitForSelector('.model-selector', { timeout: 5000 });
    await page.locator('.model-selector').selectOption('gpt-5.4-mini');
    console.log('[5] ✓ Model selector works.');

    // ── 5.5. Workspace selection and creation ──────────────────────────────────
    console.log('\n[5.5] Checking workspace selector and creation...');
    await page.waitForSelector('.workspace-select', { timeout: 5000 });
    
    // Check available workspaces in dropdown
    const options = await page.locator('.workspace-select option').evaluateAll(
      opts => opts.map(o => o.value)
    );
    console.log(`[5.5] Found workspaces: ${JSON.stringify(options)}`);
    
    // Click '+' button to open creation form
    await page.click('.workspace-add-btn');
    await page.waitForSelector('.workspace-input', { timeout: 3000 });
    console.log('[5.5] ✓ Workspace creation form opened.');
    
    // Fill in new workspace name
    const newWsName = 'test-pw-workspace';
    await page.fill('.workspace-input', newWsName);
    await page.click('.workspace-save-btn');
    
    // Wait for the dropdown to update and select the new workspace
    await page.waitForFunction((expected) => {
      const select = document.querySelector('.workspace-select');
      return select && select.value === expected;
    }, newWsName, { timeout: 5000 });
    console.log(`[5.5] ✓ Workspace "${newWsName}" successfully created and selected.`);
    
    // Select "qexow-app" back to proceed with the main test in the correct folder
    if (options.includes('qexow-app')) {
      await page.locator('.workspace-select').selectOption('qexow-app');
      await page.waitForFunction(() => {
        const select = document.querySelector('.workspace-select');
        return select && select.value === 'qexow-app';
      }, { timeout: 5000 });
      console.log('[5.5] ✓ Switched back to "qexow-app" workspace.');
    }

    // ── 6. Send a real prompt via the new textarea ───────────────────────────
    const prompt = "create a new markdown file named hello_world.md with contents '# Hello World' inside the workspace";
    console.log(`\n[6] Sending prompt: "${prompt.substring(0, 50)}..."`);
    await textarea.fill(prompt);
    
    // Verify send button becomes active when text is entered
    const sendBtn = page.locator('.send-btn');
    const hasSendActive = await sendBtn.evaluate(el => el.classList.contains('active'));
    if (hasSendActive) {
      console.log('[6] ✓ Send button is active with text entered.');
    }

    // Send via Enter key (Shift+Enter would insert newline, plain Enter sends)
    await textarea.press('Enter');

    // ── 7. New session optimistic sidebar entry ──────────────────────────────
    // thread.started from Codex can take 10-20s (model loading + API call).
    // We wait up to 20s for the sidebar to show the new session optimistically.
    console.log('\n[7] Waiting for optimistic sidebar entry (≤20s)...');
    await page.waitForFunction(() => {
      const sections = Array.from(document.querySelectorAll('.section'));
      const histSection = sections.find(s => {
        const titleEl = s.querySelector('.section-title');
        return titleEl && (titleEl.textContent || titleEl.innerText || '').includes('Historical Sessions');
      });
      if (!histSection) {
        console.log('[Test Context] histSection not found');
        return false;
      }
      const items = Array.from(histSection.querySelectorAll('.item')).filter(
        el => !el.style.pointerEvents
      );
      if (items.length === 0) {
        console.log('[Test Context] No items found in histSection');
        return false;
      }
      const firstText = (items[0].textContent || items[0].innerText || '').trim().toLowerCase();
      console.log('[Test Context] first item text:', firstText);
      return (
        firstText.includes('create a new') ||
        firstText.includes('hello') ||
        firstText.includes('markdown')
      );
    }, undefined, { timeout: 20000 });
    console.log('[7] ✓ New session appeared in sidebar!');

    // ── 8. Wait for Codex to complete and diff to appear ────────────────────
    console.log('\n[8] Waiting for file to open in editor pane (≤90s)...');
    await page.waitForFunction(() => {
      const ep = document.querySelector('.editor-pane');
      if (!ep) return false;
      const filepath = ep.querySelector('.editor-filepath');
      const cmContent = ep.querySelector('.cm-content');
      if (!filepath || !cmContent) return false;
      return filepath.textContent.includes('hello_world.md') && cmContent.textContent.includes('Hello World');
    }, undefined, { timeout: 90000 });
    console.log('[8] ✓ hello_world.md opened in editor pane!');

    // ── 9. Final screenshot ──────────────────────────────────────────────────
    await page.waitForTimeout(2000);
    const finalPath = path.join(ARTIFACTS, 'app_screenshot.png');
    await page.screenshot({ path: finalPath });
    console.log(`\n[9] ✓ Final screenshot saved: ${finalPath}`);

    console.log('\n=== ALL TESTS PASSED ✓ ===');

  } catch (err) {
    console.error('\n=== TEST FAILED ===');
    console.error(err.message);
    try {
      const failPath = path.join(ARTIFACTS, 'failure_screenshot.png');
      await page.screenshot({ path: failPath });
      console.log(`Failure screenshot saved: ${failPath}`);
    } catch (e) { /* ignore */ }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

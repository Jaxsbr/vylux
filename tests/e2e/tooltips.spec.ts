import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.openBuildablesPanel === 'function' &&
      typeof window.__vylux.setEnergy === 'function' &&
      typeof window.__vylux.getNodeTooltipVisible === 'function' &&
      typeof window.__vylux.showNodeTooltip === 'function' &&
      typeof window.__vylux.hideNodeTooltip === 'function',
    null,
    { timeout: 15_000 },
  );
}

test.describe('tooltips — buildables panel + energy nodes', () => {
  // ── Buildable tooltips ──────────────────────────────────────────────────────

  test('Worker tooltip shows name, cost, and role on hover', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

    const btn = page.locator('#vylux-buildable-worker');
    await expect(btn).toBeVisible();

    await btn.hover();

    const tooltip = page.locator('#vylux-buildable-tooltip-worker');
    await expect(tooltip).toBeVisible();

    const text = await tooltip.textContent();
    expect(text).toContain('WORKER');
    expect(text).toContain('20');
    expect(text).toContain('energy');
    // Role keyword
    expect(text).toMatch(/harvest/i);
  });

  test('Defender tooltip shows name, cost, and role on hover', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

    const btn = page.locator('#vylux-buildable-defender');
    await expect(btn).toBeVisible();

    await btn.hover();

    const tooltip = page.locator('#vylux-buildable-tooltip-defender');
    await expect(tooltip).toBeVisible();

    const text = await tooltip.textContent();
    expect(text).toContain('DEFENDER');
    expect(text).toContain('60');
    expect(text).toContain('energy');
    // Role keyword
    expect(text).toMatch(/attack/i);
  });

  test('Raider tooltip shows name, cost, and role on hover', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

    const btn = page.locator('#vylux-buildable-raider');
    await expect(btn).toBeVisible();

    await btn.hover();

    const tooltip = page.locator('#vylux-buildable-tooltip-raider');
    await expect(tooltip).toBeVisible();

    const text = await tooltip.textContent();
    expect(text).toContain('RAIDER');
    expect(text).toContain('100');
    expect(text).toContain('energy');
    // Role keyword
    expect(text).toMatch(/advance|enemy/i);
  });

  test('buildable tooltip dismisses when mouse leaves button', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

    const btn = page.locator('#vylux-buildable-raider');
    await btn.hover();

    const tooltip = page.locator('#vylux-buildable-tooltip-raider');
    await expect(tooltip).toBeVisible();

    // Move mouse away to a safe area (canvas center area away from the panel).
    await page.mouse.move(800, 400);

    await expect(tooltip).toBeHidden();
  });

  test('buildable tooltip does not intercept clicks on the button', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

    // Hover to show tooltip.
    const btn = page.locator('#vylux-buildable-worker');
    await btn.hover();
    await expect(page.locator('#vylux-buildable-tooltip-worker')).toBeVisible();

    // Verify pointer-events: none on the tooltip itself.
    const pe = await page.locator('#vylux-buildable-tooltip-worker').evaluate(
      (el) => window.getComputedStyle(el).pointerEvents,
    );
    expect(pe).toBe('none');
  });

  // ── Node tooltip ────────────────────────────────────────────────────────────

  test('energy node tooltip is hidden by default', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await expect(page.locator('#vylux-node-tooltip')).toBeHidden();
  });

  test('showNodeTooltip hook makes the node tooltip visible with correct text', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.showNodeTooltip!(400, 400));

    const tooltip = page.locator('#vylux-node-tooltip');
    await expect(tooltip).toBeVisible();

    const text = await tooltip.textContent();
    expect(text).toContain('ENERGY NODE');
    expect(text).toMatch(/worker/i);
    // Harvest yield from worker-task.ts HARVEST_YIELD constant (not hardcoded).
    const desc = await page.locator('#vylux-node-tooltip-desc').textContent();
    expect(desc).toMatch(/\+\d+.*trip/i);
  });

  test('hideNodeTooltip hook hides the tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.showNodeTooltip!(400, 400));
    await expect(page.locator('#vylux-node-tooltip')).toBeVisible();

    await page.evaluate(() => window.__vylux!.hideNodeTooltip!());
    await expect(page.locator('#vylux-node-tooltip')).toBeHidden();
  });

  test('getNodeTooltipVisible hook reflects tooltip state', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    const before = await page.evaluate(() => window.__vylux!.getNodeTooltipVisible!());
    expect(before).toBe(false);

    await page.evaluate(() => window.__vylux!.showNodeTooltip!(400, 400));

    const after = await page.evaluate(() => window.__vylux!.getNodeTooltipVisible!());
    expect(after).toBe(true);
  });

  // ── Screenshot ──────────────────────────────────────────────────────────────

  test('screenshot: Raider tooltip visible above buildables panel', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

    await page.locator('#vylux-buildable-raider').hover();
    await expect(page.locator('#vylux-buildable-tooltip-raider')).toBeVisible();

    await page.screenshot({ path: 'pm/screenshots/tooltip-buildables.png' });
  });
});

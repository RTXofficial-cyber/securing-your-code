const { test, expect } = require('@playwright/test');

test.describe('Dev Studio in Chrome', () => {
  test('landing page renders and every page is reachable', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Dev Studio/);
    await expect(page.getByRole('button', { name: /Open the Studio/ }).first()).toBeVisible();

    // landing -> setup
    await page.getByRole('button', { name: /Setup, \.exe & permissions/ }).first().click();
    await expect(page.getByRole('heading', { name: /From installer to first build/ })).toBeVisible();
    await expect(page.getByText('Get the Windows .exe')).toBeVisible();

    // setup -> studio
    await page.getByRole('button', { name: /Open Studio →/ }).first().click();
    await expect(page.locator('.activitybar')).toBeVisible();
    await expect(page.locator('.statusbar')).toBeVisible();
    await expect(page.getByText('Dev Studio Terminal')).toBeVisible();

    // studio -> home via activity bar
    await page.locator('.abtn[title="Back to home"]').click();
    await expect(page.getByRole('heading', { name: /Build massive software/ })).toBeVisible();
  });

  test('studio: explorer, tabs, terminal and theme all work', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Open the Studio/ }).first().click();

    // explorer tree is present (browser preview workspace)
    await expect(page.getByText('README.md')).toBeVisible();

    // open a file -> a tab appears
    await page.getByText('README.md').first().click();
    await expect(page.locator('.tab.active')).toContainText('README.md');

    // terminal quick chip runs and prints (mock output in preview)
    await page.locator('.chip', { hasText: 'node -v' }).click();
    await expect(page.locator('.term-body')).toContainText('preview');

    // panels slide closed and open via the activity bar
    await page.locator('.abtn[title="Toggle Explorer"]').click();
    await expect(page.locator('.rail')).toHaveCount(0);
    await page.locator('.abtn[title="Toggle Explorer"]').click();
    await expect(page.locator('.rail')).toHaveCount(1);

    // theme toggle flips the root attribute
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.locator('.abtn[title="Dark theme"], .abtn[title="Light theme"]').first().click();
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).not.toBe(before);
  });

  test('team mode runs the 4-step AI pipeline in the browser', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Open the Studio/ }).first().click();

    await page.getByRole('button', { name: 'Team', exact: true }).click();
    await expect(page.locator('.team-role')).toHaveCount(4);

    await page.locator('.chat-in textarea').fill('build me a website');
    await page.locator('.send').click();

    await expect(page.getByText('AI team run')).toBeVisible();
    await expect(page.locator('.pstep')).toHaveCount(4);
    await expect(page.getByText(/Researcher/).first()).toBeVisible();
  });

  test('settings opens with providers, permissions, plugins and security', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Open the Studio/ }).first().click();
    await page.locator('.abtn[title="Settings & API keys"]').click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('AI providers')).toBeVisible();
    await expect(page.getByText('Permissions')).toBeVisible();
    await expect(page.getByText('Plugins')).toBeVisible();
    await expect(page.getByText(/Security — app lock/)).toBeVisible();
    await expect(page.getByText(/ollama|Ollama/).first()).toBeVisible();

    // close
    await page.locator('.modal-close').click();
    await expect(page.locator('.modal')).toHaveCount(0);
  });
});

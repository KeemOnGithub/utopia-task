import { test, expect, type Page } from '@playwright/test';

function managerEmail(num: number) {
  const info = test.info();
  const offset = info.project.name === 'mobile' ? 10 : 0;
  return `browsermanager${offset + num}@example.test`;
}

function adminEmail(num: number) {
  const info = test.info();
  const offset = info.project.name === 'mobile' ? 10 : 0;
  return `browser${20 + offset + num}@example.test`;
}

async function loginAs(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('browser synthetic password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service orders', exact: true })).toBeVisible();
}

test('manager login admits to portal, shows manager badge, hides drafts/create order, and restricts admin routes locally', async ({ page }) => {
  await loginAs(page, managerEmail(1));

  // Manager badge is shown in header
  await expect(page.getByText('Manager Session')).toBeVisible();

  // Navigation items: Service orders and Operations assistant are visible
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Service orders', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Operations assistant', exact: true })).toBeVisible();

  // Admin-only creation and drafts are NOT rendered
  await expect(page.getByRole('link', { name: 'My drafts', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Create service order', exact: true })).toHaveCount(0);

  // Direct navigation to admin-only route (/orders/new) shows local gate without session loss
  await page.goto('/orders/new');
  await expect(page.getByRole('heading', { name: 'Access restricted', exact: true })).toBeVisible();
  await expect(page.getByText('Only administrators can create orders or manage drafts.')).toBeVisible();

  // Can navigate back to orders safely using the button in the main restriction panel
  await page.getByRole('main').getByRole('link', { name: 'Service orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service orders', exact: true })).toBeVisible();
  await expect(page.getByText('Manager Session')).toBeVisible();
});

test('operations assistant accepts query, executes retrieval with fake provider, and displays grounded evidence', async ({ page }) => {
  await loginAs(page, managerEmail(2));

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Operations assistant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations assistant', exact: true })).toBeVisible();

  // Privacy notice is clearly displayed
  await expect(page.getByRole('note', { name: 'Privacy notice' })).toBeVisible();

  // Example pills submit query cleanly
  const exampleBtn = page.getByRole('button', { name: '“How many service orders were created this month?”' });
  await expect(exampleBtn).toBeVisible();
  await exampleBtn.click();

  // Answer is returned from backend retrieval and displayed
  await expect(page.getByText('Matching Service Orders')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/There are \d+ orders matching your criteria/)).toBeVisible();

  // Start new conversation button clears the chat history
  await page.getByRole('button', { name: 'Start new conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Matching Service Orders')).toHaveCount(0);
});

test('order search links directly to order detail and retains conversation in tab memory', async ({ page }) => {
  await loginAs(page, adminEmail(1));

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Operations assistant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations assistant', exact: true })).toBeVisible();

  // Query orders with cooling problems
  const input = page.getByRole('textbox', { name: 'Ask a question about service orders' });
  await input.fill('Find orders with cooling problems');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  // Matches table appears with SO links
  const table = page.getByRole('table', { name: 'Service Order Results' });
  await expect(table).toBeVisible({ timeout: 15000 });
  const soLink = table.getByRole('link', { name: /^SO-/ }).first();
  await expect(soLink).toBeVisible();
  const orderNumber = await soLink.innerText();

  // Click order link to navigate to order detail
  await soLink.click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: `Service order ${orderNumber}`, exact: true })).toBeVisible();

  // Return to operations assistant
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Operations assistant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations assistant', exact: true })).toBeVisible();

  // Conversation history is retained in tab memory
  await expect(page.getByRole('table', { name: 'Service Order Results' })).toBeVisible();
  await expect(page.getByText('Find orders with cooling problems')).toBeVisible();
});

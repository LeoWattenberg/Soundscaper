import { expect, test } from '@playwright/test';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test.beforeEach(async ({ page }) => {
	await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));
});

test('the public privacy URL opens the policy in the Soundscaper dialog', async ({ page }) => {
	await page.goto('/privacy/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	const dialog = page.getByRole('dialog', { name: 'Privacy Policy', exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: '1. Scope and overview', exact: true })).toBeVisible();
	await expect(dialog.getByText('privacy@support.soundscaper.org', { exact: true }).first()).toBeVisible();
});

test('the sidebar and Help menu open the same policy dialog without leaving the editor', async ({ page }) => {
	await page.goto('/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');

	await page.getByRole('link', { name: 'Privacy policy', exact: true }).click();
	let dialog = page.getByRole('dialog', { name: 'Privacy Policy', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page).toHaveURL(/\/en\/$/u);
	await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();

	const help = editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: 'Help', exact: true });
	await help.click();
	await page.getByRole('menu', { name: 'Help', exact: true })
		.getByRole('menuitem', { name: 'Privacy policy', exact: true })
		.click();
	dialog = page.getByRole('dialog', { name: 'Privacy Policy', exact: true });
	await expect(dialog).toBeVisible();
});

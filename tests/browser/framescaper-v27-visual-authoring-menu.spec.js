import { expect, test } from '@playwright/test';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test('selected V27 owns visual authoring only through existing menus', async ({ page }) => {
	await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({ status: 404, body: '' }));
	await page.goto('/framescaper/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor).toHaveAttribute('data-product', 'framescaper');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', {
		timeout: 15_000,
	});
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();

	await editor.getByRole('menuitem', { name: 'Tracks', exact: true }).click();
	await expect(page.getByRole('menu', { name: 'Tracks', exact: true })
		.getByRole('menuitem', { name: /^Add Video Adjustment Layer/u })).toBeVisible();
	await page.keyboard.press('Escape');

	await editor.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	const effect = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(effect.getByRole('menuitem', { name: /^Video Transitions/u })).toBeVisible();
	await expect(effect.getByRole('menuitem', { name: /^Edit Video Mask\/Matte/u })).toBeVisible();
	await expect(effect.getByRole('menuitem', { name: /^Freeze Video/u })).toBeVisible();
	await expect(editor.getByRole('button', {
		name: /Add (?:Still|Title|Text|Shape|Solid|Video Adjustment Layer)/u,
	})).toHaveCount(0);
});

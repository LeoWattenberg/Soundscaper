import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	setDocumentTheme,
	waitForEditor,
} from './audio-editor-test-helpers.js';

for (const theme of ['light', 'dark']) {
	test(`toolbar customization uses eyes and saves visibility in ${theme} mode`, async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await setDocumentTheme(page, theme);
		await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
		const flyout = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
		const playToggle = flyout.getByRole('checkbox', { name: 'Play', exact: true });
		await expect(playToggle).toHaveAttribute('aria-checked', 'true');
		await expect(playToggle).toHaveCSS('font-size', '12px');
		await expect(playToggle).toContainText('\uEF53');
		await expect(flyout.getByRole('checkbox', { name: 'Metronome', exact: true })).toContainText('\uEF54');

		await playToggle.getByText('Play', { exact: true }).click();
		await expect(playToggle).toHaveAttribute('aria-checked', 'false');
		await expect(playToggle).toContainText('\uEF54');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
		await expect(flyout).toBeVisible();

		await playToggle.press('Space');
		await expect(playToggle).toHaveAttribute('aria-checked', 'true');
		await expect(playToggle).toContainText('\uEF53');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(playToggle).toBeFocused();
		await playToggle.press('Enter');
		await expect(playToggle).toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Escape');
		await expect(flyout).toBeHidden();
		await expect(editor.getByRole('button', { name: 'Customize toolbar', exact: true })).toBeFocused();

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
		await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
		await expect(playToggle).toHaveAttribute('aria-checked', 'false');
		await expect(playToggle).toContainText('\uEF54');
		await playToggle.getByText('\uEF54', { exact: true }).click();
		await expect(playToggle).toHaveAttribute('aria-checked', 'true');
		await expect(playToggle).toContainText('\uEF53');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
}

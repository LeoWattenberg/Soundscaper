import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Web Core storage visibility', () => {
	registerAudioEditorHooks();

	test('boots the maintained workspace with storage signals and safe actions', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = editor.locator('[data-storage-capacity]');
		await expect(panel).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Help', 'Debug storage');
		await expect(panel).toBeVisible();
		await expect(panel.locator('summary')).toContainText('Storage:');
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		const preservePitch = editor.getByRole('menuitem', { name: 'Preserve pitch', exact: true });
		await expect(preservePitch).toBeVisible();
		await preservePitch.click({ trial: true });
		await page.keyboard.press('Escape');
		await panel.locator('summary').click();
		await expect(panel.getByRole('button', { name: 'Refresh estimate', exact: true })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Request persistent storage', exact: true })).toHaveCount(1);
		await expect(panel.getByRole('button', { name: 'Clean orphaned temporary files', exact: true })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Clear reproducible preview cache', exact: true })).toBeVisible();

		await panel.getByRole('button', { name: 'Refresh estimate', exact: true }).click();
		await expect(panel.getByText('Storage backend', { exact: true })).toBeVisible();
		await expect(panel).toContainText('IndexedDB');

		await chooseCommandAction(page, editor, 'Help', 'Debug storage');
		await expect(panel).toHaveCount(0);
		expect(clientErrors).toEqual([]);
	});
});

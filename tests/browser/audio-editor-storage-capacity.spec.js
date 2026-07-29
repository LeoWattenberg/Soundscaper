import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Web Core storage visibility', () => {
	registerAudioEditorHooks();

	test('boots the maintained workspace with storage signals and safe actions', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = editor.locator('[data-storage-capacity]');
		await expect(panel).toBeVisible();
		await expect(panel.locator('summary')).toContainText('Storage:');
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		const playAtSpeed = editor.getByRole('menuitem', { name: 'Play at speed', exact: true });
		await expect(playAtSpeed).toBeVisible();
		await playAtSpeed.click({ trial: true });
		await page.keyboard.press('Escape');
		await panel.locator('summary').click();
		await expect(panel.getByRole('button', { name: 'Refresh estimate', exact: true })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Request persistent storage', exact: true })).toHaveCount(1);
		await expect(panel.getByRole('button', { name: 'Clean orphaned temporary files', exact: true })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Clear reproducible preview cache', exact: true })).toBeVisible();

		await panel.getByRole('button', { name: 'Refresh estimate', exact: true }).click();
		await expect(panel.getByText('Storage backend', { exact: true })).toBeVisible();
		await expect(panel).toContainText('IndexedDB');
		expect(clientErrors).toEqual([]);
	});
});

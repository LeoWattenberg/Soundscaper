/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

	test.describe('editor help tooltip', () => {
	registerAudioEditorHooks();

	test('the trigger closes and reopens help while still hovered and focused', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Tracks', 'Mix & Render');
		const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
		const help = dialog.locator('[data-mix-render-help="mix-down"]');
		const tooltip = page.locator('[data-mix-render-tooltip="mix-down"]');

		await help.click();
		await expect(tooltip).toBeVisible();
		await help.click();
		await expect(tooltip).toHaveCount(0);
		await expect(help).toBeFocused();
		await help.click();
		await expect(tooltip).toBeVisible();
	});
});

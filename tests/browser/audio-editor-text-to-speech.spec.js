/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';

test.describe('menu-owned text to speech', () => {
	registerAudioEditorHooks();

	test('opens only from Generate and offers the published languages without an installed model', async ({ page }) => {
		await installMilestone7LocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		await expect(editor.locator('[data-text-to-speech]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Generate', 'Text to Speech…');
		const dialog = page.locator('[data-text-to-speech="true"]');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('Install a speech model to generate audio locally.')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Generate preview' })).toBeDisabled();
		const language = dialog.getByLabel('Language');
		await expect(language.locator('option')).toHaveCount(9);
		await language.selectOption('a');
		await expect(dialog.getByLabel('Voice').locator('option')).toHaveCount(20);
		await dialog.getByRole('button', { name: 'Close' }).last().click();
		await expect(dialog).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});

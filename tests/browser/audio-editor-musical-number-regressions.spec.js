/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('unusable musical signature drafts restore the saved value', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	const denominator = editor.getByRole('spinbutton', { name: 'Time signature: denominator', exact: true });
	await denominator.fill('3');
	await denominator.press('Enter');
	await expect(denominator).toHaveValue('4');
	const numerator = editor.getByRole('spinbutton', { name: 'Time signature: numerator', exact: true });
	for (const draft of ['0', '1001']) {
		await numerator.fill(draft);
		await numerator.press('Enter');
		await expect(numerator).toHaveValue('4');
	}
	await denominator.fill('8');
	await denominator.press('Enter');
	await expect(denominator).toHaveValue('8');
});

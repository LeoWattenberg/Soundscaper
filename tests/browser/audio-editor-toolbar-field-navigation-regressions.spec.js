/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('toolbar number fields retain native arrow stepping instead of moving focus', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	const numerator = editor.getByRole('spinbutton', { name: 'Time signature: numerator', exact: true });
	await numerator.focus();
	await numerator.press('ArrowUp');
	await expect(numerator).toBeFocused();
	await expect(numerator).toHaveValue('5');
	await numerator.press('Enter');
	await expect(numerator).toHaveValue('5');
});

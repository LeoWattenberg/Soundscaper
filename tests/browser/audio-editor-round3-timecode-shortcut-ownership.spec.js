/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('erase keys while editing playhead digits cannot delete the selected clip', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = editor.locator('[data-clip-id]').first();
	await clip.press('Enter');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const playhead = editor.getByRole('group', { name: 'Playhead', exact: true });
	await playhead.locator('.timecode-digit').first().click();
	await expect(playhead.locator('.timecode-digit').first()).toBeFocused();
	for (const key of ['Backspace', 'Delete']) {
		await page.keyboard.press(key);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	}
	await page.keyboard.press('Enter');
	await expect(playhead).toBeFocused();
	await clip.press('Backspace');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});

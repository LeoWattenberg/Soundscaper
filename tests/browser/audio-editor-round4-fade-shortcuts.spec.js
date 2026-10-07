/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const control of ['duration', 'shape']) test(`Ctrl+B from a clip fade ${control} control adds its label`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	await clip.press('Tab');
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	await expect(fade).toBeFocused();
	if (control === 'shape') {
		await page.keyboard.press('End');
		await page.keyboard.press('Tab');
		await expect(clip.getByRole('slider', { name: 'Fade in shape', exact: true })).toBeFocused();
	}
	await page.keyboard.press('ControlOrMeta+b');
	await expect(editor.locator('[data-label-id]')).toHaveCount(1);
});

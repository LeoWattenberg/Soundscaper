/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const finish of ['release', 'Escape']) test(`the track-header volume drag ${finish === 'release' ? 'is one undoable edit' : 'cancels on Escape'}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
	const volume = row.getByRole('slider', { name: 'Volume', exact: true });
	const initial = await volume.inputValue();
	const bounds = await volume.boundingBox(); expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width * Number(initial) / 100, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height / 2, { steps: 8 });
	if (finish === 'Escape') await page.keyboard.press('Escape');
	await page.mouse.up();
	if (finish === 'release') {
		await expect(volume).not.toHaveValue(initial);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	}
	await expect(volume).toHaveValue(initial);
});

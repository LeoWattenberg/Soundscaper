/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('track Volume publishes its completed primary edit while middle remains held', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const row = clip.locator('xpath=ancestor::div[@data-track-row]');
	const volume = row.getByRole('slider', { name: 'Volume', exact: true });
	const initial = await volume.inputValue();
	const box = await volume.boundingBox();
	expect(box).not.toBeNull();
	const x = box.x + 8 + (box.width - 16) * Number(initial) / 100;
	const y = box.y + box.height / 2;
	const drag = async () => {
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * .4, y, { steps: 5 });
	};
	await drag();
	await page.mouse.up();
	await expect(volume).not.toHaveValue(initial);
	const completed = await volume.inputValue();
	await page.keyboard.press('ControlOrMeta+z');
	await expect(volume).toHaveValue(initial);
	await expect(clip).toHaveCount(1);
	await drag();
	await expect(volume).toHaveValue(completed);
	await page.evaluate(() => document.addEventListener('pointermove', function released(event) {
		if (event.pointerType !== 'mouse' || event.button !== 0 || event.buttons !== 4) return;
		document.documentElement.dataset.volumeReleasedButton = String(event.button);
		document.documentElement.dataset.volumeHeldButtons = String(event.buttons);
		document.removeEventListener('pointermove', released, true);
	}, true));
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await expect(page.locator('html')).toHaveAttribute('data-volume-released-button', '0');
	await expect(page.locator('html')).toHaveAttribute('data-volume-held-buttons', '4');
	await page.mouse.move(box.x + box.width * .7, y, { steps: 4 });
	await expect(volume).toHaveValue(completed);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(clip).toHaveCount(1);
	await expect(volume).toHaveValue(initial);
	await page.mouse.up({ button: 'middle' });
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(volume).toHaveValue(completed);
	await expect(clip).toHaveCount(1);
	expect(errors).toEqual([]);
});

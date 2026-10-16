/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, chooseCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('Mixer Master volume commits its primary release before the remaining middle button ends', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const volume = editor.locator('.kw-audio-editor__mixer-channel--master').getByRole('slider', { name: /volume$/u });
	await expect(volume).toHaveAttribute('aria-valuenow', '0');
	const box = await volume.locator('.mixer-fader__track').boundingBox();
	expect(box).not.toBeNull();
	const min = Number(await volume.getAttribute('aria-valuemin'));
	const max = Number(await volume.getAttribute('aria-valuemax'));
	const x = box.x + box.width / 2;
	const y = box.y + box.height * max / (max - min);
	const drag = async () => {
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 20, { steps: 5 });
	};
	await drag();
	await page.mouse.up();
	const completed = await volume.getAttribute('aria-valuenow');
	expect(Number(completed)).toBeLessThan(-3);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(volume).toHaveAttribute('aria-valuenow', '0');
	await expect(clip).toHaveCount(1);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(volume).toHaveAttribute('aria-valuenow', completed);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(volume).toHaveAttribute('aria-valuenow', '0');
	await drag();
	await expect(volume).toHaveAttribute('aria-valuenow', completed);
	await page.evaluate(() => document.addEventListener('pointermove', function released(event) {
		if (event.pointerType !== 'mouse' || event.button !== 0 || event.buttons !== 4) return;
		document.documentElement.dataset.mixerReleasedButton = String(event.button);
		document.documentElement.dataset.mixerHeldButtons = String(event.buttons);
		document.removeEventListener('pointermove', released, true);
	}, true));
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await expect(page.locator('html')).toHaveAttribute('data-mixer-released-button', '0');
	await expect(page.locator('html')).toHaveAttribute('data-mixer-held-buttons', '4');
	await page.keyboard.press('ControlOrMeta+z');
	await expect(clip).toHaveCount(1);
	await expect(volume).toHaveAttribute('aria-valuenow', '0');
	await page.mouse.move(x, y + 50, { steps: 4 });
	await page.mouse.up({ button: 'middle' });
	await expect(volume).toHaveAttribute('aria-valuenow', '0');
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(volume).toHaveAttribute('aria-valuenow', completed);
	await expect(clip).toHaveCount(1);
	expect(errors).toEqual([]);
});

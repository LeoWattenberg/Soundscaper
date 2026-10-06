/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('one Undo restores master gain after one effects-panel slider drag', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const effects = await openEffectsForTrack(editor, 1);
	const slider = effects.getByRole('slider', { name: 'Master gain', exact: true });
	const initial = await slider.inputValue();
	const box = await slider.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width * 5 / 6, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
	await page.mouse.up();
	await expect(slider).not.toHaveValue(initial);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(slider).toHaveValue(initial);
});

test('one Undo restores a mixer bus gain after one fader drag', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	const fader = mixer.locator('.kw-audio-editor__mixer-channel--group').getByRole('slider', { name: /volume$/u });
	const initial = await fader.getAttribute('aria-valuenow');
	const box = await fader.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 6);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
	await page.mouse.up();
	await expect(fader).not.toHaveAttribute('aria-valuenow', initial);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(fader).toHaveAttribute('aria-valuenow', initial);
});

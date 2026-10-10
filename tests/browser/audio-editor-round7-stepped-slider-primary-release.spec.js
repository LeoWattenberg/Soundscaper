/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('Master gain accepts a later ordinary range drag after primary release while middle stays held', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Range recording.wav', duration: .5, channelCount: 2 })]);
	const effects = await openEffectsForTrack(editor, 1);
	const range = effects.getByRole('slider', { name: 'Master gain', exact: true });
	await expect(range).toHaveValue('0');
	const drag = async () => {
		const box = await range.boundingBox();
		expect(box).not.toBeNull();
		const value = Number(await range.inputValue());
		const percentage = (value + 60) / 72;
		const x = box.x + 8 + percentage * (box.width - 16), y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 30, y, { steps: 4 });
		return { x, y };
	};
	await drag();
	await page.mouse.up();
	const healthy = await range.inputValue();
	expect(Number(healthy)).toBeLessThan(-1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(range).toHaveValue('0');
	await range.evaluate(element => {
		element.addEventListener('pointermove', event => {
			if (event.pointerType === 'mouse' && event.button === 0 && event.buttons === 4) {
				element.dataset.primaryReleased = String(event.buttons);
			}
		});
		element.addEventListener('lostpointercapture', () => { element.dataset.nativeCaptureLost = 'true'; });
	});
	const { x, y } = await drag();
	await expect(range).toHaveValue(healthy);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await expect(range).toHaveAttribute('data-primary-released', '4');
	await page.mouse.move(x, y - 80, { steps: 2 });
	await page.mouse.up({ button: 'middle' });
	await expect(range).toHaveAttribute('data-native-capture-lost', 'true');
	await editor.getByRole('button', { name: 'Undo', exact: true }).focus();
	const beforeNext = await range.inputValue();
	await drag();
	await page.mouse.up();
	await expect.poll(async () => Number(await range.inputValue())).toBeLessThan(Number(beforeNext) - 1);
	const later = await range.inputValue();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(range).toHaveValue(healthy);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(range).toHaveValue('0');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(range).toHaveValue(healthy);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(range).toHaveValue(later);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});

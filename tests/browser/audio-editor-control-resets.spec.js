/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	closeClipProperties,
	collectClientErrors,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('double click control defaults', () => {
	registerAudioEditorHooks();

	test('resets a track volume slider and pan knob to their defaults', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const controls = editor.getByRole('group', { name: 'browser-long-tone track controls', exact: true });
		const volume = controls.getByRole('slider', { name: 'Volume', exact: true });
		const defaultVolume = await volume.inputValue();
		await volume.press('ArrowDown');
		await expect(volume).not.toHaveValue(defaultVolume);
		await volume.dblclick();
		await expect(volume).toHaveValue(defaultVolume);

		const pan = controls.getByRole('group', { name: 'Pan', exact: true }).getByRole('slider');
		await expect(pan).toHaveAttribute('aria-valuenow', '0');
		await pan.press('ArrowRight');
		await expect(pan).not.toHaveAttribute('aria-valuenow', '0');
		await pan.dblclick();
		await expect(pan).toHaveAttribute('aria-valuenow', '0');
		expect(errors).toEqual([]);
	});

	test('resets playback speed from the Play options menu', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		const speed = page.getByRole('slider', { name: 'Playback speed', exact: true });
		await expect(speed).toHaveValue('1');
		const bounds = await speed.boundingBox();
		expect(bounds).not.toBeNull();
		await speed.click({ position: { x: bounds.width * 0.8, y: bounds.height / 2 } });
		await expect(speed).not.toHaveValue('1');
		await speed.dblclick();
		await expect(speed).toHaveValue('1');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('resets the clip fade shape sliders to their default curves', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const dialog = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		for (const label of ['Fade in shape', 'Fade out shape']) {
			const slider = dialog.getByRole('slider', { name: label, exact: true });
			await expect(slider).toHaveValue('1');
			await slider.press('End');
			await expect(slider).toHaveValue('6');
			await slider.dblclick();
			await expect(slider).toHaveValue('1');
		}
		await closeClipProperties(dialog);
		expect(errors).toEqual([]);
	});
});

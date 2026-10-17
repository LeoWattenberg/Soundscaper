/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	openSourceMonitor,
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

	test('resets both Source monitor fade shapes to their default curves', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const monitor = await openSourceMonitor(page, editor, clipByName(editor, longTone.name));
		const waveform = monitor.getByRole('region', { name: 'Source waveform', exact: true });
		for (const label of ['Fade in', 'Fade out']) {
			const fade = waveform.getByRole('slider', { name: label, exact: true });
			await fade.press('Home');
			await fade.press(label === 'Fade in' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
		}
		for (const label of ['Fade in shape', 'Fade out shape']) {
			const slider = waveform.getByRole('slider', { name: label, exact: true });
			await slider.press('0');
			await expect(slider).toHaveAttribute('aria-valuenow', '2');
			await slider.press('ArrowDown');
			const custom = await slider.getAttribute('aria-valuenow');
			expect(Number(custom)).toBeGreaterThan(2);
			await slider.dblclick();
			await expect(slider).toHaveAttribute('aria-valuenow', '2');
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(slider).toHaveAttribute('aria-valuenow', custom);
			await editor.getByRole('button', { name: 'Redo', exact: true }).click();
			await expect(slider).toHaveAttribute('aria-valuenow', '2');
			await waveform.hover();
		}
		expect(errors).toEqual([]);
	});
});

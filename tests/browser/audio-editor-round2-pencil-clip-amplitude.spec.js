/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { chooseClipMediaSetting } from './audio-editor-clip-settings-test-helpers.js';

test('drawing an inverted clip places the audible sample at the visible pencil height', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'pencil-polarity.wav', frequency: 1000, duration: 0.002, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	const draw = async () => {
		await clip.locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
		await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
		const box = await clip.locator('.clip-display').boundingBox();
		const canvas = await clip.locator('canvas.clip-body__waveform').boundingBox();
		await page.mouse.click(box.x + 32.1 / 96 * box.width, canvas.y + canvas.height * 0.25);
		await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
		return exportSamples(page, editor);
	};
	const normal = await draw();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await openClipProperties(page, editor);
	const panel = editor.locator('[data-workspace-panel="clip-properties"]');
	await showClipTimingFields(panel);
	await chooseClipMediaSetting(panel, 'Invert');
	await closeClipProperties(panel);
	const inverted = await draw();
	expect(normal[32]).toBeGreaterThan(0.1);
	expect(inverted[32]).toBeCloseTo(normal[32], 3);
});

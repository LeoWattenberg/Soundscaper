/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, importFiles,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('drawing in linear Half-wave writes the positive sample shown by its ruler', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'half-wave-pencil.wav', frequency: 1000,
		duration: 0.002, channelCount: 1, channelAmplitudes: [0] });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Half-wave']);
	await expect(clip.locator('.clip-body')).toHaveAttribute('data-half-wave', 'true');
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
	const body = await clip.locator('.clip-display').boundingBox();
	const canvas = await clip.locator('canvas.clip-body__waveform').boundingBox();
	expect(body).not.toBeNull(); expect(canvas).not.toBeNull();
	await page.mouse.click(body.x + 32.1 / 96 * body.width, canvas.y + canvas.height * 0.75);
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
	const edited = await exportSamples(page, editor);
	expect(edited[32]).toBeGreaterThan(0.1);
	expect(edited[32]).toBeLessThan(0.2);
	expect(edited[31]).toBeCloseTo(0, 6); expect(edited[33]).toBeCloseTo(0, 6);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	expect((await exportSamples(page, editor))[32]).toBeCloseTo(0, 6);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	expect((await exportSamples(page, editor))[32]).toBeCloseTo(edited[32], 6);
});

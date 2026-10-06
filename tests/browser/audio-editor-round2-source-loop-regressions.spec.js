/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles, openClipProperties, closeClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('source editor effects target the selected phase of a repeated clip', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'source-wave-cycle.wav', frequency: 1000,
		duration: 0.002, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const original = await exportSamples(page, editor);
	const panel = await openClipProperties(page, editor, clip);
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	await expect(waveform.locator('canvas').first()).toBeVisible();
	const box = await waveform.boundingBox();
	await page.mouse.move(box.x + 128 / 192 * box.width, box.y + 80);
	await page.mouse.down();
	await page.mouse.move(box.x + 144 / 192 * box.width, box.y + 80, { steps: 4 });
	await page.mouse.up();
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20_000 });
	await closeClipProperties(panel);
	const samples = await exportSamples(page, editor);
	expect(samples[40]).toBeCloseTo(-original[40], 5);
	expect(samples[136]).toBeCloseTo(-original[136], 5);
	expect(samples[68]).toBeCloseTo(original[68], 5);
});


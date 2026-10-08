/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, commitInput, disableNativeSavePicker,
	importFiles, openClipProperties, closeClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function frequency(samples, start, end) {
	let crossings = 0;
	for (let frame = start + 1; frame < end; frame++) {
		if (samples[frame - 1] <= 0 && samples[frame] > 0) crossings++;
	}
	return crossings * 48_000 / (end - start);
}

test('a Source tempo change retains the pitch and repetitions of a looped recording', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'source-loop-tempo.wav', frequency: 750,
		duration: 0.8, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const original = await exportSamples(page, editor);
	expect(original.length).toBe(76_800);
	expect(frequency(original, 4800, 14_400)).toBeGreaterThan(740);
	const properties = await openClipProperties(page, editor, clip);
	const source = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await source.focus();
	await source.press('Control+a');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change tempo']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(dialog.locator('[data-effect-param="effectAudacityFromBpm"] input'), '120');
	await commitInput(dialog.locator('[data-effect-param="effectAudacityToBpm"] input'), '240');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await closeClipProperties(properties);
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBe(38_400);
	expect(frequency(samples, 4800, 14_400)).toBeGreaterThan(740);
	expect(frequency(samples, 4800, 14_400)).toBeLessThan(760);
	expect(frequency(samples, 24_000, 33_600)).toBeGreaterThan(740);
	expect(frequency(samples, 24_000, 33_600)).toBeLessThan(760);
	await expect(clip.locator('[data-loop-boundary-frame="19200"]')).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const undone = await exportSamples(page, editor);
	expect(undone.length).toBe(76_800);
	expect(frequency(undone, 4800, 14_400)).toBeGreaterThan(740);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await exportSamples(page, editor);
	expect(redone.length).toBe(38_400);
	expect(frequency(redone, 24_000, 33_600)).toBeGreaterThan(740);
});

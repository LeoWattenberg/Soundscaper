/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeClipProperties,
	commitInput, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function rms(samples) {
	const body = samples.slice(9_600, 38_400);
	return Math.sqrt(body.reduce((power, value) => power + value * value, 0) / body.length);
}

for (const sampleRate of [48_000, 8_000]) {
	test(`a neutral source edit preserves exported level at ${sampleRate} Hz`, async ({ page }) => {
		test.setTimeout(60_000);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: `neutral-${sampleRate}.wav`, sampleRate,
			frequency: 3_800, duration: 1, channelCount: 1, channelAmplitudes: [.4] })]);
		const before = await exportSamples(page, editor);
		const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first());
		const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
		await waveform.focus();
		await waveform.press('Control+a');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Multiband compressor']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		for (const name of ['Low ratio', 'Mid ratio', 'High ratio']) {
			await commitInput(dialog.getByRole('spinbutton', { name, exact: true }), '1');
		}
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		await closeClipProperties(properties);
		const after = await exportSamples(page, editor);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		const undone = await exportSamples(page, editor);
		console.log('Neutral source edit levels', { sampleRate, before: rms(before), after: rms(after), undone: rms(undone) });
		expect(rms(undone)).toBeCloseTo(rms(before), 4);
		expect(rms(after) / rms(before)).toBeCloseTo(1, 2);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		const redone = await exportSamples(page, editor);
		expect(rms(redone)).toBeCloseTo(rms(after), 4);
	});
}

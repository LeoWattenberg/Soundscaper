/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior,
	clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const recording = createWavFixture({ name: 'native-32k-12k.wav', frequency: 12_000,
	sampleRate: 32_000, channelCount: 1 });
const silence = createWavFixture({ name: 'native-rate-destination.wav', frequency: 440,
	channelCount: 1, channelAmplitudes: [0] });

function amplitude(samples, frequency, start = 0.4, end = 0.5) {
	let real = 0, imaginary = 0;
	const first = Math.round(start * 48_000), last = Math.round(end * 48_000);
	for (let frame = first; frame < last; frame += 1) {
		const angle = 2 * Math.PI * frequency * frame / 48_000;
		real += samples[frame] * Math.cos(angle);
		imaginary += samples[frame] * Math.sin(angle);
	}
	return 2 * Math.hypot(real, imaginary) / (last - first);
}

test('joining pasted native-rate audio preserves its original spectrum', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Always paste audio as a new clip', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [recording, silence]);
	const original = clipByName(editor, recording.name);
	const before = await exportSamples(page, editor);
	expect(amplitude(before, 12_000)).toBeGreaterThan(0.2);
	expect(amplitude(before, 20_000)).toBeLessThan(0.003);
	await original.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and leave gap']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await clickClipInterior(page, clipByName(editor, silence.name), 0.25);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(clipByName(editor, silence.name)).toHaveAttribute('aria-label', /1\.6 seconds long$/u);
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(76_800);
	expect(amplitude(after, 20_000), JSON.stringify({ original: amplitude(before, 20_000),
		pasted: amplitude(after, 20_000), fundamental: amplitude(after, 12_000) })).toBeLessThan(0.003);
	expect(amplitude(after, 12_000)).toBeCloseTo(amplitude(before, 12_000), 3);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	expect(amplitude(await exportSamples(page, editor), 12_000)).toBeLessThan(0.003);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	expect(amplitude(await exportSamples(page, editor), 20_000)).toBeLessThan(0.003);
});

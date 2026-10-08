/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, clipField, closeClipProperties, disableNativeSavePicker,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('multichannel independent speed refuses before mutation and linked speed remains exportable', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'six-channel-speed.wav', frequency: 440,
		duration: 0.8, channelCount: 6, channelAmplitudes: [0.2, 0.2, 0, 0, 0, 0] });
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	await properties.getByText('Pitch and tempo', { exact: true }).click();
	await expect(properties.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true })).not.toBeChecked();
	const speed = clipField(properties, 'speedRatio');
	await speed.fill('2'); await speed.press('Enter');
	await expect(properties.getByRole('alert')).toContainText('mono or stereo');
	await expect(properties.getByRole('alert')).toContainText('Link pitch and tempo');
	await expect(speed).toHaveAttribute('aria-invalid', 'true');
	await expect(clipField(properties, 'durationFrame')).toHaveValue('38400');
	await speed.press('Escape');
	await expect(speed).toHaveValue('1');
	await closeClipProperties(properties);
	const unchanged = await exportSamples(page, editor);
	expect(unchanged).toHaveLength(38400);
	expect(amplitude(unchanged, 440)).toBeGreaterThan(0.1);
	const recovery = await openClipProperties(page, editor, clipByName(editor, recording.name));
	await recovery.getByText('Pitch and tempo', { exact: true }).click();
	await recovery.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true }).check();
	const linkedSpeed = clipField(recovery, 'speedRatio');
	await linkedSpeed.fill('2'); await linkedSpeed.press('Enter');
	await expect(clipField(recovery, 'durationFrame')).toHaveValue('19200');
	await expect(recovery.getByRole('alert')).toHaveCount(0);
	const linkage = recovery.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true });
	await linkage.click();
	await expect(recovery.getByRole('alert')).toContainText('mono or stereo');
	await expect(linkage).toBeChecked();
	await expect(clipField(recovery, 'durationFrame')).toHaveValue('19200');
	await closeClipProperties(recovery);
	const linked = await exportSamples(page, editor);
	expect(linked).toHaveLength(19200);
	expect(amplitude(linked, 880)).toBeGreaterThan(0.1);
	expect(amplitude(linked, 440)).toBeLessThan(0.01);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await exportSamples(page, editor);
	expect(restored).toHaveLength(38400);
	expect(amplitude(restored, 440)).toBeGreaterThan(0.1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await exportSamples(page, editor);
	expect(redone).toHaveLength(19200);
	expect(amplitude(redone, 880)).toBeGreaterThan(0.1);
});

function amplitude(samples, frequency) {
	let real = 0, imaginary = 0;
	const start = 4800, end = 9600;
	for (let frame = start; frame < end; frame += 1) {
		const angle = 2 * Math.PI * frequency * frame / 48000;
		real += samples[frame] * Math.cos(angle);
		imaginary += samples[frame] * Math.sin(angle);
	}
	return 2 * Math.hypot(real, imaginary) / (end - start);
}

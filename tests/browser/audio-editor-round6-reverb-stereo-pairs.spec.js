/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName, closeClipProperties,
	commitInput, disableNativeSavePicker, importFiles, openClipProperties, openExportDialog,
	readDownloadBytes } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';

function recording(channelCount) {
	const wav = createWavFixture({ name: `front-left-${channelCount}-channel.wav`,
		frequency: 440, duration: 1, channelCount, sampleRate: 48_000 });
	for (let frame = 0; frame < 48_000; frame += 1) for (let channel = 0; channel < channelCount; channel += 1) {
		const sample = channel === 0 ? .25 * Math.sin(2 * Math.PI * 440 * frame / 48_000) : 0;
		wav.buffer.writeInt16LE(Math.round(sample * 32_767), 44 + (frame * channelCount + channel) * 2);
	}
	return wav;
}

async function deliveredChannels(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const blob = new Blob([await readDownloadBytes(page, link)]);
	const descriptor = await inspectWavBlobPcm(blob);
	const channels = Array.from({ length: descriptor.channelCount }, () => new Float32Array(descriptor.frameCount));
	await streamWavBlobPcm(blob, { descriptor, onChunk: (chunk, metadata) => {
		chunk.forEach((samples, channel) => channels[channel].set(samples, metadata.frameOffset));
	} });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return channels;
}

const rms = channel => Math.sqrt(channel.reduce((power, sample) => power + sample ** 2, 0) / channel.length);

test('Source Reverb closes the same front stereo pair in a normal quad recording', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const stereo = recording(2); const quad = recording(4);
	await importFiles(editor, [stereo, quad]);
	const rows = await Promise.all([stereo, quad].map(async wav => {
		const id = await clipByName(editor, wav.name).locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
		return editor.locator(`[data-track-row][data-track-id="${id}"]`);
	}));
	await rows[1].getByRole('button', { name: 'Mute', exact: true }).click();
	for (const [index, row] of rows.entries()) {
		const properties = await openClipProperties(page, editor, row.locator('[data-clip-id]').first());
		const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
		await waveform.focus();
		await waveform.press('Control+a');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb']);
		const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await commitInput(effect.locator('[data-effect-param="stereoWidth"] input[type="number"]'), '0');
		await effect.locator('[data-effect-param="wetOnly"]').getByRole('checkbox').check();
		await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(effect).toBeHidden({ timeout: 20_000 });
		await closeClipProperties(properties);
		const output = await deliveredChannels(page, editor);
		console.log('normal Source Reverb front pair RMS', { channels: index === 0 ? 2 : 4,
			left: rms(output[0]), right: rms(output[1]) });
		expect(output).toHaveLength(2);
		expect(rms(output[0])).toBeGreaterThan(.01);
		expect(rms(output[1]) / rms(output[0])).toBeCloseTo(1, 4);
		if (index === 0) {
			await rows[0].getByRole('button', { name: 'Mute', exact: true }).click();
			await rows[1].getByRole('button', { name: 'Mute', exact: true }).click();
		}
	}
});

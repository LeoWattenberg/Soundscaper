/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, closeDialog, disableNativeSavePicker,
	importFiles, readDownloadBytes } from './audio-editor-test-helpers.js';

test('the menu-authored Dialogue Chain preserves ordinary recording phase', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const native = await page.evaluate(async () => {
		const clocks = [];
		for (const sampleRate of [8_000, 44_100, 96_000, 192_000]) {
			const offline = new OfflineAudioContext(1, 4_096, sampleRate);
			const impulse = offline.createBuffer(1, 4_096, sampleRate);
			impulse.getChannelData(0)[512] = .5;
			const source = offline.createBufferSource();
			source.buffer = impulse;
			const compressor = offline.createDynamicsCompressor();
			compressor.threshold.value = 0; compressor.knee.value = 0; compressor.ratio.value = 1;
			source.connect(compressor).connect(offline.destination); source.start();
			const rendered = await offline.startRendering();
			clocks.push([sampleRate, rendered.getChannelData(0).findIndex(sample => sample !== 0) - 512]);
		}
		const context = new OfflineAudioContext(1, 2_048, 48_000);
		const source = context.createBufferSource();
		const buffer = context.createBuffer(1, 2_048, 48_000);
		buffer.getChannelData(0)[512] = .5;
		source.buffer = buffer;
		const compressor = context.createDynamicsCompressor();
		compressor.threshold.value = 0;
		compressor.knee.value = 0;
		compressor.ratio.value = 1;
		source.connect(compressor).connect(context.destination);
		source.start();
		const rendered = await context.startRendering();
		const highpass = context.createBiquadFilter();
		highpass.type = 'highpass';
		highpass.frequency.value = 80;
		highpass.Q.value = 20 * Math.log10(.707);
		const magnitude = new Float32Array(1); const phase = new Float32Array(1);
		highpass.getFrequencyResponse(new Float32Array([250]), magnitude, phase);
		return { clocks, delay: rendered.getChannelData(0).findIndex(sample => sample !== 0) - 512,
			magnitude: magnitude[0], phase: phase[0] };
	});
	expect(native.clocks).toEqual([[8_000, 48], [44_100, 264], [96_000, 576], [192_000, 1023]]);
	expect(native.delay).toBe(288);
	expect(native.magnitude).toBeGreaterThan(.99);
	expect(native.phase).toBeGreaterThan(.4);
	await importFiles(editor, [recording('dialogue recording.wav')]);
	const dry = tone(await exportAudio(page, editor));
	expect(dry.magnitude).toBeGreaterThan(.006);
	expect(Math.abs(dry.phase)).toBeLessThan(.005);
	const track = editor.locator('[data-track-row]:not([data-video-track]):not([data-label-track])').last();
	await track.locator('[data-track-header]').click();
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: 'Window', exact: true }).click();
	await page.getByRole('menu', { name: 'Window', exact: true })
		.getByRole('menuitem', { name: /^Dialogue Chain/u }).press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Dialogue Chain', exact: true });
	await dialog.getByRole('button', { name: 'Apply dialogue chain', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Dialogue chain applied.');
	await closeDialog(dialog);
	const wet = tone(await exportAudio(page, editor));
	expect(wet.magnitude).toBeGreaterThan(.0001);
	console.log('ordinary Dialogue Chain native phase', { native, dry, wet });
	expect(Math.cos(wet.phase - native.phase)).toBeGreaterThan(.98);
	await importFiles(editor, [recording('parallel recording.wav')]);
	const mixed = tone(await exportAudio(page, editor));
	const expectedMagnitude = Math.hypot(dry.sine + wet.sine, dry.cosine + wet.cosine);
	expect(mixed.magnitude).toBeCloseTo(expectedMagnitude, 4);
});

function recording(name) {
	return createWavFixture({ name, frequency: 250, duration: 1,
		channelCount: 1, channelAmplitudes: [.01] });
}

async function exportAudio(page, editor) {
	await chooseFileAction(page, editor, 'Export video');
	const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
	const link = dialog.locator('[data-export-download]');
	const previous = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect(link).toHaveAttribute('download', /\.wav$/u);
	await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const bytes = await readDownloadBytes(page, link);
	const samples = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const buffer = await context.decodeAudioData(new Uint8Array(data).buffer);
			return Array.from(buffer.getChannelData(0));
		} finally { await context.close(); }
	}, Array.from(bytes));
	await closeDialog(dialog);
	return samples;
}

function tone(samples) {
	let sine = 0; let cosine = 0;
	for (let frame = 12_000; frame < 36_000; frame++) {
		const angle = 2 * Math.PI * 250 * frame / 48_000;
		sine += samples[frame] * Math.sin(angle);
		cosine += samples[frame] * Math.cos(angle);
	}
	sine /= 12_000; cosine /= 12_000;
	return { sine, cosine, magnitude: Math.hypot(sine, cosine), phase: Math.atan2(cosine, sine) };
}

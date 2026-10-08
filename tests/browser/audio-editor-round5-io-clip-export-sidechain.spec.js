/* SPDX-License-Identifier: AGPL-3.0-only */

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { createWavFixture, expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName,
	closeDialog, closeEffectsPanel, disableNativeSavePicker, importFiles, openEffectsForTrack,
	openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function rms(samples) {
	const middle = samples.slice(9_600, 28_800);
	return Math.sqrt(middle.reduce((sum, sample) => sum + sample * sample, 0) / middle.length);
}

function toneAmplitude(samples, frequency) {
	const middle = samples.slice(9_600, 28_800);
	let sine = 0;
	let cosine = 0;
	for (const [frame, sample] of middle.entries()) {
		const angle = 2 * Math.PI * frequency * frame / 48_000;
		sine += sample * Math.sin(angle);
		cosine += sample * Math.cos(angle);
	}
	return 2 * Math.hypot(sine, cosine) / middle.length;
}

for (const [title, amplitude, gated] of [
	['individual clip delivery retains an external Gate detector without mixing it into the clip', 0.1, false],
	['individual clip delivery retains a quiet Gate detector and the closed programme gate', 0.001, true],
]) test(title, async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, createWavFixture({ name: 'external-detector.wav', frequency: 660,
		channelCount: 1, channelAmplitudes: [amplitude] })]);
	const control = clipByName(editor, 'external-detector.wav');
	const controlTrack = await control.evaluate(clip => clip.closest('[data-track-id]')?.getAttribute('data-track-id'));
	expect(controlTrack).toBeTruthy();
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Gate');
	await closeDialog(page.getByRole('dialog', { name: 'Gate', exact: true }));
	await closeEffectsPanel(effects);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await graph.locator(`[data-routing-source="track:${controlTrack}"]`).press('Enter');
	await graph.locator('[data-routing-destination*="effect-sidechain"]').press('Enter');
	await expect(graph.locator('[data-routing-edge][aria-label*="sidechain"]')).toHaveCount(1);
	const mixed = await exportSamples(page, editor);
	if (gated) expect(rms(mixed)).toBeLessThan(0.002);
	else expect(rms(mixed)).toBeGreaterThan(0.1);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Individual clips (split by clips)');
	const download = dialog.locator('[data-export-download]');
	const previousDownload = await download.count() ? await download.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(download).toBeVisible({ timeout: 20_000 });
	await expect.poll(() => download.getAttribute('href')).not.toBe(previousDownload);
	await expect(download).toHaveAttribute('download', /-clips-.*\.zip$/u);
	const archiveBytes = await readDownloadBytes(page, download);
	await testInfo.attach('individual-clips.zip', { body: Buffer.from(archiveBytes), contentType: 'application/zip' });
	const archive = new ZipReader(new Uint8ArrayReader(archiveBytes), { useWebWorkers: false });
	try {
		const entries = await archive.getEntries();
		expect(entries).toHaveLength(2);
		const programme = entries.find(({ filename }) => filename.includes('browser-mono-tone'));
		expect(programme).toBeTruthy();
		const bytes = await programme.getData(new Uint8ArrayWriter());
		const samples = await page.evaluate(async data => {
			const context = new AudioContext({ sampleRate: 48_000 });
			try {
				const audio = await context.decodeAudioData(new Uint8Array(data).buffer);
				return Array.from(audio.getChannelData(0));
			} finally { await context.close(); }
		}, Array.from(bytes));
		if (gated) expect(rms(samples)).toBeLessThan(0.002);
		else {
			expect(rms(samples)).toBeGreaterThan(0.24);
			expect(rms(samples)).toBeLessThan(0.25);
			expect(toneAmplitude(samples, 440)).toBeGreaterThan(0.34);
		}
		expect(toneAmplitude(samples, 660)).toBeLessThan(0.001);
	} finally { await archive.close(); }
});

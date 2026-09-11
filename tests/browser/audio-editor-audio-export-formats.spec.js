/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, collectClientErrors, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes, registerAudioEditorHooks,
	sourcePeakChannels, clipByName,
} from './audio-editor-test-helpers.js';

// AAC has its own WebCodecs capability and container suite. Custom FFmpeg is
// desktop-only. These are all the remaining audio formats offered in browsers.
const FORMATS = [
	['WAV', 'wav', 'RIFF'], ['Broadcast WAV (BWF)', 'wav', 'RIFF'], ['BW64 / ADM', 'wav', 'BW64'],
	['AIFF', 'aiff', 'FORM'], ['FLAC', 'flac', 'fLaC'],
	['MP3', 'mp3', null], ['Ogg Vorbis', 'ogg', 'OggS'],
	['Opus', 'opus', 'OggS'], ['WavPack', 'wv', 'wvpk'], ['MP2', 'mp2', null],
];

test.describe('audio exporter round trips', () => {
	registerAudioEditorHooks();
	test('lists every browser audio format and excludes desktop-only Custom FFmpeg', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'formats.wav', frequency: 330 })]);
		const dialog = await openExportDialog(page, editor);
		await dialog.locator('[data-export-field="format"]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(FORMATS.length + 1);
		for (const name of [...FORMATS.map(([label]) => label), 'AAC / M4A']) {
			await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
		}
		await expect(page.getByRole('option', { name: 'Custom FFmpeg', exact: true })).toHaveCount(0);
	});

	test('refuses AAC export clearly when the browser has no audio encoder', async ({ page }) => {
		await page.addInitScript(() => { globalThis.AudioEncoder = undefined; });
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'aac.wav', frequency: 330 })]);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'AAC / M4A');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(editor.locator('[data-status]')).toContainText('This browser does not provide WebCodecs AAC encoding.');
		await expect(dialog.locator('[data-export-download]')).toBeHidden();
	});
	for (const [label, extension, signature] of FORMATS) {
		test(`${label} downloads decodable stereo audio with the expected levels`, async ({ page }) => {
			test.setTimeout(60000);
			await disableNativeSavePicker(page);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [createWavFixture({ name: 'export-source.wav', frequency: 330,
				duration: 0.5, channelAmplitudes: [0.3, 0.1] })]);
			const dialog = await openExportDialog(page, editor);
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), label);
			if (label === 'BW64 / ADM') {
				await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
				const metadata = page.getByRole('dialog', { name: 'Metadata', exact: true });
				await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
				await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
				await metadata.getByRole('button', { name: /^Done\.?$/ }).click();
			}
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			const link = dialog.locator('[data-export-download]');
			await expect(link).toBeVisible({ timeout: 20000 });
			await expect(link).toHaveAttribute('download', new RegExp(`\\.${extension}$`, 'i'));
			const bytes = await readDownloadBytes(page, link);
			expect(bytes.length).toBeGreaterThan(256);
			if (signature) expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe(signature);
			else expect(Buffer.from(bytes).subarray(0, 3).toString('ascii') === 'ID3'
				|| (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)).toBe(true);
			if (label === 'Broadcast WAV (BWF)') expect(Buffer.from(bytes).includes(Buffer.from('bext'))).toBe(true);
			if (label === 'BW64 / ADM') expect(Buffer.from(bytes).includes(Buffer.from('ds64'))).toBe(true);
			await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
			await expect(dialog).toBeHidden();
			const name = `delivered.${extension}`;
			await importFiles(editor, [{ name, mimeType: ({ wav: 'audio/wav', aiff: 'audio/aiff', mp3: 'audio/mpeg', mp2: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', wv: 'audio/x-wavpack' })[extension], buffer: Buffer.from(bytes) }]);
			await expect(clipByName(editor, name)).toBeVisible();
			await expect(editor).toHaveAttribute('data-clip-count', '2');
			const peaks = await sourcePeakChannels(page, name);
			expect(peaks.channelCount).toBe(2);
			expect(peaks.channels[0].maximum).toBeGreaterThan(0.2);
			expect(peaks.channels[0].maximum).toBeLessThan(0.4);
			expect(peaks.channels[0].minimum).toBeLessThan(-0.2);
			expect(peaks.channels[1].maximum).toBeGreaterThan(0.05);
			expect(peaks.channels[1].maximum).toBeLessThan(0.2);
			expect(errors).toEqual([]);
		});
	}
});

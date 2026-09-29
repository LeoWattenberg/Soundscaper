/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	collectClientErrors,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { cancelHeldDirectWrite, installDirectPcmTarget } from './helpers/direct-pcm-save-target.js';

const RETAINED_ARCHIVE_BYTES = 1024 * 1024;
const EXPECTED_PCM_BYTES = 38_400 * 2 * 2;
const EXPECTED_STEM_BYTES = 44 + EXPECTED_PCM_BYTES + (8 + 37 + 1) + (8 + 30);

test.describe('direct File System Access stem archives', () => {
	registerAudioEditorHooks();

	test('streams and commits a ZIP containing one WAV per track', async ({ page }) => {
		const errors = collectClientErrors(page);
		let downloads = 0;
		page.on('download', () => { downloads += 1; });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await installDirectPcmTarget(page, {
			fileName: 'direct-browser-stems.zip',
			pcmOffset: 0,
			prefixBytes: RETAINED_ARCHIVE_BYTES,
		});

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(
			page,
			exportDialog.locator('[data-export-field="output"]'),
			'Individual stems (split by tracks)',
		);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="dither"]'), 'None');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.closes || 0), {
			timeout: 20_000,
		}).toBe(1);
		await expect(exportDialog.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();

		const saved = await inspectDirectZipTarget(page, 0);
		expect(saved).toMatchObject({
			aborts: 0,
			closes: 1,
			commits: 1,
			entryCount: 3,
			maxConcurrentWrites: 1,
			opens: 1,
			publications: 1,
		});
		expect(saved.totalBytes).toBeGreaterThan(200);
		expect(saved.prefixBytes).toBe(saved.totalBytes);
		expect(saved.writeCalls).toBeGreaterThan(2);
		expect(saved.signature).toBe(0x04034b50);
		expect(saved.endSignature).toBe(0x06054b50);
		expect(saved.entries).toHaveLength(3);
		expect(saved.entries).toEqual([
			['01-Track-1.wav', [[0, 0], [0, 0]]],
			['02-browser-tone-a.wav', [[-10_595, -9_099], [-8_109, 2_968]]],
			['03-browser-tone-b.wav', [[8_109, -2_968], [-11_468, -5_734]]],
		].map(([name, samples]) => ({
			name,
			compressionMethod: 0,
			compressedBytes: EXPECTED_STEM_BYTES,
			uncompressedBytes: EXPECTED_STEM_BYTES,
			wav: {
				riff: 'RIFF', wave: 'WAVE', format: 'fmt ', data: 'data',
				channels: 2, sampleRate: 48_000, bitDepth: 16, pcmBytes: EXPECTED_PCM_BYTES,
				riffBytes: EXPECTED_STEM_BYTES - 8,
				samples,
				trailerId: 'id3 ', trailerBytes: 37,
				infoId: 'LIST', infoBytes: 30,
			},
		})));
		expect(saved.pickerOptions.suggestedName).toMatch(/-stems-.*\.zip$/u);
		expect(saved.pickerOptions.types[0].accept['application/zip']).toEqual(['.zip']);
		expect(saved.objectUrls).toEqual([]);
		expect(downloads).toBe(0);
		expect(errors).toEqual([]);
	});

	test('aborts a partly written ZIP when its destination write is cancelled', async ({ page }) => {
		test.setTimeout(45_000);
		const errors = collectClientErrors(page);
		let downloads = 0;
		page.on('download', () => { downloads += 1; });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await installDirectPcmTarget(page, {
			fileName: 'cancelled-direct-stems.zip',
			pcmOffset: 0,
			prefixBytes: 64,
			stallAfterBytesSession: 0,
		});

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(
			page,
			exportDialog.locator('[data-export-field="output"]'),
			'Individual stems (split by tracks)',
		);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

		const cancel = exportDialog.getByRole('button', { name: 'Cancel export' });
		await expect(cancel).toBeVisible();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.totalBytes || 0), {
			timeout: 20_000,
		}).toBeGreaterThan(4);
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.writeHeld || false)).toBe(true);
		await cancelHeldDirectWrite(page, cancel, 0);
		await expect(exportDialog.getByRole('button', { name: 'Export', exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.aborts || 0)).toBe(1);

		const cancelled = await inspectCancelledZipTarget(page, 0);
		expect(cancelled).toMatchObject({
			aborts: 1,
			closes: 0,
			commitStarted: 0,
			commits: 0,
			opens: 1,
			publications: 0,
			signature: 0x04034b50,
		});
		expect(cancelled.totalBytes).toBeGreaterThan(4);
		expect(cancelled.objectUrls).toEqual([]);
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
		expect(downloads).toBe(0);
		expect(errors).toEqual([]);
	});
});

async function inspectDirectZipTarget(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directPcmSave;
		const session = state.sessions[index];
		const bytes = session.prefix.subarray(0, session.prefixBytes);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (bytes.byteLength !== session.totalBytes) throw new Error('The retained ZIP is incomplete.');
		const endOffset = bytes.byteLength - 22;
		const entryCount = view.getUint16(endOffset + 10, true);
		const centralOffset = view.getUint32(endOffset + 16, true);
		const entries = [];
		let offset = centralOffset;
		for (let index = 0; index < entryCount; index += 1) {
			if (view.getUint32(offset, true) !== 0x02014b50) {
				throw new Error('Invalid ZIP central-directory entry.');
			}
			const nameBytes = view.getUint16(offset + 28, true);
			const extraBytes = view.getUint16(offset + 30, true);
			const commentBytes = view.getUint16(offset + 32, true);
			const localOffset = view.getUint32(offset + 42, true);
			if (view.getUint32(localOffset, true) !== 0x04034b50) {
				throw new Error('Invalid ZIP local entry.');
			}
			const wavOffset = localOffset + 30
				+ view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
			const ascii = (at) => String.fromCharCode(...bytes.subarray(wavOffset + at, wavOffset + at + 4));
			const pcmBytes = view.getUint32(wavOffset + 40, true);
			const trailerOffset = 44 + pcmBytes;
			const trailerBytes = view.getUint32(wavOffset + trailerOffset + 4, true);
			const infoOffset = trailerOffset + 8 + trailerBytes + (trailerBytes & 1);
			entries.push({
				compressedBytes: view.getUint32(offset + 20, true),
				compressionMethod: view.getUint16(offset + 10, true),
				name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameBytes)),
				uncompressedBytes: view.getUint32(offset + 24, true),
				wav: {
					riff: ascii(0), wave: ascii(8), format: ascii(12), data: ascii(36),
					channels: view.getUint16(wavOffset + 22, true),
					sampleRate: view.getUint32(wavOffset + 24, true),
					bitDepth: view.getUint16(wavOffset + 34, true),
					pcmBytes,
					riffBytes: view.getUint32(wavOffset + 4, true),
					samples: [100, 1000].map((frame) => [
						view.getInt16(wavOffset + 44 + frame * 4, true),
						view.getInt16(wavOffset + 46 + frame * 4, true),
					]),
					trailerId: ascii(trailerOffset),
					trailerBytes,
					infoId: ascii(infoOffset),
					infoBytes: view.getUint32(wavOffset + infoOffset + 4, true),
				},
			});
			offset += 46 + nameBytes + extraBytes + commentBytes;
		}
		return {
			...session,
			endSignature: view.getUint32(endOffset, true),
			entries,
			entryCount,
			objectUrls: state.objectUrls,
			pickerOptions: state.pickerOptions,
			prefix: undefined,
			signature: view.getUint32(0, true),
		};
	}, sessionIndex);
}

async function inspectCancelledZipTarget(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directPcmSave;
		const session = state.sessions[index];
		const view = new DataView(session.prefix.buffer, session.prefix.byteOffset, session.prefixBytes);
		return {
			...session,
			objectUrls: state.objectUrls,
			pickerOptions: state.pickerOptions,
			prefix: undefined,
			signature: view.getUint32(0, true),
		};
	}, sessionIndex);
}

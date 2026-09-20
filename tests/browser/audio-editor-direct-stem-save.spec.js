/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	longTone,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	collectClientErrors,
	disableOfflineAudio,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { installDirectPcmTarget } from './helpers/direct-pcm-save-target.js';

const RETAINED_ARCHIVE_BYTES = 1024 * 1024;

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
		expect(saved.entries.map(({ name }) => name)).toEqual([
			expect.stringMatching(/^01-.+\.wav$/u),
			'02-browser-tone-a.wav',
			'03-browser-tone-b.wav',
		]);
		for (const entry of saved.entries) {
			expect(entry.compressionMethod).toBe(0);
			expect(entry.compressedBytes).toBe(entry.uncompressedBytes);
			expect(entry.uncompressedBytes).toBeGreaterThan(44);
		}
		expect(saved.pickerOptions.suggestedName).toMatch(/-stems-.*\.zip$/u);
		expect(saved.pickerOptions.types[0].accept['application/zip']).toEqual(['.zip']);
		expect(saved.objectUrls).toEqual([]);
		expect(downloads).toBe(0);
		expect(errors).toEqual([]);
	});

	test('aborts a partly written ZIP when realtime stem rendering is cancelled', async ({ page }) => {
		test.setTimeout(45_000);
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		let downloads = 0;
		page.on('download', () => { downloads += 1; });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, longTone]);
		await installDirectPcmTarget(page, {
			fileName: 'cancelled-direct-stems.zip',
			pcmOffset: 0,
			prefixBytes: 64,
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
		await cancel.click();
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
			entries.push({
				compressedBytes: view.getUint32(offset + 20, true),
				compressionMethod: view.getUint16(offset + 10, true),
				name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameBytes)),
				uncompressedBytes: view.getUint32(offset + 24, true),
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

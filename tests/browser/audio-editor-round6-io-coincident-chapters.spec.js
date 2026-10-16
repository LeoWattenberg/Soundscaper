/* SPDX-License-Identifier: AGPL-3.0-only */

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, disableNativeSavePicker, importFiles,
	openExportDialog, readDownloadBytes, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('ordinary coincident chapter delivery', () => {
	registerAudioEditorHooks();

	test('coincident point labels each reach their own delivered WAV chapter', async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await importFiles(editor, [{
			name: 'interview-labels.txt', mimeType: 'text/plain',
			buffer: Buffer.from('0\t0\tInterview\n0\t0\tTranscript\n0.4\t0.4\tConclusion\n'),
		}]);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Chapters (split by labels)');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20_000 });
		const reader = new ZipReader(new Uint8ArrayReader(await readDownloadBytes(page, link)), { useWebWorkers: false });
		try {
			const entries = await reader.getEntries();
			expect(entries.map(({ filename }) => filename)).toEqual([
				'01-Interview.wav', '02-Transcript.wav', '03-Conclusion.wav',
			]);
			for (const entry of entries) {
				const bytes = await entry.getData(new Uint8ArrayWriter());
				expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
				expect(bytes.byteLength).toBeGreaterThan(44);
			}
		} finally { await reader.close(); }
	});
});

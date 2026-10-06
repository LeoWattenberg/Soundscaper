/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseNestedCommandAction, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

test('a Japanese project title identifies its ordinary WAV download', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const naming = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await naming.getByRole('textbox').fill('東京の録音');
	await naming.getByRole('button', { name: 'Save name', exact: true }).click();
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(dialog.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
	await expect(dialog.locator('[data-export-download]')).toHaveAttribute('download', /^東京の録音-mix-\d{4}-\d{2}-\d{2}\.wav$/u);
});

test('high-pass triangular dither writes the promised triangular noise into a quiet WAV', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'quiet-recording.wav', frequency: 0, duration: 4, channelCount: 1 })]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Sample format', exact: true }), '16-bit PCM');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Dither', exact: true }), 'Triangular high-pass');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const size = view.getUint32(offset + 4, true);
		if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === 'data') {
			let nonzero = 0;
			for (let frame = 0; frame < size / 2; frame += 1) {
				if (view.getInt16(offset + 8 + frame * 2, true) !== 0) nonzero += 1;
			}
			const fraction = nonzero / (size / 2);
			expect(fraction).toBeGreaterThan(0.22);
			expect(fraction).toBeLessThan(0.28);
			return;
		}
		offset += 8 + size + (size % 2);
	}
	throw new Error('The WAV download has no audio data.');
});

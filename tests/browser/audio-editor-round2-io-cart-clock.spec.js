/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import {
	bootEditor, chooseDropdown, collectClientErrors, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

for (const sourceRate of [32_000, 48_000]) {
	test(`an ordinary ${sourceRate} Hz broadcast source retains its CART cue time in a 96 kHz delivery`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const buffer = encodeWav([new Float32Array(sourceRate)], {
			sampleRate: sourceRate, bitDepth: 16, bext: { description: 'Radio continuity take' },
			cart: { title: 'Radio continuity take', postTimers: [{ usage: 'SEC1', value: sourceRate / 2 }] },
		});
		try {
			await importFiles(editor, [{ name: `radio-take-${sourceRate}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(buffer) }]);
		} finally {
			await test.info().attach('import-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
		}
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
		await dialog.locator('[data-export-field="sampleRate"] input').fill('96000');
		await dialog.locator('[data-export-field="sampleRate"] input').press('Tab');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20_000 });
		const bytes = await readDownloadBytes(page, link);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const chunks = new Map();
		for (let offset = 12; offset + 8 <= bytes.length;) {
			const size = view.getUint32(offset + 4, true);
			chunks.set(new TextDecoder().decode(bytes.subarray(offset, offset + 4)), offset + 8);
			offset += 8 + size + (size % 2);
		}
		expect(chunks.has('cart')).toBe(true);
		expect(view.getUint32(chunks.get('fmt ') + 4, true)).toBe(96_000);
		const timer = chunks.get('cart') + 684;
		expect(new TextDecoder().decode(bytes.subarray(timer, timer + 4))).toBe('SEC1');
		expect(view.getUint32(timer + 4, true)).toBe(48_000);
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseFileAction, clipByName, collectClientErrors,
	disableNativeSavePicker, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

// An ordinary Chromium MediaRecorder recording: a 0.8 s, 440 Hz, 0.2-gain
// oscillator into MediaStreamAudioDestinationNode, audio/webm;codecs=opus,
// audioBitsPerSecond=96000. No video track or manually altered container bytes.
const recording = Buffer.from(readFileSync(new URL('../fixtures/chromium-audio-only.webm.base64', import.meta.url), 'utf8'), 'base64');

for (const mimeType of ['audio/webm', 'video/webm']) {
	test(`an ordinary audio-only WebM recording imports as audio when the picker reports ${mimeType}`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		try {
			const picking = page.waitForEvent('filechooser');
			await chooseFileAction(page, editor, 'Import');
			await (await picking).setFiles({ name: 'voice-memo.webm', mimeType, buffer: recording });
			await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
			const clip = clipByName(editor, 'voice-memo.webm');
			await expect(clip).toBeVisible();
			await expect(editor.locator('[data-clip-kind="video"]')).toHaveCount(0);
			const dialog = await openExportDialog(page, editor);
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			const link = dialog.locator('[data-export-download]');
			await expect(link).toBeVisible();
			const bytes = Buffer.from(await readDownloadBytes(page, link));
			let data;
			for (let offset = 12; offset + 8 <= bytes.length;) {
				const size = bytes.readUInt32LE(offset + 4);
				if (bytes.toString('ascii', offset, offset + 4) === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
				offset += 8 + size + size % 2;
			}
			expect(data).toBeDefined();
			expect(data.length / (48_000 * 2 * 3)).toBeGreaterThan(0.75);
			expect(data.length / (48_000 * 2 * 3)).toBeLessThan(0.95);
			let peak = 0;
			for (let offset = 0; offset < data.length; offset += 6) peak = Math.max(peak, Math.abs(data.readIntLE(offset, 3) / 8388608));
			expect(peak).toBeGreaterThan(0.15);
			expect(peak).toBeLessThan(0.3);
			expect(errors).toEqual([]);
		} finally {
			await test.info().attach('import-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
		}
	});
}

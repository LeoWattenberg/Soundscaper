/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseBextPayload } from '../../src/common/editor/broadcast-wave.ts';
import {
	bootEditor, chooseCommandAction, chooseDropdown, closeDialog, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

test('a reordered mastering BWF timestamps its first delivered source sample', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = encodeWav([Float32Array.from({ length: 48_000 }, (_, index) => (
		0.2 * Math.sin(index * Math.PI * 2 * (index < 24_000 ? 440 : 880) / 48_000)
	))], { sampleRate: 48_000, bitDepth: 16, bext: { timeReference: '480000', description: 'Two production takes' },
		markers: [
			{ id: 1, sampleOffset: 6_000, sampleLength: 12_000, label: 'Earlier take' },
			{ id: 2, sampleOffset: 24_000, sampleLength: 12_000, label: 'Later take' },
		],
	});
	await importFiles(editor, [{ name: 'two-production-takes.wav', mimeType: 'audio/wav', buffer: Buffer.from(recording) }]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
	const mastering = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
	await mastering.getByRole('button', { name: 'New sequence', exact: true }).click();
	const form = mastering.getByRole('form', { name: 'Sequence name', exact: true });
	await form.getByRole('textbox').fill('Later first');
	await form.getByRole('button', { name: 'Sequence name', exact: true }).click();
	for (const label of ['Later take', 'Earlier take']) {
		await mastering.getByRole('combobox', { name: 'Add region', exact: true }).selectOption({ label });
		await mastering.getByRole('button', { name: 'Add region', exact: true }).click();
	}
	await expect(mastering.getByRole('region', { name: 'Entries' }).getByRole('form')).toHaveCount(2);
	await closeDialog(mastering);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Later first');
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const chunks = riffChunks(bytes);
	const format = new DataView(chunks.get('fmt ').buffer, chunks.get('fmt ').byteOffset, chunks.get('fmt ').byteLength);
	expect(format.getUint32(4, true)).toBe(48_000);
	const pcm = chunks.get('data');
	const blockAlign = format.getUint16(12, true);
	expect(pcm.byteLength / blockAlign).toBe(24_000);
	// The first region actually contains the later take's 880 Hz recording.
	const sampleBytes = format.getUint16(14, true) / 8;
	let crossings = 0;
	for (let frame = 1_201; frame < 6_000; frame++) {
		const sign = index => pcm[index * blockAlign + sampleBytes - 1] >= 128;
		if (sign(frame - 1) && !sign(frame)) crossings++;
	}
	expect(crossings * 10).toBeGreaterThanOrEqual(870);
	expect(crossings * 10).toBeLessThanOrEqual(890);
	expect(parseBextPayload(chunks.get('bext')).metadata.timeReference).toBe('504000');
});

function riffChunks(bytes) {
	const chunks = new Map();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const size = view.getUint32(offset + 4, true);
		chunks.set(new TextDecoder().decode(bytes.subarray(offset, offset + 4)), bytes.subarray(offset + 8, offset + 8 + size));
		offset += 8 + size + (size & 1);
	}
	return chunks;
}

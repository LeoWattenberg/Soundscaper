/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseCartPayload } from '../../src/common/editor/cart-metadata.ts';
import {
	bootEditor, chooseDropdown, clipByName, clipField, closeClipProperties, disableNativeSavePicker,
	fileDataTransfer, importFiles, openClipProperties, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

test('a CART recording dropped later on the timeline retains its cue position in a whole-project delivery', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'leader.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(48_000)], { sampleRate: 48_000, bitDepth: 16 })) }]);
	const radio = { name: 'radio.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(48_000)], {
			sampleRate: 48_000, bitDepth: 16,
			cart: { title: 'Radio take', postTimers: [{ usage: 'SEC1', value: 24_000 }] },
		})) };
	const lane = editor.locator('.audio-editor-track-lane[data-track-lane]').first();
	const bounds = await lane.boundingBox();
	expect(bounds).not.toBeNull();
	const transfer = await fileDataTransfer(page, [radio]);
	const event = { dataTransfer: transfer, clientX: bounds.x + Math.min(220, bounds.width - 24), clientY: bounds.y + bounds.height / 2 };
	await lane.dispatchEvent('dragover', event);
	await lane.dispatchEvent('drop', event);
	await transfer.dispose();
	const clip = clipByName(editor, radio.name);
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const properties = await openClipProperties(page, editor, clip);
	const start = Number(await clipField(properties, 'startFrame').inputValue());
	expect(start).toBeGreaterThan(0);
	await closeClipProperties(properties);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let cart;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === 'cart') {
			cart = parseCartPayload(bytes.subarray(offset + 8, offset + 8 + size));
		}
		offset += 8 + size + (size % 2);
	}
	expect(cart?.postTimers).toEqual([{ usage: 'SEC1', value: start + 24_000 }]);
});

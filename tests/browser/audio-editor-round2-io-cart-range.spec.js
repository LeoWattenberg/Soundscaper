/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseCartPayload } from '../../src/common/editor/cart-metadata.ts';
import {
	bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';
import { selectClipRange } from './helpers/complex-editing-workflows.js';

test('a selected broadcast delivery rebases CART cues to the delivered audio and omits outside cues', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const buffer = encodeWav([new Float32Array(48_000)], {
		sampleRate: 48_000, bitDepth: 16, bext: { description: 'Radio continuity take' },
		cart: { title: 'Radio continuity take', postTimers: [
			{ usage: 'INT ', value: 4_800 }, { usage: 'SEC1', value: 24_000 }, { usage: 'EOD ', value: 48_000 },
		] },
	});
	await importFiles(editor, [{ name: 'radio-range.wav', mimeType: 'audio/wav', buffer: Buffer.from(buffer) }]);
	await selectClipRange(page, editor, clipByName(editor, 'radio-range.wav'), 0.25, 0.75);
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection start']);
	const startFrame = Number(await playhead.getAttribute('aria-valuenow'));
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
	const endFrame = Number(await playhead.getAttribute('aria-valuenow'));
	expect(startFrame).toBeGreaterThan(4_800);
	expect(startFrame).toBeLessThan(24_000);
	expect(endFrame).toBeGreaterThan(24_000);
	expect(endFrame).toBeLessThan(48_000);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Current selection');
	await dialog.locator('[data-export-field="sampleRate"] input').fill('96000');
	await dialog.locator('[data-export-field="sampleRate"] input').press('Tab');
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
	expect(cart?.title).toBe('Radio continuity take');
	expect(cart?.postTimers).toEqual([{ usage: 'SEC1', value: (24_000 - startFrame) * 2 }]);
});

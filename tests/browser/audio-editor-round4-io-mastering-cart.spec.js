/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseCartPayload } from '../../src/common/editor/cart-metadata.ts';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction, clipByName,
	closeDialog, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';
import { selectClipRange } from './helpers/complex-editing-workflows.js';

test('a mastering sequence rebases a radio cue to its delivered region', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'radio-sequence.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([
		Float32Array.from({ length: 48_000 }, (_, index) => 0.2 * Math.sin(index * Math.PI * 880 / 48_000)),
	], { sampleRate: 48_000, bitDepth: 16,
		cart: { title: 'Radio programme', postTimers: [{ usage: 'SEC1', value: 24_000 }] },
	})) }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const markers = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await selectClipRange(page, editor, clipByName(editor, 'radio-sequence.wav'), 0.25, 0.75);
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection start']);
	const start = Number(await editor.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow'));
	expect(start).toBeGreaterThan(0);
	expect(start).toBeLessThan(24_000);
	await markers.getByRole('button', { name: 'Add region from selection', exact: true }).click();
	const row = markers.locator('li').last();
	await row.locator('[data-timeline-annotation]').press('Enter');
	const name = row.getByRole('textbox', { name: 'Name', exact: true });
	await name.fill('Middle take');
	await name.press('Enter');
	await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
	const mastering = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
	await mastering.getByRole('button', { name: 'New sequence', exact: true }).click();
	const form = mastering.getByRole('form', { name: 'Sequence name', exact: true });
	await form.getByRole('textbox').fill('Radio order');
	await form.getByRole('button', { name: 'Sequence name', exact: true }).click();
	await mastering.getByRole('combobox', { name: 'Add region', exact: true }).selectOption({ label: 'Middle take' });
	await mastering.getByRole('button', { name: 'Add region', exact: true }).click();
	await closeDialog(mastering);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Radio order');
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
	expect(cart?.title).toBe('Radio programme');
	expect(cart?.postTimers).toEqual([{ usage: 'SEC1', value: 24_000 - start }]);
});

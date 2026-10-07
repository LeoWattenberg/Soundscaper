/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import {
	bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName, clipField, closeClipProperties, disableNativeSavePicker,
	fileDataTransfer, importFiles, openClipProperties, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';
import { selectClipRange } from './helpers/complex-editing-workflows.js';

test('an explicitly placed broadcast recording retains its source timestamp in a selected delivery', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'leader.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(48_000)], { sampleRate: 48_000, bitDepth: 16 })) }]);
	const originalReference = '172800000';
	const recording = { name: 'location.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(48_000)], {
			sampleRate: 48_000, bitDepth: 16,
			bext: { description: 'Location take', timeReference: originalReference },
		})) };
	const lane = editor.locator('.audio-editor-track-lane[data-track-lane]').first();
	const bounds = await lane.boundingBox();
	expect(bounds).not.toBeNull();
	const transfer = await fileDataTransfer(page, [recording]);
	const event = { dataTransfer: transfer, clientX: bounds.x + Math.min(220, bounds.width - 24), clientY: bounds.y + bounds.height / 2 };
	await lane.dispatchEvent('dragover', event);
	await lane.dispatchEvent('drop', event);
	await transfer.dispose();
	const clip = clipByName(editor, recording.name);
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const properties = await openClipProperties(page, editor, clip);
	const clipStart = Number(await clipField(properties, 'startFrame').inputValue());
	expect(clipStart).toBeGreaterThan(0);
	await closeClipProperties(properties);
	await selectClipRange(page, editor, clip, 0.25, 0.75);
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection start']);
	const selectionStart = Number(await playhead.getAttribute('aria-valuenow'));
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
	const selectionEnd = Number(await playhead.getAttribute('aria-valuenow'));
	expect(selectionStart).toBeGreaterThan(clipStart);
	expect(selectionEnd).toBeLessThan(clipStart + 48_000);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Current selection');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, download);
	const descriptor = await inspectWavBlobPcm(new Blob([bytes]));
	expect(descriptor?.frameCount).toBe(selectionEnd - selectionStart);
	expect(descriptor?.bext?.timeReference).toBe(String(BigInt(originalReference) + BigInt(selectionStart - clipStart)));
});

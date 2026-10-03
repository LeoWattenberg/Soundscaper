/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	clipByName,
	closeDialog,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('folder mute delivery', () => {
	registerAudioEditorHooks();

	test('renders a menu-created folder mute before and after reload, then restores its signal', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const track = clipByName(editor, toneA.name).locator('xpath=ancestor::*[@data-track-row][1]');
		await track.getByRole('button', { name: 'Track menu', exact: true }).click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu).toBeVisible();
		await trackMenu.getByRole('menuitem', {
			name: 'Move selection into new folder',
			exact: true,
		}).click();

		let folder = editor.locator('[data-track-folder-row]').first();
		await expect(folder).toBeVisible();
		const audibleRms = await exportWavRms(page, editor);
		expect(audibleRms).toBeGreaterThan(0.15);

		let mute = folder.getByRole('button', { name: 'Mute folder', exact: true });
		await mute.click();
		await expect(mute).toHaveAttribute('aria-pressed', 'true');
		const mutedRms = await exportWavRms(page, editor);
		expect(mutedRms).toBeLessThan(0.000_01);

		await page.reload();
		editor = await waitForEditor(page);
		folder = editor.locator('[data-track-folder-row]').first();
		mute = folder.getByRole('button', { name: 'Mute folder', exact: true });
		await expect(mute).toHaveAttribute('aria-pressed', 'true');
		const restoredMutedRms = await exportWavRms(page, editor);
		expect(restoredMutedRms).toBeLessThan(0.000_01);

		await mute.click();
		await expect(mute).toHaveAttribute('aria-pressed', 'false');
		const restoredRms = await exportWavRms(page, editor);
		expect(restoredRms).toBeGreaterThan(0.15);
		expect(Math.abs(restoredRms - audibleRms)).toBeLessThan(0.001);
		expect(errors).toEqual([]);
	});
});

async function exportWavRms(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '24-bit PCM');
	const link = dialog.locator('[data-export-download]');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	const downloadPromise = page.waitForEvent('download');
	await link.click();
	const rms = wavRms(await downloadBytes(await downloadPromise));
	await closeDialog(dialog);
	return rms;
}

function wavRms(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	expect(new TextDecoder('ascii').decode(bytes.subarray(0, 4))).toBe('RIFF');
	expect(new TextDecoder('ascii').decode(bytes.subarray(8, 12))).toBe('WAVE');
	let format = null;
	let audio = null;
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const id = new TextDecoder('ascii').decode(bytes.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		if (id === 'fmt ') format = bytes.subarray(offset + 8, offset + 8 + size);
		if (id === 'data') audio = bytes.subarray(offset + 8, offset + 8 + size);
		offset += 8 + size + (size & 1);
	}
	expect(format).not.toBeNull();
	expect(audio).not.toBeNull();
	const formatView = new DataView(format.buffer, format.byteOffset, format.byteLength);
	expect(formatView.getUint16(0, true)).toBe(1);
	expect(formatView.getUint16(14, true)).toBe(24);
	let squareSum = 0;
	let sampleCount = 0;
	for (let offset = 0; offset + 2 < audio.byteLength; offset += 3) {
		let value = audio[offset] | (audio[offset + 1] << 8) | (audio[offset + 2] << 16);
		if (value & 0x80_0000) value |= 0xff00_0000;
		const normalized = value / 0x80_0000;
		squareSum += normalized * normalized;
		sampleCount += 1;
	}
	expect(sampleCount).toBeGreaterThan(0);
	return Math.sqrt(squareSum / sampleCount);
}

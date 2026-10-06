/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties, clipField, closeClipProperties,
	chooseCommandAction, chooseNestedCommandAction, clickClipInterior, openExportDialog,
	chooseDropdown, downloadBytes, disableNativeSavePicker, showToolbarButton } from './audio-editor-test-helpers.js';

test('Reset pitch and speed clears the independent pitch while linkage is enabled', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const properties = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
	await properties.getByText('Pitch and tempo', { exact: true }).click();
	await clipField(properties, 'pitchCents').fill('6');
	await clipField(properties, 'pitchCents').press('Tab');
	const linked = properties.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true });
	await linked.check();
	await properties.getByRole('button', { name: 'Reset', exact: true }).click();
	await linked.uncheck();
	await expect(clipField(properties, 'pitchCents')).toHaveValue('0.00');
});

test('clip properties apply the exact entered start frame when Snap is enabled', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await showToolbarButton(page, editor, 'Snap');
	await editor.getByRole('checkbox', { name: 'Snap', exact: true }).check();
	const properties = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
	await properties.getByText('Media settings', { exact: true }).click();
	await clipField(properties, 'startFrame').fill('19200');
	await clipField(properties, 'startFrame').press('Tab');
	await expect(clipField(properties, 'startFrame')).toHaveValue('19200');
	await expect(clipByName(editor, monoTone.name)).toHaveAccessibleName(/starts at 0\.4 seconds/u);
});

test('paste into an existing clip retains repeated pauses from copied looped audio', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Always paste audio as a new clip', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const recording = createWavFixture({ name: 'repeated-pause.wav', frequency: 440, channelCount: 1 });
	recording.buffer.fill(0, 44 + 9_600 * 2, 44 + 14_400 * 2);
	await importFiles(editor, [recording, monoTone]);
	const repeated = clipByName(editor, recording.name);
	await repeated.locator('.clip-header').click();
	await repeated.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	const target = clipByName(editor, monoTone.name);
	await clickClipInterior(page, target, 0.5);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(target).toHaveAccessibleName(/2\.4 seconds long$/u, { timeout: 20_000 });
	const properties = await openClipProperties(page, editor, target);
	await properties.getByText('Media settings', { exact: true }).click();
	await expect(clipField(properties, 'durationFrame')).toHaveValue('115200');
	await closeClipProperties(properties);
	await repeated.locator('xpath=ancestor::div[@data-track-row][1]').getByRole('button', { name: 'Mute', exact: true }).click();
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const download = page.waitForEvent('download');
	await link.click();
	const bytes = await downloadBytes(await download);
	expect(wavPeakBetween(bytes, 0.62, 0.66)).toBeLessThan(0.005);
	expect(wavPeakBetween(bytes, 1.42, 1.46)).toBeLessThan(0.005);
});

function wavPeakBetween(bytes, startSeconds, endSeconds) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let sampleRate = 0;
	let channelCount = 0;
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const id = new TextDecoder('ascii').decode(bytes.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		if (id === 'fmt ') {
			channelCount = view.getUint16(offset + 10, true);
			sampleRate = view.getUint32(offset + 12, true);
			expect(view.getUint16(offset + 22, true)).toBe(16);
		}
		if (id === 'data') {
			let peak = 0;
			for (let frame = Math.floor(startSeconds * sampleRate); frame < Math.floor(endSeconds * sampleRate); frame += 1) {
				peak = Math.max(peak, Math.abs(view.getInt16(offset + 8 + frame * channelCount * 2, true)) / 32768);
			}
			return peak;
		}
		offset += 8 + size + (size & 1);
	}
	throw new Error('Exported WAV has no PCM data.');
}

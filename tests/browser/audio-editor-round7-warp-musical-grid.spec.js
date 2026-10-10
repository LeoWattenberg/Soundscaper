/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	clipByName, closeClipProperties, collectClientErrors, disableNativeSavePicker,
	importFiles, openClipProperties, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('one-bar warp quantization follows the tempo at the placed drum recording', async ({ page }) => {
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	const recording = createWavFixture({ name: 'Later drum recording.wav', frequency: 1000,
		duration: 5, channelCount: 1, channelAmplitudes: [0] });
	for (let frame = 0; frame < 1200; frame++) {
		const value = .8 * Math.sin(frame * Math.PI / 24) * (1 - frame / 1200);
		recording.buffer.writeInt16LE(Math.round(value * 32767), 44 + (139200 + frame) * 2);
	}
	await importFiles(editor, [recording]);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('60'); await tempo.press('Enter');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await musical.getByRole('button', { name: 'Add tempo event', exact: true }).click();
	const second = musical.getByRole('form', { name: 'Tempo event 2', exact: true });
	await expect(second.locator('[name="beatNum"]')).toHaveValue('4');
	await second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('120');
	await second.getByRole('button', { name: 'Save', exact: true }).click();
	await page.keyboard.press('Escape');
	const clip = clipByName(editor, recording.name);
	const properties = await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click({ position: { x: 16, y: 4 } });
	const start = properties.locator('[data-clip-field="startFrame"]');
	await start.locator('.timecode-digit').first().click();
	await page.keyboard.type('000004000'); await page.keyboard.press('Enter');
	await expect(start.locator('.timecode__display')).toHaveText('00h00m04.000s');
	await closeClipProperties(properties);
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption({ label: 'Soundscaper' });
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const openWarp = async () => {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		return page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	};
	let warp = await openWarp();
	let grid = warp.getByRole('group', { name: 'Grid interval', exact: true });
	await grid.locator('.timecode-digit').first().click();
	await page.keyboard.type('000000096000'); await page.keyboard.press('Enter');
	const strength = warp.getByRole('slider', { name: /Quantization strength/u });
	await strength.focus(); await page.keyboard.press('End');
	await warp.getByRole('button', { name: 'Quantize transients', exact: true }).click();
	await expect(warp).toContainText('Transients quantized.');
	await expect(warp.getByLabel('Marker 1 outer position', { exact: true })).toHaveValue('96000/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).last().click();
	const healthy = await exportedDrum(page, editor);
	expect(healthy.frames).toBe(432000);
	expect(healthy.peak).toBeGreaterThan(.3);
	expect(healthy.peakFrame).toBeGreaterThanOrEqual(288000);
	expect(healthy.peakFrame).toBeLessThan(290400);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	warp = await openWarp();
	await expect(warp.getByRole('button', { name: 'Create identity warp map', exact: true })).toBeEnabled();
	grid = warp.getByRole('group', { name: 'Grid interval', exact: true });
	await grid.locator('.timecode-digit').first().click();
	await page.keyboard.type('000000096000'); await page.keyboard.press('Enter');
	await grid.getByRole('button', { name: 'Grid interval: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
	await grid.locator('.timecode-digit').first().click();
	await page.keyboard.type('0011'); await page.keyboard.press('Enter');
	await expect(grid.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
	await warp.getByRole('slider', { name: /Quantization strength/u }).focus();
	await page.keyboard.press('End');
	await warp.getByRole('button', { name: 'Quantize transients', exact: true }).click();
	await expect(warp).toContainText('Transients quantized.');
	const musicalMarker = await warp.getByLabel('Marker 1 outer position', { exact: true }).inputValue();
	await warp.getByRole('button', { name: 'Close', exact: true }).last().click();
	const musicalResult = await exportedDrum(page, editor);
	expect(musicalResult.frames).toBe(healthy.frames);
	expect(musicalResult.peak).toBeGreaterThan(.3);
	expect(musicalResult.peakFrame).toBe(healthy.peakFrame);
	expect(musicalMarker).toBe('96000/1');
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});

async function exportedDrum(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Entire project');
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).uncheck();
	const link = dialog.locator('[data-export-download]');
	const previous = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20000 });
	await expect(link).not.toHaveAttribute('href', previous ?? '');
	const bytes = await readDownloadBytes(page, link);
	const result = await page.evaluate(async bytes => {
		const context = new OfflineAudioContext(2, 1, 48000);
		const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		const pcm = decoded.getChannelData(0);
		let peak = 0; let peakFrame = 0;
		for (let frame = 0; frame < pcm.length; frame++) {
			if (Math.abs(pcm[frame]) > peak) { peak = Math.abs(pcm[frame]); peakFrame = frame; }
		}
		return { frames: decoded.length, peak, peakFrame };
	}, Array.from(bytes));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return result;
}

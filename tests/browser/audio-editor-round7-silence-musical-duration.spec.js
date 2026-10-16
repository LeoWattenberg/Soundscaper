/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	clipByName, closeClipProperties, collectClientErrors, disableNativeSavePicker,
	importFiles, openClipProperties, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('Truncate Silence measures its musical threshold from the selected recording', async ({ page }) => {
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	const recording = createWavFixture({ name: 'Later voice with pause.wav', frequency: 1000,
		duration: 6, channelCount: 1, channelAmplitudes: [.4] });
	for (let frame = 72000; frame < 216000; frame++) recording.buffer.writeInt16LE(0, 44 + frame * 2);
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
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click({ position: { x: 16, y: 4 } });
	const start = properties.locator('[data-clip-field="startFrame"]');
	await start.locator('.timecode-digit').first().click();
	await page.keyboard.type('000004000'); await page.keyboard.press('Enter');
	await expect(start.locator('.timecode__display')).toHaveText('00h00m04.000s');
	await closeClipProperties(properties);
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption({ label: 'Soundscaper' });
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const openSilence = async () => {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Truncate Silence']);
		return page.getByRole('dialog', { name: 'Apply effect', exact: true });
	};
	let silence = await openSilence();
	let minimum = silence.locator('[data-effect-param="minimumSilence"]');
	await minimum.locator('.timecode-digit').first().click();
	await page.keyboard.type('000002000'); await page.keyboard.press('Enter');
	await silence.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(silence).toBeHidden({ timeout: 20000 });
	const healthy = await exportedRecording(page, editor);
	expect(healthy.frames).toBeGreaterThan(350000);
	expect(healthy.frames).toBeLessThan(370000);
	expect(healthy.rms).toBeGreaterThan(.15);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	silence = await openSilence();
	minimum = silence.locator('[data-effect-param="minimumSilence"]');
	await minimum.locator('.timecode-digit').first().click();
	await page.keyboard.type('000002000'); await page.keyboard.press('Enter');
	await minimum.getByRole('button', { name: /Minimum silence.*format/u }).click();
	await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
	await minimum.locator('.timecode-digit').first().click();
	await page.keyboard.type('0011'); await page.keyboard.press('Enter');
	await expect(minimum.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
	await silence.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(silence).toBeHidden({ timeout: 20000 });
	const musicalResult = await exportedRecording(page, editor);
	console.log('Native silence musical threshold', { healthy, musicalResult });
	expect(musicalResult.rms).toBeGreaterThan(.15);
	expect(musicalResult.frames).toBe(healthy.frames);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});

async function exportedRecording(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Entire project');
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).uncheck();
	const link = dialog.locator('[data-export-download]');
	const previous = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20000 });
	await expect(link).not.toHaveAttribute('href', previous ?? '');
	const bytes = await readDownloadBytes(page, link);
	const result = await page.evaluate(async encoded => {
		const context = new OfflineAudioContext(2, 1, 48000);
		const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
		const decoded = await context.decodeAudioData(bytes.buffer);
		const pcm = decoded.getChannelData(0);
		let energy = 0;
		for (let frame = 200000; frame < 240000; frame++) energy += pcm[frame] ** 2;
		return { frames: decoded.length, rms: Math.sqrt(energy / 40000) };
	}, Buffer.from(bytes).toString('base64'));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return result;
}

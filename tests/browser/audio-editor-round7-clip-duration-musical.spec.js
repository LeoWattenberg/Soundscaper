/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, clipByName, closeClipProperties,
	collectClientErrors, disableNativeSavePicker, importFiles, openClipProperties, openExportDialog,
	readDownloadBytes } from './audio-editor-test-helpers.js';

test('Clip properties one-bar duration follows tempo at the placed recording', async ({ page }) => {
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	const recording = createWavFixture({ name: 'Later duration.wav', frequency: 1000,
		duration: 5, channelCount: 1, channelAmplitudes: [.4] });
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
	let properties = await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click({ position: { x: 16, y: 4 } });
	const start = properties.locator('[data-clip-field="startFrame"]');
	await enter(start, '000004000');
	await expect(start.locator('.timecode__display')).toHaveText('00h00m04.000s');
	let duration = properties.locator('[data-clip-field="durationFrame"]');
	await enter(duration, '000003000');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m03.000s');
	await closeClipProperties(properties);
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption({ label: 'Soundscaper' });
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const healthy = await exportedAudio();
	expect(healthy.frames).toBe(336000); expect(healthy.peak).toBeGreaterThan(.2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	properties = await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click({ position: { x: 16, y: 4 } });
	duration = properties.locator('[data-clip-field="durationFrame"]');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m05.000s');
	await duration.getByRole('button', { name: 'Duration: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
	await enter(duration, '0011');
	await closeClipProperties(properties);
	const localBar = await exportedAudio();
	expect(localBar.peak).toBeGreaterThan(.2); expect(localBar.frames).toBe(288000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	expect((await exportedAudio()).frames).toBe(432000);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	expect((await exportedAudio()).frames).toBe(288000);
	await expect(editor.getByRole('alert')).toHaveCount(0); expect(errors).toEqual([]);

	async function enter(field, digits) {
		await field.locator('.timecode-digit').first().click();
		await page.keyboard.type(digits); await page.keyboard.press('Enter');
	}
	async function exportedAudio() {
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
			const context = new OfflineAudioContext(1, 1, 48000);
			const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
			const decoded = await context.decodeAudioData(bytes.buffer);
			let peak = 0;
			for (const value of decoded.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
			return { frames: decoded.length, peak };
		}, Buffer.from(bytes).toString('base64'));
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		return result;
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	clipByName, closeClipProperties, collectClientErrors, disableNativeSavePicker,
	importFiles, openClipProperties, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const effect of ['Change tempo', 'Change speed and pitch']) {
	test(`${effect} desired musical duration follows the selected recording's tempo`, async ({ page }) => {
		const errors = collectClientErrors(page);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/en/');
		await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
		const recording = createWavFixture({ name: 'Later rate recording.wav', frequency: 1000,
			duration: 3, channelCount: 1, channelAmplitudes: [.4] });
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
		const openRate = async () => {
			await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', effect]);
			return page.getByRole('dialog', { name: 'Apply effect', exact: true });
		};
		let rate = await openRate();
		let desired = rate.locator('[data-effect-param="effectAudacityNewLength"]');
		await expect(rate.locator('[data-effect-param="effectAudacityCurrentLength"] .timecode__display')).toHaveText('00h00m03.000s');
		await desired.locator('.timecode-digit').first().click();
		await page.keyboard.type('000002000'); await page.keyboard.press('Enter');
		await rate.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(rate).toBeHidden({ timeout: 20000 });
		const healthy = await exportedRecording(page, editor);
		expect(healthy.frames).toBe(288000);
		expect(healthy.rms).toBeGreaterThan(.15);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		rate = await openRate();
		await expect(rate.locator('[data-effect-param="effectAudacityCurrentLength"] .timecode__display')).toHaveText('00h00m03.000s');
		desired = rate.locator('[data-effect-param="effectAudacityNewLength"]');
		await desired.locator('.timecode-digit').first().click();
		await page.keyboard.type('000002000'); await page.keyboard.press('Enter');
		await desired.getByRole('button', { name: /Desired duration.*format/u }).click();
		await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
		await desired.locator('.timecode-digit').first().click();
		await page.keyboard.type('0011'); await page.keyboard.press('Enter');
		await expect(desired.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
		await rate.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(rate).toBeHidden({ timeout: 20000 });
		const musicalResult = await exportedRecording(page, editor);
		console.log('Native rate musical duration', { effect, healthy, musicalResult });
		expect(musicalResult.rms).toBeGreaterThan(.15);
		expect(musicalResult.frames).toBe(healthy.frames);
		await expect(editor.getByRole('alert')).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

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
	const result = await page.evaluate(async bytes => {
		const context = new OfflineAudioContext(2, 1, 48000);
		const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		const pcm = decoded.getChannelData(0);
		let energy = 0;
		for (let frame = 200000; frame < 240000; frame++) energy += pcm[frame] ** 2;
		return { frames: decoded.length, rms: Math.sqrt(energy / 40000) };
	}, Array.from(bytes));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return result;
}

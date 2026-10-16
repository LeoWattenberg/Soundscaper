/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseDropdown, closeDialog,
	collectClientErrors, commitInput, disableNativeSavePicker, importFiles, openEffectsForTrack,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('a selected delivery retains the ordinary finite echoes heard in the complete mix', async ({ page }) => {
	test.setTimeout(180_000);
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'steady quiet recording.wav', frequency: 500,
		duration: 20, channelCount: 1, channelAmplitudes: [.02] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Delay');
	const effect = page.getByRole('dialog', { name: 'Delay', exact: true });
	for (const [parameter, value] of [['time', '2'], ['echoes', '10'], ['echoGain', '0']]) {
		await commitInput(effect.locator(`[data-effect-param="${parameter}"] input[type="number"]`), value);
	}
	await closeDialog(effect);
	const complete = await exportWindow(page, editor, false);
	expect(complete.frames).toBe(960_000);
	// The first echo starts at two seconds. These equal-length, whole-cycle
	// windows avoid the clip fades and compare dry audio with its finite echoes.
	expect(complete.preEchoRms).toBeGreaterThan(.009);
	expect(complete.preEchoRms).toBeLessThan(.011);
	expect(complete.rms).toBeGreaterThan(complete.preEchoRms * 8);
	for (const [name, frame] of [['Selection start', 864_000], ['Selection end', 912_000]]) {
		const control = editor.getByRole('group', { name, exact: true });
		await control.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await control.locator('.timecode-digit').first().click();
		await page.keyboard.type(String(frame).padStart(12, '0'));
		await page.keyboard.press('Enter');
		await expect(control.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
	const selected = await exportWindow(page, editor, true);
	expect(selected.frames).toBe(48_000);
	expect(selected.rms / complete.rms).toBeGreaterThan(.99);
	expect(selected.rms / complete.rms).toBeLessThan(1.01);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});

async function exportWindow(page, editor, selected) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), selected ? 'Current selection' : 'Entire project');
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).uncheck();
	const link = dialog.locator('[data-export-download]');
	const previous = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect(link).not.toHaveAttribute('href', previous ?? '');
	const bytes = await readDownloadBytes(page, link);
	const measurements = await page.evaluate(async ({ bytes, selected }) => {
		const context = new OfflineAudioContext(2, 1, 48_000);
		const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		const channel = decoded.getChannelData(0);
		const rms = (begin, end) => {
			let squares = 0;
			for (let frame = begin; frame < end; frame++) squares += channel[frame] ** 2;
			return Math.sqrt(squares / (end - begin));
		};
		return { frames: decoded.length,
			rms: rms(selected ? 4_800 : 868_800, selected ? 43_200 : 907_200),
			preEchoRms: selected ? null : rms(4_800, 43_200) };
	}, { bytes: Array.from(bytes), selected });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return measurements;
}

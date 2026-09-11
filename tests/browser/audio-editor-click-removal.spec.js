/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture, readFile } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction,
	chooseDropdown, closeDialog, closeEffectsPanel, collectClientErrors,
	disableNativeSavePicker, importFiles, openEffectsForTrack, openExportDialog,
	registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

// A quiet tone with two isolated impulses. Export assertions measure audible
// repair rather than merely checking that a new source or download exists.
function clickedTone() {
	const fixture = createWavFixture({ name: 'clicks.wav', frequency: 220,
		duration: 0.5, channelCount: 1, channelAmplitudes: [0.01] });
	fixture.buffer.writeInt16LE(30000, 44 + 10000 * 2);
	fixture.buffer.writeInt16LE(-28000, 44 + 10001 * 2);
	return fixture;
}

async function openClickRemoval(page, editor) {
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Click Removal']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function exportAudio(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20000 });
	const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
	const bytes = await readFile(await download.path());
	const result = await page.evaluate(async (data) => {
		const context = new AudioContext({ sampleRate: 48000 });
		try {
			const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
			const samples = audio.getChannelData(0);
			let peak = 0;
			let toneEnergy = 0;
			for (let frame = 0; frame < samples.length; frame++) {
				peak = Math.max(peak, Math.abs(samples[frame]));
				if (frame >= 2000 && frame < 4000) toneEnergy += samples[frame] ** 2;
			}
			return { peak, toneRms: Math.sqrt(toneEnergy / 2000), duration: audio.duration };
		} finally { await context.close(); }
	}, Array.from(bytes));
	await closeDialog(dialog);
	return result;
}

test.describe('Click Removal', () => {
	registerAudioEditorHooks();
	test.beforeEach(async ({ page }) => { await disableNativeSavePicker(page); });

	test('repairs clicks from the menu and restores audio with undo and redo', async ({ page }) => {
		test.setTimeout(90000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [clickedTone()]);
		const original = await exportAudio(page, editor);
		expect(original.peak).toBeGreaterThan(0.3);
		const dialog = await openClickRemoval(page, editor);
		await expect(dialog.getByRole('spinbutton', { name: 'Threshold', exact: true })).toHaveValue('200');
		await expect(dialog.getByRole('spinbutton', { name: 'Maximum spike width (samples)', exact: true })).toHaveValue('20');
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden();
		const repaired = await exportAudio(page, editor);
		expect(repaired.peak).toBeLessThan(original.peak / 10);
		expect(repaired.toneRms).toBeCloseTo(original.toneRms, 4);
		expect(repaired.duration).toBeCloseTo(original.duration, 4);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		const undone = await exportAudio(page, editor);
		expect(undone.peak).toBeCloseTo(original.peak, 4);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		const redone = await exportAudio(page, editor);
		expect(redone.peak).toBeCloseTo(repaired.peak, 4);
		expect(errors).toEqual([]);
	});

	test('closing changed controls leaves the original audio untouched', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [clickedTone()]);
		const original = await exportAudio(page, editor);
		const dialog = await openClickRemoval(page, editor);
		const threshold = dialog.getByRole('spinbutton', { name: 'Threshold', exact: true });
		await threshold.fill('100');
		await threshold.press('Tab');
		await closeDialog(dialog);
		const unchanged = await exportAudio(page, editor);
		// Export dithering can change the least significant sample bits.
		expect(unchanged.peak).toBeCloseTo(original.peak, 4);
		expect(unchanged.toneRms).toBeCloseTo(original.toneRms, 4);
		expect(unchanged.duration).toBe(original.duration);
		expect(errors).toEqual([]);
	});

	test('persists live rack controls and removes clicks during offline export', async ({ page }) => {
		test.setTimeout(60000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [clickedTone()]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Click Removal');
		const dialog = page.getByRole('dialog', { name: 'Click Removal', exact: true });
		for (const [name, value] of [['Threshold', '180'], ['Maximum spike width (samples)', '24']]) {
			const control = dialog.getByRole('spinbutton', { name, exact: true });
			await control.fill(value);
			await control.press('Tab');
		}
		await closeDialog(dialog);
		await closeEffectsPanel(panel);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restored = await waitForEditor(page);
		const restoredPanel = await openEffectsForTrack(restored, 1);
		await restoredPanel.getByRole('group', { name: 'Click Removal', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		const restoredDialog = page.getByRole('dialog', { name: 'Click Removal', exact: true });
		await expect(restoredDialog.getByRole('spinbutton', { name: 'Threshold', exact: true })).toHaveValue('180');
		await expect(restoredDialog.getByRole('spinbutton', { name: 'Maximum spike width (samples)', exact: true })).toHaveValue('24');
		await closeDialog(restoredDialog);
		await closeEffectsPanel(restoredPanel);
		const repaired = await exportAudio(page, restored);
		expect(repaired.peak).toBeLessThan(0.05);
		expect(repaired.toneRms).toBeGreaterThan(0.001);
		expect(repaired.duration).toBeCloseTo(0.5, 2);
		expect(errors).toEqual([]);
	});
});

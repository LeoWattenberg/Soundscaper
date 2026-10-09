/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzipSync } from 'fflate';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName,
	closeDialog, closeEffectsPanel, disableNativeSavePicker, importFiles, openEffectsForTrack,
	openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

for (const frozen of [false, true]) test(`individual clip export ${frozen ? 'explains the normal frozen-track refusal' : 'delivers ordinary unfrozen PCM'}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	if (frozen) {
		const effects = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, effects, 'track', 'Feedback delay');
		await closeDialog(page.getByRole('dialog', { name: 'Feedback delay', exact: true }));
		await closeEffectsPanel(effects);
		await clipByName(editor, toneA.name).locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Window', ['History']);
		const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li');
		const count = await history.count();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
		await expect(history).toHaveCount(count + 1, { timeout: 10_000 });
	}
	const dialog = await openExportDialog(page, editor);
	await dialog.locator('[data-export-field="output"]').getByRole('button').click();
	await expect(page.getByRole('listbox', { name: 'Output', exact: true })).toBeVisible();
	const option = page.getByRole('option', { name: 'Individual clips (split by clips)', exact: true });
	if (frozen) {
		await expect(option).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(dialog.locator('[data-export-clips-unavailable]')).toContainText('Unfreeze');
	} else {
		await expect(option).not.toHaveAttribute('aria-disabled', 'true');
		await option.click();
		await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	}
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const delivered = await readDownloadBytes(page, link);
	const bytes = frozen ? delivered : Object.values(unzipSync(delivered))[0];
	const audio = await audioMetrics(page, bytes);
	expect(audio.frames).toBeGreaterThanOrEqual(38_400);
	expect(audio.peak).toBeGreaterThan(.1);
	if (frozen) {
		await closeDialog(dialog);
		await clipByName(editor, toneA.name).locator('.clip-header').click();
		const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li');
		const count = await history.count();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Unfreeze track']);
		await expect(history).toHaveCount(count + 1);
		const restored = await openExportDialog(page, editor);
		await expect(restored.locator('[data-export-clips-unavailable]')).toHaveCount(0);
		await chooseDropdown(page, restored.locator('[data-export-field="output"]'), 'Individual clips (split by clips)');
		await restored.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(restored.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
		const clips = Object.values(unzipSync(await readDownloadBytes(page, restored.locator('[data-export-download]'))));
		expect(clips).toHaveLength(1);
		const restoredAudio = await audioMetrics(page, clips[0]);
		expect(restoredAudio.frames).toBe(38_400);
		expect(restoredAudio.peak).toBeGreaterThan(.1);
	}
});

async function audioMetrics(page, bytes) {
	return page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const decoded = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return { frames: decoded.length, peak: decoded.getChannelData(0).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
		} finally { await context.close(); }
	}, Array.from(bytes));
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, clipByName,
	closeWorkspacePanel, disableNativeSavePicker, downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function rms(samples, start = 4_800, end = 14_400) {
	const window = samples.slice(start, end);
	return Math.sqrt(window.reduce((sum, value) => sum + value ** 2, 0) / window.length);
}

test('an ordinary gain-automated DAWproject round trip keeps its audible level', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-workspace-panel="mixer"]');
	const fader = mixer.locator('.kw-audio-editor__mixer-channel--track').last().getByRole('slider', { name: /volume$/u });
	for (let step = 0; step < 6; step += 1) await fader.press('ArrowDown');
	expect(Number(await fader.getAttribute('aria-valuenow'))).toBeLessThan(-6);
	await closeWorkspacePanel(editor, 'mixer');
	const row = clipByName(editor, monoTone.name).locator('xpath=ancestor::div[@data-track-row]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const curve = row.locator('[data-automation-insert-point]').first();
	await curve.focus();
	await page.keyboard.press('i');
	await expect(row.locator('[data-automation-point-id]')).toHaveCount(2);
	const lastPoint = row.locator('[data-automation-point-id]').last();
	const priorValue = Number(await lastPoint.getAttribute('aria-valuenow'));
	for (let step = 0; step < 6; step += 1) await lastPoint.press('ArrowDown');
	const finalValue = await lastPoint.getAttribute('aria-valuenow');
	expect(Number(finalValue)).toBeLessThan(priorValue);
	const before = await exportSamples(page, editor);
	expect(rms(before)).toBeGreaterThan(0.01);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading;
	const bytes = await downloadBytes(download);
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length);
	expect(rms(after) / rms(before)).toBeCloseTo(1, 3);
	expect(rms(after, 28_800, 33_600) / rms(before, 28_800, 33_600)).toBeCloseTo(1, 3);
	const importedRow = clipByName(editor, monoTone.name.replace(/\.[^.]+$/u, '')).locator('xpath=ancestor::div[@data-track-row]');
	await chooseTrackMenuAction(page, editor, importedRow, 'Add automation');
	await expect(importedRow.locator('[data-automation-point-id]')).toHaveCount(2);
	await expect(importedRow.locator('[data-automation-point-id]').last()).toHaveAttribute('aria-valuenow', finalValue);
});

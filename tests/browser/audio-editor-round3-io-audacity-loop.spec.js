/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseFileAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function rms(samples, start, end) {
	let sum = 0;
	for (let index = Math.round(start * 48_000); index < Math.round(end * 48_000); index += 1) sum += samples[index] ** 2;
	return Math.sqrt(sum / Math.round((end - start) * 48_000));
}

test('Audacity project export materializes the audible repeats of a normally extended clip', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'looped-pause.wav', frequency: 1000, duration: 0.8, channelCount: 1 });
	recording.buffer.fill(0, 44 + 9_600 * 2, 44 + 14_400 * 2);
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
	const before = await exportSamples(page, editor);
	expect(rms(before, 1.05, 1.08)).toBeLessThan(0.0001);
	expect(rms(before, 0.9, 0.95)).toBeGreaterThan(0.1);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AUP4']);
	const download = await downloading;
	const bytes = await downloadBytes(download);
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length);
	expect(rms(after, 1.05, 1.08)).toBeLessThan(0.0001);
	expect(rms(after, 0.9, 0.95)).toBeGreaterThan(0.1);
});

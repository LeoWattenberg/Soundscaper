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

test('Audacity project round trip keeps the audible position of an authored nonlinear warp', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'warped-production-pause.wav', frequency: 1000, duration: 1, channelCount: 1 });
	// A normal recording with a quarter-second pause, retaining its PCM WAV header.
	recording.buffer.fill(0, 44 + 12_000 * 2, 44 + 24_000 * 2);
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('24000');
	await warp.getByLabel('Source sample', { exact: true }).fill('36000');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	const before = await exportSamples(page, editor);
	expect(rms(before, 0.2, 0.24)).toBeLessThan(0.001);
	expect(rms(before, 0.1, 0.14)).toBeGreaterThan(0.1);
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
	expect(rms(after, 0.2, 0.24)).toBeLessThan(0.001);
	expect(rms(after, 0.1, 0.14)).toBeGreaterThan(0.1);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties,
	disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const warped of [false, true]) test(`Source trim retains the ${warped ? 'authored nonlinear' : 'ordinary'} recording timing`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'source-trim.wav', frequency: 1000,
		duration: 1, channelCount: 1 });
	recording.buffer.fill(0, 44 + 12_000 * 2, 44 + 24_000 * 2);
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	if (warped) {
		await clip.locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
		await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
		await warp.getByLabel('Outer position', { exact: true }).fill('24000');
		await warp.getByLabel('Source sample', { exact: true }).fill('36000');
		await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
		await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
		await warp.getByRole('button', { name: 'Close', exact: true }).click();
	}
	const before = await exportSamples(page, editor);
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByRole('button', { name: 'Trim source end', exact: true }).press('Shift+ArrowLeft');
	await closeClipProperties(properties);
	const expectedFrames = warped ? 38_400 : 43_200;
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(expectedFrames);
	const pause = warped ? [.2, .24] : [.3, .4];
	expect(rms(before, ...pause)).toBeLessThan(.001);
	expect(rms(after, ...pause)).toBeLessThan(.001);
	expect(rms(after, .1, .14)).toBeGreaterThan(.1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clip).toHaveAccessibleName(/1 second long$/u);
	const restored = await exportSamples(page, editor);
	expect(restored).toHaveLength(before.length);
	expect(rms(restored, ...pause)).toBeLessThan(.001);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	expect(await exportSamples(page, editor)).toHaveLength(expectedFrames);
});

function rms(samples, start, end) {
	const first = Math.round(start * 48_000);
	const last = Math.round(end * 48_000);
	let sum = 0;
	for (let frame = first; frame < last; frame++) sum += samples[frame] ** 2;
	return Math.sqrt(sum / (last - first));
}

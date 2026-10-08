/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
} from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function recording(sampleRate) {
	const result = createWavFixture({ name: `production-pause-${sampleRate}.wav`, frequency: 1000,
		duration: 1, sampleRate, channelCount: 1 });
	result.buffer.fill(0, 44 + sampleRate / 4 * 2, 44 + sampleRate / 2 * 2);
	return result;
}

function rms(samples, start, end) {
	let sum = 0;
	for (let index = Math.round(start * 48_000); index < Math.round(end * 48_000); index += 1) sum += samples[index] ** 2;
	return Math.sqrt(sum / Math.round((end - start) * 48_000));
}

async function openWarp(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	return page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
}

test('replacing a warped recording at another sample rate retains its audible source positions', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const adding = page.waitForEvent('filechooser');
	await editor.locator('button').getByText('Add audio to Project bin', { exact: true }).click();
	await (await adding).setFiles(recording(48_000));
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	const sourceId = await card.getAttribute('data-source-id');
	expect(sourceId).toBeTruthy();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	const clip = clipByName(editor, 'production-pause-48000.wav');
	await clip.locator('.clip-header').click();
	const warp = await openWarp(page, editor);
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('24000');
	await warp.getByLabel('Source sample', { exact: true }).fill('36000');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	const before = await exportSamples(page, editor);
	expect(rms(before, 0.2, 0.24)).toBeLessThan(0.001);
	expect(rms(before, 0.1, 0.14)).toBeGreaterThan(0.1);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await card.getByRole('button', { name: /More file actions/u }).click();
	const replacing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await replacing).setFiles(recording(24_000));
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await expect(card).not.toHaveAttribute('data-source-id', sourceId);
	await clip.locator('.clip-header').click();
	const replacedWarp = await openWarp(page, editor);
	await expect(replacedWarp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('18000/1');
	await replacedWarp.getByRole('button', { name: 'Close', exact: true }).click();
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length);
	expect(rms(after, 0.2, 0.24)).toBeLessThan(0.001);
	expect(rms(after, 0.1, 0.14)).toBeGreaterThan(0.1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(card).toHaveAttribute('data-source-id', sourceId);
	await clip.locator('.clip-header').click();
	const restoredWarp = await openWarp(page, editor);
	await expect(restoredWarp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
	await restoredWarp.getByRole('button', { name: 'Close', exact: true }).click();
});

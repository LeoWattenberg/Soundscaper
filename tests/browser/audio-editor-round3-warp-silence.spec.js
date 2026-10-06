/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Split clips at silences removes the pause at its authored warped timeline position', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'recording-with-pause.wav', frequency: 440, duration: 1, channelCount: 1 });
	// A normal mono recording with a quarter-second pause, retaining a standard PCM WAV header.
	recording.buffer.fill(0, 44 + 12_000 * 2, 44 + 24_000 * 2);
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('24000');
	await warp.getByLabel('Source sample', { exact: true }).fill('36000');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split clips at silences']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name).first());
	await properties.getByText('Media settings', { exact: true }).click();
	const duration = properties.locator('[data-clip-field="durationFrame"]');
	await duration.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(duration.locator('.timecode__display')).toHaveText('000,000,008,000samples');
});

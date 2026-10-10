/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('the same frequency in either stereo spectrogram channel selects the same band', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'stereo spectrum.wav', duration: 2, channelCount: 2 });
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.getByRole('button', { name: 'Spectral brush', exact: true });
	const bounds = await brush.boundingBox();
	expect(bounds).not.toBeNull();
	const center = editor.locator('.audio-editor-spectral-selection__handle--frequency-center');
	await brush.click({ position: { x: 80, y: bounds.height / 4 } });
	await expect(center).toBeVisible();
	const first = Number(await center.getAttribute('aria-valuenow'));
	expect(first).toBeGreaterThan(0);
	const selectedBounds = await center.boundingBox();
	expect(selectedBounds).not.toBeNull();
	expect(Math.abs(selectedBounds.y + selectedBounds.height / 2 - (bounds.y + bounds.height / 4))).toBeLessThan(4);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await expect(center).toHaveCount(0);
	await brush.click({ position: { x: 80, y: bounds.height * 3 / 4 } });
	await expect(center).toBeVisible();
	const second = Number(await center.getAttribute('aria-valuenow'));
	expect(Math.abs(second - first)).toBeLessThan(Math.max(10, first * .03));
});

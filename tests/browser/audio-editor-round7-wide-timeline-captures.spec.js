/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, closeDialog,
	disableNativeSavePicker, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const channelCount of [2, 4]) {
	test(`a macro Invert captures every channel of an ordinary ${channelCount}-channel recording`, async ({ page }) => {
		const { editor, original } = await importRecording(page, channelCount);
		await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
		const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
		await manager.getByRole('button', { name: 'New program', exact: true }).click();
		await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("await sound.effect('audacity-invert');");
		await manager.getByRole('button', { name: 'Run program', exact: true }).click();
		await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed', { timeout: 10_000 });
		await manager.getByRole('button', { name: 'Close', exact: true }).click();
		const actual = await exportSamples(page, editor);
		expect(actual).toHaveLength(original.length);
		let maximumError = 0;
		for (let frame = 4800; frame < 43_200; frame++) {
			maximumError = Math.max(maximumError, Math.abs(actual[frame] + original[frame]));
		}
		expect(maximumError).toBeLessThan(.0001);
	});

	test(`a track noise profile captures an ordinary ${channelCount}-channel recording`, async ({ page }) => {
		const { editor } = await importRecording(page, channelCount);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Noise Reduction');
		const rack = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
		await expect(rack.getByRole('button', { name: 'Get noise profile', exact: true })).toBeVisible();
		await rack.getByRole('button', { name: 'Get noise profile', exact: true }).click();
		await expect(rack.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible({ timeout: 10_000 });
		await closeDialog(rack);
		const profiled = await exportSamples(page, editor);
		expect(profiled).toHaveLength(48_000 + 2_047);
		expect(profiled.every(Number.isFinite)).toBe(true);
	});
}

async function importRecording(page, channelCount) {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: `capture-${channelCount}-channels.wav`,
		frequency: 750, duration: 1, channelCount })]);
	const original = await exportSamples(page, editor);
	expect(original).toHaveLength(48_000);
	expect(original.slice(4800, 43_200).some(value => Math.abs(value) > .1)).toBe(true);
	await editor.locator('[data-clip-id]').first().locator('.clip-header').click();
	return { editor, original };
}

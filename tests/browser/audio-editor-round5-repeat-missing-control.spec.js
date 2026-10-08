/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function peak(samples) { return samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0); }

test('Repeat last effect refuses its removed control instead of using a cancelled draft', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, ['music', 'quiet', 'voice'].map((name, index) => createWavFixture({
		name: `${name}.wav`, duration: 2, frequency: index ? 1000 : 330,
		channelCount: 1, channelAmplitudes: [index === 1 ? 0 : .2],
	})));
	const musicTrackId = await clipByName(editor, 'music.wav').locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
	const musicRow = editor.locator(`[data-track-row][data-track-id="${musicTrackId}"]`);
	const voiceRow = clipByName(editor, 'voice.wav').locator('xpath=ancestor::div[@data-track-row]');
	await voiceRow.getByRole('button', { name: 'Mute', exact: true }).click();
	await musicRow.locator('.clip-header').first().click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Auto Duck']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await chooseDropdown(page, effect.getByRole('group', { name: 'Control track', exact: true }), 'quiet');
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	const before = await exportSamples(page, editor);
	expect(peak(before)).toBeGreaterThan(.13);
	expect(peak(before)).toBeLessThan(.15);
	await clipByName(editor, 'quiet.wav').locator('xpath=ancestor::div[@data-track-row]').locator('.track-control-panel__track-name-text').click();
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await musicRow.locator('.clip-header').first().click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Auto Duck']);
	await chooseDropdown(page, effect.getByRole('group', { name: 'Control track', exact: true }), 'voice');
	await effect.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseCommandAction(page, editor, 'Effect', 'Repeat last effect');
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden({ timeout: 20_000 });
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length);
	let difference = 0;
	for (let frame = 0; frame < before.length; frame++) difference = Math.max(difference, Math.abs(after[frame] - before[frame]));
	expect(difference).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clipByName(editor, 'quiet.wav')).toBeVisible();
	await musicRow.locator('.clip-header').first().click();
	await chooseCommandAction(page, editor, 'Effect', 'Repeat last effect');
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden({ timeout: 20_000 });
	const recovered = await exportSamples(page, editor);
	expect(recovered.length).toBe(before.length);
	expect(peak(recovered)).toBeGreaterThan(.13);
	expect(peak(recovered)).toBeLessThan(.15);
});

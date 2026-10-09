/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior,
	clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('smoothing a loop fragment leaves its unselected source phase unchanged', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const recording = createWavFixture({ name: 'smooth-loop.wav', frequency: 1000, duration: 0.002, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clips = clipByName(editor, recording.name);
	await clips.locator('.clip-header').click();
	await clips.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const original = await exportSamples(page, editor);
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clips, 1 / 3);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await clickClipInterior(page, clips.last(), 0.5);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await split.click();
	const middle = clips.nth(1);
	const clipId = await middle.getAttribute('data-clip-id');
	const fragment = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	await fragment.locator('.clip-header').click();
	await fragment.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Select', ['Audio clips', 'Cursor to next clip boundary']);
	const tools = editor.getByRole('toolbar', { name: 'Sample tools', exact: true });
	await expect(tools).toBeVisible();
	await fragment.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const untouched = await exportSamples(page, editor);
	expect(untouched[136]).toBeCloseTo(original[40] * 2, 5);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await tools.getByRole('button', { name: 'Smooth selection', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
	await fragment.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const samples = await exportSamples(page, editor);
	// Extending this same fragment reveals phase 40, outside both halves of the
	// original wrapped selection (64–95 and 0–31). It must retain the source PCM.
	expect(samples[136]).toBeCloseTo(untouched[136], 5);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await exportSamples(page, editor);
	expect(redone[136]).toBeCloseTo(untouched[136], 5);
});

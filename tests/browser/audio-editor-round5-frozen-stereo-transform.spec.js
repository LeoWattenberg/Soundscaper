/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture, monoTone } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	closeDialog, closeEffectsPanel, disableNativeSavePicker, importFiles, openEffectsForTrack,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const silent = createWavFixture({ name: 'frozen-stereo-silent-right.wav', frequency: 660,
	channelCount: 1, channelAmplitudes: [0] });

test('Make stereo accepts a frozen mono recording and preserves the authored output', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, silent]);
	const programme = clipByName(editor, monoTone.name);
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Feedback delay');
	await closeDialog(page.getByRole('dialog', { name: 'Feedback delay', exact: true }));
	await closeEffectsPanel(effects);
	await programme.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li');
	const beforeFreeze = await history.count();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
	await expect(history).toHaveCount(beforeFreeze + 1, { timeout: 10_000 });
	const before = await exportSamples(page, editor);
	const track = programme.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Make stereo track']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('alert')).toHaveCount(0);
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length);
	const rms = samples => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
	expect(rms(after)).toBeCloseTo(rms(before) * Math.SQRT2, 3);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

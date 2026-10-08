/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture, monoTone } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, clipByName, closeDialog,
	closeEffectsPanel, commitInput, disableNativeSavePicker, importFiles, openEffectsForTrack,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const silent = createWavFixture({ name: 'silent-right.wav', frequency: 660,
	channelCount: 1, channelAmplitudes: [0] });

function tailRms(samples) {
	const tail = samples.slice(48_000, 57_600);
	return Math.sqrt(tail.reduce((sum, sample) => sum + sample * sample, 0) / tail.length);
}

test('Make stereo retains the audible authored rack tail when replacing the two mono tracks', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, silent]);
	const programme = clipByName(editor, monoTone.name);
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Feedback delay');
	const delay = page.getByRole('dialog', { name: 'Feedback delay', exact: true });
	for (const [parameter, value] of Object.entries({ time: '0.5', feedback: '0', mix: '1' })) {
		await commitInput(delay.locator(`[data-effect-param="${parameter}"] input`), value);
	}
	await closeDialog(delay);
	await closeEffectsPanel(effects);
	const before = await exportSamples(page, editor);
	expect(before.length).toBe(62_400);
	expect(tailRms(before)).toBeGreaterThan(0.1);
	const track = programme.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Make stereo track']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length);
	expect(tailRms(after)).toBeGreaterThan(0.1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	expect(tailRms(await exportSamples(page, editor))).toBeGreaterThan(0.1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	expect(tailRms(await exportSamples(page, editor))).toBeGreaterThan(0.1);
});

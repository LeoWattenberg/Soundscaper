/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture, monoTone } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	closeDialog, closeEffectsPanel, disableNativeSavePicker, importFiles, openEffectsForTrack,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const quiet = createWavFixture({ name: 'quiet-detector.wav', frequency: 660,
	channelCount: 1, channelAmplitudes: [0.001] });

function rms(samples) {
	const middle = samples.slice(9_600, 28_800);
	return Math.sqrt(middle.reduce((sum, sample) => sum + sample * sample, 0) / middle.length);
}

for (const [title, detector, gated] of [
	['Make stereo bakes the authored external Gate detector into its channel audio', quiet, true],
	['Make stereo keeps unity programme gain with a loud detector and a pre-pan capture',
		createWavFixture({ name: 'loud-detector.wav', frequency: 660, channelCount: 1, channelAmplitudes: [0.1] }), false],
]) test(title, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, detector]);
	const programme = clipByName(editor, monoTone.name);
	const control = clipByName(editor, detector.name);
	const controlTrack = await control.evaluate(clip => clip.closest('[data-track-id]')?.getAttribute('data-track-id'));
	expect(controlTrack).toBeTruthy();
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Gate');
	await closeDialog(page.getByRole('dialog', { name: 'Gate', exact: true }));
	await closeEffectsPanel(effects);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await graph.locator(`[data-routing-source="track:${controlTrack}"]`).press('Enter');
	await graph.locator('[data-routing-destination*="effect-sidechain"]').press('Enter');
	await expect(graph.locator('[data-routing-edge][aria-label*="sidechain"]')).toHaveCount(1);
	const before = rms(await exportSamples(page, editor));
	if (gated) expect(before).toBeLessThan(0.002);
	else expect(before).toBeGreaterThan(0.1);
	const assertProgramme = samples => {
		const level = rms(samples);
		if (gated) expect(level).toBeLessThan(0.002);
		else { expect(level).toBeGreaterThan(0.24); expect(level).toBeLessThan(0.25); }
	};
	const track = programme.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Make stereo track']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	assertProgramme(await exportSamples(page, editor));
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(graph.locator('[data-routing-edge][aria-label*="sidechain"]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	assertProgramme(await exportSamples(page, editor));
});

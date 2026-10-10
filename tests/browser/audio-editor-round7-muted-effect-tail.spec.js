/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, clipByName, closeDialog, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('muting a delayed recording removes its irrelevant release from Export', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, ['dry', 'delayed'].map(name => createWavFixture({ name: `${name}.wav`,
		frequency: 440, duration: 1, channelCount: 2 })));
	const panel = await openEffectsForTrack(editor, 2);
	await addRackEffect(page, panel, 'track', 'Feedback delay');
	const dialog = page.getByRole('dialog', { name: 'Feedback delay', exact: true });
	for (const [parameter, value] of Object.entries({ time: '1', feedback: '0', mix: '1' })) {
		await commitInput(dialog.locator(`[data-effect-param="${parameter}"] input`), value);
	}
	await closeDialog(dialog);
	const sounding = await exportSamples(page, editor);
	expect(sounding.length).toBe(96_000);
	const track = clipByName(editor, 'delayed.wav').locator('xpath=ancestor::div[@data-track-row]');
	await track.getByRole('button', { name: 'Mute', exact: true }).click();
	const muted = await exportSamples(page, editor);
	expect(muted.length).toBe(48_000);
	expect(Math.max(...muted.slice(0, 128).map(Math.abs))).toBeGreaterThan(.1);
	await track.getByRole('button', { name: 'Mute', exact: true }).click();
	expect((await exportSamples(page, editor)).length).toBe(96_000);
});

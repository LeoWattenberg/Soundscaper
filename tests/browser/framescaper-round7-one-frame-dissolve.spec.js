/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';
import { closeDissolve, openDissolve, ordinaryCameraPair, setClipSamples } from './helpers/round7-dissolve-user-path.js';

test('a normally trimmed one-frame camera clip offers no impossible dissolve', async ({ page }) => {
	const errors = collectClientErrors(page);
	const { editor, outgoing } = await ordinaryCameraPair(page);
	// The default project sequence is 30fps with a 48kHz clock: one frame is
	// entered through the visible Duration/Samples digit control as 1600 samples.
	await setClipSamples(page, editor, outgoing, 'durationFrame', 1_600);
	const dialog = await openDissolve(page, editor, outgoing);
	await expect(dialog.getByRole('combobox', { name: 'Outgoing → incoming', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('alert')).toHaveText('Select one clip from an unlocked video track containing an adjacent pair.');
	await expect(dialog.getByRole('button', { name: 'Apply dissolve', exact: true })).toHaveCount(0);
	await closeDissolve(page, dialog);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openDissolve(page, editor, outgoing);
	await expect(restored.getByRole('button', { name: 'Apply dissolve', exact: true })).toBeEnabled();
	expect(errors).toEqual([]);
});


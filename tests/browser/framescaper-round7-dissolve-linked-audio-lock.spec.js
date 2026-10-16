/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { collectClientErrors } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { closeDissolve, openDissolve, ordinaryCameraPair } from './helpers/round7-dissolve-user-path.js';

test('a camera dissolve respects its independently locked audio partner', async ({ page }) => {
	test.setTimeout(90_000);
	const errors = collectClientErrors(page);
	const { editor, outgoing } = await ordinaryCameraPair(page);
	const audioTrack = editor.locator('[data-track-row]:has([data-spectrogram-scale]):has([data-clip-id][role="group"])').first();
	await expect(audioTrack).toBeVisible();
	await expect(audioTrack.locator('[data-clip-id][role="group"]')).toHaveCount(2);
	await chooseTrackMenuAction(page, editor, audioTrack, 'Lock track');
	const dialog = await openDissolve(page, editor, outgoing);
	await expect(dialog.getByRole('combobox', { name: 'Outgoing → incoming', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Apply dissolve', exact: true })).toHaveCount(0);
	await closeDissolve(page, dialog);
	await chooseTrackMenuAction(page, editor, audioTrack, 'Unlock track');
	const restored = await openDissolve(page, editor, outgoing);
	await restored.getByRole('button', { name: 'Apply dissolve', exact: true }).click();
	await expect(restored.getByRole('status')).toHaveText('Selected authored state applied.');
	await restored.getByRole('button', { name: 'Remove dissolve', exact: true }).click();
	await expect(restored.getByRole('status')).toHaveText('Selected authored state removed.');
	expect(errors).toEqual([]);
});

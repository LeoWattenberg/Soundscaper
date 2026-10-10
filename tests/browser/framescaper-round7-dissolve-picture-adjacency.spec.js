/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { chooseCommandAction, chooseNestedCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';
import { closeDissolve, openDissolve, ordinaryCameraPair, readClipSamples, setClipSamples } from './helpers/round7-dissolve-user-path.js';

test('the normal dissolve picker preserves a Solid between camera clips', async ({ page }) => {
	const errors = collectClientErrors(page);
	const { editor, outgoing, incoming } = await ordinaryCameraPair(page);
	const outgoingSamples = await readClipSamples(page, editor, outgoing, 'durationFrame');
	await chooseNestedCommandAction(page, editor, 'Generate', [
		'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoSolid'],
	]);
	const solid = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await expect(solid).toHaveCount(1);
	const solidSamples = await readClipSamples(page, editor, solid, 'durationFrame');
	expect(solidSamples).toBe(240_000);
	// The existing picture track initially contains Camera A, Camera B, Solid.
	// Ordinary visible Start edits rearrange it to Camera A, Solid, Camera B.
	await setClipSamples(page, editor, incoming, 'startFrame', outgoingSamples + solidSamples);
	await setClipSamples(page, editor, solid, 'startFrame', outgoingSamples);
	const dialog = await openDissolve(page, editor, outgoing);
	await expect(dialog.getByRole('combobox', { name: 'Outgoing → incoming', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('alert')).toHaveText('Select one clip from an unlocked video track containing an adjacent pair.');
	await closeDissolve(page, dialog);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openDissolve(page, editor, outgoing);
	await expect(restored.getByRole('combobox', { name: 'Outgoing → incoming', exact: true }).locator('option')).toHaveCount(1);
	await restored.getByRole('button', { name: 'Apply dissolve', exact: true }).click();
	await expect(restored.getByRole('status')).toHaveText('Selected authored state applied.');
	expect(errors).toEqual([]);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, importFiles,
	openClipProperties, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('an open Source editor does not prevent the selected track rack from capturing its timeline profile', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Noise Reduction');
	const rack = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
	await rack.getByRole('button', { name: 'Close', exact: true }).click();
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first());
	const source = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await source.focus();
	await source.press('Control+a');
	await panel.getByRole('group', { name: 'Noise Reduction', exact: true })
		.getByRole('button', { name: 'Select effect', exact: true }).click();
	await rack.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(rack.getByRole('button', { name: 'Replace noise profile', exact: true }))
		.toBeVisible({ timeout: 5000 });
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseNestedCommandAction, closeDialog, closeEffectsPanel, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('Tab reaches a populated mixer effect and Enter opens its rack', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Reverb');
	await closeDialog(page.getByRole('dialog', { name: 'Reverb', exact: true }));
	await closeEffectsPanel(effects);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const tracks = editor.locator('.kw-audio-editor__mixer-channel--track');
	await tracks.first().getByRole('button', { name: 'Solo', exact: true }).click();
	await page.keyboard.press('Tab');
	const effect = tracks.nth(1).getByRole('button', { name: 'Reverb', exact: true });
	await expect(effect).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(editor.locator('[data-workspace-panel="effects"]')).toBeVisible();
});

test('mixer fader Home and End select the minimum and maximum gain', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').nth(1).getByRole('slider', { name: /volume$/u });
	await fader.press('Home');
	await expect(fader).toHaveAttribute('aria-valuenow', '-60');
	await fader.press('End');
	await expect(fader).toHaveAttribute('aria-valuenow', '12');
});

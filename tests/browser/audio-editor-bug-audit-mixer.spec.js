/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseNestedCommandAction, closeDialog, closeEffectsPanel, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('the master mixer effect slots open the master rack', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const master = editor.locator('.kw-audio-editor__mixer-channel--master');
	await master.locator('.mixer-effect--empty').first().getByRole('button', { name: 'Select effect', exact: true }).click();
	const effects = editor.locator('[data-workspace-panel="effects"]');
	await expect(effects).toBeVisible();
	await expect(effects.locator('[data-effect-rack]')).toHaveCount(1);
});

test('selecting a replacement in a mixer effect menu replaces the effect', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Reverb');
	await closeDialog(page.getByRole('dialog', { name: 'Reverb', exact: true }));
	await closeEffectsPanel(effects);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const slot = editor.locator('.kw-audio-editor__mixer-channel--track .mixer-effect--enabled');
	await expect(slot).toHaveCount(1);
	await slot.hover();
	await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Audacity\s/u }).press('ArrowRight');
	await page.getByRole('menuitem', { name: 'Compressor', exact: true }).click();
	await expect(slot).toContainText('Compressor');
});

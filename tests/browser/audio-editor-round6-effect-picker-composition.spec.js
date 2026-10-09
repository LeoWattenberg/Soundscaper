/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, closeDialog, importFiles, openEffectsForTrack, openRackPicker } from './audio-editor-test-helpers.js';

test('the native effect search keeps its unfinished composition until ordinary Escape', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openEffectsForTrack(editor, 1);
	const trigger = panel.locator('[data-effect-rack]').getByRole('button', { name: 'Add effect', exact: true }).first();
	const picker = page.locator('.audio-editor-effect-picker-flyout');
	const search = picker.getByRole('searchbox', { name: 'Search effects', exact: true });
	await openRackPicker(panel, 'track');
	await search.fill('Bass');
	await search.press('Escape');
	await expect(picker).toBeHidden();
	await expect(trigger).toBeFocused();
	await openRackPicker(panel, 'track');
	await search.fill('とう');
	await search.evaluate(element => {
		element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true,
			bubbles: true, cancelable: true }));
	});
	await expect(picker).toBeVisible();
	await expect(search).toHaveValue('とう');
	await expect(search).toBeFocused();
	await search.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
	await search.fill('Bass');
	await picker.getByRole('menuitem', { name: 'Bass and Treble', exact: true }).click();
	const effect = page.getByRole('dialog', { name: 'Bass and Treble', exact: true });
	await expect(effect).toBeVisible();
	await closeDialog(effect);
	await expect(panel.getByRole('group', { name: 'Bass and Treble', exact: true })).toBeVisible();
});

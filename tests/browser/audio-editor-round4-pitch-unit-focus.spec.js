/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { openClipMediaSettings } from './audio-editor-clip-settings-test-helpers.js';

registerAudioEditorHooks();

test('changing clip pitch units restores the settings trigger for continued keyboard editing', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	const trigger = panel.getByRole('button', { name: 'Media settings', exact: true });
	for (const label of ['Percent change', 'Semitones (half-steps)']) {
		const menu = await openClipMediaSettings(panel);
		const unitMenu = menu.getByRole('menuitem', { name: /^Pitch unit(?:\s|$)/u });
		await unitMenu.focus();
		await unitMenu.press('ArrowRight');
		const unit = menu.getByRole('menuitemradio', { name: label, exact: true });
		await unit.focus();
		await unit.press('Enter');
		await expect(menu).toBeHidden();
		await expect(trigger).toBeFocused();
		const reopened = await openClipMediaSettings(panel);
		const units = reopened.getByRole('menuitem', { name: /^Pitch unit(?:\s|$)/u });
		await units.focus();
		await units.press('ArrowRight');
		await expect(reopened.getByRole('menuitemradio', { name: label, exact: true })).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
	}
});

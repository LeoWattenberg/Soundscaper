/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('modified source-ruler arrows preserve the audition position and run the configured command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Right');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const clip = clipByName(editor, toneA.name);
	const original = await clip.getAttribute('aria-label');
	const properties = await openClipProperties(page, editor, clip);
	const ruler = properties.getByRole('slider', { name: 'Source timeline', exact: true });
	const position = await ruler.getAttribute('aria-valuenow');
	await ruler.focus();
	await ruler.press('Control+Alt+ArrowRight');
	await expect(ruler).toHaveAttribute('aria-valuenow', position);
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(clip).toHaveAttribute('aria-label', original);
});

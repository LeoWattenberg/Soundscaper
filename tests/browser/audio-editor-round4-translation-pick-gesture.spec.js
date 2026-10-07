/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('picking a slider message leaves its audio value unchanged', async ({ page }) => {
	await page.setViewportSize({ width: 1800, height: 1200 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const effects = await openEffectsForTrack(editor, 1);
	const slider = effects.getByRole('slider', { name: 'Master gain', exact: true });
	const initial = await slider.inputValue();
	await chooseCommandAction(page, editor, 'Help', 'Contribute translations');
	const translations = page.getByRole('dialog', { name: 'Community translations', exact: true });
	await expect(translations.getByRole('textbox', { name: 'English source', exact: true })).toBeVisible();
	await translations.getByRole('button', { name: 'Pick a message in the editor', exact: true }).click();
	await slider.click({ position: { x: 12, y: 6 } });
	await expect(translations.getByRole('button', { name: 'Pick a message in the editor', exact: true }))
		.toHaveAttribute('aria-pressed', 'false');
	await expect(slider).toHaveValue(initial);
});

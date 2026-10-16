/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('Project bin removal confirmation keyboard ownership', () => {
	registerAudioEditorHooks();
	test('Cancel owns initial focus, Tab remains in the confirmation, and Escape cancels removal', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await clipByName(editor, monoTone.name).locator('.clip-header').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		const card = editor.getByRole('listitem', { name: `Project bin: ${monoTone.name.replace(/\.wav$/u, '')}`, exact: true });
		await card.locator('.kw-audio-editor__project-bin-overflow').press('Enter');
		await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).press('Enter');
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
		for (let index = 0; index < 5; index += 1) {
			await page.keyboard.press('Tab');
			await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
		}
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(card).toBeVisible();
	});
});

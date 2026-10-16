/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test.use({ viewport: { width: 1_440, height: 1_000 } });

test('native Clip properties drawers retain keyboard activation and selected audio', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const panel = await openClipProperties(page, editor, clip);
	const drawer = panel.locator('[data-clip-properties-drawer="media"]');
	const summary = drawer.locator('summary');
	await expect(drawer).not.toHaveAttribute('open');
	await summary.getByText('Media settings', { exact: true }).click();
	await expect(drawer).toHaveAttribute('open', '');
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	// Native Shift+Tab reaches the actual summary from its first editable child.
	await panel.getByRole('textbox', { name: 'Clip name', exact: true }).focus();
	await page.keyboard.press('Shift+Tab');
	await expect(summary).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(drawer).toHaveCount(1);
	await expect(drawer).not.toHaveAttribute('open');
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(summary).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(drawer).toHaveAttribute('open', '');
	await page.keyboard.press('Space');
	await expect(drawer).not.toHaveAttribute('open');
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	expect(errors).toEqual([]);
});

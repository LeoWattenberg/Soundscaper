/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, waitForResponsiveEditorLayout } from './audio-editor-test-helpers.js';
import { TRACK_MENU_TRIGGER } from './helpers/track-menu.js';

test('Escape closes compact track headers at the visible drawer toggle', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const editor = await bootEditor(page, '/embed/en/');
	await waitForResponsiveEditorLayout(editor);
	await expect(editor).toHaveAttribute('data-layout', 'compact');
	await importFiles(editor, [toneA]);
	const toggle = editor.locator('[data-track-header-toggle]');
	await toggle.click();
	const header = editor.locator('[data-track-header]').first();
	await expect(header).toBeVisible();
	await header.getByRole('button', { name: TRACK_MENU_TRIGGER }).first().focus();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await expect(header).toBeHidden();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(toggle).toBeFocused();
	await page.keyboard.press('Space');
	await expect(header).toBeVisible();
});

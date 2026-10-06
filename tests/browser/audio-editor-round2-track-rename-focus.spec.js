/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { TRACK_MENU_TRIGGER } from './helpers/track-menu.js';

for (const key of ['Enter', 'Escape']) test(`${key} finishes inline track renaming at its track controls`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const row = editor.locator('[data-track-row]').first();
	await row.locator('.track-control-panel__track-name-text').dblclick();
	const input = row.locator('[data-track-name] input');
	await expect(input).toBeFocused();
	await input.fill('Dialogue');
	await input.press(key);
	await expect(input).toHaveCount(0);
	await expect(row.locator('.track-control-panel__track-name-text')).toHaveText(key === 'Enter' ? 'Dialogue' : 'Track 1');
	await expect(row.getByRole('button', { name: TRACK_MENU_TRIGGER }).first()).toBeFocused();
	await page.keyboard.press('Space');
	await expect(page.locator('.audio-editor-track-menu')).toBeVisible();
});

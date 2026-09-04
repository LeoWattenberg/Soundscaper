/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('keyboard shortcut preferences', () => {
	registerAudioEditorHooks();

	test('sorts shortcuts by where the commands appear, and drops the rows that take none', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();

		// The categorized view is what the page opens on: File heads the list
		// because File heads the menubar, and its first row is the File menu's.
		const groups = preferences.locator('[data-shortcut-group]');
		await expect(groups.first()).toHaveAttribute('data-shortcut-group', 'menu:file');
		await expect(groups.first()).toHaveText('File');
		await expect(preferences.locator('[data-shortcut-action]').first())
			.toHaveAttribute('data-shortcut-action', 'file-new');

		// A dropdown value, an application-information command and a dynamic
		// action template are all absent, whichever view is showing.
		await expect(preferences.locator('[data-shortcut-action="snap-1-128"]')).toHaveCount(0);
		await expect(preferences.locator('[data-shortcut-action="about-audacity"]')).toHaveCount(0);
		await expect(preferences.locator('[data-shortcut-action*="%1"]')).toHaveCount(0);
		await expect(preferences.locator('[data-shortcut-action="snap-enabled"]')).toHaveCount(1);

		await chooseDropdown(page, preferences.locator('[role="group"][aria-label="Sort commands"]'), 'Alphabetical');
		await expect(groups).toHaveCount(0);
		await expect(preferences.locator('[data-shortcut-action]').first())
			.toHaveAttribute('data-shortcut-action', 'label-add');
		await expect(preferences.locator('[data-shortcut-action="about-audacity"]')).toHaveCount(0);
	});
});

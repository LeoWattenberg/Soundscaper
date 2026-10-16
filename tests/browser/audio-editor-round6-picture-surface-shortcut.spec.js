/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('a native picture surface releases a configured modified navigation command', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const name of ['poster', 'background']) {
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await chooser).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: `Image clip: ${name}`, exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	}
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Down');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const first = editor.locator('[data-video-track]').filter({ has: page.getByRole('group', { name: 'Image clip: poster', exact: true }) }).locator('.audio-editor-video-track-surface');
	const second = editor.locator('[data-video-track]').filter({ has: page.getByRole('group', { name: 'Image clip: background', exact: true }) }).locator('.audio-editor-video-track-surface');
	await first.focus();
	await page.keyboard.press('ArrowDown');
	await expect(second).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(first).toBeFocused();
	await page.keyboard.press('Control+Alt+ArrowDown');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});

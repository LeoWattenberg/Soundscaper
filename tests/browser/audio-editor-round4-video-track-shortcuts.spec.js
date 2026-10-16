/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Ctrl+Up from a picture track menu moves the focused track and supports Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const name of ['poster', 'background']) {
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await chooser).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: `Image clip: ${name}`, exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	}
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	const row = editor.locator('[data-video-track]').filter({ has: page.getByRole('group', { name: 'Image clip: background', exact: true }) });
	await row.locator('[data-track-name]').click();
	const menu = row.getByRole('button', { name: 'Track options', exact: true });
	await menu.focus();
	await expect(menu).toBeFocused();
	const originalIndex = Number(await row.getAttribute('data-track-index'));
	await page.keyboard.press('ControlOrMeta+ArrowUp');
	await expect(row).toHaveAttribute('data-track-index', String(originalIndex - 1));
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(row).toHaveAttribute('data-track-index', String(originalIndex));
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(row).toHaveAttribute('data-track-index', String(originalIndex - 1));
});

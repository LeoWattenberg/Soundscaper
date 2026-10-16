/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, getMenuItem, openNestedCommandMenu } from './audio-editor-test-helpers.js';

test('Group clips is unavailable for picture leaves without group metadata', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const name of ['poster', 'background']) {
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await chooser).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: `Image clip: ${name}`, exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	}
	await editor.getByRole('group', { name: 'Image clip: poster', exact: true }).press('Enter');
	await editor.getByRole('group', { name: 'Image clip: background', exact: true }).press('Shift+Enter');
	const menu = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
	await expect(getMenuItem(menu, 'Group clips')).toBeDisabled();
});

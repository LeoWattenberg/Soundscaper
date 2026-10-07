/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('track navigation arrows leave an active picture track name editor intact', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	await expect(editor.getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await editor.locator('[data-video-track] [data-track-name]').dblclick();
	const name = editor.getByRole('textbox', { name: 'Track name: Images', exact: true });
	await expect(name).toBeFocused();
	await name.fill('Picture track');
	await name.press('ArrowUp');
	await expect(name).toBeFocused();
	await name.press('Escape');
	await expect(editor.locator('[data-video-track] [data-track-name]')).toHaveText('Images');
});

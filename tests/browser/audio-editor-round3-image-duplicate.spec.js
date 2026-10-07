/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Duplicate creates an independently selected picture track for a normal still image', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clips = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clips).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clips.locator('.clip-header').click();
	const count = Number(await editor.getAttribute('data-track-count'));
	await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	await expect(clips).toHaveCount(2);
	await expect(editor).toHaveAttribute('data-track-count', String(count + 1));
	await expect(editor.locator('[data-track-row]').last().getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
	await expect(editor).toHaveAttribute('data-track-count', String(count));
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clickClipInterior } from './audio-editor-test-helpers.js';

test('Split tool divides a normally imported still image and Undo restores its original extent', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clips = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clips).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const before = await clips.boundingBox();
	expect(before).not.toBeNull();
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	await clickClipInterior(page, clips, 0.5);
	await expect(clips).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(clips).toHaveCount(1);
	await expect.poll(async () => (await clips.boundingBox())?.width).toBe(before.width);
});

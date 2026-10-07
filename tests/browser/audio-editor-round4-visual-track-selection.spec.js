/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const kind of ['image', 'generator']) test(`Track start to end uses an ordinary ${kind} extent`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	if (kind === 'image') {
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	} else {
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle']]);
	}
	const clip = editor.getByRole('group', { name: kind === 'image' ? 'Image clip: poster' : 'Video clip: Title', exact: true });
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', '00:00:05:00');
});

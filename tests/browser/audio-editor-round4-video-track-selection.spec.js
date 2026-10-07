/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Ctrl-clicking picture track names selects both tracks for Remove tracks', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const name of ['poster', 'background']) {
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await chooser).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: `Image clip: ${name}`, exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	}
	const clips = editor.getByRole('group', { name: /^Image clip:/u });
	await expect(clips).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	const names = editor.locator('.audio-editor-video-track-controls [data-track-name]');
	await expect(names).toHaveCount(2);
	await names.first().click();
	await names.last().click({ modifiers: ['ControlOrMeta'] });
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	await expect(clips).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(clips).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(clips).toHaveCount(0);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Ctrl+Right moves native image content and Ctrl+Left restores it', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clip.locator('.clip-header').click();
	const position = () => clip.evaluate(element => Number.parseFloat(element.style.left));
	const before = await position();
	expect(Number.isFinite(before)).toBe(true);
	await page.keyboard.press('Control+ArrowRight');
	await expect.poll(position).toBeGreaterThan(before);
	await page.keyboard.press('Control+ArrowLeft');
	await expect.poll(position).toBe(before);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect.poll(position).toBeGreaterThan(before);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect.poll(position).toBe(before);
});

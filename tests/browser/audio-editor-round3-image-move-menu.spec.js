/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('the image clip context menu offers compatible picture tracks as move destinations', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const name of ['poster', 'background']) {
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await chooser).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: `Image clip: ${name}`, exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	}
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(editor.locator('.audio-editor-track-row').filter({ has: page.getByRole('group', { name: /^Image clip:/u }) })).toHaveCount(2);
	const before = await clip.boundingBox(); expect(before).not.toBeNull();
	const destination = editor.locator('.audio-editor-track-row').filter({ has: page.getByRole('group', { name: 'Image clip: background', exact: true }) });
	await clip.locator('.clip-header').click({ button: 'right' });
	const move = page.getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await expect(move).toBeVisible();
	await expect(move).toBeEnabled();
	await move.hover();
	await page.getByRole('menuitem', { name: 'Images', exact: true }).click();
	await expect(destination.getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
	await expect.poll(async () => (await clip.boundingBox())?.x).toBe(before.x);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(destination.getByRole('group', { name: 'Image clip: poster', exact: true })).toHaveCount(0);
	await expect(clip).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(destination.getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
});

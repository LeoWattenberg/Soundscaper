/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('global item commands move an ordinary still between compatible picture tracks', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const name of ['poster', 'background']) {
		const picking = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await picking).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: `Image clip: ${name}`, exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	}
	const poster = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	const background = editor.getByRole('group', { name: 'Image clip: background', exact: true });
	const owner = clip => clip.locator('xpath=ancestor::*[@data-track-id][1]');
	const originalTrack = await owner(poster).getAttribute('data-track-id');
	const destinationTrack = await owner(background).getAttribute('data-track-id');
	expect(destinationTrack).not.toBe(originalTrack);
	await poster.locator('.clip-header').click();
	const start = await poster.evaluate(element => Number.parseFloat(element.style.left));
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	// The existing horizontal item command proves this focus path dispatches globally.
	await playhead.press('Control+ArrowRight');
	await expect.poll(() => poster.evaluate(element => Number.parseFloat(element.style.left))).toBeGreaterThan(start);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(() => poster.evaluate(element => Number.parseFloat(element.style.left))).toBe(start);
	await playhead.press('Control+ArrowDown');
	await expect(owner(poster)).toHaveAttribute('data-track-id', destinationTrack);
	await expect.poll(() => poster.evaluate(element => Number.parseFloat(element.style.left))).toBe(start);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(owner(poster)).toHaveAttribute('data-track-id', originalTrack);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(owner(poster)).toHaveAttribute('data-track-id', destinationTrack);
	await playhead.press('Control+ArrowUp');
	await expect(owner(poster)).toHaveAttribute('data-track-id', originalTrack);
});

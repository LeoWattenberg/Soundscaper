/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const kind of ['image', 'generator']) test(`shuttle includes an ordinary ${kind} programme`, async ({ page }) => {
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
	const readout = editor.locator('[data-sequence-timecode]');
	await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:00:00');
	await clip.locator('.clip-header').click();
	await page.keyboard.press('L');
	await expect.poll(() => readout.getAttribute('data-sequence-timecode')).not.toBe('00:00:00:00');
	await page.keyboard.press('K');
	await expect(editor.locator('[data-status]')).toContainText('Shuttle stopped');
});

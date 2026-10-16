/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('Undo reaches the timeline from a focused video opacity fade', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('fade-shortcuts.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.locator('.clip-header').click();
	await clip.press('Tab');
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	await expect(fade).toBeFocused();
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await page.keyboard.press('ControlOrMeta+z');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await clip.press('Enter');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
});

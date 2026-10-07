/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, openClipProperties } from './audio-editor-test-helpers.js';

test('still-image Properties changes its supported timeline duration', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	const properties = await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	const duration = properties.getByRole('group', { name: 'Duration', exact: true });
	await duration.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('2');
	await page.keyboard.press('Enter');
	await expect(properties.getByRole('alert')).toHaveCount(0);
	await closeWorkspacePanel(editor, 'clip-properties');
	await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	await expect.poll(async () => (await duration.locator('.timecode-digit').allTextContents()).join('')).toBe('000002000');
});

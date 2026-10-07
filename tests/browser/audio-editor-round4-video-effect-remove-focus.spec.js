/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('video effect removal keeps the next rack action available to the keyboard', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('effect-removal.webm')]);
	const properties = await openClipProperties(page, editor, editor.getByRole('group', { name: /^Video clip:/u }).first());
	const rack = properties.locator('[data-video-effect-rack]');
	const add = rack.getByRole('button', { name: 'Add effect', exact: true });
	await add.click();
	await add.click();
	const rows = rack.locator('[data-video-effect-id]');
	await expect(rows).toHaveCount(2);
	const remove = rack.getByRole('button', { name: 'Remove effect: Color Adjust', exact: true });
	await remove.first().focus();
	await page.keyboard.press('Enter');
	await expect(rows).toHaveCount(1);
	await expect(remove).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(rows).toHaveCount(0);
	await expect(add).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(rows).toHaveCount(1);
});

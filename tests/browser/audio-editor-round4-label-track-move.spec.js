/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('a label moved to another track keeps keyboard editing on that label', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await page.keyboard.press('Control+b');
	const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await title.fill('Moved label');
	await title.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);
	const rows = editor.locator('[data-label-track]');
	await expect(rows).toHaveCount(2);
	const marker = rows.nth(0).getByRole('group', { name: 'Edit labels: Moved label', exact: true });
	await marker.focus();
	await page.keyboard.press('Control+ArrowDown');
	const moved = rows.nth(1).getByRole('group', { name: 'Edit labels: Moved label', exact: true });
	await expect(moved).toBeVisible();
	await expect(marker).toHaveCount(0);
	await expect(moved).toBeFocused();
	const before = await moved.boundingBox();
	expect(before).not.toBeNull();
	await page.keyboard.press('Control+ArrowRight');
	await expect.poll(async () => (await moved.boundingBox())?.x).toBeGreaterThan(before.x + 5);
});

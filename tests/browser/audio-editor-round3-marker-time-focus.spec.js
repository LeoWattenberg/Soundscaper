/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('committing a marker time retains its field focus for continued keyboard editing', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await panel.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
	const start = panel.getByRole('group', { name: 'Start sample', exact: true });
	await start.locator('.timecode-digit').last().click();
	await page.keyboard.press('1');
	await page.keyboard.press('Enter');
	await expect(panel.getByRole('status').last()).toContainText('48');
	await expect(start).toBeFocused();
	await start.locator('.timecode-digit').last().click();
	await page.keyboard.press('2');
	await page.keyboard.press('Enter');
	await expect(start).toBeFocused();
	await expect(start.locator('.timecode-digit').last()).toHaveText('2');
});

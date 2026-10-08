/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, openClipProperties, closeWorkspacePanel } from './audio-editor-test-helpers.js';

test('generated Title Properties edits supported timeline duration in one Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const clip = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	const properties = await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	const duration = properties.getByRole('group', { name: 'Duration', exact: true });
	await duration.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('2');
	await page.keyboard.press('Enter');
	await expect(properties.getByRole('alert')).toHaveCount(0);
	await expect(properties.locator('[data-clip-field="gain"]')).toHaveCount(0);
	await expect(properties.locator('[data-clip-properties-drawer="fading"]')).toHaveCount(0);
	await closeWorkspacePanel(editor, 'clip-properties');
	await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	await expect.poll(async () => (await duration.locator('.timecode-digit').allTextContents()).join('')).toBe('000002000');
	await closeWorkspacePanel(editor, 'clip-properties');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	await expect.poll(async () => (await duration.locator('.timecode-digit').allTextContents()).join('')).toBe('000005000');
});

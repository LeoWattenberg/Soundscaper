/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, openEffectsForTrack, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('timed recording skips its disabled duration when tabbing from the start date', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const end = dialog.getByRole('radio', { name: 'End date and time', exact: true });
	await end.check();
	const start = dialog.locator('input[type="datetime-local"]').first();
	await start.focus();
	for (let index = 0; index < 10 && await start.evaluate((element) => element === document.activeElement); index += 1) {
		await page.keyboard.press('Tab');
	}
	await expect(end).toBeFocused();
});

test('a realtime effect header remains reachable after dragging toward the window edge', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	await page.getByRole('dialog', { name: 'Tone', exact: true }).getByRole('button', { name: 'Generate', exact: true }).click();
	const effects = await openEffectsForTrack(editor, 0);
	await addRackEffect(page, effects, 'track', 'Reverb');
	const dialog = page.getByRole('dialog', { name: 'Reverb', exact: true });
	const header = dialog.locator('.dialog-header');
	const before = await header.boundingBox();
	await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
	await page.mouse.down();
	await page.mouse.move(1, 1, { steps: 5 });
	await page.mouse.up();
	const after = await header.boundingBox();
	expect(after.y).toBeGreaterThanOrEqual(0);
	expect(after.x + after.width).toBeGreaterThanOrEqual(48);
});

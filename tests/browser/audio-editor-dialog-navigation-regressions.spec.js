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

async function moveReverbToWindowEdge(page) {
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
	expect((await header.boundingBox()).y).toBeGreaterThanOrEqual(0);
	return { dialog, header };
}

test('a moved realtime effect title stays reachable when the browser window becomes shorter', async ({ page }) => {
	const { header } = await moveReverbToWindowEdge(page);
	const viewport = page.viewportSize();
	await page.setViewportSize({ width: viewport.width, height: viewport.height - 59 });
	await expect.poll(async () => (await header.boundingBox()).y).toBeGreaterThanOrEqual(0);
	await expect(header.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
});

test('a moved realtime effect title stays reachable when its resize control enlarges the body', async ({ page }) => {
	const { dialog, header } = await moveReverbToWindowEdge(page);
	const before = await dialog.boundingBox();
	const resize = dialog.getByRole('button', { name: 'Resize: Reverb', exact: true });
	await resize.focus();
	await resize.press('ArrowDown');
	await resize.press('ArrowDown');
	await expect.poll(async () => (await dialog.boundingBox()).height).toBe(before.height + 32);
	await expect.poll(async () => (await header.boundingBox()).y).toBeGreaterThanOrEqual(0);
	await expect(header.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
});

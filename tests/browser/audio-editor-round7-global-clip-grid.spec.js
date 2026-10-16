/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, showToolbarButton } from './audio-editor-test-helpers.js';

test('global item keys from the playhead move the selected clip across successive snap lines', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	const clip = clipByName(editor, longTone.name);
	await clip.locator('.clip-header').click();
	await showToolbarButton(page, editor, 'Snap');
	await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const position = () => clip.evaluate(element => Number.parseFloat(element.style.left));
	const original = await position();
	await playhead.press('Control+ArrowRight');
	await expect.poll(position).toBeGreaterThan(original);
	const first = await position();
	await playhead.press('Control+ArrowRight');
	await expect.poll(position).toBeGreaterThan(first);
	const second = await position();
	await playhead.press('Control+ArrowLeft');
	await expect.poll(position).toBe(first);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(second);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(position).toBe(first);
});

test('global vertical item keys retain an off-grid clip position while Snap is enabled', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	const clip = clipByName(editor, longTone.name);
	const header = clip.locator('.clip-header');
	const box = await header.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * .5 + 30, box.y + box.height * .5, { steps: 4 });
	await page.mouse.up();
	const position = () => clip.evaluate(element => Number.parseFloat(element.style.left));
	const original = await position();
	expect(original).toBeGreaterThan(12);
	const track = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	const originalTrack = await track.getAttribute('data-track-id');
	await header.click();
	await showToolbarButton(page, editor, 'Snap');
	await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
	await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('Control+ArrowUp');
	await expect(track).not.toHaveAttribute('data-track-id', originalTrack);
	await expect.poll(position).toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(track).toHaveAttribute('data-track-id', originalTrack);
	await expect.poll(position).toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(track).not.toHaveAttribute('data-track-id', originalTrack);
	await expect.poll(position).toBe(original);
});

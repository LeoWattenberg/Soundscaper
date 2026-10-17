/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, longTone, toneB } from './audio-editor-test-fixtures.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

async function setup(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone, toneB]);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const clip = clipByName(editor, longTone.name);
	const display = clip.locator('.clip-display');
	return { editor, clip, display, row: clip.locator('xpath=ancestor::*[@data-track-row][1]') };
}
const duration = editor => editor.getByRole('group', { name: 'Selection duration', exact: true }).locator('.timecode__display');

test('a header press waits for click and dragging clears picked clips through completion', async ({ page }) => {
	const { editor, clip, display } = await setup(page);
	const box = await clip.boundingBox();
	await page.mouse.move(box.x + 40, box.y + 10);
	await page.mouse.down();
	await expect(display).toHaveAttribute('data-selected', 'false');
	await page.mouse.up();
	await expect(display).toHaveAttribute('data-selected', 'true');
	await page.mouse.move(box.x + 40, box.y + 10);
	await page.mouse.down();
	await page.mouse.move(box.x + 80, box.y + 10, { steps: 5 });
	await expect(display).toHaveAttribute('data-selected', 'false');
	await page.mouse.up();
	await expect(display).toHaveAttribute('data-selected', 'false');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});

test('body Ctrl-click toggles clips without moving the playhead or creating a time range', async ({ page }) => {
	const { editor, clip, display } = await setup(page);
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const before = await playhead.getAttribute('aria-valuenow');
	const box = await display.boundingBox();
	await clip.click({ position: { x: box.width / 2, y: box.height * .75 }, modifiers: ['Control'] });
	await expect(display).toHaveAttribute('data-selected', 'true');
	await expect(duration(editor)).toHaveText('00h00m00.000s');
	await expect(playhead).toHaveAttribute('aria-valuenow', before);
	await clip.click({ position: { x: box.width / 2, y: box.height * .75 }, modifiers: ['Control'] });
	await expect(display).toHaveAttribute('data-selected', 'false');
});

test('body double-click selects audio, body triple-click picks track clips, and a context menu preserves the range', async ({ page }) => {
	const { editor, clip, display } = await setup(page);
	const box = await display.boundingBox();
	const point = { x: box.width / 2, y: box.height * .75 };
	await clip.dblclick({ position: point });
	await expect(duration(editor)).toHaveText('00h00m08.000s');
	await expect(display).toHaveAttribute('data-selected', 'false');
	await clip.click({ button: 'right', position: point });
	await expect(page.locator('.audio-editor-clip-context-menu')).toBeVisible();
	await expect(duration(editor)).toHaveText('00h00m08.000s');
	await expect(display).toHaveAttribute('data-selected', 'false');
	await page.keyboard.press('Escape');
	await clip.click({ position: point, clickCount: 3 });
	await expect(display).toHaveAttribute('data-selected', 'true');
	await expect(duration(editor)).toHaveText('00h00m00.000s');
});

test('track panel double-click selects its audio, triple-click selects every track, and controls preserve its range', async ({ page }) => {
	const { editor, row } = await setup(page);
	const panel = row.locator('.track-control-panel');
	// The main panel has 12px padding; x=30,y=100 lands on its Effects button.
	const point = { x: 6, y: 100 };
	await panel.dblclick({ position: point });
	await expect(duration(editor)).toHaveText('00h00m08.000s');
	await panel.getByRole('slider', { name: 'Volume', exact: true }).press('ArrowLeft');
	await expect(duration(editor)).toHaveText('00h00m08.000s');
	await panel.click({ position: point, clickCount: 3 });
	await expect(duration(editor)).toHaveText('00h00m00.000s');
	await chooseTrackMenuAction(page, editor, row, 'Move selection into new folder');
	const folder = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(editor.locator('[data-track-row]')).toHaveCount(0);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const action of ['Cut', 'Cut and leave gap']) test(`a refused labeled ${action} preserves the clipboard until successful removal`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, toneA]);
	const source = clipByName(editor, monoTone.name);
	const protectedClip = clipByName(editor, toneA.name);
	await source.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await protectedClip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await protectedClip.locator('.clip-header').click();
	await drawRange(page, editor);
	await page.keyboard.press('Control+b');
	await expect(editor.locator('[data-label-track] .audio-editor-label-marker')).toHaveCount(1);
	await editor.getByRole('textbox', { name: /^Edit labels:/u }).press('Enter');
	const track = protectedClip.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', action]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(protectedClip).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await expect(clipByName(editor, monoTone.name)).toHaveCount(2);
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clipByName(editor, monoTone.name)).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await protectedClip.locator('.clip-header').click();
	await drawRange(page, editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', action]);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '4');
	await expect(clipByName(editor, monoTone.name)).toHaveCount(1);
	await expect(clipByName(editor, toneA.name)).toHaveCount(3);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clipByName(editor, toneA.name)).toHaveCount(3);
});

async function drawRange(page, editor) {
	const ruler = await editor.locator('[data-ruler]').boundingBox();
	expect(ruler).not.toBeNull();
	await page.mouse.move(ruler.x + 24, ruler.y + 26);
	await page.mouse.down();
	await page.mouse.move(ruler.x + 72, ruler.y + 26, { steps: 4 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).toBeVisible();
}

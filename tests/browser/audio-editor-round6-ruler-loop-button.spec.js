/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('opening the loop ruler context menu keeps the authored playback loop and redo history', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	const loop = editor.getByRole('button', { name: 'Loop selection', exact: true });
	const initial = await loop.getAttribute('aria-pressed');
	expect(['false', 'true']).toContain(initial);
	const ruler = editor.locator('[data-ruler] canvas');
	await ruler.click({ position: { x: 100, y: 5 } });
	await expect(loop).toHaveAttribute('aria-pressed', initial === 'true' ? 'false' : 'true');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(loop).toHaveAttribute('aria-pressed', initial);
	await ruler.click({ position: { x: 100, y: 5 }, button: 'right' });
	await expect(page.locator('.timeline-ruler-context-menu')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('.timeline-ruler-context-menu')).toHaveCount(0);
	await expect(loop).toHaveAttribute('aria-pressed', initial);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(loop).toHaveAttribute('aria-pressed', initial === 'true' ? 'false' : 'true');
});

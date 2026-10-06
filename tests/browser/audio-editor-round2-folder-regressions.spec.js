/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('changing one track visualization leaves other tracks in their existing view', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const first = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	const second = clipByName(editor, toneB.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await expect(first).toHaveAttribute('data-display-mode', 'waveform');
	await expect(second).toHaveAttribute('data-display-mode', 'waveform');
	await chooseTrackMenuAction(page, editor, first, ['Track visualization', 'Spectrogram']);
	await expect(first).toHaveAttribute('data-display-mode', 'spectrogram');
	await expect(second).toHaveAttribute('data-display-mode', 'waveform');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(first).toHaveAttribute('data-display-mode', 'waveform');
	await expect(second).toHaveAttribute('data-display-mode', 'waveform');
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await expect(first).toHaveAttribute('data-display-mode', 'spectrogram');
	await expect(second).toHaveAttribute('data-display-mode', 'spectrogram');
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await expect(first).toHaveAttribute('data-display-mode', 'waveform');
	await expect(second).toHaveAttribute('data-display-mode', 'waveform');
});

test('collapsing a parent keeps its visible folder in the keyboard tab order', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(),
		'Move selection into new folder');
	const parent = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	await parent.click({ button: 'right', position: { x: 40, y: 12 } });
	await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
	const child = editor.getByRole('treeitem', { name: 'Folder Folder 2, level 2', exact: true });
	await child.click({ position: { x: 40, y: 12 } });
	await expect(child).toHaveAttribute('tabindex', '0');
	await parent.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(child).toHaveCount(0);
	await expect(parent).toHaveAttribute('tabindex', '0');
	await parent.getByRole('button', { name: 'Expand folder', exact: true }).press('Shift+Tab');
	await expect(parent).toBeFocused();
});

test('committing a folder rename keeps keyboard navigation on the folder row', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(),
		'Move selection into new folder');
	const folder = editor.getByRole('treeitem');
	await folder.focus();
	await folder.press('F2');
	const input = editor.getByRole('textbox', { name: 'Rename folder', exact: true });
	await input.fill('Rhythm');
	await input.press('Enter');
	await expect(folder).toHaveAttribute('aria-label', 'Folder Rhythm, level 1');
	await expect(folder).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(folder).toHaveAttribute('aria-expanded', 'false');
});

test('duplicating a foldered track keeps its copy in the same folder', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const original = clipByName(editor, toneA.name);
	const track = original.locator('xpath=ancestor::div[@data-track-row][1]');
	await original.locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
	await chooseTrackMenuAction(page, editor, track, 'Duplicate track');
	await expect(clipByName(editor, toneA.name)).toHaveCount(2);
	const folder = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
});

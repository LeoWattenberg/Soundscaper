import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('audio editor track folder tree', () => {
	registerAudioEditorHooks();

	async function wrapDefaultTrackIntoFolder(page) {
		const editor = await bootEditor(page, '/embed/en/');
		const trackHeader = editor.locator('[data-track-row]').first();
		await trackHeader.getByRole('button', { name: 'Track menu', exact: true }).click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu).toBeVisible();
		await trackMenu.getByRole('menuitem', { name: 'Move selection into new folder', exact: true }).click();
		const folderRow = editor.locator('[data-track-folder-row]');
		await expect(folderRow).toHaveCount(1);
		return { editor, folderRow: folderRow.first() };
	}

	test('wrapping a track creates an accessible folder tree over the same ordering', async ({ page }) => {
		const { editor, folderRow } = await wrapDefaultTrackIntoFolder(page);

		await expect(folderRow).toHaveAttribute('role', 'treeitem');
		await expect(folderRow).toHaveAttribute('aria-level', '1');
		await expect(folderRow).toHaveAttribute('aria-posinset', '1');
		await expect(folderRow).toHaveAttribute('aria-setsize', '1');
		await expect(folderRow).toHaveAttribute('aria-expanded', 'true');
		const tree = editor.locator('[role="tree"]');
		await expect(tree).toHaveAttribute('aria-label', 'Track folders');
		await expect(tree).toHaveAttribute('aria-owns', /audio-editor-track-folder-row-/u);
		// The folder row precedes its member track in the flattened order.
		const rows = editor.locator('[data-track-folder-row], [data-track-row]');
		await expect(rows.first()).toHaveAttribute('data-track-folder-row', 'true');

		// One undoable step: a single undo removes the folder again.
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor.locator('[data-track-folder-row]')).toHaveCount(0);
	});

	test('keyboard collapse, rename, and audibility toggles edit the same folder', async ({ page }) => {
		const { editor, folderRow } = await wrapDefaultTrackIntoFolder(page);

		await folderRow.focus();
		await page.keyboard.press('ArrowLeft');
		await expect(folderRow).toHaveAttribute('aria-expanded', 'false');
		await expect(editor.locator('[data-track-row]')).toHaveCount(0);
		await page.keyboard.press('ArrowRight');
		await expect(folderRow).toHaveAttribute('aria-expanded', 'true');
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);

		await page.keyboard.press('Enter');
		const renameInput = editor.getByRole('textbox', { name: 'Rename folder' });
		await expect(renameInput).toBeVisible();
		await renameInput.fill('Rhythm');
		await renameInput.press('Enter');
		await expect(folderRow).toHaveAttribute('aria-label', 'Folder Rhythm, level 1');

		const mute = folderRow.getByRole('button', { name: 'Mute folder' });
		await mute.click();
		await expect(mute).toHaveAttribute('aria-pressed', 'true');
	});

	test('the folder context menu removes the folder while keeping its tracks', async ({ page }) => {
		const { editor, folderRow } = await wrapDefaultTrackIntoFolder(page);

		await folderRow.click({ button: 'right', position: { x: 40, y: 12 } });
		await editor.getByRole('menuitem', { name: 'Delete folder, keep tracks' }).click();
		await expect(editor.locator('[data-track-folder-row]')).toHaveCount(0);
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);
	});
});

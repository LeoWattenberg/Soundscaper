import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('ADM complete numeric edits', () => {
	registerAudioEditorHooks();
	test('one Undo restores the angle before a completed multi-digit edit', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'ADM', exact: true }).click();
		await panel.getByRole('button', { name: 'Enable ADM', exact: true }).click();
		await panel.getByRole('button', { name: 'Add object', exact: true }).click();
		const angle = panel.getByLabel('Azimuth', { exact: true });
		await expect(angle).toHaveValue('0');
		await angle.selectText();
		await angle.pressSequentially('145');
		await angle.press('Tab');
		await expect(angle).toHaveValue('145');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(angle).toHaveValue('0');
	});
});

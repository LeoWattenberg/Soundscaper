import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('core clip editing', () => {
	registerAudioEditorHooks();

	test('cuts a selected clip and keeps it pasteable through undo and redo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const original = clipByName(editor, toneA.name);
		const originalId = await original.getAttribute('data-clip-id');
		expect(originalId).not.toBeNull();
		await original.locator('.clip-header').click();

		await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut']);
		await expect(editor).toHaveAttribute('data-clip-count', '0');

		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(editor.locator(`[data-clip-id="${originalId}"]`)).toBeVisible();

		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(editor).toHaveAttribute('data-clip-count', '0');

		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(clipByName(editor, toneA.name)).toBeVisible();

		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		expect(errors).toEqual([]);
	});
});

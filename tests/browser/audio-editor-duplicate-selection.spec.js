import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, clipByName, clipField, closeDialog,
	collectClientErrors, importFiles, openClipProperties, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Duplicate selection', () => {
	registerAudioEditorHooks();

	test('Ctrl+D and Edit Duplicate copy a clip to a new track at its original time with one undo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const original = clipByName(editor, toneA.name);
		const properties = await openClipProperties(page, editor, original);
		await clipField(properties, 'startFrame').fill('12345');
		await clipField(properties, 'startFrame').press('Tab');
		await closeDialog(properties);
		const originalId = await original.getAttribute('data-clip-id');
		const source = original.locator('xpath=ancestor::*[@data-track-row][1]');
		const sourceId = await source.getAttribute('data-track-id');
		const beforeTracks = Number(await editor.getAttribute('data-track-count'));
		await original.click({ position: { x: 32, y: 10 } });
		await page.keyboard.press('Control+d');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(editor).toHaveAttribute('data-track-count', String(beforeTracks + 1));
		const copied = editor.getByRole('group', { name: /^browser-tone-a(?:\.wav)? clip,/u }).last();
		await expect(copied).toBeVisible();
		const copiedTrack = copied.locator('xpath=ancestor::*[@data-track-row][1]');
		expect(await copiedTrack.getAttribute('data-track-id')).not.toBe(sourceId);
		const copiedProperties = await openClipProperties(page, editor, copied);
		await expect(clipField(copiedProperties, 'startFrame')).toHaveValue('12345');
		await closeDialog(copiedProperties);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor).toHaveAttribute('data-track-count', String(beforeTracks));
		await expect(editor.locator(`[data-clip-id="${originalId}"]`)).toBeVisible();
		await original.click({ position: { x: 32, y: 10 } });
		await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(editor).toHaveAttribute('data-track-count', String(beforeTracks + 1));
		expect(errors).toEqual([]);
	});
});

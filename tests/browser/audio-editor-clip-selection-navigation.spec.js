import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clickClipInterior,
	clipByName,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Soundscaper clip-selection navigation menus', () => {
	registerAudioEditorHooks();

	test('navigates clip and selection boundaries through Select and View only', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const split = editor.getByRole('button', { name: 'Split tool', exact: true });
		await split.click();
		await clickClipInterior(page, clipByName(editor, toneA.name), 0.5);
		await split.click();
		const clips = editor.locator('[data-clip-id]');
		await expect(clips).toHaveCount(2);

		await chooseCommandAction(page, editor, 'Select', 'Select none');
		const selectionTimecodes = editor.locator('[data-selection-toolbar] .timecode');
		const collapsed = await selectionTimecodes.allTextContents();
		await chooseNestedCommandAction(page, editor, 'Select', ['Audio clips', 'Cursor to next clip boundary']);
		const firstBoundary = await selectionTimecodes.allTextContents();
		expect(firstBoundary).not.toEqual(collapsed);

		await chooseNestedCommandAction(page, editor, 'Select', ['Audio clips', 'Next clip']);
		await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		const nextClipSelection = await selectionTimecodes.allTextContents();
		await chooseNestedCommandAction(page, editor, 'Select', ['Audio clips', 'Previous clip boundary to cursor']);
		await expect.poll(() => selectionTimecodes.allTextContents()).not.toEqual(nextClipSelection);

		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection start']);
		await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'Select all tracks']);
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
		await expect(editor.locator('[data-track-lane][data-selected="true"]')).toHaveCount(0);
	});
});

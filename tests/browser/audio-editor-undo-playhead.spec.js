import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clickClipInterior,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const playheadFrame = async (playhead) => Number(await playhead.getAttribute('aria-valuenow'));

test.describe('undo history playhead', () => {
	registerAudioEditorHooks();

	test('undo hands back the playhead the edit was made from, and redo the one it was undone from', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		const clip = clipByName(editor, toneA.name);

		await clickClipInterior(page, clip, 0.7);
		await expect.poll(() => playheadFrame(playhead)).toBeGreaterThan(0);
		const edited = await playheadFrame(playhead);
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);

		await clickClipInterior(page, clip, 0.2);
		await expect.poll(() => playheadFrame(playhead)).toBeLessThan(edited);
		const undone = await playheadFrame(playhead);

		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect.poll(() => playheadFrame(playhead)).toBe(edited);

		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect.poll(() => playheadFrame(playhead)).toBe(undone);
		expect(errors).toEqual([]);
	});
});

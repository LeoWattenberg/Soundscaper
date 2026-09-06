import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clickClipInterior,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const playheadFrame = async (playhead) => Number(await playhead.getAttribute('aria-valuenow'));

// The same horizontal placement clickClipInterior uses, so a click and a drag
// that name the same position land on the same frame.
const interiorX = (box, position) => (
	box.x + Math.max(12, Math.min(box.width - 12, box.width * position))
);
const bodyY = (box) => box.y + Math.max(12, box.height * 0.55);

test.describe('time selection and the playhead', () => {
	registerAudioEditorHooks();

	test('drawing a time selection carries the playhead to the start of the selection', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		const clip = clipByName(editor, toneA.name);

		await clickClipInterior(page, clip, 0.25);
		await expect.poll(() => playheadFrame(playhead)).toBeGreaterThan(0);
		const atSelectionStart = await playheadFrame(playhead);
		await clickClipInterior(page, clip, 0.75);
		await expect.poll(() => playheadFrame(playhead)).toBeGreaterThan(atSelectionStart);

		// Drawn right to left, so a playhead that merely stayed where the drag was
		// released would fail this even though the selection is the same range.
		const box = await clip.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(interiorX(box, 0.75), bodyY(box));
		await page.mouse.down();
		await page.mouse.move(interiorX(box, 0.25), bodyY(box), { steps: 6 });
		await page.mouse.up();

		await expect.poll(() => playheadFrame(playhead)).toBeLessThan(atSelectionStart + 64);
		expect(await playheadFrame(playhead)).toBeGreaterThan(atSelectionStart - 64);
		expect(errors).toEqual([]);
	});

	test('selecting a clip from its header leaves the playhead where it was', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		const clip = clipByName(editor, toneA.name);

		await clickClipInterior(page, clip, 0.7);
		await expect.poll(() => playheadFrame(playhead)).toBeGreaterThan(0);
		const before = await playheadFrame(playhead);

		const box = await clip.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.click(box.x + 28, box.y + 10);

		await expect(clip.locator('[data-selected="true"]').first()).toBeVisible();
		expect(await playheadFrame(playhead)).toBe(before);
		expect(errors).toEqual([]);
	});
});

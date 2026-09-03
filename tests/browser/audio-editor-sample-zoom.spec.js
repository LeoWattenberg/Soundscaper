import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

// Mirrors TIMELINE_MAX_SCROLL_PIXELS: the widest surface a browser lays out.
const MAXIMUM_TIMELINE_SCROLL_PIXELS = 16_000_000;

test.describe('audio editor sample-depth zoom', () => {
	registerAudioEditorHooks();

	test('reaches the zoom where samples are drawn individually and arms the pencil', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await clipByName(editor, longTone.name).click({ position: { x: 24, y: 10 } });
		const timeline = editor.locator('[data-timeline]');
		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		for (let step = 0; step < 20; step += 1) await zoomIn.click();

		// The sample tools appear only once one sample is drawn as its own stem,
		// and Audacity shows a pencil over the lane while the draw tool is armed.
		await expect(editor.locator('[data-sample-edit-tools]')).toBeVisible();
		const lane = editor.locator('.audio-editor-track-lane').first();
		expect(await lane.evaluate((element) => globalThis.getComputedStyle(element).cursor))
			.toContain('data:image/svg+xml');

		// The surface stays inside the width a browser will lay out, and the
		// scroll offset is scaled onto the far wider content space instead.
		const metrics = await timeline.evaluate((element) => ({
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
			scale: Number(element.dataset.timelineScrollScale),
		}));
		expect(metrics.scrollWidth).toBeLessThanOrEqual(MAXIMUM_TIMELINE_SCROLL_PIXELS + metrics.clientWidth);
		expect(metrics.scale).toBeGreaterThan(1);

		// Scrolling into the scaled space still draws the clip under the viewport,
		// which only holds while drawn content carries the render origin.
		const target = Math.floor((metrics.scrollWidth - metrics.clientWidth) * 0.1);
		await timeline.evaluate((element, scrollX) => {
			element.scrollLeft = scrollX;
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		}, target);
		await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBe(target);
		const clipBox = await clipByName(editor, longTone.name).boundingBox();
		const timelineBox = await timeline.boundingBox();
		expect(clipBox).not.toBeNull();
		expect(clipBox.x).toBeLessThan(timelineBox.x + timelineBox.width);
		expect(clipBox.x + clipBox.width).toBeGreaterThan(timelineBox.x);
		expect(errors).toEqual([]);
	});
});

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('audio editor timeline render window', () => {
	registerAudioEditorHooks();

	test('anchors waveform projection while exact scroll continues updating', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const timeline = editor.locator('[data-timeline]');
		const panel = editor.locator('.audio-editor-timeline-panel');
		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		for (let step = 0; step < 4; step += 1) await zoomIn.click();

		const metrics = await timeline.evaluate((element) => {
			const root = element.closest('.audio-editor-timeline-panel');
			return {
				maximum: element.scrollWidth - element.clientWidth,
				viewportWidth: Number.parseFloat(
					getComputedStyle(root).getPropertyValue('--timeline-viewport-width'),
				),
			};
		});
		expect(metrics.maximum).toBeGreaterThan(metrics.viewportWidth * 0.75);
		const waveform = clipByName(editor, longTone.name).locator('canvas.clip-body__waveform');
		await waveform.evaluate((canvas) => { globalThis.__anchoredWaveformCanvas = canvas; });
		const initialAnchor = Number(await panel.getAttribute('data-render-scroll-x'));
		const withinAnchor = Math.floor(initialAnchor + metrics.viewportWidth * 0.25);

		await timeline.evaluate((element, scrollX) => {
			element.scrollLeft = scrollX;
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		}, withinAnchor);
		await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBe(withinAnchor);
		expect(Number(await panel.getAttribute('data-render-scroll-x'))).toBe(initialAnchor);
		expect(await panel.evaluate((element) => Number.parseFloat(
			element.style.getPropertyValue('--timeline-scroll-x'),
		))).toBe(withinAnchor);
		expect(await waveform.evaluate((canvas) => canvas === globalThis.__anchoredWaveformCanvas)).toBe(true);

		const beyondAnchor = Math.floor(initialAnchor + metrics.viewportWidth * 0.6);
		await timeline.evaluate((element, scrollX) => {
			element.scrollLeft = scrollX;
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		}, beyondAnchor);
		await expect.poll(async () => Number(await panel.getAttribute('data-render-scroll-x'))).toBe(beyondAnchor);
		await expect(clipByName(editor, longTone.name)).toBeVisible();
		await waveform.evaluate(() => { delete globalThis.__anchoredWaveformCanvas; });
		expect(errors).toEqual([]);
	});

	test('uses exact scroll hit testing for ruler drags inside an anchored render window', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const timeline = editor.locator('[data-timeline]');
		const panel = editor.locator('.audio-editor-timeline-panel');
		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		for (let step = 0; step < 4; step += 1) await zoomIn.click();

		const viewportWidth = await panel.evaluate((element) => Number.parseFloat(
			getComputedStyle(element).getPropertyValue('--timeline-viewport-width'),
		));
		const initialAnchor = Number(await panel.getAttribute('data-render-scroll-x'));
		const withinAnchor = Math.floor(initialAnchor + viewportWidth * 0.25);
		await timeline.evaluate((element, scrollX) => {
			element.scrollLeft = scrollX;
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		}, withinAnchor);
		await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBe(withinAnchor);
		expect(Number(await panel.getAttribute('data-render-scroll-x'))).toBe(initialAnchor);

		const ruler = editor.locator('[data-ruler-interaction]');
		const rulerBox = await ruler.boundingBox();
		expect(rulerBox).not.toBeNull();
		const startX = rulerBox.x + Math.min(96, rulerBox.width * 0.2);
		const endX = Math.min(rulerBox.x + rulerBox.width - 24, startX + 144);
		const pointerY = rulerBox.y + Math.min(26, rulerBox.height * 0.75);
		await page.mouse.move(startX, pointerY);
		await page.mouse.down();
		await page.mouse.move(endX, pointerY, { steps: 4 });
		await page.mouse.up();

		const selection = await editor.locator('[data-time-selection-overlay]').boundingBox();
		expect(selection).not.toBeNull();
		expect(Math.abs(selection.x - startX)).toBeLessThanOrEqual(2);
		expect(Math.abs(selection.width - (endX - startX))).toBeLessThanOrEqual(2);
		expect(await panel.evaluate((element) => Number.parseFloat(
			element.style.getPropertyValue('--timeline-scroll-x'),
		))).toBe(withinAnchor);
		expect(errors).toEqual([]);
	});
});

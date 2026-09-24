import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('timeline pointer affordances', () => {
	registerAudioEditorHooks();

	test('shows an I-beam throughout tracks and mouse position on both rulers', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const lane = editor.locator('.audio-editor-track-row [data-track-lane]').first();
		const laneBox = await lane.boundingBox();
		const rulerBox = await editor.locator('[data-ruler]').boundingBox();
		expect(laneBox).not.toBeNull();
		expect(rulerBox).not.toBeNull();
		const x = rulerBox.x + rulerBox.width - 55;
		const y = laneBox.y + laneBox.height / 2;
		await page.mouse.move(x, y);
		const cursor = await page.evaluate(({ x: pointX, y: pointY }) => {
			const target = document.elementFromPoint(pointX, pointY);
			return target ? getComputedStyle(target).cursor : null;
		}, { x, y });
		expect(cursor).toBe('text');
		const timePosition = editor.locator('[data-time-ruler-pointer-position]');
		const verticalPosition = editor.locator('[data-vertical-ruler-pointer-position]');
		await expect(timePosition).toBeVisible();
		await expect(verticalPosition).toBeVisible();
		expect(Math.abs((await timePosition.boundingBox()).x - x)).toBeLessThanOrEqual(1);
		expect(Math.abs((await verticalPosition.boundingBox()).y - y)).toBeLessThanOrEqual(1);
		const rulerBackground = await editor.locator('[data-track-ruler]').first().evaluate((element) => (
			getComputedStyle(element).backgroundColor
		));
		expect(rulerBackground).toMatch(/^rgb\([^)]*\)$/u);
		await expect(editor.locator('[data-timeline]')).toHaveCSS('background-size', /40px 100%/u);
		await editor.evaluate((element) => { element.dataset.editorSkin = 'sakura'; });
		await expect(editor.locator('[data-timeline]')).toHaveCSS('background-size', /40px 100%/u);
		await page.mouse.move(4, 4);
		await expect(timePosition).toBeHidden();
		await expect(verticalPosition).toBeHidden();
	});

	test('reserves only the top third of an unselected clip edge for trimming', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const lane = editor.locator('.audio-editor-track-row [data-track-lane]').first();
		const laneBox = await lane.boundingBox();
		const clipBox = await clip.boundingBox();
		expect(laneBox).not.toBeNull();
		expect(clipBox).not.toBeNull();
		await page.mouse.click(clipBox.x + clipBox.width + 25, laneBox.y + laneBox.height / 2);
		await expect(clip.locator('.clip-display')).not.toHaveClass(/clip-display--selected/u);
		const trimCursor = await clip.locator('.clip-display').evaluate((display) => (
			getComputedStyle(display, '::after').cursor
		));
		expect(trimCursor).toContain('url(');
		const lowerY = clipBox.y + clipBox.height * 5 / 6;
		await page.mouse.move(clipBox.x + clipBox.width - 3, lowerY);
		await page.mouse.down();
		await page.mouse.move(clipBox.x + clipBox.width - 38, lowerY, { steps: 5 });
		await page.mouse.up();
		await expect(editor.locator('[data-time-selection-overlay]').first()).toBeVisible();
		expect((await clip.boundingBox()).width).toBeCloseTo(clipBox.width, 0);
		const upperY = clipBox.y + clipBox.height / 6;
		await page.mouse.move(clipBox.x + clipBox.width - 3, upperY);
		await page.mouse.down();
		await page.mouse.move(clipBox.x + clipBox.width - 28, upperY, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => (await clip.boundingBox()).width).toBeLessThan(clipBox.width - 10);
	});
});

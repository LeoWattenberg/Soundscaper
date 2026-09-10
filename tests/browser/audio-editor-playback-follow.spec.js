import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('timeline playback following', () => {
	registerAudioEditorHooks();

	test('exposes mutually exclusive scroll and pinned playhead preferences', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const ruler = editor.locator('[data-ruler]');
		const menu = page.locator('.timeline-ruler-context-menu');
		const openMenu = () => ruler.click({ button: 'right', position: { x: 80, y: 20 } });

		await openMenu();
		const scrollToPlayhead = menu.getByRole('menuitem', { name: 'Scroll view to playhead', exact: true });
		const pinnedPlayhead = menu.getByRole('menuitem', { name: 'Pinned play head', exact: true });
		await expect(scrollToPlayhead.locator('svg')).toHaveCount(1);
		await expect(pinnedPlayhead.locator('svg')).toHaveCount(0);

		await pinnedPlayhead.click();
		await openMenu();
		await expect(scrollToPlayhead.locator('svg')).toHaveCount(0);
		await expect(pinnedPlayhead.locator('svg')).toHaveCount(1);

		await scrollToPlayhead.click();
		await openMenu();
		await expect(scrollToPlayhead.locator('svg')).toHaveCount(1);
		await expect(pinnedPlayhead.locator('svg')).toHaveCount(0);
		await page.keyboard.press('Escape');
		expect(errors).toEqual([]);
	});

	test('moves the playhead back to the left when it reaches the right edge', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		const timeline = editor.locator('[data-timeline]');
		const ruler = editor.locator('[data-ruler]');
		const clip = clipByName(editor, longTone.name);
		const [rulerBox, clipBox] = await Promise.all([ruler.boundingBox(), clip.boundingBox()]);
		expect(rulerBox).not.toBeNull();
		expect(clipBox).not.toBeNull();
		await page.mouse.click(rulerBox.x + rulerBox.width - 40, clipBox.y + clipBox.height / 2);

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(async () => {
			const [scrollLeft, currentRuler, playhead] = await Promise.all([
				timeline.evaluate((element) => element.scrollLeft),
				ruler.boundingBox(),
				editor.locator('[data-playhead] .playhead-cursor__line').boundingBox(),
			]);
			if (scrollLeft < 50 || !currentRuler || !playhead) return Number.POSITIVE_INFINITY;
			return playhead.x - currentRuler.x;
		}, { timeout: 3_000 }).toBeLessThan(160);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('suspends pinned following while a manually displaced playhead is off-screen', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		const timeline = editor.locator('[data-timeline]');
		const ruler = editor.locator('[data-ruler]');
		const clip = clipByName(editor, longTone.name);
		const [rulerBox, clipBox] = await Promise.all([ruler.boundingBox(), clip.boundingBox()]);
		expect(rulerBox).not.toBeNull();
		expect(clipBox).not.toBeNull();
		await page.mouse.click(rulerBox.x + rulerBox.width * 0.6, clipBox.y + clipBox.height / 2);

		await ruler.click({ button: 'right', position: { x: 80, y: 20 } });
		await page.locator('.timeline-ruler-context-menu')
			.getByRole('menuitem', { name: 'Pinned play head', exact: true })
			.click();
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(async () => {
			const [currentRuler, playhead] = await Promise.all([
				ruler.boundingBox(),
				editor.locator('[data-playhead] .playhead-cursor__line').boundingBox(),
			]);
			if (!currentRuler || !playhead) return Number.POSITIVE_INFINITY;
			return Math.abs(playhead.x - (currentRuler.x + currentRuler.width / 2));
		}).toBeLessThan(3);

		const manualScroll = await timeline.evaluate((element) => {
			const maximum = element.scrollWidth - element.clientWidth;
			element.scrollLeft = Math.min(maximum, element.scrollLeft + element.clientWidth * 0.7);
			return element.scrollLeft;
		});
		await page.waitForTimeout(150);
		expect(Math.abs(await timeline.evaluate((element) => element.scrollLeft) - manualScroll)).toBeLessThan(3);
		await expect.poll(async () => {
			const [currentRuler, playhead] = await Promise.all([
				ruler.boundingBox(),
				editor.locator('[data-playhead] .playhead-cursor__line').boundingBox(),
			]);
			if (!currentRuler || !playhead) return Number.POSITIVE_INFINITY;
			return Math.abs(playhead.x - (currentRuler.x + currentRuler.width / 2));
		}, { timeout: 3_000 }).toBeLessThan(3);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(errors).toEqual([]);
	});
});

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	openTrackHeaderDrawer,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

function intersectionRatio(locator) {
	return locator.evaluate((element) => new Promise((resolve) => {
		const observer = new IntersectionObserver(([entry]) => {
			observer.disconnect();
			resolve(entry.intersectionRatio);
		});
		observer.observe(element);
	}));
}

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

	test('clips an off-screen playhead before the sticky track controls', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		const timeline = editor.locator('[data-timeline]');
		await timeline.evaluate((element) => { element.scrollLeft = 200; });
		await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);

		const playheadLine = editor.locator('[data-playhead] .playhead-cursor__line');
		const [lineBox, trackHeaderBox] = await Promise.all([
			playheadLine.boundingBox(),
			editor.locator('[data-track-header]').first().boundingBox(),
		]);
		expect(lineBox).not.toBeNull();
		expect(trackHeaderBox).not.toBeNull();
		expect(lineBox.x).toBeLessThan(trackHeaderBox.x + trackHeaderBox.width);
		await expect.poll(() => intersectionRatio(playheadLine)).toBe(0);
		expect(errors).toEqual([]);
	});

	test('clips the playhead behind the compact track-header drawer', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 390, height: 844 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const lane = editor.locator('.audio-editor-track-row [data-track-lane]').first();
		const laneBox = await lane.boundingBox();
		expect(laneBox).not.toBeNull();
		await page.mouse.click(laneBox.x + 100, laneBox.y + 48);
		const playheadLine = editor.locator('[data-playhead] .playhead-cursor__line');
		await expect.poll(() => intersectionRatio(playheadLine)).toBeGreaterThan(0);

		expect(await openTrackHeaderDrawer(editor)).toBe(true);
		const trackHeader = editor.locator('[data-track-header]').first();
		await expect.poll(() => trackHeader.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
		const [lineBox, trackHeaderBox] = await Promise.all([
			playheadLine.boundingBox(),
			trackHeader.boundingBox(),
		]);
		expect(lineBox).not.toBeNull();
		expect(trackHeaderBox).not.toBeNull();
		expect(lineBox.x).toBeLessThan(trackHeaderBox.x + trackHeaderBox.width);
		await expect.poll(() => intersectionRatio(playheadLine)).toBe(0);
		expect(errors).toEqual([]);
	});

	test('keeps the playhead when Space stops and resumes playback', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await editor.evaluate((element) => {
			element.tabIndex = -1;
			element.focus();
		});
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		const playheadLine = playhead.locator('.playhead-cursor__line');

		await page.keyboard.press('Space');
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await expect.poll(() => intersectionRatio(playheadLine)).toBeGreaterThan(0);
		const stoppedFrameFloor = Number(await playhead.getAttribute('aria-valuenow'));
		await page.keyboard.press('Space');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(playhead).toHaveCount(1);
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
			.toBeGreaterThanOrEqual(stoppedFrameFloor);
		await expect.poll(() => intersectionRatio(playheadLine)).toBeGreaterThan(0);

		await page.keyboard.press('Space');
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(playhead).toHaveCount(1);
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
			.toBeGreaterThan(stoppedFrameFloor);
		await expect.poll(() => intersectionRatio(playheadLine)).toBeGreaterThan(0);
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

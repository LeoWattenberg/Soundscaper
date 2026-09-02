/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

/**
 * Compare the grid canvas with the ruler canvas pixel column by pixel column.
 * Ruler ticks paint the bottom rows of the ruler; labelled ticks also reach the
 * top rows. Grid lines paint the whole canvas height, majors at full alpha.
 */
function readGridAlignment(editor, gridSelector) {
	return editor.evaluate((root, selector) => {
		const ruler = root.querySelector('[data-ruler] canvas.timeline-ruler');
		const grid = root.querySelector(selector);
		if (!ruler || !grid) return { ready: false };
		const columns = (canvas, painted) => {
			const context = canvas.getContext('2d');
			const { width, height } = canvas;
			const ratio = width / canvas.getBoundingClientRect().width;
			const image = context.getImageData(0, 0, width, height).data;
			const pixel = (x, y) => Array.from(image.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
			const major = new Set();
			const minor = new Set();
			for (let x = 0; x < width; x += 1) {
				const kind = painted(pixel, x, width, height);
				if (kind) (kind === 'major' ? major : minor).add(Math.floor(x / ratio));
			}
			return { major: [...major], minor: [...minor].filter((column) => !major.has(column)) };
		};
		const differs = (a, b) => a.some((value, index) => Math.abs(value - b[index]) > 12);
		// A tick is a one-pixel column that differs from both neighbours, which
		// keeps a time-selection tint (a wide, uniform region) out of the count.
		const isolated = (pixel, x, y, width) => x > 0 && x + 1 < width
			&& differs(pixel(x, y), pixel(x - 1, y)) && differs(pixel(x, y), pixel(x + 1, y));
		const rulerTicks = columns(ruler, (pixel, x, width, height) => {
			if (!isolated(pixel, x, height - 3, width)) return null;
			return isolated(pixel, x, 1, width) ? 'major' : 'minor';
		});
		let fullHeight = true;
		const gridLines = columns(grid, (pixel, x, width, height) => {
			const alpha = pixel(x, 1)[3];
			if (alpha === 0) return null;
			if (pixel(x, height - 2)[3] === 0) fullHeight = false;
			return alpha > 200 ? 'major' : 'minor';
		});
		const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
		const only = (a, b) => a.filter((column) => !b.includes(column)).slice(0, 12);
		return {
			gridOnly: { major: only(gridLines.major, rulerTicks.major), minor: only(gridLines.minor, rulerTicks.minor) },
			rulerOnly: { major: only(rulerTicks.major, gridLines.major), minor: only(rulerTicks.minor, gridLines.minor) },
			ready: true,
			scrollX: root.closest('.audio-editor-timeline-panel')?.style.getPropertyValue('--timeline-scroll-x') || '0px',
			leftOffset: Math.round(grid.getBoundingClientRect().left - ruler.getBoundingClientRect().left),
			widthOffset: Math.round(grid.getBoundingClientRect().width - ruler.getBoundingClientRect().width),
			majorCount: gridLines.major.length,
			minorCount: gridLines.minor.length,
			majorsMatch: same(gridLines.major, rulerTicks.major),
			minorsMatch: same(gridLines.minor, rulerTicks.minor),
			fullHeight,
		};
	}, gridSelector);
}

const ALIGNED = {
	ready: true,
	leftOffset: 0,
	widthOffset: 0,
	majorsMatch: true,
	minorsMatch: true,
	fullHeight: true,
};

test.describe('timeline grid lines', () => {
	registerAudioEditorHooks();

	test('draws a line under every ruler tick and keeps them aligned through scroll, zoom and format changes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const timeline = editor.locator('[data-timeline]');
		const panel = editor.locator('.audio-editor-timeline-panel');
		const grid = editor.locator('[data-timeline-grid="viewport"] canvas');
		const readAlignment = () => readGridAlignment(panel, '[data-timeline-grid="viewport"] canvas');

		await expect(grid).toHaveCount(1);
		await expect.poll(readAlignment).toMatchObject({ ...ALIGNED, scrollX: '0px' });
		let alignment = await readAlignment();
		expect(alignment.majorCount).toBeGreaterThanOrEqual(3);
		expect(alignment.minorCount).toBeGreaterThan(alignment.majorCount);

		// The canvas covers the scroll viewport below the ruler, so lines continue
		// under the empty stage beneath the last track instead of stopping with it.
		const [timelineBox, gridBox, rulerRowBox] = await Promise.all([
			timeline.boundingBox(),
			grid.boundingBox(),
			editor.locator('.audio-editor-ruler-row').boundingBox(),
		]);
		expect(Math.round(gridBox.y)).toBe(Math.round(rulerRowBox.y + rulerRowBox.height));
		expect(gridBox.y + gridBox.height).toBeGreaterThanOrEqual(timelineBox.y + timelineBox.height - 20);

		await importFiles(editor, [longTone]);
		const lane = editor.locator('[data-track-row] [data-track-lane]').first();
		await expect(lane).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
		await expect(editor.locator('[data-track-row]').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
		await expect.poll(readAlignment).toMatchObject(ALIGNED);

		await timeline.evaluate((element) => { element.scrollLeft = 333; });
		await expect.poll(readAlignment).toMatchObject({ ...ALIGNED, scrollX: '333px' });

		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await expect.poll(readAlignment).toMatchObject(ALIGNED);
		alignment = await readAlignment();
		expect(alignment.majorCount).toBeGreaterThanOrEqual(2);

		const timelineRuler = editor.locator('[data-ruler]');
		await timelineRuler.click({ button: 'right', position: { x: 80, y: 20 } });
		const timelineMenu = page.locator('.timeline-ruler-context-menu');
		await expect(timelineMenu).toBeVisible();
		await timelineMenu.getByRole('menuitem', { name: 'Beats & measures', exact: true }).click();
		await expect(timelineRuler).toHaveAttribute('data-time-format', 'beats-measures');
		await expect.poll(readAlignment).toMatchObject(ALIGNED);
		alignment = await readAlignment();
		expect(alignment.majorCount).toBeGreaterThanOrEqual(2);

		expect(errors).toEqual([]);
	});

	test('output dock lanes draw the same grid behind their envelopes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = editor.locator('.audio-editor-timeline-panel');
		await editor.getByRole('button', { name: 'Add track', exact: true }).click();
		const flyout = page.locator('.add-track-flyout');
		await flyout.getByRole('checkbox', { name: 'Show master track', exact: true }).click();
		await page.keyboard.press('Escape');
		const masterRow = editor.locator('[data-output-track-row][data-output-scope="master"]');
		await expect(masterRow).toHaveCount(1);
		await expect(masterRow.locator('.audio-editor-output-lane')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
		await expect.poll(() => readGridAlignment(
			panel,
			'[data-output-track-row][data-output-scope="master"] [data-timeline-grid="fill"] canvas',
		)).toMatchObject(ALIGNED);

		expect(errors).toEqual([]);
	});
});

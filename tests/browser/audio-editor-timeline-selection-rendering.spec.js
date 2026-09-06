import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

async function dragRulerSelection(page, editor) {
	const ruler = editor.locator('[data-ruler-interaction]');
	const rulerBox = await ruler.boundingBox();
	expect(rulerBox).not.toBeNull();
	const startX = rulerBox.x + 40;
	const endX = rulerBox.x + 160;
	const pointerY = rulerBox.y + rulerBox.height * 0.8;
	await page.mouse.move(startX, pointerY);
	await page.mouse.down();
	await page.mouse.move(endX, pointerY, { steps: 4 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]').first()).toBeVisible();
}

test.describe('Soundscaper timeline selection rendering', () => {
	registerAudioEditorHooks();

	test('shades the selected range only in the tracks the selection acts on', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		// The workspace opens with an empty track, so importing two files leaves
		// three rows to tell apart.
		await importFiles(editor, [toneA, toneB]);
		const rows = editor.locator('.audio-editor-track-row');
		await expect(rows).toHaveCount(3);

		// A track is focused after import, so a bare ruler drag selects a range in
		// that one track: the other tracks keep their unshaded lanes.
		await dragRulerSelection(page, editor);
		const bands = editor.locator('[data-time-selection-overlay]');
		await expect(bands).toHaveCount(1);
		const selectedRow = editor.locator('.audio-editor-track-row:has([data-track-lane][data-selected="true"])');
		await expect(selectedRow).toHaveCount(1);
		await expect(selectedRow.locator('[data-time-selection-overlay]')).toHaveCount(1);

		const bandBox = await bands.boundingBox();
		const selectedBox = await selectedRow.boundingBox();
		expect(bandBox.y).toBeGreaterThanOrEqual(selectedBox.y - 1);
		expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(selectedBox.y + selectedBox.height + 1);

		// Selecting every track is what puts the range back across the timeline.
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'Select all tracks']);
		await expect(bands).toHaveCount(3);
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
		await expect(bands).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('rings the selected track once, across its header and its lane', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const rows = editor.locator('.audio-editor-track-row');
		await expect(rows).toHaveCount(2);

		const ring = editor.locator('.audio-editor-track-header-selection');
		await expect(ring).toHaveCount(1);
		await expect(rows.nth(0).locator('[data-track-header] .audio-editor-track-header-selection')).toHaveCount(0);

		// The ring is painted over the vendored control panel rather than clipped
		// away with the focus bars the panel draws outside its own box.
		const headerBox = await rows.nth(1).locator('[data-track-header]').boundingBox();
		const ringBox = await ring.boundingBox();
		expect(ringBox.width).toBeGreaterThan(headerBox.width - 2);
		expect(ringBox.height).toBeGreaterThan(headerBox.height - 2);

		// Audacity draws one selection around the whole track, so the header only
		// carries its rounded outer end and the row runs the bars on to the end of
		// the lane. Nothing may close the ring at the header/lane seam.
		const outline = await rows.nth(1).evaluate((row) => {
			const cap = getComputedStyle(row.querySelector('.audio-editor-track-header-selection'));
			const lane = row.querySelector('[data-track-lane]');
			const bar = (part) => {
				const style = getComputedStyle(row, part);
				return { height: style.height, width: style.width, color: style.backgroundColor };
			};
			return {
				capTop: cap.borderTopWidth,
				capLeft: cap.borderLeftWidth,
				capBottom: cap.borderBottomWidth,
				capRight: cap.borderRightWidth,
				capOuterRadius: cap.borderTopLeftRadius,
				capInnerRadius: cap.borderTopRightRadius,
				capColor: cap.borderTopColor,
				laneShadow: getComputedStyle(lane).boxShadow,
				rowWidth: `${String(Math.round(row.getBoundingClientRect().width))}px`,
				top: bar('::before'),
				bottom: bar('::after'),
			};
		});
		expect(outline.capTop).toBe('2px');
		expect(outline.capLeft).toBe('2px');
		expect(outline.capBottom).toBe('2px');
		expect(outline.capRight).toBe('0px');
		expect(outline.capInnerRadius).toBe('0px');
		expect(Number.parseFloat(outline.capOuterRadius)).toBeGreaterThan(0);
		expect(outline.laneShadow).toBe('none');
		for (const bar of [outline.top, outline.bottom]) {
			expect(bar.height).toBe('2px');
			expect(bar.width).toBe(outline.rowWidth);
			expect(bar.color).toBe(outline.capColor);
		}

		await rows.nth(0).locator('[data-track-lane]').click({ position: { x: 8, y: 8 } });
		await expect(rows.nth(0).locator('[data-track-header] .audio-editor-track-header-selection')).toHaveCount(1);
		await expect(rows.nth(1).locator('[data-track-header] .audio-editor-track-header-selection')).toHaveCount(0);
		const unselectedBars = await rows.nth(1).evaluate((row) => [
			getComputedStyle(row, '::before').content,
			getComputedStyle(row, '::after').content,
		]);
		expect(unselectedBars).toEqual(['none', 'none']);
		expect(errors).toEqual([]);
	});

	test('carries the track header column to the bottom of the timeline viewport', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('.audio-editor-track-row')).toHaveCount(2);

		// Tracks fit the viewport until their height is changed by hand; shrink
		// them so there is empty space under the last track to account for.
		for (let press = 0; press < 20; press += 1) {
			await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Decrease all track heights']);
		}

		const geometry = await editor.evaluate((root) => {
			const scroll = root.querySelector('[data-timeline]');
			const list = root.querySelector('[data-track-list]');
			const ruler = root.querySelector('.audio-editor-ruler-row');
			const lastRow = [...root.querySelectorAll('.audio-editor-track-row')].at(-1);
			const listTop = list.getBoundingClientRect().top;
			const surface = document.createElement('div');
			surface.style.background = 'var(--kw-editor-stage-raised)';
			root.append(surface);
			const raised = getComputedStyle(surface).backgroundColor;
			surface.remove();
			const scrollStyle = getComputedStyle(scroll);
			const stops = [...scrollStyle.backgroundImage.matchAll(/([\d.]+)px/g)].map((stop) => Number(stop[1]));
			return {
				listHeight: list.getBoundingClientRect().height,
				available: scroll.clientHeight - ruler.getBoundingClientRect().height,
				rowsHeight: lastRow.getBoundingClientRect().bottom - listTop,
				columnImage: scrollStyle.backgroundImage,
				columnAttachment: scrollStyle.backgroundAttachment,
				columnWidth: stops[1],
				raised,
				headerWidth: root.querySelector('[data-track-header]').getBoundingClientRect().width,
			};
		});

		// One track leaves empty space below it, and the column has to reach the
		// bottom of that space rather than stopping at the last track.
		expect(geometry.rowsHeight).toBeLessThan(geometry.available - 1);
		expect(geometry.listHeight).toBeGreaterThanOrEqual(geometry.available - 1);

		// The scrolling viewport paints the column itself, in the same surface as
		// the headers above it and exactly as wide, so it covers the empty space to
		// the bottom of the viewport.
		expect(geometry.columnImage).toContain(geometry.raised);
		expect(Math.abs(geometry.columnWidth - geometry.headerWidth)).toBeLessThanOrEqual(1);

		// The column stands in for the sticky headers above it, so it has to stay
		// at the left edge of the viewport once the timeline scrolls sideways.
		// Belonging to the viewport rather than to the scrolled surface is what
		// keeps it there: a scroll listener moving it would always answer a frame
		// late and shudder against the headers it continues.
		expect(geometry.columnAttachment).toBe('scroll');
		const timeline = editor.locator('[data-timeline]');
		await timeline.evaluate((element) => { element.scrollLeft = 240; });
		await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBe(240);
		const scrolled = await editor.evaluate((root) => {
			const scroll = root.querySelector('[data-timeline]');
			const header = root.querySelector('[data-track-header]');
			return {
				columnImage: getComputedStyle(scroll).backgroundImage,
				headerOffset: Math.round(
					header.getBoundingClientRect().left - scroll.getBoundingClientRect().left,
				),
			};
		});
		expect(scrolled.columnImage).toBe(geometry.columnImage);
		expect(scrolled.headerOffset).toBe(0);
		expect(errors).toEqual([]);
	});

	test('pins the vertical scale to the right edge of the lane viewport', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		// Zoom in far enough that the timeline has somewhere to scroll to.
		for (let press = 0; press < 6; press += 1) await page.keyboard.press('Control+1');
		const timeline = editor.locator('[data-timeline]');
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth - element.clientWidth))
			.toBeGreaterThan(400);

		const readScale = () => editor.evaluate((root) => {
			const scroll = root.querySelector('[data-timeline]');
			const scale = root.querySelector('.audio-editor-vertical-ruler');
			const corner = root.querySelector('.audio-editor-ruler-scale-corner');
			const port = scroll.getBoundingClientRect();
			return {
				scrollLeft: Math.round(scroll.scrollLeft),
				// The scale hangs off the right edge of the viewport by a fixed
				// amount, and its corner sits squarely above it, at every offset.
				fromViewportRight: Math.round(port.right - scale.getBoundingClientRect().right),
				cornerOffset: Math.round(
					corner.getBoundingClientRect().left - scale.getBoundingClientRect().left,
				),
				// Sticky layout holds the scale in place on the compositor. A
				// transform fed by a scroll listener would arrive a frame late and
				// jitter against the sticky headers on the other side of the lane.
				transform: getComputedStyle(scale).transform,
			};
		});

		const atRest = await readScale();
		expect(atRest.transform).toBe('none');
		expect(atRest.cornerOffset).toBe(0);
		for (const offset of [240, 900]) {
			await timeline.evaluate((element, left) => { element.scrollLeft = left; }, offset);
			await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBe(offset);
			const scrolled = await readScale();
			expect(scrolled.fromViewportRight).toBe(atRest.fromViewportRight);
			expect(scrolled.cornerOffset).toBe(0);
			expect(scrolled.transform).toBe('none');
		}

		// Scrolling down must not carry the scales with it: each one belongs to the
		// track beside it, not to the top of the viewport.
		for (let press = 0; press < 6; press += 1) {
			await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Increase all track heights']);
		}
		await expect.poll(() => timeline.evaluate((element) => element.scrollHeight - element.clientHeight))
			.toBeGreaterThan(100);
		await timeline.evaluate((element) => { element.scrollTop = 100; });
		const rows = await editor.evaluate((root) => [...root.querySelectorAll('.audio-editor-track-row')]
			.map((row) => Math.round(
				row.querySelector('.audio-editor-vertical-ruler').getBoundingClientRect().top
					- row.getBoundingClientRect().top,
			)));
		expect(rows.length).toBeGreaterThan(0);
		expect(rows).toEqual(rows.map(() => 0));
		expect(errors).toEqual([]);
	});
});

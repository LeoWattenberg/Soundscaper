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
			return {
				listHeight: list.getBoundingClientRect().height,
				available: scroll.clientHeight - ruler.getBoundingClientRect().height,
				rowsHeight: lastRow.getBoundingClientRect().bottom - listTop,
				sidebarWidth: Number.parseFloat(getComputedStyle(list, '::before').width),
				headerWidth: root.querySelector('[data-track-header]').getBoundingClientRect().width,
			};
		});

		// One track leaves empty space below it, and the column has to reach the
		// bottom of that space rather than stopping at the last track.
		expect(geometry.rowsHeight).toBeLessThan(geometry.available - 1);
		expect(geometry.listHeight).toBeGreaterThanOrEqual(geometry.available - 1);
		expect(Math.abs(geometry.sidebarWidth - geometry.headerWidth)).toBeLessThanOrEqual(1);

		// The column stands in for the sticky headers above it, so it has to stay
		// at the left edge of the viewport once the timeline scrolls sideways.
		const timeline = editor.locator('[data-timeline]');
		await timeline.evaluate((element) => {
			element.scrollLeft = 240;
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		});
		await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBe(240);
		await expect.poll(() => editor.evaluate((root) => {
			const list = root.querySelector('[data-track-list]');
			const header = root.querySelector('[data-track-header]');
			const shift = new DOMMatrixReadOnly(getComputedStyle(list, '::before').transform).m41;
			return Math.round(list.getBoundingClientRect().left + shift - header.getBoundingClientRect().left);
		})).toBe(0);
		expect(errors).toEqual([]);
	});
});

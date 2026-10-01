import { WAVEFORM_PEAKS_VERSION } from '../../src/common/editor/waveform-peak-contract.ts';
import { AUDIO_EDITOR_MAX_PIXELS_PER_SECOND } from '../../src/common/editor/timeline-zoom-limits.ts';
import {
	asymmetricStereoTone,
	expect,
	longTone,
	monoTone,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	clipField,
	clipNameAccessiblePattern,
	closeDialog,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
	sourcePeakChannels,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

async function expectPeakPyramidColumnsAtMostOnePixel(waveform) {
	const resolution = await waveform.evaluate((canvas) => {
		const plan = canvas.__kwWaveformPlan;
		const context = canvas.getContext('2d');
		const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
		let visible = false;
		for (let index = 3; pixels && index < pixels.length; index += 4) {
			if (pixels[index] !== 0) { visible = true; break; }
		}
		if (!plan) return { missing: true, visible };
		const canvasWidth = canvas.getBoundingClientRect().width;
		const source = canvas.dataset.waveformSource;
		const widthScale = canvasWidth / plan.pixelWidth;
		return {
			missing: false,
			visible,
			source,
			blockSize: plan.peakBlockSize ?? null,
			pixelsPerSample: plan.pixelsPerSample,
			pixelWidth: plan.peakBlockSize && source === 'peaks'
				? plan.peakBlockSize * plan.pixelsPerSample * widthScale
				: null,
			plannedWidth: plan.pixelWidth,
			canvasWidth,
			mode: canvas.dataset.waveformMode,
			pending: canvas.dataset.waveformPending ?? null,
		};
	});
	expect(resolution.missing, `waveform state ${JSON.stringify(resolution)}`).toBe(false);
	expect(resolution.visible, `waveform state ${JSON.stringify(resolution)}`).toBe(true);
	if (resolution.source === 'peak-preview') {
		expect(resolution.mode).toBe('summary');
		return;
	}
	if (resolution.pixelWidth === null) return;
	expect(
		resolution.pixelWidth,
		`peak resolution ${JSON.stringify(resolution)}`,
	).toBeLessThanOrEqual(1);
}

async function spectrogramVisibleColumns(canvas) {
	return canvas.evaluate((element) => {
		const { data, width, height } = element.getContext('2d')
			.getImageData(0, 0, element.width, element.height);
		const visibleColumns = [0, 0, 0];
		let legacyBlueSilencePixels = 0;
		for (let x = 0; x < width; x += 1) {
			let hasVisibleSpectrum = false;
			for (let y = 0; y < height; y += 1) {
				const pixel = (y * width + x) * 4;
				if (!data[pixel + 3]) continue;
				const red = data[pixel];
				const green = data[pixel + 1];
				const blue = data[pixel + 2];
				if (red <= 2 && green <= 2 && blue >= 250) legacyBlueSilencePixels += 1;
				if (Math.max(red, green, blue) > 64 && red + green > 24) hasVisibleSpectrum = true;
			}
			if (hasVisibleSpectrum) visibleColumns[Math.min(2, Math.floor(x * 3 / width))] += 1;
		}
		return { width, height, visibleColumns, legacyBlueSilencePixels };
	});
}

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('announces each clip placement in its accessible name', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await expect(clip).toHaveAttribute(
			'aria-label',
			`${toneA.name} clip, starts at 0 seconds, 0.8 seconds long`,
		);
		expect(errors).toEqual([]);
	});

	test('renames an audio clip from its header, F2, and Clip Properties', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const initialClip = clipByName(editor, toneA.name);
		const clipId = await initialClip.getAttribute('data-clip-id');
		expect(clipId).not.toBeNull();
		const clip = editor.locator(`[data-clip-id="${clipId}"]`);

		await clip.locator('.clip-header__name').dblclick();
		const headerInput = clip.getByRole('textbox', { name: 'Clip name', exact: true });
		await expect(headerInput).toBeFocused();
		await headerInput.fill('Header rename');
		await headerInput.press('Enter');
		await expect(clip).toContainText('Header rename');

		await clip.locator('.clip-header').click();
		await page.keyboard.press('F2');
		await expect(headerInput).toBeFocused();
		await headerInput.fill('Discarded rename');
		await headerInput.press('Escape');
		await expect(clip).toContainText('Header rename');

		await clip.locator('.clip-header').click();
		await page.keyboard.press('F2');
		await headerInput.fill('F2 rename');
		await headerInput.press('Enter');
		await expect(clip).toContainText('F2 rename');

		const dialog = await openClipProperties(page, editor, clip);
		const nameField = clipField(dialog, 'name');
		await expect(nameField).toHaveValue('F2 rename');
		await nameField.fill('Properties rename');
		await nameField.press('Tab');
		await expect(clip).toContainText('Properties rename');
		await closeDialog(dialog);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clip).toContainText('F2 rename');
		expect(errors).toEqual([]);
	});

	test('moves and trims clips with frame-canonical pointer edits', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.scrollIntoViewIfNeeded();
		await clip.click({ position: { x: 32, y: 10 } });
		let clipDialog = await openClipProperties(page, editor);
		await expect(clipField(clipDialog, 'startFrame')).toHaveValue('0');
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('38400');
		await closeDialog(clipDialog);
		await clip.scrollIntoViewIfNeeded();

		const box = await clip.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box.x + 32, box.y + 10);
		await page.mouse.down();
		await page.mouse.move(box.x + 80, box.y + 10, { steps: 4 });
		await expect.poll(async () => (await clip.boundingBox())?.x || 0).toBeGreaterThan(box.x + 20);
		await page.mouse.up();
		clipDialog = await openClipProperties(page, editor);
		await expect.poll(async () => Number(await clipField(clipDialog, 'startFrame').inputValue())).toBeGreaterThan(0);

		const movedDuration = Number(await clipField(clipDialog, 'durationFrame').inputValue());
		await closeDialog(clipDialog);
		await clip.scrollIntoViewIfNeeded();
		const trimBox = await clip.boundingBox();
		expect(trimBox).not.toBeNull();
		await page.mouse.move(trimBox.x + trimBox.width - 2, trimBox.y + 48);
		await page.mouse.down();
		await page.mouse.move(trimBox.x + trimBox.width - 26, trimBox.y + 48, { steps: 4 });
		await page.mouse.up();
		clipDialog = await openClipProperties(page, editor);
		await expect.poll(async () => Number(await clipField(clipDialog, 'durationFrame').inputValue())).toBeLessThan(movedDuration);
		await closeDialog(clipDialog);
		const selectedClipBox = await clip.boundingBox();
		expect(selectedClipBox).not.toBeNull();
		await page.mouse.move(selectedClipBox.x + 32, selectedClipBox.y + 48);
		await page.mouse.down();
		await page.mouse.move(selectedClipBox.x + 80, selectedClipBox.y + 48, { steps: 4 });
		await page.mouse.up();
		await expect(editor.getByRole('button', { name: 'Loop selection' })).toBeEnabled();
		await expect.poll(async () => (await clip.boundingBox())?.x || 0).toBeLessThan(selectedClipBox.x + 2);
		expect(errors).toEqual([]);
	});

	test('creates a new track when a clip is dragged into empty space below the tracks', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor).toHaveAttribute('data-track-count', '2');
		const clip = clipByName(editor, toneA.name);
		await clip.scrollIntoViewIfNeeded();
		const clipBox = await clip.boundingBox();
		const timelineInnerBox = await editor.locator('.audio-editor-timeline-inner').boundingBox();
		const lastTrackBox = await editor.locator('.audio-editor-track-row').last().boundingBox();
		expect(clipBox).not.toBeNull();
		expect(timelineInnerBox).not.toBeNull();
		expect(lastTrackBox).not.toBeNull();
		const targetY = Math.min(timelineInnerBox.y + timelineInnerBox.height - 16, lastTrackBox.y + lastTrackBox.height + 32);

		await page.mouse.move(clipBox.x + 32, clipBox.y + 10);
		await page.mouse.down();
		await page.mouse.move(clipBox.x + 32, targetY, { steps: 6 });
		await expect(editor.locator('.audio-editor-new-track-drop-preview')).toBeVisible();
		await page.mouse.up();

		await expect(editor).toHaveAttribute('data-track-count', '3');
		await expect(editor.locator('[data-track-row]').last().getByRole('group', {
			name: clipNameAccessiblePattern(toneA.name),
		})).toHaveCount(1);
		await editor.getByRole('button', { name: 'Undo' }).click();
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('moves, trims, and stretches a multi-selection as one clip set', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const firstClip = clipByName(editor, toneA.name);
		const secondClip = clipByName(editor, toneB.name);
		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });
		await expect(firstClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await expect(secondClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await expect(firstClip).toHaveCSS('z-index', '1001');
		await expect(secondClip).toHaveCSS('z-index', '1001');

		const firstStart = await firstClip.boundingBox();
		const secondStart = await secondClip.boundingBox();
		expect(firstStart).not.toBeNull();
		expect(secondStart).not.toBeNull();
		await page.mouse.move(secondStart.x + 28, secondStart.y + 10);
		await page.mouse.down();
		await page.mouse.move(secondStart.x + 76, secondStart.y + 10, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await firstClip.boundingBox())?.x || 0).toBeGreaterThan(firstStart.x + 20);
		await expect.poll(async () => (await secondClip.boundingBox())?.x || 0).toBeGreaterThan(secondStart.x + 20);

		const firstBeforeTrim = await firstClip.boundingBox();
		const secondBeforeTrim = await secondClip.boundingBox();
		const trimHandle = secondClip.locator('.clip-display__handle--trim-right');
		const trimBox = await trimHandle.boundingBox();
		expect(firstBeforeTrim).not.toBeNull();
		expect(secondBeforeTrim).not.toBeNull();
		expect(trimBox).not.toBeNull();
		const trimWaveform = secondClip.locator('canvas.clip-body__waveform');
		const waveformBeforeTrim = await trimWaveform.evaluate((canvas) => {
			globalThis.__trimPreviewWaveformPlan = canvas.__kwWaveformPlan;
			return {
				pixelsPerSample: canvas.__kwWaveformPlan.pixelsPerSample,
				drawScale: canvas.getBoundingClientRect().width / canvas.__kwWaveformPlan.pixelWidth,
			};
		});
		await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(trimBox.x - 24, trimBox.y + trimBox.height / 2, { steps: 4 });
		await expect.poll(async () => (await secondClip.boundingBox())?.width || 0).toBeLessThan(secondBeforeTrim.width - 10);
		const waveformDuringTrim = await trimWaveform.evaluate((canvas) => ({
			reusedPlan: canvas.__kwWaveformPlan === globalThis.__trimPreviewWaveformPlan,
			pixelsPerSample: canvas.__kwWaveformPlan.pixelsPerSample,
			drawScale: canvas.getBoundingClientRect().width / canvas.__kwWaveformPlan.pixelWidth,
		}));
		expect(waveformDuringTrim.reusedPlan).toBe(false);
		expect(waveformDuringTrim.pixelsPerSample).toBeCloseTo(waveformBeforeTrim.pixelsPerSample, 4);
		expect(waveformDuringTrim.drawScale).toBeCloseTo(waveformBeforeTrim.drawScale, 2);
		await page.mouse.up();
		await expect.poll(async () => (await firstClip.boundingBox())?.width || 0).toBeLessThan(firstBeforeTrim.width - 10);
		await expect.poll(async () => (await secondClip.boundingBox())?.width || 0).toBeLessThan(secondBeforeTrim.width - 10);

		const firstBeforeStretch = await firstClip.boundingBox();
		const secondBeforeStretch = await secondClip.boundingBox();
		const stretchHandle = secondClip.locator('.clip-display__handle--stretch-right');
		const stretchBox = await stretchHandle.boundingBox();
		expect(firstBeforeStretch).not.toBeNull();
		expect(secondBeforeStretch).not.toBeNull();
		expect(stretchBox).not.toBeNull();
		await page.mouse.move(stretchBox.x + stretchBox.width / 2, stretchBox.y + stretchBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(stretchBox.x + 24, stretchBox.y + stretchBox.height / 2, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await firstClip.boundingBox())?.width || 0).toBeGreaterThan(firstBeforeStretch.width + 10);
		await expect.poll(async () => (await secondClip.boundingBox())?.width || 0).toBeGreaterThan(secondBeforeStretch.width + 10);
		expect(errors).toEqual([]);
	});

	test('deselects a clip when clicking its body instead of its header', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.locator('.clip-header').click();
		await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await clip.click({ position: { x: 48, y: 48 } });
		await expect(clip.locator('.clip-display')).not.toHaveClass(/clip-display--selected/);
		expect(errors).toEqual([]);
	});

	test('shows the pitch badge a clip earns from the Alt+Up and Alt+Down shortcuts', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const timeline = editor.getByRole('region', { name: 'Timeline', exact: true }).first();
		const badge = clip.locator('.clip-header__badge-value');
		await clip.locator('.clip-header').click();
		await expect(badge).toHaveCount(0);

		// The badge carries the direction on the number, because the header draws
		// one musical note where Audacity swaps between two arrow bitmaps.
		await timeline.press('Alt+ArrowUp');
		await expect(badge).toHaveText('+1');
		await timeline.press('Alt+ArrowUp');
		await expect(badge).toHaveText('+2');
		for (let step = 0; step < 3; step += 1) await timeline.press('Alt+ArrowDown');
		await expect(badge).toHaveText('-1');
		await timeline.press('Alt+ArrowUp');
		await expect(badge).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('enables delete menus and shortcuts for a clip-only selection', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let clip = clipByName(editor, toneA.name);
		await clip.locator('.clip-header').click();
		await editor.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
		const editMenu = page.getByRole('menu', { name: 'Edit', exact: true });
		await getMenuItem(editMenu, 'Delete').hover();
		for (const label of [
			'Delete and leave gap',
			'Delete and close gap per clip',
			'Delete and close gap per track',
			'Delete and close gap on all tracks',
		]) await expect(getMenuItem(editMenu, label)).toBeEnabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await clip.locator('.clip-header').click();
		await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/);

		await editor.getByRole('region', { name: 'Timeline', exact: true }).first().press('Delete');
		await expect(clipByName(editor, toneA.name)).toHaveCount(0);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		clip = clipByName(editor, toneA.name);
		await expect(clip).toHaveCount(1);
		await clip.locator('.clip-header').click();
		await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await editor.getByRole('region', { name: 'Timeline', exact: true }).first().press('Control+Delete');
		await expect(clipByName(editor, toneA.name)).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('persists independent waveform peak pyramids for stereo channels', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [asymmetricStereoTone]);
		const peaks = await sourcePeakChannels(page, asymmetricStereoTone.name);
		expect(peaks.version).toBe(WAVEFORM_PEAKS_VERSION);
		expect(peaks.channelCount).toBe(2);
		expect(peaks.blockSizes).toEqual([8, 16, 32, 64, 256, 1_024, 4_096, 16_384, 65_536]);
		expect(peaks.channels).toHaveLength(2);
		expect(peaks.channels[0].maximum).toBeGreaterThan(0.09);
		expect(peaks.channels[0].maximum).toBeLessThan(0.11);
		expect(peaks.channels[1].maximum).toBeGreaterThan(0.69);
		expect(peaks.channels[1].maximum).toBeLessThan(0.71);
		expect(peaks.channels[1].maximum).toBeGreaterThan(peaks.channels[0].maximum * 6);
		expect(errors).toEqual([]);
	});

	test('renders solid Audacity summary columns and connected samples across zoom levels', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await editor.getByRole('button', { name: 'Zoom out', exact: true }).click();
		const waveform = clipByName(editor, longTone.name).locator('canvas.clip-body__waveform');
		await expect(waveform).toHaveAttribute('data-waveform-renderer', 'audacity');
		await expect(waveform).toHaveAttribute('data-waveform-mode', 'summary');
		await expect(waveform).toHaveAttribute('data-waveform-source', 'peaks');
		await expectPeakPyramidColumnsAtMostOnePixel(waveform);

		const summaryPixels = await waveform.evaluate((canvas) => {
			const context = canvas.getContext('2d');
			const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
			let blankColumns = 0;
			let transparentInteriorPixels = 0;
			for (let x = 0; x < width; x += 1) {
				let first = -1;
				let last = -1;
				for (let y = 0; y < height; y += 1) {
					if (data[(y * width + x) * 4 + 3] === 0) continue;
					if (first < 0) first = y;
					last = y;
				}
				if (first < 0) {
					blankColumns += 1;
					continue;
				}
				for (let y = first; y <= last; y += 1) {
					if (data[(y * width + x) * 4 + 3] === 0) transparentInteriorPixels += 1;
				}
			}
			return { blankColumns, transparentInteriorPixels, width };
		});
		expect(summaryPixels.width).toBeGreaterThan(40);
		expect(summaryPixels.blankColumns).toBe(0);
		expect(summaryPixels.transparentInteriorPixels).toBe(0);

		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		let sampleMode = 'summary';
		for (let step = 0; step < 12 && sampleMode === 'summary'; step += 1) {
			await zoomIn.click();
			sampleMode = await waveform.getAttribute('data-waveform-mode');
			await expectPeakPyramidColumnsAtMostOnePixel(waveform);
		}
		expect(sampleMode).toBe('connecting-dots');
		await expect(waveform).toHaveAttribute('data-waveform-source', 'pcm');
		const zoomedClip = clipByName(editor, longTone.name);
		await zoomedClip.click({ position: { x: 48, y: 48 } });
		await expect(zoomedClip.locator('.clip-display')).not.toHaveClass(/clip-display--selected/);
		await expect(waveform).toHaveAttribute('data-waveform-owner', 'audacity');
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await waveform.evaluate((canvas) => {
			const prototype = CanvasRenderingContext2D.prototype;
			globalThis.__waveformPlanBeforeDrag = canvas.__kwWaveformPlan;
			globalThis.__waveformClearsAfterPointerDown = 0;
			globalThis.__waveformStrokesAfterPointerDown = 0;
			globalThis.__waveformOriginalClearRect = prototype.clearRect;
			globalThis.__waveformOriginalStroke = prototype.stroke;
			prototype.clearRect = function countWaveformClears(...args) {
				if (this.canvas === canvas) globalThis.__waveformClearsAfterPointerDown += 1;
				return globalThis.__waveformOriginalClearRect.apply(this, args);
			};
			prototype.stroke = function countWaveformStrokes(...args) {
				if (this.canvas === canvas) globalThis.__waveformStrokesAfterPointerDown += 1;
				return globalThis.__waveformOriginalStroke.apply(this, args);
			};
		});
		const clipHeader = zoomedClip.locator('.clip-header');
		const clipHeaderBox = await clipHeader.boundingBox();
		expect(clipHeaderBox).not.toBeNull();
		await page.mouse.move(clipHeaderBox.x + 24, clipHeaderBox.y + clipHeaderBox.height / 2);
		await page.mouse.down();
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		expect(await page.evaluate(() => globalThis.__waveformClearsAfterPointerDown)).toBe(0);
		expect(await page.evaluate(() => globalThis.__waveformStrokesAfterPointerDown)).toBe(0);
		expect(await waveform.evaluate((canvas) => canvas.__kwWaveformPlan === globalThis.__waveformPlanBeforeDrag)).toBe(true);
		await page.mouse.move(clipHeaderBox.x + 88, clipHeaderBox.y + clipHeaderBox.height / 2);
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		expect(await waveform.evaluate((canvas) => canvas.__kwWaveformPlan === globalThis.__waveformPlanBeforeDrag)).toBe(true);
		await page.mouse.up();
		await expect.poll(() => waveform.evaluate((canvas) => (
			canvas.__kwWaveformPlan === globalThis.__waveformPlanBeforeDrag || canvas.dataset.waveformPending === 'true'
		))).toBe(false);
		await page.evaluate(() => {
			globalThis.__waveformClearsAfterPointerDown = 0;
			globalThis.__waveformStrokesAfterPointerDown = 0;
		});
		const movedClipHeaderBox = await clipHeader.boundingBox();
		expect(movedClipHeaderBox).not.toBeNull();
		await page.mouse.move(movedClipHeaderBox.x + 24, movedClipHeaderBox.y + movedClipHeaderBox.height / 2);
		await page.mouse.down();
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		expect(await page.evaluate(() => globalThis.__waveformClearsAfterPointerDown)).toBe(0);
		expect(await page.evaluate(() => globalThis.__waveformStrokesAfterPointerDown)).toBe(0);
		await page.mouse.up();
		await waveform.evaluate(() => {
			const prototype = CanvasRenderingContext2D.prototype;
			prototype.clearRect = globalThis.__waveformOriginalClearRect;
			prototype.stroke = globalThis.__waveformOriginalStroke;
			delete globalThis.__waveformOriginalClearRect;
			delete globalThis.__waveformOriginalStroke;
			delete globalThis.__waveformPlanBeforeDrag;
			delete globalThis.__waveformClearsAfterPointerDown;
			delete globalThis.__waveformStrokesAfterPointerDown;
		});
		const connectedPixels = await waveform.evaluate((canvas) => {
			const context = canvas.getContext('2d');
			const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
			let blankColumns = 0;
			for (let x = 0; x < width; x += 1) {
				let painted = false;
				for (let y = 0; y < height; y += 1) {
					if (data[(y * width + x) * 4 + 3] > 0) {
						painted = true;
						break;
					}
				}
				if (!painted) blankColumns += 1;
			}
			return { blankColumns, width };
		});
		expect(connectedPixels.width).toBeGreaterThan(40);
		expect(connectedPixels.blankColumns).toBe(0);

		const track = zoomedClip.locator('xpath=ancestor::div[@data-track-row]');
		await track.getByRole('button', { name: 'Track menu', exact: true }).click();
		// The view modes now sit under the track menu's Track visualization submenu.
		const trackMenu = page.locator('.audio-editor-track-menu');
		const display = trackMenu.getByRole('menuitem', { name: /^Track visualization(?:\s|$)/u });
		await display.focus();
		await page.keyboard.press('ArrowRight');
		await display.getByRole('menu').getByRole('menuitem', { name: 'Multi-view', exact: true }).click();
		await expect(track).toHaveAttribute('data-display-mode', 'multiview');
		await expect(waveform).toHaveAttribute('data-waveform-owner', 'audacity');
		await expect(waveform).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
		const spectrogramColors = await waveform.evaluate((canvas) => {
			const context = canvas.getContext('2d');
			const { data, width, height } = context.getImageData(0, 0, canvas.width, Math.floor(canvas.height / 2) - 2);
			const colors = new Set();
			for (let offset = 0; offset < data.length; offset += 4) {
				if (data[offset + 3] === 0) continue;
				colors.add(`#${[0, 1, 2].map((channel) => data[offset + channel].toString(16).padStart(2, '0')).join('')}`);
			}
			return { colors: [...colors], width, height };
		});
		expect(spectrogramColors.width).toBeGreaterThan(40);
		expect(spectrogramColors.height).toBeGreaterThan(10);
		expect(spectrogramColors.colors.length).toBeGreaterThan(1);
		expect(spectrogramColors.colors).toContain('#010101');
		expect(spectrogramColors.colors).toContain('#fefbf9');
		expect(spectrogramColors.colors.some((color) => [0xc3, 0x28, 0x84].every((channel, index) => (
			Math.abs(parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) - channel) <= 16
		)))).toBe(true);
		await waveform.evaluate((canvas) => {
			const prototype = CanvasRenderingContext2D.prototype;
			globalThis.__multiviewWaveformClears = 0;
			globalThis.__multiviewOriginalClearRect = prototype.clearRect;
			prototype.clearRect = function countMultiviewWaveformClears(...args) {
				if (this.canvas === canvas) globalThis.__multiviewWaveformClears += 1;
				return globalThis.__multiviewOriginalClearRect.apply(this, args);
			};
		});
		await page.mouse.move(clipHeaderBox.x + 24, clipHeaderBox.y + clipHeaderBox.height / 2);
		await page.mouse.down();
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		expect(await page.evaluate(() => globalThis.__multiviewWaveformClears)).toBe(0);
		await page.mouse.up();
		await waveform.evaluate(() => {
			CanvasRenderingContext2D.prototype.clearRect = globalThis.__multiviewOriginalClearRect;
			delete globalThis.__multiviewOriginalClearRect;
			delete globalThis.__multiviewWaveformClears;
		});
		expect(errors).toEqual([]);
	});

	test('a sustained tone keeps spectrogram color across the clip', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Spectrogram']);
		const canvas = clip.locator('canvas.clip-body__waveform');
		await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
		const painted = await spectrogramVisibleColumns(canvas);
		expect(painted.width).toBeGreaterThan(40);
		expect(painted.height).toBeGreaterThan(10);
		expect(painted.legacyBlueSilencePixels).toBe(0);
		for (const [third, count] of painted.visibleColumns.entries()) {
			expect(count, `visible spectrum in third ${third + 1}: ${JSON.stringify(painted)}`)
				.toBeGreaterThan(painted.width / 12);
		}
	});

	test('a tone burst has a smooth spectrogram time envelope', async ({ page }) => {
		const burst = { ...monoTone, name: 'browser-tone-burst.wav', buffer: Buffer.from(monoTone.buffer) };
		// Keep the 440 Hz tone only from 0.32 to 0.48 seconds.
		for (let frame = 0; frame < 38_400; frame += 1) {
			if (frame < 15_360 || frame >= 23_040) burst.buffer.writeInt16LE(0, 44 + frame * 2);
		}
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [burst]);
		const clip = clipByName(editor, burst.name);
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Spectrogram']);
		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		for (let step = 0; step < 3; step += 1) await zoomIn.click();
		const canvas = clip.locator('canvas.clip-body__waveform');
		await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
		const raster = await canvas.evaluate((element) => {
			const { data, width, height } = element.getContext('2d')
				.getImageData(0, 0, element.width, element.height);
			const edgeX = Math.round(width * 0.32 / 0.8);
			let mostColors = 0;
			for (let y = 0; y < height; y += 1) {
				const colors = new Set();
				for (let x = edgeX - 16; x < edgeX + 16; x += 1) {
					const offset = (y * width + x) * 4;
					colors.add(`${data[offset]}:${data[offset + 1]}:${data[offset + 2]}`);
				}
				mostColors = Math.max(mostColors, colors.size);
			}
			return { width, mostColors };
		});
		expect(raster.width).toBeGreaterThan(200);
		expect(raster.mostColors, JSON.stringify(raster)).toBeGreaterThan(10);
	});

	test('a sustained tone stays colored at sample-depth spectrogram zoom', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Spectrogram']);
		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		for (let step = 0; step < 18; step += 1) await zoomIn.click();
		const timeline = editor.locator('[data-timeline]');
		await timeline.evaluate((element, contentX) => {
			const scale = Number(element.dataset.timelineScrollScale) || 1;
			element.scrollLeft = Math.floor(contentX / scale);
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		}, AUDIO_EDITOR_MAX_PIXELS_PER_SECOND * 0.4);
		const canvas = clip.locator('canvas.clip-body__waveform');
		await expect.poll(() => canvas.evaluate((element) => {
			const plan = element.__kwWaveformPlan;
			return plan && plan.startFrame > 2_048 && plan.endFrame < 36_352
				? plan.endFrame - plan.startFrame
				: Number.POSITIVE_INFINITY;
		})).toBeLessThan(2_048);
		await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
		await expect.poll(async () => {
			const painted = await spectrogramVisibleColumns(canvas);
			return Math.min(...painted.visibleColumns) / painted.width;
		}).toBeGreaterThan(1 / 12);
		const painted = await spectrogramVisibleColumns(canvas);
		expect(painted.width).toBeGreaterThan(40);
		expect(painted.height).toBeGreaterThan(10);
		expect(painted.legacyBlueSilencePixels).toBe(0);
		for (const [third, count] of painted.visibleColumns.entries()) {
			expect(count, `visible spectrum in third ${third + 1}: ${JSON.stringify(painted)}`)
				.toBeGreaterThan(painted.width / 12);
		}
		expect(errors).toEqual([]);
	});

	test('renders 3-band and rainbow frequency waveforms from Track visualization', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		const waveform = clip.locator('canvas.clip-body__waveform');

		await chooseTrackMenuAction(page, editor, track, ['Track visualization', '3-band waveform']);
		await expect(track).toHaveAttribute('data-display-mode', 'waveform-three-band');
		await expect(waveform).toHaveAttribute('data-frequency-waveform-mode', 'waveform-three-band');
		await expect(waveform).toHaveAttribute('data-waveform-source', 'frequency-analysis');

		await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Rainbow waveform']);
		await expect(track).toHaveAttribute('data-display-mode', 'waveform-rainbow');
		await expect(waveform).toHaveAttribute('data-frequency-waveform-mode', 'waveform-rainbow');
		await expect(waveform).toHaveAttribute('data-waveform-source', 'frequency-analysis');
		expect(errors).toEqual([]);
	});

	test('keeps the Audacity waveform canvas intact across viewport overscan', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const timeline = editor.locator('[data-timeline]');
		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		for (let step = 0; step < 4; step += 1) await zoomIn.click();
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

		const waveform = clipByName(editor, longTone.name).locator('canvas.clip-body__waveform');
		await expect(waveform).toHaveAttribute('data-waveform-owner', 'audacity');
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const initial = await waveform.evaluate((canvas) => {
			globalThis.__waveformOverscanCanvas = canvas;
			const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
			let checksum = 2_166_136_261;
			for (const value of data) checksum = Math.imul(checksum ^ value, 16_777_619) >>> 0;
			return {
				checksum,
				width: canvas.width,
				height: canvas.height,
				inlineWidth: canvas.style.width,
				inlineHeight: canvas.style.height,
			};
		});
		expect(initial.checksum).not.toBe(2_166_136_261);
		expect(initial.inlineWidth).toBe('');
		expect(initial.inlineHeight).toBe('');

		await waveform.evaluate(async (canvas) => {
			const scroll = canvas.closest('.audio-editor-timeline-panel').querySelector('[data-timeline]');
			const panel = scroll.closest('.audio-editor-timeline-panel');
			const panelWidth = Number.parseFloat(getComputedStyle(panel).getPropertyValue('--track-panel-width')) || 0;
			const maximumScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
			const scrollStep = Math.max(1, (scroll.clientWidth - panelWidth) / 2);
			for (let step = 0; step < 100; step += 1) {
				scroll.scrollLeft = Math.min(maximumScroll, scroll.scrollLeft + scrollStep);
				scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
				await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				if (canvas !== globalThis.__waveformOverscanCanvas || !canvas.isConnected) {
					throw new Error('The waveform canvas was replaced before leaving the viewport.');
				}
				if (canvas.closest('[data-clip-id]').getBoundingClientRect().right
					<= scroll.getBoundingClientRect().left + panelWidth + 1) return;
				if (scroll.scrollLeft >= maximumScroll) break;
			}
			throw new Error('The waveform did not reach viewport overscan.');
		});
		await expect.poll(() => waveform.evaluate((canvas) => {
			const panel = canvas.closest('.audio-editor-timeline-panel');
			const scroll = panel.querySelector('[data-timeline]');
			const panelWidth = Number.parseFloat(getComputedStyle(panel).getPropertyValue('--track-panel-width')) || 0;
			return {
				sameCanvas: canvas === globalThis.__waveformOverscanCanvas,
				offscreen: canvas.closest('[data-clip-id]').getBoundingClientRect().right
					<= scroll.getBoundingClientRect().left + panelWidth + 1,
				owner: canvas.dataset.waveformOwner,
				inlineWidth: canvas.style.width,
				inlineHeight: canvas.style.height,
			};
		})).toEqual({
			sameCanvas: true,
			offscreen: true,
			owner: 'audacity',
			inlineWidth: '',
			inlineHeight: '',
		});

		await timeline.evaluate((element) => {
			element.scrollLeft = 0;
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		});
		await expect.poll(() => waveform.evaluate((canvas) => canvas === globalThis.__waveformOverscanCanvas)).toBe(true);
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const restored = await waveform.evaluate((canvas) => {
			const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
			let checksum = 2_166_136_261;
			for (const value of data) checksum = Math.imul(checksum ^ value, 16_777_619) >>> 0;
			delete globalThis.__waveformOverscanCanvas;
			return { checksum, width: canvas.width, height: canvas.height };
		});
		expect(restored).toEqual({ checksum: initial.checksum, width: initial.width, height: initial.height });
		expect(errors).toEqual([]);
	});
});

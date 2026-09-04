import {
	expect,
	longTone,
	monoTone,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseNestedCommandAction,
	clipByName,
	closeChromeDrawer,
	closeDialog,
	closeEffectsPanel,
	collectClientErrors,
	dispatchPinch,
	expectSurfaceWithinViewport,
	getMenuItem,
	importFiles,
	openChromeDrawer,
	openClipProperties,
	openEffectsForTrack,
	openNestedCommandMenu,
	openTrackHeaderDrawer,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

async function openMixRenderDialog(page, editor) {
	await chooseCommandAction(page, editor, 'Tracks', 'Mix & Render');
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function mixedSourceChannelCount(page) {
	return page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const openRequest = indexedDB.open(databaseName);
		openRequest.onerror = () => reject(openRequest.error);
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			const request = database.transaction('sources', 'readonly').objectStore('sources').getAll();
			request.onerror = () => {
				database.close();
				reject(request.error);
			};
			request.onsuccess = () => {
				database.close();
				resolve(request.result.find(({ id }) => id?.startsWith('mixed-source-'))?.channelCount ?? null);
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

async function expectMixRenderOptionTooltip(page, dialog, {
	key, label, description, interaction,
}) {
	const checkbox = dialog.getByRole('checkbox', { name: label, exact: true });
	const descriptionId = await checkbox.getAttribute('aria-describedby');
	expect(descriptionId).toBeTruthy();
	const persistentDescription = dialog.locator(`[id="${descriptionId}"]`);
	await expect(persistentDescription).toHaveClass(/\bkw-audio-editor-sr-only\b/u);
	await expect(persistentDescription).toHaveText(description);
	const help = dialog.locator(`[data-mix-render-help="${key}"]`);
	await expect(help).toHaveAttribute('aria-label', `Help: ${label}`);
	await expect(help).toHaveAttribute('aria-describedby', descriptionId);
	await expect(help).toHaveAttribute('data-tooltip-ignore', /^(?:|true)$/u);
	if (interaction === 'hover') await help.hover();
	else await help.focus();
	const tooltip = page.locator('.audio-editor-help-tooltip', {
		has: page.locator(`[data-mix-render-tooltip="${key}"]`),
	});
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toHaveAttribute('role', 'tooltip');
	await expect(tooltip).toHaveText(description);
	await expect(page.getByRole('tooltip')).toHaveCount(1);
	await expect(help).toHaveAttribute('aria-describedby', await tooltip.getAttribute('id'));
	await expect(tooltip).toHaveClass(/\bflyout\b/u);
	return { help, tooltip };
}

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('mixes selected tracks through the real browser graph and restores them with undo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const firstClip = clipByName(editor, toneA.name);
		const secondClip = clipByName(editor, toneB.name);
		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });

		const dialog = await openMixRenderDialog(page, editor);
		await expect(dialog.getByRole('button', { name: 'Cancel', exact: true }))
			.toHaveClass(/\bbutton--secondary\b/u);
		await expect(dialog.getByRole('button', { name: 'Mix & Render', exact: true }))
			.toHaveClass(/\bbutton--primary\b/u);
		for (const label of ['Mix down', 'Render effects', 'Replace originals']) {
			await expect(dialog.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
		}
		const descriptions = [
			'Combine the selected tracks into one rendered track. Clear this option to render each track separately.',
			'Burn realtime effects into the rendered audio.',
			'Replace the selected tracks. Clear this option to create new tracks.',
		];
		for (const description of descriptions) {
			await expect(dialog.locator('p').filter({ hasText: description })).toHaveCount(0);
		}
		const hoveredHelp = await expectMixRenderOptionTooltip(page, dialog, {
			key: 'mix-down', label: 'Mix down', description: descriptions[0], interaction: 'hover',
		});
		await hoveredHelp.tooltip.hover();
		await expect(hoveredHelp.tooltip).toBeVisible();
		await page.mouse.move(0, 0);
		await expect(page.locator('[data-mix-render-tooltip]')).toHaveCount(0);
		const focusedHelp = await expectMixRenderOptionTooltip(page, dialog, {
			key: 'render-effects', label: 'Render effects', description: descriptions[1], interaction: 'focus',
		});
		await page.keyboard.press('Escape');
		await expect(focusedHelp.tooltip).toHaveCount(0);
		await expect(dialog).toBeVisible();
		const channels = dialog.getByRole('group', { name: 'Mix down to', exact: true });
		await expect(channels.getByRole('button')).toContainText('Stereo');
		await chooseDropdown(page, channels, 'Mono');
		await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		const mixedClip = clipByName(editor, 'Mix');
		await expect(mixedClip).toBeVisible({ timeout: 20_000 });
		await expect(firstClip).toHaveCount(0);
		await expect(secondClip).toHaveCount(0);
		await expect.poll(() => mixedSourceChannelCount(page)).toBe(1);

		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect(clipByName(editor, toneB.name)).toBeVisible();
		await expect(mixedClip).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('renders selected tracks separately while keeping each original', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const firstClip = clipByName(editor, toneA.name);
		const secondClip = clipByName(editor, toneB.name);
		const firstTrack = firstClip.locator('xpath=ancestor::div[@data-track-row][1]');
		const secondTrack = secondClip.locator('xpath=ancestor::div[@data-track-row][1]');
		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });

		const dialog = await openMixRenderDialog(page, editor);
		await dialog.getByRole('checkbox', { name: 'Mix down', exact: true }).setChecked(false);
		await expect(dialog.getByRole('group', { name: 'Mix down to', exact: true })
			.getByRole('button')).toBeDisabled();
		await dialog.getByRole('checkbox', { name: 'Replace originals', exact: true }).setChecked(false);
		await expect(dialog.getByRole('checkbox', { name: 'Render effects', exact: true })).toBeChecked();
		await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		const firstRenderedName = `${toneA.name.replace(/\.[^.]+$/u, '')} — Rendered`;
		const secondRenderedName = `${toneB.name.replace(/\.[^.]+$/u, '')} — Rendered`;
		const firstRendered = clipByName(editor, firstRenderedName);
		const secondRendered = clipByName(editor, secondRenderedName);
		await expect(firstRendered).toBeVisible({ timeout: 20_000 });
		await expect(secondRendered).toBeVisible({ timeout: 20_000 });
		await expect(firstClip).toBeVisible();
		await expect(secondClip).toBeVisible();
		await expect(clipByName(firstTrack.locator('xpath=following-sibling::*[1]'), firstRenderedName)).toBeVisible();
		await expect(clipByName(secondTrack.locator('xpath=following-sibling::*[1]'), secondRenderedName)).toBeVisible();
		await expect(clipByName(editor, 'Mix')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('reveals sample tools only at sample zoom and applies an undoable pencil stroke', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await clip.click({ position: { x: 24, y: 10 } });
		await expect(editor.locator('[data-sample-edit-tools]')).toHaveCount(0);
		const splitTool = editor.getByRole('button', { name: 'Split tool', exact: true });
		await splitTool.click();
		await expect(splitTool).toHaveAttribute('aria-pressed', 'true');
		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		// Two notches deeper than one pixel per sample, where the renderer stops
		// joining samples with a line and draws each one as its own stem.
		for (let step = 0; step < 11; step += 1) await zoomIn.click();
		const sampleTools = editor.getByRole('toolbar', { name: 'Sample tools', exact: true });
		await expect(sampleTools).toBeVisible();
		const pencil = sampleTools.getByRole('button', { name: 'Sample pencil', exact: true });
		await expect(pencil).toHaveAttribute('aria-pressed', 'true');
		await expect(splitTool).toHaveAttribute('aria-pressed', 'false');
		await expect(editor.locator('.audio-editor-timeline-panel')).toHaveAttribute('data-sample-pencil', 'true');

		await clip.scrollIntoViewIfNeeded();
		const box = await clip.boundingBox();
		expect(box).not.toBeNull();
		const start = { x: box.x + 80, y: box.y + Math.min(70, box.height - 8) };
		const end = { x: box.x + 86, y: box.y + Math.min(82, box.height - 5) };
		await clip.dispatchEvent('pointerdown', {
			pointerId: 0, pointerType: 'mouse', button: 0, buttons: 1,
			clientX: start.x, clientY: start.y,
		});
		await clip.dispatchEvent('pointermove', {
			pointerId: 0, pointerType: 'mouse', button: 0, buttons: 1,
			clientX: end.x, clientY: end.y,
		});
		await clip.dispatchEvent('pointerup', {
			pointerId: 0, pointerType: 'mouse', button: 0, buttons: 0,
			clientX: end.x, clientY: end.y,
		});
		await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
		await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await editor.getByRole('button', { name: 'Zoom out', exact: true }).click();
		await expect(editor.locator('[data-sample-edit-tools]')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('previews clip moves continuously in time and snaps them to track rows', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 1440, height: 1200 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(3);

		const sourceTrack = editor.locator('[data-track-row]').nth(1);
		const targetTrack = editor.locator('[data-track-row]').nth(2);
		const clip = sourceTrack.locator('[data-clip-id]');
		const clipBox = await clip.boundingBox();
		const targetLaneBox = await targetTrack.locator('[data-track-lane]').boundingBox();
		expect(clipBox).not.toBeNull();
		expect(targetLaneBox).not.toBeNull();

		await page.mouse.move(clipBox.x + 28, clipBox.y + 12);
		await page.mouse.down();
		await page.mouse.move(clipBox.x + 76, targetLaneBox.y + 12, { steps: 5 });
		const preview = targetTrack.locator('[data-clip-id]');
		await expect(preview).toBeVisible();
		await expect.poll(async () => (await preview.boundingBox())?.x || 0).toBeGreaterThan(clipBox.x + 20);
		await expect(sourceTrack.locator('[data-clip-id]')).toHaveCount(0);
		await page.mouse.up();

		await expect(targetTrack.locator('[data-clip-id]')).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('keeps clipped waveform data stable for the duration of a move preview', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 720, height: 900 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const waveform = clip.locator('canvas.clip-body__waveform');
		await expect(waveform).toHaveAttribute('data-waveform-renderer', 'audacity');

		const clipBox = await clip.boundingBox();
		expect(clipBox).not.toBeNull();
		await page.mouse.move(clipBox.x + 28, clipBox.y + 12);
		await page.mouse.down();
		await waveform.evaluate((canvas) => new Promise((resolve) => {
			const waitForPlan = () => {
				if (canvas.__kwWaveformPlan) {
					globalThis.__movePreviewWaveformPlan = canvas.__kwWaveformPlan;
					resolve();
				} else requestAnimationFrame(waitForPlan);
			};
			requestAnimationFrame(waitForPlan);
		}));
		await page.mouse.move(clipBox.x + 148, clipBox.y + 12, { steps: 8 });
		await expect.poll(() => waveform.evaluate(
			(canvas) => canvas.__kwWaveformPlan === globalThis.__movePreviewWaveformPlan,
		)).toBe(true);
		await page.mouse.up();
		await expect.poll(() => waveform.evaluate(
			(canvas) => canvas.__kwWaveformPlan === globalThis.__movePreviewWaveformPlan,
		)).toBe(false);
		expect(errors).toEqual([]);
	});

	test('layers pointer-moved clips without trimming inactive audio', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 1440, height: 1200 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const targetTrack = editor.locator('[data-track-row]').nth(1);
		const sourceTrack = editor.locator('[data-track-row]').nth(2);
		const inactiveClip = clipByName(targetTrack, toneA.name);
		const activeClip = clipByName(sourceTrack, toneB.name);
		const inactiveBox = await inactiveClip.boundingBox();
		const activeBox = await activeClip.boundingBox();
		const targetLaneBox = await targetTrack.locator('[data-track-lane]').boundingBox();
		expect(inactiveBox).not.toBeNull();
		expect(activeBox).not.toBeNull();
		expect(targetLaneBox).not.toBeNull();

		await page.mouse.move(activeBox.x + 28, activeBox.y + 12);
		await page.mouse.down();
		await page.mouse.move(activeBox.x + 64, targetLaneBox.y + 12, { steps: 4 });
		await page.mouse.up();

		await expect(sourceTrack.locator('[data-clip-id]')).toHaveCount(0);
		await expect(targetTrack.locator('[data-clip-id]')).toHaveCount(2);
		await expect.poll(async () => (await inactiveClip.boundingBox())?.width || 0).toBeCloseTo(inactiveBox.width, 0);
		const movedBox = await clipByName(targetTrack, toneB.name).boundingBox();
		expect(movedBox).not.toBeNull();
		expect(movedBox.x).toBeLessThan(inactiveBox.x + inactiveBox.width);
		expect(inactiveBox.x).toBeLessThan(movedBox.x + movedBox.width);
		expect(errors).toEqual([]);
	});

	test('supports ruler selection and playhead keyboard and pointer control', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		const selectionToolbar = editor.locator('[data-selection-toolbar]');
		const timecodesBeforeVerticalDrag = await selectionToolbar.locator('.timecode').allTextContents();

		const verticalRuler = editor.locator('[data-track-ruler]').first();
		await verticalRuler.scrollIntoViewIfNeeded();
		const verticalRulerBox = await verticalRuler.boundingBox();
		expect(verticalRulerBox).not.toBeNull();
		await page.mouse.move(verticalRulerBox.x + verticalRulerBox.width / 2, verticalRulerBox.y + 24);
		await page.mouse.down();
		await page.mouse.move(verticalRulerBox.x + verticalRulerBox.width / 2, verticalRulerBox.y + 72, { steps: 4 });
		await page.mouse.up();
		await expect.poll(() => selectionToolbar.locator('.timecode').allTextContents()).toEqual(timecodesBeforeVerticalDrag);

		const ruler = editor.locator('[data-ruler]');
		await ruler.scrollIntoViewIfNeeded();
		const rulerBox = await ruler.boundingBox();
		expect(rulerBox).not.toBeNull();
		await page.mouse.move(rulerBox.x + 22, rulerBox.y + 26);
		await page.mouse.down();
		await page.mouse.move(rulerBox.x + 82, rulerBox.y + 26, { steps: 4 });
		await page.mouse.up();
		await expect(editor.getByRole('button', { name: 'Loop selection' })).toBeEnabled();
		await expect(selectionToolbar.locator('.timecode')).toHaveCount(3);
		await expect(selectionToolbar).toContainText('Selection');
		await expect(selectionToolbar).toContainText('Duration');

		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		await playhead.scrollIntoViewIfNeeded();
		await playhead.focus();
		await page.keyboard.press('Home');
		await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		await page.keyboard.press('ArrowRight');
		await expect(playhead).toHaveAttribute('aria-valuenow', '1');

		expect(errors).toEqual([]);
	});

	test('exposes Audacity timeline and vertical ruler context controls', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const timelineRuler = editor.locator('[data-ruler]');
		await timelineRuler.click({ button: 'right', position: { x: 80, y: 20 } });
		const timelineMenu = page.locator('.timeline-ruler-context-menu');
		await expect(timelineMenu).toBeVisible();
		await timelineMenu.getByRole('menuitem', { name: 'Beats & measures', exact: true }).click();
		await expect(timelineRuler).toHaveAttribute('data-time-format', 'beats-measures');

		await timelineRuler.click({ button: 'right', position: { x: 80, y: 20 } });
		await timelineMenu.getByRole('menuitem', { name: 'Click ruler to start playback', exact: true }).click();
		await timelineRuler.click({ button: 'right', position: { x: 80, y: 20 } });
		await expect(timelineMenu.getByRole('menuitem', { name: 'Click ruler to start playback', exact: true }).locator('svg')).toHaveCount(0);
		await page.keyboard.press('Escape');

		const importedTrack = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
		const verticalRuler = importedTrack.locator('[data-track-ruler]');
		await expect(verticalRuler).toHaveAttribute('data-ruler-format', 'linear-db');
		await verticalRuler.click({ button: 'right', position: { x: 20, y: 70 } });
		const rulerFlyout = page.locator('.audio-editor-ruler-flyout');
		await expect(rulerFlyout).toBeVisible();
		const rulerFormats = rulerFlyout.getByRole('radiogroup', { name: 'Ruler format' });
		await expect(rulerFormats.getByRole('radio')).toHaveCount(2);
		await expect(rulerFormats.getByRole('radio', { name: 'Logarithmic (dB)', exact: true })).toHaveCount(0);
		await rulerFormats.getByRole('radio').nth(1).click();
		await expect(verticalRuler).toHaveAttribute('data-ruler-format', 'linear-db');
		await rulerFlyout.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await expect(verticalRuler).toHaveAttribute('data-ruler-zoom', '1');
		await rulerFlyout.getByText('Half wave', { exact: true }).click();
		await expect(importedTrack).toHaveAttribute('data-display-mode', 'half-wave');
		const halfWaveBody = importedTrack.locator('.clip-body[data-half-wave="true"]');
		await expect(halfWaveBody).toHaveCount(1);
		await expect(halfWaveBody).toHaveCSS('mask-image', 'none');
		await expect(importedTrack.locator('.audio-editor-half-wave-ruler')).toHaveCount(2);
		const halfWaveRulerGeometry = await importedTrack.locator('.audio-editor-half-wave-ruler').first().evaluate((element) => ({
			height: element.getBoundingClientRect().height,
			innerHeight: element.querySelector('.vertical-ruler')?.getBoundingClientRect().height,
		}));
		expect(halfWaveRulerGeometry.innerHeight).toBeCloseTo(halfWaveRulerGeometry.height * 2, 0);
		await rulerFlyout.getByText('Half wave', { exact: true }).click();
		await expect(importedTrack).toHaveAttribute('data-display-mode', 'waveform');
		await page.keyboard.press('Escape');

		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		await verticalRuler.click({ button: 'right', position: { x: 20, y: 70 } });
		await expect(rulerFlyout).toBeVisible();
		await rulerFlyout.getByRole('radiogroup', { name: 'Ruler format' }).getByRole('radio').first().click();
		await expect(importedTrack.locator('[data-track-lane]')).toHaveAttribute('data-spectrogram-scale', 'linear');

		expect(errors).toEqual([]);
	});

	test('shows time selections above clips and label tracks', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);

		const ruler = editor.locator('[data-ruler]');
		const rulerBox = await ruler.boundingBox();
		const labelLane = editor.locator('[data-label-track] [data-track-lane]');
		const labelBox = await labelLane.boundingBox();
		expect(rulerBox).not.toBeNull();
		expect(labelBox).not.toBeNull();
		await page.mouse.move(rulerBox.x + 22, rulerBox.y + 26);
		await page.mouse.down();
		await page.mouse.move(rulerBox.x + 82, rulerBox.y + 26, { steps: 4 });
		await page.mouse.up();

		const overlay = editor.locator('[data-time-selection-overlay]');
		const overlayBox = await overlay.boundingBox();
		expect(overlayBox).not.toBeNull();
		expect(overlayBox.y).toBeLessThanOrEqual(labelBox.y);
		expect(overlayBox.y + overlayBox.height).toBeGreaterThanOrEqual(labelBox.y + labelBox.height);
		await expect(overlay).toHaveCSS('z-index', '50');
		expect(errors).toEqual([]);
	});

	test('moves the playhead without starting playback when clicking timeline lanes and clips', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		const emptyLane = editor.locator('.audio-editor-track-row [data-track-lane]').first();
		const emptyLaneBox = await emptyLane.boundingBox();
		expect(emptyLaneBox).not.toBeNull();
		const clickedX = emptyLaneBox.x + 48;

		await page.mouse.click(clickedX, emptyLaneBox.y + 48);
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		const playheadLine = editor.locator('[data-playhead] .playhead-cursor__line');
		const playheadLineBox = await playheadLine.boundingBox();
		expect(playheadLineBox).not.toBeNull();
		expect(Math.abs(playheadLineBox.x - clickedX)).toBeLessThanOrEqual(1);
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await playhead.focus();
		await page.keyboard.press('Home');

		const clip = clipByName(editor, toneA.name);
		await clip.click({ position: { x: 48, y: 24 } });
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('uses bounded crisp canvases, spectrogram projection, track menus, and mobile pinch zoom', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 390, height: 844 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		// The phone layout keeps the tool toolbar in the chrome drawer.
		await openChromeDrawer(editor);
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		await expect(editor).toHaveAttribute('data-timeline-view', 'spectrogram');
		await expect(editor.getByRole('button', { name: 'Spectrogram', exact: true })).toHaveAttribute('aria-pressed', 'true');
		await closeChromeDrawer(editor);
		await expect(clipByName(editor, toneA.name).locator('canvas.clip-body__waveform'))
			.toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');

		const rulerCanvas = editor.locator('[data-ruler] canvas.timeline-ruler');
		await expect.poll(() => rulerCanvas.evaluate((canvas) => canvas.width / canvas.getBoundingClientRect().width)).toBeGreaterThanOrEqual(1);
		const clipGeometry = await clipByName(editor, toneA.name).evaluate((clip) => {
			const canvases = [...clip.querySelectorAll('canvas')];
			return canvases.map((canvas) => ({
				backingWidth: canvas.width,
				backingHeight: canvas.height,
				cssWidth: canvas.getBoundingClientRect().width,
				cssHeight: canvas.getBoundingClientRect().height,
			}));
		});
		expect(clipGeometry.length).toBeGreaterThan(0);
		for (const canvas of clipGeometry) {
			expect(canvas.backingWidth).toBeLessThanOrEqual(8_192);
			expect(canvas.backingHeight).toBeLessThanOrEqual(2_048);
			expect(canvas.backingWidth).toBeGreaterThanOrEqual(Math.floor(canvas.cssWidth));
		}

		const timeline = editor.locator('[data-timeline]');
		const beforeWidth = await timeline.evaluate((element) => element.scrollWidth);
		await dispatchPinch(timeline);
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(beforeWidth);
		await expect(editor.locator('[data-inspector]')).toHaveCount(0);
		await openChromeDrawer(editor);
		await expect(editor.getByRole('tablist', { name: 'Project tabs' })).toBeVisible();
		await expect(editor.getByRole('tab')).toHaveCount(1);
		await closeChromeDrawer(editor);

		const mobileClip = clipByName(editor, toneA.name);
		const clipDialog = await openClipProperties(page, editor, mobileClip, { force: true });
		await expectSurfaceWithinViewport(clipDialog, page);
		await page.keyboard.press('Escape');
		await expect(clipDialog).toBeHidden();
		await expect(mobileClip).toBeVisible();

		const effectsPanel = await openEffectsForTrack(editor, 1);
		await expectSurfaceWithinViewport(
			effectsPanel.getByRole('region', { name: 'Effects panel', exact: true }),
			page,
		);
		await closeEffectsPanel(effectsPanel);
		await expect(effectsPanel).toBeHidden();

		const firstTrack = editor.locator('[data-track-row]').first();
		await openTrackHeaderDrawer(editor);
		const trackMenuButton = firstTrack.getByRole('button', { name: 'Track menu' });
		await trackMenuButton.click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu).toBeVisible();
		const [trackMenuButtonBox, trackMenuBox] = await Promise.all([trackMenuButton.boundingBox(), trackMenu.boundingBox()]);
		expect(trackMenuButtonBox).not.toBeNull();
		expect(trackMenuBox).not.toBeNull();
		// The track menu is a context menu, so it carries its own edge inset rather than
		// sitting flush with the trigger, and on a phone the full-width header puts the
		// trigger near the right edge, where the menu shifts left to stay on screen. What
		// must hold is that it stays on screen, overlaps its trigger and opens below it.
		expect(trackMenuBox.x).toBeGreaterThanOrEqual(0);
		expect(trackMenuBox.x + trackMenuBox.width).toBeLessThanOrEqual(page.viewportSize().width);
		expect(trackMenuBox.x + trackMenuBox.width).toBeGreaterThanOrEqual(trackMenuButtonBox.x);
		expect(trackMenuBox.x).toBeLessThanOrEqual(trackMenuButtonBox.x + trackMenuButtonBox.width);
		expect(trackMenuBox.y).toBeGreaterThanOrEqual(trackMenuButtonBox.y + trackMenuButtonBox.height - 1);
		await trackMenu.getByRole('menuitem', { name: 'Enable multi-track recording', exact: true }).click();
		await expect(firstTrack.getByRole('button', { name: /^Arm for recording:/ })).toBeVisible();
		await openTrackHeaderDrawer(editor);
		await trackMenuButton.click();
		await trackMenu.getByRole('menuitem', { name: 'Duplicate track', exact: true }).click();
		await expect(editor).toHaveAttribute('data-track-count', '3');
		expect(errors).toEqual([]);
	});

	test('binds track and clip context entries to Audacity parity metadata', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const firstTrack = editor.locator('[data-track-row]').first();
		await firstTrack.getByRole('button', { name: 'Track menu', exact: true }).click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		const duplicateTrack = trackMenu.locator('[data-action-id="duplicate-track"]');
		await expect(duplicateTrack).toHaveAttribute('data-parity-status', 'implemented');
		await expect(duplicateTrack).toHaveAttribute('data-action-origin', 'upstream');
		await expect(duplicateTrack).toHaveAttribute('data-enable-when', 'editable-audio-track-selected');
		await expect(trackMenu.locator('[data-action-id="remove-tracks"]')
			.locator('xpath=ancestor::div[@role="menuitem"]')
			.locator('.context-menu-item-shortcut')).toHaveText('Shift+C');
		await expect(trackMenu.locator('[data-action-id="local://show-arm-controls"]')).toHaveAttribute(
			'data-parity-status',
			'supplemental',
		);
		await trackMenu.getByRole('menuitem', { name: 'Enable multi-track recording', exact: true }).click();
		await expect(firstTrack.getByRole('button', { name: /^Arm for recording:/ })).toBeVisible();

		const clip = clipByName(editor, toneA.name);
		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		await page.keyboard.press('Escape');
		const editMenu = editor.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'Edit', exact: true });
		await editMenu.click();
		const editCommands = page.getByRole('menu', { name: 'Edit', exact: true });
		await expect(getMenuItem(editCommands, 'Cut')).toHaveAttribute('aria-disabled', 'false');
		await expect(getMenuItem(editCommands, 'Copy')).toHaveAttribute('aria-disabled', 'false');
		const paste = getMenuItem(editCommands, 'Paste');
		await paste.focus();
		await page.keyboard.press('ArrowRight');
		const pasteMenu = paste.getByRole('menu');
		await expect(pasteMenu).toBeVisible();
		await expect(pasteMenu.getByRole('menuitem', { name: /^Paste/ })).toHaveCount(1);
		await expect(getMenuItem(pasteMenu, 'Insert')).toBeVisible();
		await expect(getMenuItem(pasteMenu, 'Insert and preserve synchronisation')).toBeVisible();
		await page.keyboard.press('Escape');
		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		const clipMenu = page.locator('.audio-editor-clip-context-menu');
		const split = clipMenu.locator('[data-action-id="split"]');
		await expect(split).toHaveAttribute('data-parity-status', 'implemented');
		await expect(split).toHaveAttribute('data-enable-when', 'editable-selection-or-clip');
		await expect(split.locator('xpath=ancestor::div[@role="menuitem"]')
			.locator('.context-menu-item-shortcut')).toHaveText('Ctrl+I');
		await expect(clipMenu.locator('[data-action-id="local://reverse-clip"]')).toHaveAttribute(
			'data-parity-status',
			'supplemental',
		);
		const renderPitchSpeed = clipMenu.locator('[data-action-id="clip-render-pitch-speed"]');
		await expect(renderPitchSpeed.locator('xpath=ancestor::div[@role="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
		await expect(renderPitchSpeed).toHaveAttribute('data-disabled-reason', 'unavailable');

		await clipMenu.locator('[data-action-id="clip-properties"]').click();
		const clipDialog = page.getByRole('dialog', { name: 'Clip properties', exact: true });
		await expect(clipDialog).toBeVisible();
		await closeDialog(clipDialog);
		expect(errors).toEqual([]);
	});

	test('changes stable track colors and supports inherited or overridden clip colors', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const clip = clipByName(editor, toneA.name);
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		const clipBody = clip.locator('.clip-body');

		await track.getByRole('button', { name: 'Track menu', exact: true }).click();
		await page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: 'Track color', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Track color: Red', exact: true }).click();
		await expect(track).toHaveAttribute('data-track-color', 'red');
		await expect(clipBody).toHaveAttribute('data-color', 'red');

		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Clip color/ }).hover();
		await page.getByRole('menuitem', { name: 'Green', exact: true }).click();
		await expect(clipBody).toHaveAttribute('data-color', 'green');

		await track.getByRole('button', { name: 'Track menu', exact: true }).click();
		await page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: 'Track color', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Track color: Yellow', exact: true }).click();
		await expect(track).toHaveAttribute('data-track-color', 'yellow');
		await expect(clipBody).toHaveAttribute('data-color', 'green');

		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Clip color/ }).hover();
		await page.getByRole('menuitem', { name: 'Follow track color', exact: true }).click();
		await expect(clipBody).toHaveAttribute('data-color', 'yellow');
		expect(errors).toEqual([]);
	});

	test('edits per-track spectrogram settings and exposes adjustable spectral selection handles', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		const panelsMenu = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		await expect(panelsMenu.getByRole('menuitem', { name: 'Spectrogram', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(panelsMenu).toBeHidden();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu', { name: 'View', exact: true })).toBeHidden();

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Spectrogram$/ }).click();
		const settings = preferences.locator('[data-spectrogram-settings]');
		await expect(settings).toBeVisible();
		const targetTrackId = await settings.getAttribute('data-spectrogram-target');
		expect(targetTrackId).not.toBe('defaults');
		const targetLane = editor.locator(`.audio-editor-track-row [data-track-lane][data-track-id="${targetTrackId}"]`).first();
		await settings.getByLabel('Scale', { exact: true }).selectOption('linear');
		await settings.getByLabel('Minimum frequency (Hz)', { exact: true }).fill('1000');
		await settings.getByLabel('Maximum frequency (Hz)', { exact: true }).fill('8000');
		await settings.getByLabel('Dynamic range (dB)', { exact: true }).fill('96');
		await settings.getByLabel('Window size', { exact: true }).selectOption('4096');
		await settings.getByLabel('Window type', { exact: true }).selectOption('blackman');
		await expect(targetLane).toHaveAttribute('data-spectrogram-scale', 'linear');
		await expect(targetLane).toHaveAttribute('data-spectrogram-minimum-frequency', '1000');
		await expect(targetLane).toHaveAttribute('data-spectrogram-maximum-frequency', '8000');
		await expect(targetLane).toHaveAttribute('data-spectrogram-window-size', '4096');
		await expect(targetLane).toHaveAttribute('data-spectrogram-range', '96');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(editor.locator('[data-workspace-panel="spectrogram"]')).toHaveCount(0);

		const ruler = editor.locator('[data-ruler]');
		const rulerBox = await ruler.boundingBox();
		expect(rulerBox).not.toBeNull();
		await page.mouse.move(rulerBox.x + 30, rulerBox.y + 24);
		await page.mouse.down();
		await page.mouse.move(rulerBox.x + 110, rulerBox.y + 24, { steps: 4 });
		await page.mouse.up();
		await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
		const spectralDialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
		await expect(spectralDialog).toBeVisible();
		await spectralDialog.getByRole('button', { name: 'Select range', exact: true }).click();

		const overlay = targetLane.locator('[data-spectral-selection]');
		await expect(overlay).toBeVisible();
		const minimumHandle = overlay.getByRole('slider', { name: 'Spectral selection minimum-frequency handle' });
		const maximumHandle = overlay.getByRole('slider', { name: 'Spectral selection maximum-frequency handle' });
		const startHandle = overlay.getByRole('slider', { name: 'Spectral selection start-time handle' });
		const endHandle = overlay.getByRole('slider', { name: 'Spectral selection end-time handle' });
		await expect(minimumHandle).toHaveAttribute('aria-valuenow', '1000');
		await expect(maximumHandle).toHaveAttribute('aria-valuenow', '8000');
		await maximumHandle.focus();
		await page.keyboard.press('ArrowDown');
		await expect(maximumHandle).toHaveAttribute('aria-valuenow', '7990');
		const startBefore = Number(await startHandle.getAttribute('aria-valuenow'));
		await startHandle.focus();
		await page.keyboard.press('ArrowRight');
		await expect.poll(async () => Number(await startHandle.getAttribute('aria-valuenow'))).toBeGreaterThan(startBefore);
		await expect(endHandle).toBeVisible();
		expect(errors).toEqual([]);
	});

	test("wheel zoom follows Audacity's mouse zoom precision", async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const scroll = editor.locator('.audio-editor-timeline-scroll');
		const timelineWidth = () => scroll.evaluate((element) => element.scrollWidth);

		// A whole octave a notch is the default, so the first setting confirms it
		// rather than changing it.
		await setMouseZoomPrecision(page, editor, 1, { expectCurrent: 1 });
		const beforeCoarse = await timelineWidth();
		await wheelZoomIn(page, scroll);
		await expect.poll(timelineWidth).toBeGreaterThan(beforeCoarse * 1.8);

		await setMouseZoomPrecision(page, editor, 16);
		const beforeFine = await timelineWidth();
		await wheelZoomIn(page, scroll);
		await expect.poll(timelineWidth).toBeGreaterThan(beforeFine);
		expect(await timelineWidth()).toBeLessThan(beforeFine * 1.2);
	});
});

async function setMouseZoomPrecision(page, editor, precision, { expectCurrent = null } = {}) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	const field = preferences.getByLabel('Mouse zoom precision', { exact: true });
	if (expectCurrent !== null) await expect(field).toHaveValue(String(expectCurrent));
	await field.fill(String(precision));
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();
}

async function wheelZoomIn(page, scroll) {
	await scroll.hover({ position: { x: 40, y: 20 } });
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, -120);
	await page.keyboard.up('Control');
}

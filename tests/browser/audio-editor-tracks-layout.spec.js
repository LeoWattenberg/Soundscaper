import { expect, longTone, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	clipField,
	closeDialog,
	collectClientErrors,
	fileDataTransfer,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
	setDocumentTheme,
	trackNameText,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('adds the selected track type from the timeline flyout', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const addTrack = editor.getByRole('button', { name: 'Add track', exact: true });

		await addTrack.click();
		const flyout = page.locator('.add-track-flyout');
		await expect(flyout).toBeVisible();
		await expect(flyout.getByRole('menuitem', { name: 'Audio track', exact: true })).toBeVisible();
		await expect(flyout.getByRole('menuitem', { name: 'Label track', exact: true })).toBeVisible();

		await flyout.getByRole('menuitem', { name: 'Audio track', exact: true }).click();
		await expect(flyout).toHaveCount(0);
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);
	});

	test('themes and spaces the add-track flyout in dark mode', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await setDocumentTheme(page, 'dark');
		await editor.getByRole('button', { name: 'Add track', exact: true }).click();

		const flyout = page.locator('.add-track-flyout');
		await expect(flyout).toHaveCSS('background-color', 'rgb(44, 46, 51)');
		await expect(flyout).toHaveCSS('color', 'rgb(228, 229, 231)');
		await expect(flyout.locator('.add-track-flyout__options')).toHaveCSS('gap', '8px');
		await expect(flyout.getByRole('menuitem', { name: 'Audio track', exact: true }))
			.toHaveCSS('background-color', 'rgb(81, 90, 99)');
	});

	test('pins V21 send and master strips below media tracks without legacy strip envelopes', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		const addTrack = editor.getByRole('button', { name: 'Add track', exact: true });
		const mediaTracks = editor.locator('[data-track-row]');

		await expect(editor.locator('[data-output-track-dock]')).toHaveCount(0);
		await expect(editor.locator('[data-side-playback-meter]')).toBeVisible();

		await addTrack.click();
		let flyout = page.locator('.add-track-flyout');
		const showMaster = flyout.getByRole('checkbox', { name: 'Show master track', exact: true });
		await expect(flyout.getByRole('menuitem', { name: 'Send track', exact: true })).toBeVisible();
		await expect(showMaster).not.toBeChecked();
		await expect(flyout.locator('.add-track-flyout__row')).toHaveCount(2);
		await expect(flyout.locator('.add-track-flyout__row').getByRole('checkbox', { name: 'Show master track', exact: true })).toHaveCount(1);
		await expect(flyout.locator('.add-track-flyout__row').getByRole('checkbox', { name: 'Show markers', exact: true })).toHaveCount(1);
		await showMaster.click();
		await expect(flyout).toBeVisible();
		await expect(showMaster).toBeChecked();
		await expect(editor.locator('[data-output-track-row][data-output-scope="master"]')).toHaveCount(1);
		await expect(mediaTracks).toHaveCount(1);

		const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
		await menubar.getByRole('menuitem', { name: 'View', exact: true }).click();
		const viewMenu = page.getByRole('menu', { name: 'View', exact: true });
		const viewMaster = viewMenu.getByRole('menuitemcheckbox', { name: 'Show master track', exact: true });
		await expect(viewMaster).toHaveAttribute('aria-checked', 'true');
		await expect(viewMenu.locator('[role="menuitem"][aria-checked]')).toHaveCount(0);
		await viewMaster.focus();
		await page.keyboard.press('Enter');
		await expect(editor.locator('[data-output-track-row][data-output-scope="master"]')).toHaveCount(0);
		await expect(editor.locator('[data-side-playback-meter]')).toBeVisible();

		await addTrack.click();
		flyout = page.locator('.add-track-flyout');
		await expect(flyout.getByRole('checkbox', { name: 'Show master track', exact: true })).not.toBeChecked();
		await flyout.getByRole('checkbox', { name: 'Show master track', exact: true }).check();
		await flyout.getByRole('menuitem', { name: 'Send track', exact: true }).click();
		for (let index = 0; index < 4; index += 1) {
			await addTrack.click();
			await page.locator('.add-track-flyout').getByRole('menuitem', { name: 'Send track', exact: true }).click();
		}

		const dock = editor.locator('[data-output-track-dock]');
		const outputRows = dock.locator('[data-output-track-row]');
		await expect(outputRows).toHaveCount(6);
		expect(await outputRows.evaluateAll((rows) => rows.map((row) => row.dataset.outputScope))).toEqual([
			'send', 'send', 'send', 'send', 'send', 'master',
		]);
		await expect(mediaTracks).toHaveCount(1);
		await expect(dock.locator('[data-clip-id], canvas.audio-editor-waveform-canvas')).toHaveCount(0);
		await expect(dock.locator('[data-track-row], [data-track-lane]')).toHaveCount(0);
		await expect.poll(() => dock.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
		const [panelBounds, dockBounds] = await Promise.all([
			editor.locator('.audio-editor-timeline-panel').boundingBox(),
			dock.boundingBox(),
		]);
		expect(panelBounds).not.toBeNull();
		expect(dockBounds).not.toBeNull();
		expect(Math.abs(panelBounds.y + panelBounds.height - dockBounds.y - dockBounds.height)).toBeLessThanOrEqual(2);
		expect(dockBounds.height).toBeLessThanOrEqual(panelBounds.height / 3 + 2);

		const firstSend = outputRows.first();
		await expect(firstSend).toHaveAttribute('data-collapsed', 'true');
		expect((await firstSend.boundingBox())?.height).toBe(54);
		await firstSend.getByRole('button', { name: 'Track menu', exact: true }).click();
		await page.locator('.audio-editor-output-track-menu').getByRole('menuitem', { name: 'Expand track', exact: true }).click();
		await expect(firstSend).toHaveAttribute('data-collapsed', 'false');
		expect((await firstSend.boundingBox())?.height).toBe(114);
		await expect(firstSend.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
		await expect(firstSend.getByRole('button', { name: 'Solo', exact: true })).toBeVisible();
		await expect(firstSend.getByRole('button', { name: 'Effects', exact: true })).toBeVisible();

		const envelope = firstSend.locator('.audio-editor-output-envelope');
		await expect(envelope).toHaveCount(0);

		const transfer = await fileDataTransfer(page, [toneA]);
		await firstSend.locator('[data-output-lane]').dispatchEvent('drop', { dataTransfer: transfer });
		await expect(mediaTracks).toHaveCount(1);
		await expect(firstSend.locator('[data-clip-id]')).toHaveCount(0);

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		editor = await waitForEditor(page);
		const restoredRows = editor.locator('[data-output-track-row]');
		await expect(restoredRows).toHaveCount(6);
		await expect(restoredRows.first()).toHaveAttribute('data-collapsed', 'false');
		await expect(restoredRows.first().locator('.audio-editor-output-envelope')).toHaveCount(0);
		await expect(restoredRows.last()).toHaveAttribute('data-output-scope', 'master');
		expect(errors).toEqual([]);
	});

	test('projects one playback position through the ruler, media, and output playheads', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await editor.getByRole('button', { name: 'Add track', exact: true }).click();
		await page.locator('.add-track-flyout')
			.getByRole('checkbox', { name: 'Show master track', exact: true })
			.check();
		const playbackPositions = () => editor.evaluate((root) => [
			root.querySelector('.audio-editor-ruler-playhead')?.getBoundingClientRect().x,
			root.querySelector('[data-playhead] .playhead-cursor__line')?.getBoundingClientRect().x,
			root.querySelector('.audio-editor-output-playhead')?.getBoundingClientRect().x,
		]);
		const initial = await playbackPositions();

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(async () => {
			const positions = await playbackPositions();
			return Math.max(...positions) - Math.min(...positions);
		}).toBeLessThanOrEqual(1);
		await expect.poll(async () => (await playbackPositions())[1]).toBeGreaterThan(initial[1] + 2);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();

		expect(errors).toEqual([]);
	});

	test('rejects pointer clip moves onto output tracks', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const addTrack = editor.getByRole('button', { name: 'Add track', exact: true });
		await addTrack.click();
		await page.locator('.add-track-flyout').getByRole('menuitem', {
			name: 'Send track',
			exact: true,
		}).click();

		const dock = editor.locator('[data-output-track-dock]');
		const outputLane = dock.locator('[data-output-lane]').first();
		const clip = clipByName(editor, toneA.name);
		await clip.scrollIntoViewIfNeeded();
		const [clipBox, outputLaneBox] = await Promise.all([
			clip.boundingBox(),
			outputLane.boundingBox(),
		]);
		expect(clipBox).not.toBeNull();
		expect(outputLaneBox).not.toBeNull();
		const trackCount = await editor.getAttribute('data-track-count');

		await page.mouse.move(clipBox.x + 32, clipBox.y + 10);
		await page.mouse.down();
		await page.mouse.move(
			Math.min(outputLaneBox.x + outputLaneBox.width - 24, clipBox.x + 132),
			outputLaneBox.y + outputLaneBox.height / 2,
			{ steps: 6 },
		);
		await page.mouse.up();

		await expect(clip).toBeVisible();
		await expect.poll(async () => Math.round((await clip.boundingBox())?.x || 0)).toBe(Math.round(clipBox.x));
		await expect(editor).toHaveAttribute('data-track-count', trackCount);
		await expect(dock.locator('[data-clip-id], [data-track-row], [data-track-lane]')).toHaveCount(0);
		const clipDialog = await openClipProperties(page, editor, clip);
		await expect(clipField(clipDialog, 'startFrame')).toHaveValue('0');
		await closeDialog(clipDialog);
		expect(errors).toEqual([]);
	});

	test('navigates output tracks and their menus by keyboard', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('audacity-accessibility-profile', 'au4-tab-groups');
		});
		const editor = await bootEditor(page, '/embed/en/');
		const addTrack = editor.getByRole('button', { name: 'Add track', exact: true });
		for (let index = 0; index < 2; index += 1) {
			await addTrack.click();
			await page.locator('.add-track-flyout').getByRole('menuitem', {
				name: 'Send track',
				exact: true,
			}).click();
		}

		const rows = editor.locator('[data-output-track-row][data-output-scope="send"]');
		await expect(rows).toHaveCount(2);
		const firstRow = rows.first();
		const secondRow = rows.nth(1);
		const firstPanel = firstRow.locator('.track-control-panel');
		const secondPanel = secondRow.locator('.track-control-panel');
		const firstLane = firstRow.locator('[data-output-lane]');
		const secondLane = secondRow.locator('[data-output-lane]');

		await firstPanel.focus();
		await page.keyboard.press('Tab');
		await expect(firstLane).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(firstPanel).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(secondPanel).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(firstPanel).toBeFocused();

		await firstLane.focus();
		await page.keyboard.press('ArrowDown');
		await expect(secondLane).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(firstLane).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(secondPanel).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(firstLane).toBeFocused();

		await firstLane.press('Escape');
		await expect(firstPanel).toBeFocused();
		const trackMenuButton = firstRow.getByRole('button', { name: 'Track menu', exact: true });
		await trackMenuButton.focus();
		await trackMenuButton.press('Escape');
		await expect(firstPanel).toBeFocused();

		await firstLane.focus();
		await firstLane.press('Shift+F10');
		const menu = page.locator('.audio-editor-output-track-menu[role="menu"]');
		const expand = menu.getByRole('menuitem', { name: 'Expand track', exact: true });
		await expect(menu).toBeVisible();
		await expect(expand).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(firstLane).toBeFocused();

		await firstLane.press('Shift+F10');
		await menu.getByRole('menuitem', { name: 'Expand track', exact: true }).press('Enter');
		await expect(firstRow).toHaveAttribute('data-collapsed', 'false');
	});

	test('keeps time selection available on empty tracks', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const lane = editor.locator('.audio-editor-track-row [data-track-lane]').first();
		const box = await lane.boundingBox();
		expect(box).not.toBeNull();

		await page.mouse.move(box.x + 24, box.y + 48);
		await page.mouse.down();
		await page.mouse.move(box.x + 144, box.y + 48, { steps: 4 });
		await page.mouse.up();
		const loopSelection = editor.getByRole('button', { name: 'Loop selection' });
		await expect(loopSelection).toBeEnabled();
		const loopButton = editor.locator('.kw-audio-editor__transport-state button');
		await loopButton.click();
		await expect(loopButton).toHaveAttribute('aria-pressed', 'true');
		await loopButton.click();
		await expect(loopButton).toHaveAttribute('aria-pressed', 'false');
		await loopSelection.click();
		await expect(loopButton).toHaveAttribute('aria-pressed', 'true');
		const ruler = editor.locator('[data-ruler]');
		const rulerBox = await ruler.boundingBox();
		expect(rulerBox).not.toBeNull();
		await page.mouse.click(rulerBox.x + 84, rulerBox.y + rulerBox.height / 4);
		await expect(loopButton).toHaveAttribute('aria-pressed', 'false');
		await expect(editor.locator('[data-selection-toolbar] .timecode')).toHaveCount(3);

		await editor.getByRole('button', { name: 'Add track', exact: true }).click();
		await page.locator('.add-track-flyout').getByRole('menuitem', { name: 'Audio track', exact: true }).click();
		await expect(editor.locator('[data-selection-toolbar] .timecode')).toHaveCount(3);
	});

	test('opens the custom track name editor only after double-clicking the native name', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const name = trackNameText(editor).first();
		await expect(name).toHaveText('Track 1');
		await expect(editor.locator('[data-track-name] input')).toHaveCount(0);

		await name.dblclick();
		const input = editor.locator('[data-track-name] input');
		await expect(input).toBeFocused();
		await input.fill('Renamed track');
		await input.press('Enter');

		await expect(editor.locator('[data-track-name] input')).toHaveCount(0);
		await expect(name).toHaveText('Renamed track');
	});

	test('anchors toolbar and browser zoom gestures to the project timeline', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const timeline = editor.locator('[data-timeline]');
		const timelinePanel = editor.locator('.audio-editor-timeline-panel');
		const normalWidth = await timeline.evaluate((element) => element.scrollWidth);

		const ruler = editor.locator('[data-ruler]');
		const rulerBox = await ruler.boundingBox();
		expect(rulerBox).not.toBeNull();
		await clipByName(editor, longTone.name).click({ position: { x: rulerBox.width * 0.75, y: 48 } });
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(normalWidth);
		await expect.poll(async () => {
			const [viewport, playhead] = await Promise.all([
				ruler.boundingBox(),
				editor.locator('[data-playhead] .playhead-cursor__line').boundingBox(),
			]);
			if (!viewport || !playhead) return Number.POSITIVE_INFINITY;
			return Math.abs(playhead.x - (viewport.x + viewport.width / 2));
		}).toBeLessThanOrEqual(2);
		await timelinePanel.evaluate((element) => { element.tabIndex = -1; element.focus(); });
		const waveform = clipByName(editor, longTone.name).locator('canvas.clip-body__waveform');
		await page.keyboard.down('Control');
		for (let step = 0; step < 6; step += 1) await page.keyboard.press('=');
		await page.keyboard.up('Control');
		await expect.poll(() => waveform.evaluate((canvas) => {
			const context = canvas.getContext('2d');
			const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
			const center = Math.floor(height / 2);
			const paintedQuarters = Array.from({ length: 4 }, (_, quarter) => {
				let painted = 0;
				for (let x = Math.floor(width * quarter / 4); x < Math.floor(width * (quarter + 1) / 4); x += 1) {
					for (let y = 0; y < height; y += 1) {
						if (Math.abs(y - center) <= 2 || data[(y * width + x) * 4 + 3] === 0) continue;
						painted += 1;
						break;
					}
				}
				return painted;
			});
			return Math.min(...paintedQuarters);
		})).toBeGreaterThan(40);

		await page.evaluate(() => {
			const externalFocus = document.createElement('button');
			externalFocus.id = 'external-zoom-focus';
			document.body.append(externalFocus);
			externalFocus.focus();
			globalThis.__projectZoomOutDefaultPrevented = false;
		});
		await page.keyboard.down('Control');
		await page.evaluate(() => {
			document.addEventListener('keydown', (event) => {
				if (event.key === '-') globalThis.__projectZoomOutDefaultPrevented = event.defaultPrevented;
			}, { once: true });
		});
		await page.keyboard.press('-');
		await page.keyboard.up('Control');
		expect(await page.evaluate(() => globalThis.__projectZoomOutDefaultPrevented)).toBe(true);
		await page.keyboard.down('Control');
		for (let step = 0; step < 6; step += 1) await page.keyboard.press('-');
		await page.keyboard.up('Control');
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBe(normalWidth);
		await page.locator('#external-zoom-focus').evaluate((element) => element.remove());

		await timeline.hover();
		await page.keyboard.down('Control');
		await page.mouse.wheel(0, -120);
		await page.keyboard.up('Control');
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(normalWidth);
		expect(errors).toEqual([]);
	});

	test('keeps vertical rulers pinned while the timeline scrolls horizontally', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const timeline = editor.locator('[data-timeline]');
		const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
		for (let step = 0; step < 4; step += 1) await zoomIn.click();
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

		const ruler = editor.locator('[data-track-ruler]').first();
		const before = await ruler.boundingBox();
		expect(before).not.toBeNull();
		await timeline.evaluate((element) => {
			element.scrollLeft = element.scrollWidth - element.clientWidth;
			element.dispatchEvent(new Event('scroll'));
		});
		await expect.poll(() => ruler.evaluate((element) => getComputedStyle(element).transform)).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
		const after = await ruler.boundingBox();
		expect(after).not.toBeNull();
		expect(after.x).toBeCloseTo(before.x, 0);
		const timelineRight = (await timeline.boundingBox()).x + await timeline.evaluate((element) => element.clientWidth);
		expect(Math.abs(after.x + after.width - timelineRight)).toBeLessThanOrEqual(2);
		expect(errors).toEqual([]);
	});

	test('clamps timeline scrolling at the project boundaries', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const timeline = editor.locator('[data-timeline]');
		await expect(timeline).toHaveCSS('overscroll-behavior-x', 'none');

		const clampedScroll = await timeline.evaluate(async (element) => {
			const inner = element.querySelector('.audio-editor-timeline-inner');
			const originalWidth = inner.style.width;
			const projectMaximum = Math.max(0, element.scrollWidth - element.clientWidth);
			inner.style.width = `${element.scrollWidth + 1_000}px`;
			element.scrollLeft = projectMaximum + 500;
			element.dispatchEvent(new Event('scroll'));
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const result = element.scrollLeft;
			inner.style.width = originalWidth;
			return { projectMaximum, result };
		});
		expect(clampedScroll.result).toBeLessThanOrEqual(clampedScroll.projectMaximum);
		expect(errors).toEqual([]);
	});

	test('discards invalid legacy accessibility profiles and preserves valid preferences', async ({ page }) => {
		await page.addInitScript(() => {
			if (sessionStorage.getItem('kw-accessibility-test-initialized')) return;
			sessionStorage.setItem('kw-accessibility-test-initialized', 'true');
			localStorage.setItem('audacity-accessibility-profile', 'au4');
		});
		await bootEditor(page, '/embed/en/');
		await expect.poll(() => page.evaluate(() => localStorage.getItem('audacity-accessibility-profile'))).toBeNull();

		await page.evaluate(() => localStorage.setItem('audacity-accessibility-profile', 'au4-tab-groups'));
		await page.reload();
		await waitForEditor(page);
		await expect.poll(() => page.evaluate(() => localStorage.getItem('audacity-accessibility-profile'))).toBe('au4-tab-groups');
	});

	test('expands the editor to the full viewport from the application header', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const fullscreen = editor.getByRole('button', { name: 'Fullscreen', exact: true });
		await expect(fullscreen).toHaveText('');
		await expect(fullscreen.locator('svg')).toBeVisible();
		await fullscreen.click();
		await expect(editor).toHaveClass(/kw-audio-editor--viewport-fullscreen/);
		expect(await editor.evaluate((element) => [element.clientWidth, element.clientHeight, innerWidth, innerHeight])).toEqual([
			page.viewportSize().width,
			page.viewportSize().height,
			page.viewportSize().width,
			page.viewportSize().height,
		]);
		const projectTabs = editor.getByRole('tablist', { name: 'Project tabs' });
		await expect(projectTabs).toBeVisible();
		const title = editor.locator('.application-header__windows-title');
		const tabsBox = await projectTabs.boundingBox();
		const titleBox = await title.boundingBox();
		const fullscreenBox = await fullscreen.boundingBox();
		expect(tabsBox).not.toBeNull();
		expect(titleBox).not.toBeNull();
		expect(fullscreenBox).not.toBeNull();
		expect(tabsBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
		expect(tabsBox.x + tabsBox.width).toBeLessThanOrEqual(fullscreenBox.x);
		const toolbar = editor.getByRole('toolbar', { name: 'Tool toolbar' });
		await expect(toolbar).toBeVisible();
		expect((await toolbar.boundingBox()).y).toBeGreaterThanOrEqual((await editor.locator('.kw-audio-editor__application-header').boundingBox()).y + (await editor.locator('.kw-audio-editor__application-header').boundingBox()).height);
		await fullscreen.click();
		await expect(editor).not.toHaveClass(/kw-audio-editor--viewport-fullscreen/);
	});

	test('customizes toolbar button visibility from the toolbar gear', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const settings = editor.getByRole('button', { name: 'Customize toolbar', exact: true });
		await settings.click();
		const flyout = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
		const playToggle = flyout.getByRole('checkbox', { name: 'Play', exact: true });
		await expect(flyout).toBeVisible();
		await expect(flyout).toHaveCSS('position', 'fixed');
		await expect(flyout.locator('.musescore-icon').first()).toBeVisible();
		for (const label of [
			'Cut and close gap per track',
			'Copy',
			'Paste',
			'Split at playhead',
			'Delete and close gap per track',
		]) {
			await expect(flyout.getByRole('checkbox', { name: label, exact: true })).toHaveAttribute('aria-checked', 'false');
			await expect(editor.getByRole('button', { name: label, exact: true })).toHaveCount(0);
		}
		await expect(flyout.getByRole('checkbox', { name: 'Cut and leave gap', exact: true })).toHaveAttribute('aria-checked', 'false');
		await expect(flyout.getByRole('checkbox', { name: 'Delete and leave gap', exact: true })).toHaveAttribute('aria-checked', 'false');
		await expect(flyout.getByRole('checkbox', { name: 'Cut and close gap on all tracks', exact: true })).toHaveAttribute('aria-checked', 'false');
		await expect(flyout.getByRole('checkbox', { name: 'Delete and close gap on all tracks', exact: true })).toHaveAttribute('aria-checked', 'false');
		await expect(playToggle).toHaveAttribute('aria-checked', 'true');
		await playToggle.click();
		await expect(playToggle).toHaveAttribute('aria-checked', 'false');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
		await playToggle.click();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		const timeDisplayToggle = flyout.getByRole('checkbox', { name: 'Playhead', exact: true });
		await expect(timeDisplayToggle).toHaveAttribute('aria-checked', 'true');
		await timeDisplayToggle.click();
		await expect(editor.locator('[data-time-display]')).toHaveCount(0);
		await timeDisplayToggle.click();
		await expect(editor.locator('[data-time-display]')).toBeVisible();
		const monitorToggle = flyout.getByRole('checkbox', { name: 'Record level', exact: true });
		await monitorToggle.click();
		await expect(editor.getByRole('button', { name: 'Record level', exact: true })).toHaveCount(0);
		await monitorToggle.click();
		await expect(editor.getByRole('button', { name: 'Record level', exact: true })).toBeVisible();
		const playbackVolumeToggle = flyout.getByRole('checkbox', { name: 'Playback volume', exact: true });
		await playbackVolumeToggle.click();
		await expect(editor.locator('[data-side-playback-meter]')).toHaveCount(0);
		await playbackVolumeToggle.click();
		await expect(editor.locator('[data-side-playback-meter]')).toBeVisible();
	});
});

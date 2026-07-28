import {
	captionLabels,
	expect,
	readFile,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	clipField,
	closeDialog,
	collectClientErrors,
	commitInput,
	getMenuItem,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('opens unified search from fixed shortcuts with an owned keyboard-accessible listbox', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-project-bin-input]').setInputFiles([toneA]);
		const sourceInput = editor.locator('[data-project-bin-name]');
		const search = editor.locator('[data-editor-search-input]');
		const popup = editor.locator('[data-editor-search-popup]');
		const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });

		await expect(sourceInput).toBeVisible();
		await sourceInput.focus();
		await page.keyboard.press('Control+f');
		await expect(search).toBeFocused();
		await expect(search).toHaveAttribute('role', 'combobox');
		await expect(search).toHaveAttribute('aria-expanded', 'true');
		await expect(popup).toBeVisible();
		await expect(popup).toHaveAttribute('role', 'listbox');
		await expect(menubar.locator('[data-editor-search]')).toHaveCount(0);
		await expect(popup.getByRole('group', { name: 'Commands', exact: true })).toBeVisible();
		const initialActiveId = await search.getAttribute('aria-activedescendant');
		expect(initialActiveId).toBeTruthy();
		await expect(page.locator(`#${initialActiveId}`)).toHaveAttribute('aria-selected', 'true');
		await search.press('ArrowDown');
		await expect.poll(() => search.getAttribute('aria-activedescendant')).not.toBe(initialActiveId);
		await assertNoSeriousAxeViolations(page, '[data-editor-search]');

		await search.press('Escape');
		await expect(popup).toBeHidden();
		await expect(search).toHaveValue('');
		await expect(sourceInput).toBeFocused();

		for (const shortcut of ['F3', 'Meta+f']) {
			await page.keyboard.press(shortcut);
			await expect(search).toBeFocused();
			await expect(popup).toBeVisible();
			await search.press('Escape');
			await expect(sourceInput).toBeFocused();
		}

		await menubar.getByRole('menuitem', { name: 'File', exact: true }).click();
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		await expect(fileMenu).toBeVisible();
		await page.keyboard.press('Control+f');
		await expect(fileMenu).toBeHidden();
		await expect(search).toBeFocused();
		await menubar.getByRole('menuitem', { name: 'View', exact: true }).click();
		await expect(popup).toBeHidden();
		await expect(page.getByRole('menu', { name: 'View', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
	});

	test('keeps disabled search commands inert and maps a louder request to Amplify without editing', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const search = editor.locator('[data-editor-search-input]');
		const popup = editor.locator('[data-editor-search-popup]');

		await page.keyboard.press('Control+f');
		await search.fill('project-properties');
		const disabledCommand = popup.locator('[data-editor-search-key="command:project-properties"]');
		await expect(disabledCommand).toBeVisible();
		await expect(disabledCommand).toHaveAttribute('aria-disabled', 'true');
		await expect(popup.getByRole('option')).toHaveCount(1);
		await expect(search).not.toHaveAttribute('aria-activedescendant', /.+/);
		await search.press('Enter');
		await expect(popup).toBeVisible();
		await disabledCommand.click({ force: true });
		await expect(popup).toBeVisible();
		await search.press('Escape');

		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		const countsBefore = await editor.evaluate((root) => ({
			clips: root.dataset.clipCount,
			tracks: root.dataset.trackCount,
		}));
		await page.keyboard.press('Control+f');
		await search.fill('I want to make this louder');
		const amplify = popup.locator('[data-editor-search-key="command:audacity-amplify"]');
		await expect(amplify).toBeVisible();
		await expect(amplify).toContainText('Amplify');
		await expect(amplify).toHaveAttribute('aria-selected', 'true');
		await search.press('Enter');

		const effectDialog = page.locator('[data-selection-effects-dialog]');
		await expect(effectDialog).toBeVisible();
		await expect(effectDialog).toContainText(/Amplification|audacity-amplify/i);
		await expect(editor).toHaveAttribute('data-clip-count', countsBefore.clips);
		await expect(editor).toHaveAttribute('data-track-count', countsBefore.tracks);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await closeDialog(effectDialog);
	});

	test('reveals a compact Project Bin search result without previewing or inserting it', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const editor = await bootEditor(page, '/embed/en/');
		const trigger = editor.locator('[data-editor-search-trigger]');
		const search = editor.locator('[data-editor-search-input]');
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');

		await expect(trigger).toBeVisible();
		await expect(search).toBeHidden();
		await trigger.click();
		await expect(search).toBeFocused();
		await search.press('Escape');
		await expect(trigger).toBeFocused();

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Project bin']);
		await expect(projectBinPanel).toBeVisible();
		await editor.locator('[data-project-bin-input]').setInputFiles([toneA]);
		let card = projectBinPanel.locator('[data-project-bin-item]').first();
		await expect(card).toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await projectBinPanel.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBinPanel).toBeHidden();

		await trigger.click();
		await search.fill(toneA.name);
		const binResult = editor.locator('[data-editor-search-option][data-editor-search-kind="project-bin"]');
		await expect(binResult).toHaveCount(1);
		await expect(binResult).toContainText(toneA.name);
		await search.press('Enter');

		await expect(projectBinPanel).toBeVisible();
		card = projectBinPanel.locator('[data-project-bin-item]').first();
		await expect(card).toBeFocused();
		await expect(card.getByRole('button', { name: /^Play:/ })).toHaveAttribute('aria-pressed', 'false');
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	});

	test('centers and focuses an offscreen timeline clip activated from search', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const clipDialog = await openClipProperties(page, editor, clipByName(editor, toneB.name));
		await commitInput(clipField(clipDialog, 'startFrame'), '4800000');
		await closeDialog(clipDialog);

		const timelineScroll = editor.locator('.audio-editor-timeline-scroll');
		await timelineScroll.evaluate((element) => {
			element.scrollLeft = 0;
			element.dispatchEvent(new Event('scroll'));
		});
		await expect(clipByName(editor, toneB.name)).toHaveCount(0);
		await page.keyboard.press('Control+f');
		const search = editor.locator('[data-editor-search-input]');
		await search.fill(toneB.name);
		const timelineResult = editor
			.locator('[data-editor-search-option][data-editor-search-kind="timeline"]')
			.filter({ hasText: toneB.name });
		await expect(timelineResult).toHaveCount(1);
		await search.press('Enter');

		await expect.poll(() => timelineScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(1_000);
		await expect(clipByName(editor, toneB.name)).toBeVisible();
		await expect(clipByName(editor, toneB.name)).toBeFocused();
	});

	test('exposes the complete zoom menu and executes custom shortcuts through the action registry', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const timeline = editor.locator('[data-timeline]');
		const normalWidth = await timeline.evaluate((element) => element.scrollWidth);

		const menubar = editor.getByRole('menubar', { name: 'Application menu' });
		await menubar.getByRole('menuitem', { name: 'View', exact: true }).click();
		const viewMenu = page.getByRole('menu', { name: 'View', exact: true });
		const zoomItem = getMenuItem(viewMenu, 'Zoom');
		await zoomItem.click();
		const zoomMenu = zoomItem.getByRole('menu');
		await expect(zoomMenu).toBeVisible();
		for (const label of ['Zoom normal', 'Zoom to selection', 'Zoom toggle', 'Fit height', 'Decrease all track heights', 'Increase all track heights', 'Center view on playhead']) {
			await expect(getMenuItem(zoomMenu, label)).toBeVisible();
		}
		const fitProject = getMenuItem(zoomMenu, 'Fit project to width');
		await expect(fitProject).toBeVisible();
		await expect(fitProject).toContainText('Ctrl+0');
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await expect(editor.getByRole('button', { name: 'Loop selection', exact: true })).toBeEnabled();
		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(normalWidth);
		await editor.locator('.audio-editor-timeline-panel').evaluate((element) => {
			element.tabIndex = -1;
			element.focus();
		});
		await page.keyboard.press('Control+0');
		const ruler = editor.locator('[data-ruler]');
		const fittedClip = clipByName(editor, toneA.name);
		await expect.poll(async () => {
			const [viewport, clip] = await Promise.all([ruler.boundingBox(), fittedClip.boundingBox()]);
			if (!viewport || !clip) return 0;
			return clip.width / viewport.width;
		}).toBeGreaterThan(0.95);
		await expect.poll(() => fittedClip.locator('canvas.clip-body__waveform').evaluate((canvas) => {
			const context = canvas.getContext('2d');
			const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
			let paintedRightHalf = 0;
			for (let x = Math.floor(width / 2); x < width; x += 1) {
				for (let y = 0; y < height; y += 1) {
					if (data[(y * width + x) * 4 + 3] === 0) continue;
					paintedRightHalf += 1;
					break;
				}
			}
			return paintedRightHalf;
		})).toBeGreaterThan(40);
		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(normalWidth);
		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom normal']);
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBe(normalWidth);

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const search = preferences.getByRole('searchbox', { name: 'Search commands', exact: true });
		await search.fill('Zoom toggle');
		const row = preferences.locator('[data-shortcut-action="zoom-toggle"]');
		await expect(row).toBeVisible();
		await row.locator('input').fill('K');
		await row.getByRole('button', { name: 'Assign', exact: true }).click();
		await page.keyboard.press('Escape');
		await expect(preferences).toBeHidden();

		const timelinePanel = editor.locator('.audio-editor-timeline-panel');
		await timelinePanel.evaluate((element) => { element.tabIndex = -1; element.focus(); });
		await page.keyboard.press('k');
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(normalWidth);
		await page.keyboard.press('Control+2');
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBe(normalWidth);
		expect(errors).toEqual([]);
	});

	test('edits recording level, project metadata, and labels through the manifest surfaces', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record level', exact: true }).click();
		const recordingLevel = editor.locator('[data-side-recording-meter]').getByRole('slider', { name: 'Record level', exact: true });
		await recordingLevel.fill('2.7');
		await expect(recordingLevel).toHaveValue('2.7');
		await page.keyboard.press('Escape');

		await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
		const labelsPanel = editor.locator('[data-workspace-panel="labels"]');
		await expect(labelsPanel).toBeVisible();
		const newLabel = labelsPanel.getByRole('button', { name: 'New label', exact: true });
		await expect(newLabel).toBeEnabled();
		await newLabel.click();
		await expect(editor).toHaveAttribute('data-track-count', '2');
		const labelRow = labelsPanel.locator('[data-labels-panel-list] [data-label-id]');
		await expect(labelRow).toHaveCount(1);
		const labelTrackId = await labelRow.getAttribute('data-track-id');
		expect(labelTrackId).toBeTruthy();
		await expect(editor.locator(`[data-label-track][data-track-id="${labelTrackId}"]`)).toHaveCount(1);
		await commitInput(labelRow.getByRole('textbox', { name: /^Label title:/ }), 'Verse');
		const rangeInputs = labelRow.getByRole('spinbutton');
		await commitInput(rangeInputs.nth(1), '0.500');
		await commitInput(rangeInputs.nth(0), '0.125');
		await expect(rangeInputs.nth(0)).toHaveValue('0.125');
		await expect(rangeInputs.nth(1)).toHaveValue('0.500');
		await labelsPanel.getByRole('button', { name: 'Close: Labels', exact: true }).click();
		await expect(labelsPanel).toHaveCount(0);
		const timelineLabel = editor.locator('[data-label-track] [data-label-id]', { hasText: 'Verse' });
		await expect(timelineLabel).toBeVisible();
		const widthBeforeResize = await timelineLabel.evaluate((element) => element.getBoundingClientRect().width);
		const rightEar = timelineLabel.locator('.label-marker__right-ear');
		const rightEarBox = await rightEar.boundingBox();
		expect(rightEarBox).not.toBeNull();
		await page.mouse.move(rightEarBox.x + rightEarBox.width / 2, rightEarBox.y + rightEarBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(rightEarBox.x + rightEarBox.width / 2 + 32, rightEarBox.y + rightEarBox.height / 2, { steps: 3 });
		await page.mouse.up();
		await expect.poll(() => timelineLabel.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(widthBeforeResize);
		const widthAfterResize = await timelineLabel.evaluate((element) => element.getBoundingClientRect().width);
		await page.mouse.move(rightEarBox.x + rightEarBox.width / 2 + 96, rightEarBox.y + rightEarBox.height / 2);
		await expect.poll(() => timelineLabel.evaluate((element) => element.getBoundingClientRect().width)).toBe(widthAfterResize);
		await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
		await expect.poll(async () => Number(await labelsPanel
			.locator('[data-labels-panel-list] [data-label-id]')
			.getByRole('spinbutton').nth(1).inputValue())).toBeGreaterThan(0.5);
		await labelsPanel.getByRole('button', { name: 'Close: Labels', exact: true }).click();
		await timelineLabel.dblclick();
		await expect(timelineLabel.locator('input')).toHaveValue('Verse');
		await page.keyboard.press('Escape');

		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const metadataPanel = editor.locator('[data-workspace-panel="metadata"]');
		await expect(metadataPanel).toBeVisible();
		await commitInput(metadataPanel.locator('input[name="title"]'), 'Browser parity project');
		await commitInput(metadataPanel.locator('input[name="artist"]'), 'Audacity tester');
		await metadataPanel.getByRole('button', { name: 'Close: Metadata', exact: true }).click();
		await expect(metadataPanel).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		await expect(editor.locator('[data-workspace-panel="metadata"] input[name="title"]')).toHaveValue('Browser parity project');
		await expect(editor.locator('[data-workspace-panel="metadata"] input[name="artist"]')).toHaveValue('Audacity tester');
		expect(errors).toEqual([]);
	});

	test('generates a configured tone, traverses history, and restores it from autosave', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');

		await test.step('configure and generate a quarter-second tone', async () => {
			await chooseCommandAction(page, editor, 'Generate', 'Tone');
			const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
			await expect(dialog).toBeVisible();
			await expect(dialog.locator('[data-generator-field="durationSeconds"] input')).toHaveValue('30');
			await commitInput(dialog.locator('[data-generator-field="frequency"] input'), '880');
			await commitInput(dialog.locator('[data-generator-field="amplitude"] input'), '0.4');
			await commitInput(dialog.locator('[data-generator-field="durationSeconds"] input'), '0.25');
			await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
			await expect(clipByName(editor, 'Tone')).toHaveCount(1);
		});

		await test.step('undo and redo the generated source as one edit', async () => {
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-clip-count', '0');
			await editor.getByRole('button', { name: 'Redo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(clipByName(editor, 'Tone')).toHaveCount(1);
			const clipDialog = await openClipProperties(page, editor, clipByName(editor, 'Tone'));
			await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('12000');
			await closeDialog(clipDialog);
		});

		await test.step('reload the saved project and retain the generated duration', async () => {
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
			await page.reload();
			editor = await waitForEditor(page);
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			const clipDialog = await openClipProperties(page, editor, clipByName(editor, 'Tone'));
			await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('12000');
			await closeDialog(clipDialog);
		});

		expect(errors).toEqual([]);
	});

	test('round-trips imported captions through editing, history, autosave, and WebVTT export', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');

		await test.step('import an SRT file as an editable label track', async () => {
			const fileChooserPromise = page.waitForEvent('filechooser');
			await chooseFileAction(page, editor, 'Import');
			await (await fileChooserPromise).setFiles(captionLabels);
			await expect(editor.locator('[data-status]')).toHaveText('Imported 2 label(s).');
			await expect(editor).toHaveAttribute('data-track-count', '2');
			await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
		});

		await test.step('edit one cue and remove another through the label manager', async () => {
			await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
			const labelsPanel = editor.locator('[data-workspace-panel="labels"]');
			await expect(labelsPanel).toBeVisible();
			const rows = labelsPanel.locator('[data-labels-panel-list] [data-label-id]');
			await expect(rows).toHaveCount(2);

			const intro = rows.nth(0);
			await commitInput(intro.getByRole('textbox'), 'Edited intro');
			await commitInput(intro.getByRole('spinbutton').nth(1), '1.750');
			await expect(intro.getByRole('textbox')).toHaveValue('Edited intro');
			await expect(intro.getByRole('spinbutton').nth(1)).toHaveValue('1.750');

			await rows.nth(1).getByRole('button', { name: 'Delete label: Outro caption', exact: true }).click();
			await expect(rows).toHaveCount(1);
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(rows).toHaveCount(2);
			await editor.getByRole('button', { name: 'Redo', exact: true }).click();
			await expect(rows).toHaveCount(1);
		});

		await test.step('restore the edited label track from autosave', async () => {
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
			await page.reload();
			editor = await waitForEditor(page);
			const labelsPanel = editor.locator('[data-workspace-panel="labels"]');
			if (!await labelsPanel.isVisible()) await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
			const rows = labelsPanel.locator('[data-labels-panel-list] [data-label-id]');
			await expect(rows).toHaveCount(1);
			await expect(rows.getByRole('textbox')).toHaveValue('Edited intro');
			await expect(rows.getByRole('spinbutton').nth(0)).toHaveValue('0.250');
			await expect(rows.getByRole('spinbutton').nth(1)).toHaveValue('1.750');
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);
			await expect(editor.locator('[data-label-track]')).toHaveCount(2);
		});

		await test.step('choose the format and label tracks, then export valid WebVTT', async () => {
			const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
			await menubar.getByRole('menuitem', { name: 'File', exact: true }).click();
			const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
			const exportOther = getMenuItem(fileMenu, 'Export other');
			await exportOther.focus();
			await page.keyboard.press('ArrowRight');
			const exportOtherMenu = exportOther.getByRole('menu');
			await expect(exportOtherMenu).toBeVisible();
			await expect(getMenuItem(exportOtherMenu, 'Export MIDI')).toHaveCount(0);
			await page.keyboard.press('Escape');
			await page.keyboard.press('Escape');

			await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels']);
			const dialog = page.getByRole('dialog', { name: 'Export labels', exact: true });
			await expect(dialog).toBeVisible();
			await expect(page.locator('[data-editor-surface="label-export"]')).toBeVisible();
			await expect(dialog.getByRole('checkbox')).toHaveCount(2);
			await dialog.getByRole('checkbox', { name: 'Labels', exact: true }).click();
			await expect(dialog.getByRole('checkbox', { name: 'Labels', exact: true })).not.toBeChecked();
			await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'As WebVTT');

			const [download] = await Promise.all([
				page.waitForEvent('download'),
				dialog.getByRole('button', { name: 'Export labels', exact: true }).click(),
			]);
			await expect(dialog).toBeHidden();
			expect(download.suggestedFilename()).toMatch(/\.vtt$/i);
			const downloadPath = await download.path();
			expect(downloadPath).not.toBeNull();
			await expect.poll(async () => readFile(downloadPath, 'utf8')).toBe([
				'WEBVTT',
				'',
				'1',
				'00:00:00.250 --> 00:00:01.750',
				'Edited intro',
				'',
			].join('\n'));
		});

		await test.step('export Podcast 2.0 chapter JSON', async () => {
			await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels']);
			const dialog = page.getByRole('dialog', { name: 'Export labels', exact: true });
			await expect(dialog).toBeVisible();
			await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'As Podcast 2.0 chapters (JSON)');

			const [download] = await Promise.all([
				page.waitForEvent('download'),
				dialog.getByRole('button', { name: 'Export labels', exact: true }).click(),
			]);
			expect(download.suggestedFilename()).toMatch(/\.json$/i);
			const downloadPath = await download.path();
			expect(downloadPath).not.toBeNull();
			expect(JSON.parse(await readFile(downloadPath, 'utf8'))).toEqual({
				version: '1.2.0',
				chapters: [{ startTime: 0.25, title: 'Edited intro' }],
			});
		});

		expect(errors).toEqual([]);
	});
});

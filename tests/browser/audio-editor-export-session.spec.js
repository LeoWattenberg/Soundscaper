import {
	expect,
	longTone,
	monoTone,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseNestedCommandAction,
	clipByName,
	closeDialog,
	closeEffectsPanel,
	closeWorkspacePanel,
	collectClientErrors,
	disableNativeSavePicker,
	disableOfflineAudio,
	downloadBytes,
	effectSourceMetadata,
	effectSourcePeak,
	getMenuItem,
	importFiles,
	openAnalysisPanel,
	openClipProperties,
	openEffectsForTrack,
	openExportDialog,
	openRackPicker,
	openSelectionEffectDialog,
	readDownloadBytes,
	registerAudioEditorHooks,
	seekOnRuler,
	setDocumentTheme,
	showToolbarButton,
	waitForEditor,
	waitForResponsiveEditorLayout,
} from './audio-editor-test-helpers.js';

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('streams aligned WAV stems into a local ZIP archive', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="output"]'), 'Individual stems (split by tracks)');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		await expect(download).toHaveAttribute('download', /-stems-.*\.zip$/);
		const archive = await readDownloadBytes(page, download);
		expect(Array.from(archive.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(archive.length).toBeGreaterThan(200);
		expect(errors).toEqual([]);
	});

	test('splits the mix into one file per label and archives the chapters', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		// The dialog starts the download itself once the file is ready, so the
		// browser must report one without the link ever being pressed.
		const downloads = [];
		page.on('download', (download) => downloads.push(download));
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Markers']);
		const markers = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
		await markers.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
		await seekOnRuler(page, editor, 220);
		await markers.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
		await expect(markers.locator('[data-timeline-annotation]')).toHaveCount(2);

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="output"]'), 'Chapters (split by labels)');
		// A chapter delivers exactly the span its label names, so there is no tail.
		await expect(exportDialog.locator('[data-export-field="tails"]')).toHaveCount(0);
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		await expect(download).toHaveAttribute('download', /-chapters-.*\.zip$/u);
		await expect.poll(() => downloads.length).toBe(1);
		const archiveBytes = await downloadBytes(downloads[0]);
		const archive = {
			signature: Array.from(archiveBytes.subarray(0, 4)),
			entries: [...new TextDecoder('latin1').decode(archiveBytes).matchAll(/\d\d-[A-Za-z0-9-]+\.wav/gu)]
				.map(([name]) => name),
		};
		expect(archive.signature).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect([...new Set(archive.entries)]).toEqual(['01-chapter-1.wav', '02-chapter-2.wav']);
		expect(downloads[0].suggestedFilename()).toMatch(/-chapters-.*\.zip$/u);
		expect(errors).toEqual([]);
	});

	test('keeps delivery preset controls aligned in the export dialog', async ({ page }) => {
		await page.setViewportSize({ width: 700, height: 760 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		// Audacity keeps every preset action on the dropdown's own row: Save,
		// Reset, Delete and the three-dot menu sit to its right rather than
		// stacking underneath it.
		const presetSection = exportDialog.locator('[data-delivery-presets]');
		const presetTrigger = presetSection.locator('.effect-header__preset .dropdown__trigger');
		const triggerBounds = await presetTrigger.boundingBox();
		expect(triggerBounds).not.toBeNull();

		const actionBounds = await presetSection
			.locator('.effect-header__right .effect-header__icon-button')
			.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()));
		expect(actionBounds).toHaveLength(4);
		expect(new Set(actionBounds.map(({ y }) => Math.round(y))).size).toBe(1);
		for (const bounds of actionBounds) {
			expect(bounds.x).toBeGreaterThanOrEqual(triggerBounds.x + triggerBounds.width - 1);
			expect(bounds.y + bounds.height).toBeGreaterThan(triggerBounds.y);
			expect(bounds.y).toBeLessThan(triggerBounds.y + triggerBounds.height);
		}

		expect(await presetSection.locator('.audio-editor-export-preset-actions').count()).toBe(0);
	});

	test('completes an import, effect, and undo workflow in German', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/de/');
		await importFiles(editor, [monoTone]);
		await chooseNestedCommandAction(page, editor, 'Effekt', ['Spezial', 'Invertieren']);
		const effectDialog = page.getByRole('dialog', { name: 'Effekt anwenden', exact: true });
		await expect(effectDialog).toHaveCount(0);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(clipByName(editor, 'browser-mono-tone')).toBeVisible();
		await expect.poll(async () => (
			(await effectSourceMetadata(page)).some((source) => source.name.includes('Invertieren'))
		)).toBe(true);
		await editor.getByRole('button', { name: 'Rückgängig', exact: true }).click();
		await expect(clipByName(editor, monoTone.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('copies audio between project tabs through the shared session clipboard', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseCommandAction(page, editor, 'Edit', 'Copy');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor.getByRole('tablist', { name: 'Project tabs' }).getByRole('tab')).toHaveCount(2);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('project tabs provide roving focus and automatic keyboard activation', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		const tabs = editor.getByRole('tablist', { name: 'Project tabs' }).getByRole('tab');
		await expect(tabs).toHaveCount(2);
		const first = tabs.nth(0);
		const second = tabs.nth(1);
		await expect(first).toHaveAttribute('tabindex', '-1');
		await expect(second).toHaveAttribute('tabindex', '0');

		await second.focus();
		await page.keyboard.press('ArrowRight');
		await expect(first).toBeFocused();
		await expect(first).toHaveAttribute('aria-selected', 'true');
		await expect(first).toHaveAttribute('tabindex', '0');
		await expect(second).toHaveAttribute('tabindex', '-1');

		await page.keyboard.press('End');
		await expect(second).toBeFocused();
		await expect(second).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Home');
		await expect(first).toBeFocused();
		await expect(first).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowLeft');
		await expect(second).toBeFocused();
		await expect(second).toHaveAttribute('aria-selected', 'true');
		expect(errors).toEqual([]);
	});

	test('keeps settled playback smooth without redrawing clip waveforms or producing long tasks', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await showToolbarButton(page, editor, 'Split at playhead');
		await importFiles(editor, [toneA]);
		await seekOnRuler(page, editor, 60);
		await editor.getByRole('button', { name: 'Split at playhead' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		test.skip(!await page.evaluate(() => PerformanceObserver.supportedEntryTypes?.includes('longtask')), 'The Long Task API is unavailable in this browser.');
		await page.evaluate(() => {
			globalThis.__playbackWaveformDraws = 0;
			const prototype = CanvasRenderingContext2D.prototype;
			const clearRect = prototype.clearRect;
			prototype.clearRect = function countPlaybackWaveformDraws(...args) {
				if (this.canvas?.matches('canvas.clip-body__waveform')) globalThis.__playbackWaveformDraws += 1;
				return clearRect.apply(this, args);
			};
		});

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await page.waitForTimeout(500);
		// Keep both probes on the same post-startup playback window.
		await page.evaluate(() => {
			globalThis.__audioEditorLongTasks = [];
			globalThis.__playbackWaveformDraws = 0;
			globalThis.__audioEditorLongTaskObserver = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) globalThis.__audioEditorLongTasks.push(entry.duration);
			});
			globalThis.__audioEditorLongTaskObserver.observe({ type: 'longtask', buffered: false });
		});
		const playheadPositions = await page.evaluate(async () => {
			const line = document.querySelector('[data-playhead] .playhead-cursor__line');
			const positions = [];
			const startedAt = performance.now();
			await new Promise((resolve) => {
				const sample = () => {
					positions.push(line?.getBoundingClientRect().x || 0);
					if (performance.now() - startedAt >= 350) resolve();
					else requestAnimationFrame(sample);
				};
				requestAnimationFrame(sample);
			});
			return positions;
		});
		const playbackMetrics = await page.evaluate(() => {
			for (const entry of globalThis.__audioEditorLongTaskObserver.takeRecords()) {
				globalThis.__audioEditorLongTasks.push(entry.duration);
			}
			globalThis.__audioEditorLongTaskObserver.disconnect();
			return {
				longTasks: [...globalThis.__audioEditorLongTasks],
				waveformDraws: globalThis.__playbackWaveformDraws,
			};
		});
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(new Set(playheadPositions.map((position) => position.toFixed(1))).size).toBeGreaterThan(10);
		expect(playbackMetrics.waveformDraws).toBe(0);
		expect(playbackMetrics.longTasks).toEqual([]);
		expect(errors).toEqual([]);
	});

	test('keeps mono selections mono when applying Audacity effects', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const effectDialog = await openSelectionEffectDialog(page, editor);
		// The effect names the dialog from its header rather than from a second
		// copy of its own title inside the body.
		await expect(effectDialog.locator('.dialog-header__title')).toHaveText('Bass and Treble');
		await effectDialog.getByRole('button', { name: 'Apply to selection' }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(effectDialog).toBeHidden();
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Bass and Treble'))?.channelCount).toBe(1);
		await expect.poll(async () => effectSourcePeak(page, 'Bass and Treble')).toBeGreaterThan(0.33);
		expect(errors).toEqual([]);
	});

	test('renders a local WAV mix when OfflineAudioContext is available', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		test.skip(!await page.evaluate(() => typeof globalThis.OfflineAudioContext === 'function' || typeof globalThis.webkitOfflineAudioContext === 'function'), 'OfflineAudioContext is unavailable in this browser.');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 15_000 });
		await expect(download).toHaveAttribute('download', /\.wav$/);
		const bytes = await readDownloadBytes(page, download);
		expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
		expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE');
		expect(bytes.length).toBeGreaterThan(44);
		expect(errors).toEqual([]);
	});

	test('falls back to bounded realtime WAV rendering without OfflineAudioContext', async ({ page }) => {
		await disableNativeSavePicker(page);
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		const header = new TextDecoder().decode((await readDownloadBytes(page, download)).subarray(0, 4));
		expect(header).toBe('RIFF');
		expect(errors).toEqual([]);
	});

	test('validates export choices and cancels a realtime render', async ({ page }) => {
		await disableNativeSavePicker(page);
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const exportDialog = await openExportDialog(page, editor);

		// One delivery choice: the whole project, or one file per track. There is
		// no selection, no loop and no label, so nothing else is deliverable.
		await exportDialog.locator('[data-export-field="output"]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(2);
		await expect(page.getByRole('option', { name: 'Current selection' })).toHaveCount(0);
		await expect(page.getByRole('option', { name: 'Chapters (split by labels)' })).toHaveCount(0);
		await expect(exportDialog.locator('[data-export-field="output"]').getByRole('button')).toContainText('Entire project');
		await page.keyboard.press('Escape');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'FLAC');
		await exportDialog.locator('[data-export-field="bitDepth"]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(1);
		await expect(page.getByRole('option', { name: '32-bit Float' })).toHaveCount(0);
		await expect(exportDialog.locator('[data-export-field="bitDepth"]').getByRole('button')).toContainText('24-bit PCM');
		await page.keyboard.press('Escape');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');

		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		const cancel = exportDialog.getByRole('button', { name: 'Cancel export' });
		await expect(cancel).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(cancel).toBeVisible();
		const [dialogBounds, editorBounds] = await Promise.all([exportDialog.boundingBox(), editor.boundingBox()]);
		expect(dialogBounds).not.toBeNull();
		expect(editorBounds).not.toBeNull();
		await page.mouse.click(
			Math.max(editorBounds.x + 2, dialogBounds.x - 8),
			dialogBounds.y + dialogBounds.height / 2,
		);
		await expect(cancel).toBeVisible();
		await cancel.click();
		await expect(exportDialog.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 10_000 });
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('indexeddb-multitab-writer moves the project lock to the newest tab', async ({ page, context }) => {
		const first = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, first, 'Tracks', ['Add new track', 'Audio track']);
		await expect(first.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		const secondPage = await context.newPage();
		await secondPage.goto('/embed/en/');
		const second = secondPage.locator('[data-audio-editor]');
		await expect(second).toHaveAttribute('data-audio-editor-bound', 'true');
		const secondRecord = second.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(secondRecord).toBeEnabled();
		await expect(second.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		const firstRecord = first.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(firstRecord).toBeDisabled({ timeout: 5_000 });
		await expect(firstRecord).toHaveAttribute('aria-label', /read-only/i);
		await expect(first.locator('[data-status]')).toContainText('already open in another tab');

		await page.close();
		await expect(second.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 5_000 });
		await expect(secondRecord).toBeEnabled();
		await secondPage.close();
	});

	test('refreshes an untouched default project without becoming read-only', async ({ page }) => {
		let editor = await bootEditor(page, '/en/');
		let record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(record).toBeEnabled();

		await page.reload();
		editor = await waitForEditor(page);
		record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		expect(await record.isEnabled()).toBe(true);
		await expect(editor.locator('[data-status]')).not.toContainText('already open in another tab');
	});

	test('refreshes an untouched default project with fallback leases', async ({ page, context }) => {
		await context.addInitScript(() => {
			Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
		});
		await bootEditor(page, '/en/');

		await page.reload();
		const editor = await waitForEditor(page);
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		expect(await record.isEnabled()).toBe(true);
		await expect(editor.locator('[data-status]')).not.toContainText('already open in another tab');
	});

	test('records a bounded AudioWorklet take onto the active track when arm controls are hidden', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					async getUserMedia() {
						const context = new AudioContext({ sampleRate: 48_000 });
						const oscillator = context.createOscillator();
						const gain = context.createGain();
						const merger = context.createChannelMerger(2);
						const destination = context.createMediaStreamDestination();
						oscillator.frequency.value = 440;
						gain.gain.value = 0.1;
						oscillator.connect(gain);
						gain.connect(merger, 0, 0);
						gain.connect(merger, 0, 1);
						merger.connect(destination);
						oscillator.start();
						await context.resume();
						const [track] = destination.stream.getAudioTracks();
						const getSettings = track.getSettings.bind(track);
						Object.defineProperty(track, 'getSettings', {
							configurable: true,
							value: () => ({ ...getSettings(), channelCount: 2, sampleRate: 48_000 }),
						});
						return destination.stream;
					},
				},
			});
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		const tracks = editor.locator('[data-track-row]');
		await expect(tracks).toHaveCount(2);
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		await expect(editor).toHaveAttribute('data-timeline-view', 'spectrogram');
		await expect(editor.getByRole('button', { name: /^Arm for recording:/ })).toHaveCount(0);
		const record = editor.getByRole('button', { name: 'Record onto the active track' });
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		const recordingPreview = tracks.nth(1).locator('[data-clip-id^="recording-preview-"]');
		await expect(recordingPreview).toBeVisible({ timeout: 10_000 });
		const recordingWaveform = recordingPreview.locator('canvas').first();
		await expect(recordingWaveform).toBeVisible();
		await expect(recordingWaveform).toHaveAttribute('data-waveform-renderer', 'audacity');
		await expect(recordingWaveform).toHaveAttribute('data-waveform-mode', 'summary');
		await page.waitForTimeout(350);
		await editor.evaluate((element) => {
			element.tabIndex = -1;
			element.focus();
		});
		await page.keyboard.press('Space');
		await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(recordingPreview).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(tracks.nth(0).locator('[data-clip-id]')).toHaveCount(0);
		await expect(tracks.nth(1).locator('[data-clip-id]')).toHaveCount(1);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect(tracks.nth(1).locator('[data-clip-id]')).toHaveCount(0);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(tracks.nth(1).locator('[data-clip-id]')).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('has named, keyboard-reachable controls in initial, populated, menu, effects, and dialog states', async ({ page }) => {
		test.setTimeout(90_000);
		await page.addInitScript(() => {
			localStorage.setItem('audacity-accessibility-profile', 'wcag-flat');
		});
		const editor = await bootEditor(page, '/embed/en/');
		const flatHeadings = editor.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem');
		expect(await flatHeadings.evaluateAll((items) => items.filter((item) => item.tabIndex === 0).length)).toBe(await flatHeadings.count());
		await flatHeadings.filter({ hasText: /^File$/ }).focus();
		await page.keyboard.press('ArrowDown');
		await expect(getMenuItem(page.getByRole('menu', { name: 'File', exact: true }), 'New')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(flatHeadings.filter({ hasText: /^Edit$/ })).toBeFocused();
		await expect(page.getByRole('menu', { name: 'File', exact: true })).toBeHidden();
		await assertAccessibleBasics(editor);
		await assertNoSeriousAxeViolations(page);
		await importFiles(editor, [toneA]);
		await assertAccessibleBasics(editor);
		await assertNoSeriousAxeViolations(page);

		await setDocumentTheme(page, 'dark');
		await editor.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'File', exact: true }).click();
		await assertAccessibleBasics(page.locator('body'));
		await assertNoSeriousAxeViolations(page);
		await getMenuItem(page.getByRole('menu', { name: 'File', exact: true }), 'Local projects').click();
		await assertAccessibleBasics(page.getByRole('dialog', { name: 'Local projects' }));
		await assertNoSeriousAxeViolations(page);
		await page.getByRole('dialog', { name: 'Local projects' }).getByRole('button', { name: 'Close' }).click();

		const effectsPanel = await openEffectsForTrack(editor, 1);
		await assertAccessibleBasics(effectsPanel);
		await assertNoSeriousAxeViolations(page);
		await openRackPicker(effectsPanel, 'track');
		await assertAccessibleBasics(page.getByRole('menu', { name: 'Choose an effect' }));
		await assertNoSeriousAxeViolations(page);
		await page.keyboard.press('Escape');
		await closeEffectsPanel(effectsPanel);

		const clipDialog = await openClipProperties(page, editor, clipByName(editor, toneA.name));
		await assertAccessibleBasics(clipDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(clipDialog);

		const effectDialog = await openSelectionEffectDialog(page, editor);
		await assertAccessibleBasics(effectDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(effectDialog);

		const analysisPanel = await openAnalysisPanel(page, editor);
		await assertAccessibleBasics(analysisPanel);
		await assertNoSeriousAxeViolations(page);
		await closeWorkspacePanel(editor, 'analysis');

		const exportDialog = await openExportDialog(page, editor);
		await assertAccessibleBasics(exportDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(exportDialog);
	});

	test('matches the desktop, tablet, and mobile editor shells in light and dark themes', async ({ page }, testInfo) => {
		test.skip(
			process.platform !== 'linux' || testInfo.project.name !== 'chromium',
			'The canonical visual baselines are maintained by the Ubuntu CI Chromium run.',
		);
		test.setTimeout(60_000);
		const editor = await bootEditor(page, '/embed/en/');
		// The storage bar is a Help > Debug storage opt-in, so the maintained
		// baselines show the default chrome without it.
		await expect(editor.locator('[data-storage-capacity]')).toHaveCount(0);
		await editor.locator('[data-import-input]').setInputFiles([toneA]);
		await expect(editor.locator('[data-project-bin-item]')).toHaveCount(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.evaluate(() => document.fonts.ready);
		await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });

		for (const viewport of [
			{ label: 'desktop', width: 1440, height: 1000 },
			{ label: 'tablet', width: 930, height: 1000 },
			{ label: 'mobile', width: 390, height: 844 },
		]) {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await waitForResponsiveEditorLayout(editor);
			for (const theme of ['light', 'dark']) {
				await setDocumentTheme(page, theme);
				await expect(editor).toHaveScreenshot(`audio-editor-${viewport.label}-${theme}.png`, {
					animations: 'disabled',
					caret: 'hide',
					maxDiffPixelRatio: 0.015,
				});
			}
		}
	});

	test('generates a complete MP3 with the dedicated browser codec', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'MP3');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = exportDialog.locator('[data-export-download]');
		const failure = exportDialog.locator('.audio-editor-field-error');
		await expect(download.or(failure)).toBeVisible({ timeout: 60_000 });
		expect(await failure.allTextContents()).toEqual([]);
		await expect(download).toHaveAttribute('download', /\.mp3$/);
		const bytes = await readDownloadBytes(page, download);
		const head = new TextDecoder().decode(bytes.subarray(0, 3));
		expect(head === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)).toBe(true);
		expect(bytes.length).toBeGreaterThan(256);
		expect(errors).toEqual([]);
	});
});

import { expect, monoTone, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseFileAction,
	chooseNestedCommandAction,
	clickClipInterior,
	clipByName,
	closeDialog,
	closeEffectsPanel,
	collectClientErrors,
	effectSourceMetadata,
	getMenuItem,
	importFiles,
	openAnalysisPanel,
	openExportDialog,
	registerAudioEditorHooks,
	setDocumentTheme,
} from './audio-editor-test-helpers.js';

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('suppresses the browser context menu across the editor', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('.audio-editor-ruler-corner')).toBeVisible();
		const prevented = await editor.evaluate((element) => {
			const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
			element.querySelector('.audio-editor-ruler-corner')?.dispatchEvent(event);
			return event.defaultPrevented;
		});
		expect(prevented).toBe(true);
	});

	test('matches the Audacity menubar and AU4 keyboard navigation model', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('audacity-accessibility-profile', 'au4-tab-groups');
		});
		const editor = await bootEditor(page, '/embed/en/');
		const menubar = editor.getByRole('menubar', { name: 'Application menu' });
		const headings = menubar.getByRole('menuitem');
		const expectedHeadings = [
			'File',
			'Edit',
			'Select',
			'View',
			'Playback and recording',
			'Tracks',
			'Generate',
			'Effect',
			'Analyze',
			'Tools',
			'Help',
		];

		await expect(menubar).toBeVisible();
		await expect(headings).toHaveCount(expectedHeadings.length);
		expect(await headings.allTextContents()).toEqual(expectedHeadings);
		for (const heading of await headings.all()) {
			await expect(heading).toHaveAttribute('aria-haspopup', 'menu');
			await expect(heading).toHaveAttribute('aria-expanded', 'false');
		}
		expect(await headings.evaluateAll((items) => items.filter((item) => item.tabIndex >= 0).length)).toBe(1);

		const file = headings.filter({ hasText: /^File$/ });
		const tracks = headings.filter({ hasText: /^Tracks$/ });
		const help = headings.filter({ hasText: /^Help$/ });
		await file.focus();
		await page.keyboard.press('ArrowLeft');
		await expect(help).toBeFocused();
		await page.keyboard.press('Home');
		await expect(file).toBeFocused();
		await page.keyboard.press('End');
		await expect(help).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(file).toBeFocused();

		await page.keyboard.press('ArrowDown');
		let menu = page.getByRole('menu', { name: 'File', exact: true });
		await expect(menu).toBeVisible();
		await expect(file).toHaveAttribute('aria-expanded', 'true');
		const newProject = getMenuItem(menu, 'New');
		const clearData = getMenuItem(menu, 'Clear all local editor data');
		await expect(newProject).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(clearData).toBeFocused();
		await page.keyboard.press('Home');
		await expect(newProject).toBeFocused();
		await page.keyboard.press('End');
		await expect(clearData).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(newProject).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
		await expect(file).toBeFocused();
		await expect(file).toHaveAttribute('aria-expanded', 'false');

		await tracks.focus();
		await page.keyboard.press('ArrowDown');
		menu = page.getByRole('menu', { name: 'Tracks', exact: true });
		const addNewTrack = getMenuItem(menu, 'Add new track');
		await expect(addNewTrack).toBeFocused();
		await page.keyboard.press('ArrowRight');
		const trackSubmenu = addNewTrack.getByRole('menu');
		const firstTrackType = getMenuItem(trackSubmenu, 'Audio track');
		await expect(trackSubmenu).toBeVisible();
		await expect(firstTrackType).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(trackSubmenu).toBeHidden();
		await expect(addNewTrack).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
		await expect(tracks).toBeFocused();
		await expect(tracks).toHaveAttribute('aria-expanded', 'false');

		await file.focus();
		await page.keyboard.press('ArrowDown');
		await expect(newProject).toBeFocused();
		await page.keyboard.press('Tab');
		const toolToolbar = editor.locator('[data-editor-tool-toolbar]').getByRole('toolbar');
		const play = toolToolbar.getByRole('button', { name: 'Play', exact: true });
		await expect(page.getByRole('menu', { name: 'File', exact: true })).toBeHidden();
		await expect(play).toBeFocused();

		await expect(editor.getByRole('button', { name: 'Back five seconds', exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Forward five seconds', exact: true })).toHaveCount(0);
		const recordLevel = editor.locator('[data-side-recording-meter]').getByRole('button', { name: 'Record level', exact: true });
		await expect(recordLevel).toHaveAttribute('aria-expanded', 'false');
		await recordLevel.click();
		const recordLevelFlyout = editor.getByRole('dialog', { name: 'Record level', exact: true });
		const monitor = recordLevelFlyout.getByRole('checkbox', { name: 'Turn on input monitoring (hear yourself while recording)', exact: true });
		await expect(recordLevelFlyout).toBeVisible();
		await expect(monitor).toHaveAttribute('aria-checked', 'false');
		await monitor.click();
		await expect(monitor).toHaveAttribute('aria-checked', 'true');
		await expect(editor.getByRole('alert')).toContainText('Use headphones while monitoring');
		await monitor.click();
		await expect(monitor).toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Escape');
		await expect(recordLevel).toHaveAttribute('aria-expanded', 'false');

		const arm = editor.getByRole('button', { name: /^Arm for recording:/ });
		await expect(arm).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		await expect(arm).toHaveCount(1);
		await expect(arm).toHaveAttribute('aria-pressed', 'true');
	});

	test('reserves standalone Alt for the menubar without stealing modified shortcuts', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const file = editor.getByRole('menubar', { name: 'Application menu' })
			.getByRole('menuitem', { name: 'File', exact: true });
		const fullscreen = editor.getByRole('button', { name: 'Fullscreen', exact: true });

		await fullscreen.focus();
		await page.keyboard.down('Alt');
		await expect(fullscreen).toBeFocused();
		await page.keyboard.down('Shift');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.up('Shift');
		await page.keyboard.up('Alt');
		await expect(fullscreen).toBeFocused();

		await page.keyboard.press('Alt');
		await expect(file).toBeFocused();
		await fullscreen.focus();
		await page.keyboard.press('F10');
		await expect(file).toBeFocused();

		const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
		await search.focus();
		await expect(search).toBeFocused();
		await page.keyboard.press('Alt');
		await expect(search).toBeFocused();
	});

	test('keeps focus where it moved after a command when the closing frame lands late', async ({ page }) => {
		// A loaded runner can defer the frame that follows a menu command well past
		// the next control the operator reaches for, so pin that ordering here.
		await page.addInitScript(() => {
			const nativeFrame = globalThis.requestAnimationFrame.bind(globalThis);
			globalThis.requestAnimationFrame = (callback) => (globalThis.__delayEditorFrames
				? setTimeout(() => nativeFrame(callback), 150)
				: nativeFrame(callback));
		});
		const editor = await bootEditor(page, '/embed/en/');
		const view = editor.getByRole('menubar', { name: 'Application menu' })
			.getByRole('menuitem', { name: 'View', exact: true });
		const play = editor.locator('[data-editor-tool-toolbar]').getByRole('toolbar')
			.getByRole('button', { name: 'Play', exact: true });

		await page.evaluate(() => { globalThis.__delayEditorFrames = true; });
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		await play.focus();
		await expect(play).toBeFocused();
		await page.waitForTimeout(300);
		await expect(play).toBeFocused();

		// A command the operator does not follow up on still returns focus to its menu.
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		await expect(view).toBeFocused();
		await page.waitForTimeout(300);
		await expect(view).toBeFocused();
	});

	test('omits unavailable commands and opens project properties from File', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const menubar = editor.getByRole('menubar', { name: 'Application menu' });
		for (const [menuName, labels] of [
			['File', ['Close project', 'Export selected audio', 'Quit']],
			['View', ['Show piano roll']],
			['Tracks', ['Sync-lock tracks', 'MIDI track']],
			['Generate', ['Plugin manager']],
			['Effect', ['Plugin manager']],
			['Analyze', ['Plugin manager']],
			['Tools', [
				'Plugin manager',
				'Screenshot tools',
				'Run benchmark',
				'Reset configuration',
				'Sample data import',
				'Sample data export',
			]],
			['Help', ['Diagnostics', 'Check for updates']],
		]) {
			await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
			const menu = page.getByRole('menu', { name: menuName, exact: true });
			await expect(menu).toBeVisible();
			for (const label of labels) await expect(menu.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0);
			await page.keyboard.press('Escape');
		}

		await menubar.getByRole('menuitem', { name: 'File', exact: true }).click();
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		const projectProperties = getMenuItem(fileMenu, 'Project properties');
		await expect(projectProperties).not.toHaveAttribute('aria-disabled', 'true');
		await projectProperties.click();
		await expect(editor.locator('[data-workspace-panel="metadata"]')).toBeVisible();
	});

	test('imports configured raw PCM and composes regular annotations from Tools', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Tools', 'Import raw data');
		const rawDialog = page.getByRole('dialog', { name: 'Import raw data', exact: true });
		await expect(rawDialog).toBeVisible();
		await rawDialog.getByLabel('Raw PCM file').setInputFiles({
			name: 'pulse.raw', mimeType: 'application/octet-stream', buffer: Buffer.alloc(160),
		});
		await rawDialog.getByLabel('Sample rate').fill('8000');
		await rawDialog.getByRole('button', { name: 'Import', exact: true }).click();
		await expect(rawDialog).toBeHidden();
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });

		await chooseCommandAction(page, editor, 'Tools', 'Regular interval labels');
		const regularDialog = page.getByRole('dialog', { name: 'Regular interval labels', exact: true });
		await regularDialog.getByLabel('Start frame').fill('0');
		await regularDialog.getByLabel('End frame').fill('10');
		await regularDialog.getByLabel('Interval in frames').fill('2');
		await regularDialog.getByRole('button', { name: 'Create annotations', exact: true }).click();
		await expect(regularDialog).toBeHidden();
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Markers']);
		await expect(editor.getByRole('listbox', { name: 'Markers and named regions', exact: true }).getByRole('option')).toHaveCount(5);
		expect(errors).toEqual([]);
	});

	test('repeats the last generator and analyzer from their menus', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Generate', 'Tone');
		const generator = page.getByRole('dialog', { name: 'Tone', exact: true });
		await generator.locator('[data-generator-field="durationSeconds"] input').fill('0.01');
		await generator.getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
		await chooseCommandAction(page, editor, 'Generate', 'Repeat last generator');
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 15_000 });

		const analysis = await openAnalysisPanel(page, editor);
		await analysis.getByRole('button', { name: 'Analyze master', exact: true }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		await analysis.getByRole('button', { name: 'Close: Analysis', exact: true }).click();
		await chooseCommandAction(page, editor, 'Analyze', 'Repeat last analyzer');
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		expect(errors).toEqual([]);
	});

	test('reverts editor preferences from Help after confirmation without deleting the project', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const projectId = await editor.getAttribute('data-project-id');

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Appearance$/ }).click();
		await preferences.getByRole('radio', { name: 'Dark', exact: true }).click();
		await expect(editor).toHaveAttribute('data-editor-theme', 'dark');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();

		await chooseCommandAction(page, editor, 'Help', 'Revert to factory settings');
		const confirmation = page.getByRole('dialog', { name: 'Revert to factory settings', exact: true });
		await expect(confirmation).toContainText('Projects and audio files will not be deleted.');
		await confirmation.getByRole('button', { name: 'Revert settings', exact: true }).click();

		await expect(confirmation).toBeHidden();
		await expect(editor).toHaveAttribute('data-editor-theme', 'system');
		await expect(editor).toHaveAttribute('data-workspace-preset', 'modern');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
	});

	test('opens timer recording as a reachable future-time workflow', async ({ page }) => {
		await page.addInitScript(() => {
			globalThis.__timedInputRequests = 0;
			globalThis.__timedInputTrackStopped = false;
			let readyState = 'live';
			const track = new EventTarget();
			Object.defineProperties(track, {
				kind: { value: 'audio' },
				readyState: { get: () => readyState },
				getSettings: { value: () => ({ channelCount: 1, sampleRate: 48_000 }) },
				stop: { value: () => {
					if (readyState === 'ended') return;
					readyState = 'ended';
					globalThis.__timedInputTrackStopped = true;
					track.dispatchEvent(new Event('ended'));
				} },
			});
			const stream = {
				getAudioTracks: () => [track],
				getTracks: () => [track],
			};
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					enumerateDevices: async () => [],
					getUserMedia: () => {
						globalThis.__timedInputRequests += 1;
						return new Promise((resolve) => {
							globalThis.__resolveTimedInput = () => resolve(stream);
						});
					},
				},
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await editor.getByRole('menuitem', { name: 'Set up timed recording', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('opens the recording input immediately');
		const start = dialog.locator('input[type="datetime-local"]');
		await expect(start).toHaveValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/);
		await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__timedInputRequests)).toBe(1);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor.locator('[data-status]')).toContainText('Scheduled recording cancelled');
		await page.evaluate(() => globalThis.__resolveTimedInput());
		await expect.poll(() => page.evaluate(() => globalThis.__timedInputTrackStopped)).toBe(true);
		await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button')).toHaveAttribute('aria-pressed', 'false');
	});

	test('runs the Nyquist prompt and a bundled Legacy processor through the production WASM boundary', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
		let dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('PCM sandbox');
		const source = dialog.getByRole('textbox', { name: 'Nyquist source', exact: true });
		await source.fill('42');
		await dialog.getByRole('button', { name: 'Run', exact: true }).click();
		await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('42', { timeout: 20_000 });
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

		await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
		dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
		await expect(dialog.getByRole('textbox', { name: 'Nyquist source', exact: true })).toHaveValue('42');
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Nyquist', 'Tremolo']);
		dialog = page.getByRole('dialog', { name: 'Tremolo', exact: true });
		await expect(dialog.getByRole('spinbutton', { name: 'Frequency (Hz)', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Nyquist result.', { timeout: 20_000 });
		await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('1 channel(s)');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-clip-id]')).toContainText('Tremolo');
		await expect.poll(async () => (
			(await effectSourceMetadata(page)).find((storedSource) => storedSource.name.includes('Tremolo'))?.channelCount
		)).toBe(1);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, monoTone.name)).toHaveCount(1);

		await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Pluck']);
		dialog = page.getByRole('dialog', { name: 'Pluck', exact: true });
		await expect(dialog.getByRole('spinbutton', { name: 'Pluck MIDI pitch', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

		await chooseNestedCommandAction(page, editor, 'Analyze', ['Nyquist', 'Beat Finder']);
		dialog = page.getByRole('dialog', { name: 'Beat Finder', exact: true });
		await expect(dialog.getByRole('spinbutton', { name: 'Threshold Percentage', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('cancels a bundled Nyquist action while its source fetch is delayed', async ({ page }) => {
		const errors = collectClientErrors(page);
		let releaseFetch;
		let markRequested;
		let markRouteDone;
		const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
		const sourceRequested = new Promise((resolve) => { markRequested = resolve; });
		const routeDone = new Promise((resolve) => { markRouteDone = resolve; });
		let wasmRequests = 0;
		await page.route(/tremolo[^/]*\.ny(?:\?.*)?$/i, async (route) => {
			markRequested();
			await fetchGate;
			try {
				await route.continue();
			} catch (error) {
				if (!/abort|cancel|closed|handled/i.test(String(error?.message || error))) throw error;
			} finally {
				markRouteDone();
			}
		});
		await page.route(/nyquist[^/]*\.wasm(?:\?.*)?$/i, async (route) => {
			wasmRequests += 1;
			await route.continue();
		});

		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		const originalClip = clipByName(editor, monoTone.name);
		const originalClipId = await originalClip.getAttribute('data-clip-id');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Nyquist', 'Tremolo']);
		const dialog = page.getByRole('dialog', { name: 'Tremolo', exact: true });
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await sourceRequested;
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		releaseFetch();
		await routeDone;
		await page.waitForTimeout(500);

		await expect(editor.locator('[data-status]')).toHaveText('Effect preview cancelled.');
		await expect(clipByName(editor, monoTone.name)).toHaveAttribute('data-clip-id', originalClipId);
		await expect(editor.locator('[data-clip-id]')).not.toContainText('Tremolo');
		expect((await effectSourceMetadata(page)).some((storedSource) => storedSource.name.includes('Tremolo'))).toBe(false);
		expect(wasmRequests).toBe(0);
		expect(errors).toEqual([]);
	});

	test('keeps the Record flyout and Effect menu clear of clicked-button tooltips', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const menubar = editor.getByRole('menubar', { name: 'Application menu' });

		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await expect(editor.locator('.kw-audio-editor__button-tooltip')).toHaveCount(0);
		await page.keyboard.press('Escape');
		for (const name of ['Effect']) {
			await menubar.getByRole('menuitem', { name, exact: true }).click();
			await expect(editor.locator('.kw-audio-editor__application-menu')).toBeVisible();
			await expect(editor.locator('.kw-audio-editor__button-tooltip')).toHaveCount(0);
			await page.keyboard.press('Escape');
		}
	});

	test('hydrates once, dispatches one action, exposes the Audacity command surface, and follows live theme changes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');

		await expect(editor.getByRole('button', { name: 'Mixer (unavailable)' })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Share (unavailable)' })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Audio setup (unavailable)' })).toHaveCount(0);
		await expect(editor.getByRole('toolbar', { name: 'Project toolbar' })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Home', exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Project', exact: true })).toHaveCount(0);
		await expect(editor.getByRole('tablist', { name: 'Project tabs' })).toBeVisible();
		await expect(editor.getByRole('tab', { name: 'Untitled project' })).toHaveAttribute('aria-selected', 'true');
		const menubar = editor.getByRole('menubar', { name: 'Application menu' });
		await expect(menubar).toBeVisible();
		for (const menu of ['File', 'Edit', 'Select', 'View', 'Tracks', 'Generate', 'Effect', 'Analyze', 'Tools', 'Help']) {
			await expect(menubar.getByRole('menuitem', { name: menu, exact: true })).toBeVisible();
		}
		await expect(menubar.getByRole('menuitem', { name: 'Record', exact: true })).toHaveCount(0);
		await expect(menubar.getByRole('menuitem', { name: 'Extra', exact: true })).toHaveCount(0);
		const selectionToolbar = editor.locator('[data-selection-toolbar]');
		await expect(selectionToolbar.getByRole('toolbar', { name: 'Selection toolbar' })).toBeVisible();
		await expect(selectionToolbar.locator('[data-status]')).toHaveText('Editor ready. Create a project or import audio.');

		const openChooserPromise = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await openChooserPromise).setFiles([]);
		await page.keyboard.press('Escape');
		await chooseFileAction(page, editor, 'Local projects');
		const projectsDialog = page.getByRole('dialog', { name: 'Local projects' });
		await expect(projectsDialog).toBeVisible();
		await projectsDialog.getByRole('button', { name: 'Close' }).click();

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);
		await chooseCommandAction(page, editor, 'Effect', 'Add track effects');
		const commandEffects = editor.locator('[data-workspace-panel="effects"]');
		await expect(commandEffects.getByRole('region', { name: 'Effects panel', exact: true })).toBeVisible();
		await closeEffectsPanel(commandEffects);

		await setDocumentTheme(page, 'light');
		const applicationHeader = editor.locator('.kw-audio-editor__application-header');
		const lightBackground = await applicationHeader.evaluate((element) => getComputedStyle(element).getPropertyValue('--header-bg'));
		await setDocumentTheme(page, 'dark');
		const darkBackground = await applicationHeader.evaluate((element) => getComputedStyle(element).getPropertyValue('--header-bg'));
		expect(darkBackground).not.toBe(lightBackground);

		const exportDialog = await openExportDialog(page, editor);
		await exportDialog.locator('[data-export-field="format"]').getByRole('button').click();
		const portal = page.getByRole('listbox');
		await expect(portal).toBeVisible();
		await expect(portal).toHaveCSS('--dropdown-menu-bg', '#202126');
		await page.keyboard.press('Escape');
		await closeDialog(exportDialog);
		expect(errors).toEqual([]);
	});

	test('supports split-tool tap and press-and-hold interaction', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const timeline = editor.locator('.audio-editor-timeline-panel');
		const splitButton = editor.getByRole('button', { name: 'Split tool', exact: true });
		await editor.locator('.kw-audio-editor__keyboard-help').focus();

		await page.keyboard.press('s');
		await expect(timeline).toHaveAttribute('data-split-tool', 'true');
		await expect(splitButton).toHaveAttribute('aria-pressed', 'true');
		await clickClipInterior(page, clipByName(editor, toneA.name), 0.35);
		await expect(editor).toHaveAttribute('data-clip-count', '2');

		await page.keyboard.press('s');
		await expect(timeline).toHaveAttribute('data-split-tool', 'false');
		await expect(splitButton).toHaveAttribute('aria-pressed', 'false');
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await editor.locator('.kw-audio-editor__keyboard-help').focus();

		await page.keyboard.down('s');
		await expect(timeline).toHaveAttribute('data-split-tool', 'true');
		await page.waitForTimeout(350);
		await clickClipInterior(page, clipByName(editor, toneA.name), 0.65);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await page.keyboard.up('s');
		await expect(timeline).toHaveAttribute('data-split-tool', 'false');
		await expect(splitButton).toHaveAttribute('aria-pressed', 'false');
		expect(errors).toEqual([]);
	});

	test('keeps a split clip at its released position on its original track', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const splitButton = editor.getByRole('button', { name: 'Split tool', exact: true });
		await splitButton.click();
		await clickClipInterior(page, clipByName(editor, toneA.name), 0.35);
		await splitButton.click();

		const clips = editor.locator('[data-track-row]').nth(1).locator('[data-clip-id]');
		await expect(clips).toHaveCount(2);
		const rightClip = clips.nth(1);
		const clipBox = await rightClip.boundingBox();
		expect(clipBox).not.toBeNull();
		const headerBox = await rightClip.locator('.clip-header').boundingBox();
		expect(headerBox).not.toBeNull();
		const startX = headerBox.x + Math.min(headerBox.width / 2, 40);
		const startY = headerBox.y + headerBox.height / 2;

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX + 25, startY, { steps: 4 });
		await page.mouse.up();

		await expect.poll(async () => (await rightClip.boundingBox())?.x || 0).toBeGreaterThan(clipBox.x + 15);
		expect(errors).toEqual([]);
	});

	test('edits clip-glued volume automation with the Audacity envelope tool', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const automation = editor.getByRole('button', { name: 'Clip gain', exact: true });
		await automation.click();
		await expect(automation).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.locator('.audio-editor-timeline-panel')).toHaveAttribute('data-automation-tool', 'true');

		const clip = clipByName(editor, toneA.name);
		const envelope = clip.locator('.envelope-overlay');
		await expect(envelope).toBeVisible();
		const envelopeBox = await envelope.boundingBox();
		expect(envelopeBox).toBeTruthy();
		const curveY = await envelope.locator('path').evaluate((path) => (
			Number(path.getAttribute('d')?.match(/^M [^,]+,([^ ]+)/)?.[1])
		));
		await page.mouse.click(
			envelopeBox.x + envelopeBox.width * 0.5,
			envelopeBox.y + curveY,
		);
		await expect(clip.locator('.envelope-point')).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	for (const locale of [
		{
			path: '/embed/en/',
			selectMenu: 'Select',
			spectralMenu: 'Spectral',
			label: 'Spectral brush',
			optionsLabel: 'Spectrogram options',
		},
		{
			path: '/embed/de/',
			selectMenu: 'Auswählen',
			spectralMenu: 'Spektral',
			label: 'Spektralpinsel',
			optionsLabel: 'Optionen für Spektrogramm',
		},
	]) {
		test(`${locale.path} opts into the spectral brush from its menu`, async ({ page }) => {
			const editor = await bootEditor(page, locale.path);
			const spectrogram = editor.getByRole('button', { name: /^(Spectrogram|Spektrogramm)$/ });
			await spectrogram.click();
			await expect(spectrogram).toHaveAttribute('aria-pressed', 'true');
			await editor.getByRole('button', { name: locale.optionsLabel, exact: true }).click();
			await expect(editor.locator('[data-action-id="spectral-brush"]')).toHaveCount(0);
			await page.keyboard.press('Escape');
			await chooseNestedCommandAction(page, editor, locale.selectMenu, [locale.spectralMenu, locale.label]);
			const brush = editor.locator('[data-spectral-brush]');
			await expect(brush).toBeVisible();
			await expect(brush).toHaveAccessibleName(locale.label);
			await brush.focus();
			await page.keyboard.press('Enter');
			await expect(editor.locator('[data-spectral-selection]')).toBeVisible();
		});
	}

	test('builds the shortcut command inventory from implemented manifest actions', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const search = preferences.getByRole('searchbox', { name: 'Search commands', exact: true });

		await search.fill('Insert');
		const insert = preferences.locator('[data-shortcut-action="insert"]');
		await expect(insert).toBeVisible();
		await expect(insert).not.toHaveAttribute('aria-disabled', 'true');
		const insertShortcut = insert.locator('input');
		await expect(insertShortcut).toBeEnabled();
		await insertShortcut.fill('Alt+I');
		await expect(insert.getByRole('button', { name: 'Assign', exact: true })).toBeEnabled();
		await expect(insert.locator('[data-shortcut-disabled-reason]')).toHaveCount(0);

		await search.fill('Zoom normal');
		await expect(preferences.locator('[data-shortcut-action="zoom-default"]')).toBeVisible();
		await expect(preferences.locator('[data-shortcut-action="plugin-manager"]')).toHaveCount(0);
		await search.fill('Nyquist prompt');
		await expect(preferences.locator('[data-shortcut-action="nyquist-prompt"]')).toBeVisible();
	});
});

import {
	AUDIO_EDITOR_PATHS,
	expect,
	monoTone,
	test,
	toneA,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	closeDialog,
	collectClientErrors,
	escapeRegex,
	importFiles,
	registerAudioEditorHooks,
	serveTranslationFixture,
	trackNameText,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('uses branded navigation standalone and a chrome-free embed surface', async ({ page }) => {
		await page.goto('/en/');
		await expect(page.locator('.site-sidebar')).toBeVisible();
		await expect(page.locator('.brand')).toContainText('Soundscaper');
		await expect(page.locator('link[rel="icon"][href="/logo/logo-klein-schwarz.svg"]')).toHaveAttribute('media', '(prefers-color-scheme: light)');
		await expect(page.locator('link[rel="icon"][href="/logo/logo-klein-weiß.svg"]')).toHaveAttribute('media', '(prefers-color-scheme: dark)');

		await page.goto('/embed/en/');
		await expect(page.locator('.site-sidebar')).toHaveCount(0);
		await expect(page.locator('.tool-intro')).toBeHidden();
		await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true');
	});

	test('keeps a non-dismissible warning visible when project storage is ephemeral', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(globalThis, 'indexedDB', {
				configurable: true,
				value: undefined,
			});
		});

		let editor = await bootEditor(page, '/embed/en/');
		let warning = editor.locator('[data-storage-ephemeral-warning]');
		await expect(warning).toBeVisible();
		await expect(warning).toHaveAttribute('role', 'alert');
		await expect(warning).toHaveText('Persistent local storage is unavailable. Changes will be lost when this page is closed or reloaded.');
		await expect(warning.getByRole('button')).toHaveCount(0);

		await page.reload();
		editor = await waitForEditor(page);
		warning = editor.locator('[data-storage-ephemeral-warning]');
		await expect(warning).toBeVisible();
		await expect(warning.getByRole('button')).toHaveCount(0);
	});

	test('uses the Framescaper video workspace from the site sidebar', async ({ page }) => {
		await page.goto('/framescaper/en/');
		const editor = await waitForEditor(page);
		const workspaceSelect = page.locator('[data-sidebar] [data-workspace-select]');
		const settingsSection = page.locator('[data-sidebar] .sidebar-settings');
		await expect(workspaceSelect).toBeEnabled();
		await expect(settingsSection.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
		await expect(settingsSection.getByRole('button', { name: 'Switch color theme', exact: true })).toBeVisible();
		await expect(settingsSection.getByRole('combobox', { name: 'Language', exact: true })).toBeVisible();
		await expect(settingsSection.getByRole('combobox', { name: 'Workspace', exact: true })).toBeVisible();
		const [sidebarBounds, settingsBounds] = await Promise.all([
			page.locator('[data-sidebar]').boundingBox(),
			settingsSection.boundingBox(),
		]);
		expect(sidebarBounds).not.toBeNull();
		expect(settingsBounds).not.toBeNull();
		expect(sidebarBounds.y + sidebarBounds.height - settingsBounds.y - settingsBounds.height).toBeLessThanOrEqual(32);
		await expect(workspaceSelect.locator('option')).toHaveText(['Video editor']);
		await expect(editor.locator('[data-action-id="playback-bpm"]')).toHaveCount(0);
		await expect(editor.locator('[data-action-id="playback-time-signature"]')).toHaveCount(0);

		await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
		await expect(editor.locator('[data-action-id="playback-bpm"]')).toHaveCount(0);
		await expect(editor.locator('[data-action-id="playback-time-signature"]')).toHaveCount(0);
		const videoWorkspace = editor.locator('[data-video-workspace]');
		const projectBin = videoWorkspace.locator('[data-video-workspace-panel="project-bin"]');
		const videoPreview = videoWorkspace.locator('[data-video-workspace-panel="video-preview"]');
		await expect(projectBin).toBeVisible();
		await expect(videoPreview).toBeVisible();
		await expect(videoPreview.locator('[data-video-preview]')).toContainText('Add video to the timeline to see a preview.');

		const [projectBinBounds, videoPreviewBounds, actionBarBounds, toolbarBounds, workspaceBounds] = await Promise.all([
			projectBin.boundingBox(),
			videoPreview.boundingBox(),
			editor.locator('.kw-audio-editor__action-bar').boundingBox(),
			editor.locator('[data-toolbar-dock="top"]').boundingBox(),
			editor.locator('.kw-audio-editor__workspace').boundingBox(),
		]);
		expect(projectBinBounds).not.toBeNull();
		expect(videoPreviewBounds).not.toBeNull();
		expect(actionBarBounds).not.toBeNull();
		expect(toolbarBounds).not.toBeNull();
		expect(workspaceBounds).not.toBeNull();
		expect(projectBinBounds.x).toBeLessThan(videoPreviewBounds.x);
		expect(Math.abs(projectBinBounds.y - videoPreviewBounds.y)).toBeLessThanOrEqual(1);
		expect(actionBarBounds.y + actionBarBounds.height).toBeLessThanOrEqual(projectBinBounds.y + 1);
		expect(projectBinBounds.y + projectBinBounds.height).toBeLessThanOrEqual(toolbarBounds.y + 1);
		expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(workspaceBounds.y + 1);

		await expect(editor.locator('[data-side-playback-meter]')).toBeVisible();
		await expect(editor.locator('[data-side-recording-meter]')).toHaveCount(0);
	});

	test('keeps timeline context menus interactive above the Framescaper video preview', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/framescaper/en/');
		const editor = await waitForEditor(page);
		await importFiles(editor, [toneA]);

		const videoPreview = editor.locator('[data-video-workspace-panel="video-preview"]');
		const clip = clipByName(editor, toneA.name);
		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		const clipMenu = page.locator('.audio-editor-clip-context-menu');
		await expect(clipMenu).toBeVisible();
		await expect(editor.locator('[data-editor-overlay-layer] > .audio-editor-clip-context-menu')).toHaveCount(1);
		const [previewBounds, menuBounds] = await Promise.all([
			videoPreview.boundingBox(),
			clipMenu.boundingBox(),
		]);
		expect(previewBounds).not.toBeNull();
		expect(menuBounds).not.toBeNull();
		expect(menuBounds.y).toBeLessThan(previewBounds.y + previewBounds.height);
		expect(menuBounds.y + menuBounds.height).toBeGreaterThan(previewBounds.y);

		await clipMenu.getByRole('menuitem', { name: 'Clip properties', exact: true }).click();
		const clipDialog = page.getByRole('dialog', { name: 'Clip properties', exact: true });
		await expect(clipDialog).toBeVisible();
		await closeDialog(clipDialog);
		expect(errors).toEqual([]);
	});

	test('persists sidebar collapse and synchronizes the initial dark-mode toggle state', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('soundscaper_theme', 'dark'));
		await page.goto('/en/');

		const sidebar = page.locator('[data-sidebar]');
		const themeToggle = page.getByRole('button', { name: 'Switch color theme', exact: true });
		await expect(themeToggle).toHaveAttribute('aria-pressed', 'true');
		await expect(themeToggle).toContainText('Dark');

		const collapse = page.getByRole('button', { name: 'Collapse navigation', exact: true });
		await collapse.click();
		await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
		await expect(sidebar.locator('[data-sidebar-collapse]')).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeVisible();

		await page.reload();
		await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
	});

	test('loads verified LTR and RTL catalogs before binding the editor', async ({ page }) => {
		let releasePackResponse;
		const packResponseGate = new Promise((resolve) => { releasePackResponse = resolve; });
		await serveTranslationFixture(page, {
			fr: { name: 'Français', direction: 'ltr', messages: { play: 'Lecture' } },
			ar: { name: 'العربية', direction: 'rtl', messages: { play: 'تشغيل' } },
		}, { waitForPack: () => packResponseGate });

		await page.goto('/embed/fr/');
		await expect(page.locator('[data-audio-editor]')).toHaveCount(0);
		await expect(page.getByRole('status')).toHaveText('Loading project');
		releasePackResponse();
		let editor = await waitForEditor(page);
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
		await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
		await expect(editor.getByRole('button', { name: 'Lecture', exact: true })).toBeVisible();

		editor = await bootEditor(page, '/embed/ar/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
		await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
		await expect(editor.getByRole('button', { name: 'تشغيل', exact: true })).toBeVisible();
		const fileMenu = editor.getByRole('menuitem', { name: 'File', exact: true });
		const editMenu = editor.getByRole('menuitem', { name: 'Edit', exact: true });
		const [fileBox, editBox] = await Promise.all([fileMenu.boundingBox(), editMenu.boundingBox()]);
		expect(fileBox).not.toBeNull();
		expect(editBox).not.toBeNull();
		expect(fileBox.x).toBeGreaterThan(editBox.x);
		await fileMenu.focus();
		await fileMenu.press('ArrowLeft');
		await expect(editMenu).toBeFocused();
		await editMenu.press('Enter');
		await expect(editMenu).toHaveAttribute('aria-expanded', 'true');
		const editLeaf = editor.locator('.kw-audio-editor__application-menu').getByRole('menuitem', { name: /^Undo\b/ });
		await editLeaf.focus();
		await editLeaf.press('ArrowRight');
		await expect(fileMenu).toHaveAttribute('aria-expanded', 'true');
		await expect(editor.locator('.audio-editor-timeline-scroll')).toHaveCSS('direction', 'ltr');
		await expect(editor.locator('.audio-editor-track-controls').first()).toHaveCSS('direction', 'rtl');
		await importFiles(editor, [monoTone]);
		const playhead = editor.locator('[data-playhead]');
		await playhead.focus();
		await playhead.press('ArrowRight');
		await expect(playhead).toHaveAttribute('aria-valuenow', '1');
	});

	test('overlays verified Audacity German copy on the complete bundled fallback', async ({ page }) => {
		await serveTranslationFixture(page, {
			de: { name: 'Deutsch', direction: 'ltr', messages: { play: 'Audacity-Wiedergabe' } },
		});

		const editor = await bootEditor(page, '/embed/de/');
		await expect(editor.getByRole('button', { name: 'Audacity-Wiedergabe', exact: true })).toBeVisible();
		await expect(editor.getByRole('button', { name: 'Optionen für Audacity-Wiedergabe', exact: true })).toBeVisible();
		await expect(editor.getByRole('button', { name: 'Optionen für Spektrogramm', exact: true })).toBeVisible();
		await expect(editor.getByRole('button', { name: 'Vollbild', exact: true })).toBeVisible();
	});

	test('shows localized Flyout tooltips only while an editor button is hovered', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const play = editor.getByRole('button', { name: 'Play', exact: true });
		const tooltip = editor.locator('.kw-audio-editor__button-tooltip');

		await expect(tooltip).toHaveCount(0);
		await play.hover();
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toHaveAttribute('role', 'tooltip');
		await expect(tooltip.locator('[data-audio-editor-button-tooltip]')).toHaveText('Play');
		await expect(tooltip).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

		await editor.locator('[data-action="mixer"] button').hover();
		await expect(tooltip.locator('[data-audio-editor-button-tooltip]')).toHaveText('Mixer');

		await page.mouse.move(0, 0);
		await expect(tooltip).toHaveCount(0);
	});

	test('standalone locale selector only navigates to committed eligible routes', async ({ page }) => {
		await serveTranslationFixture(page, {
			fr: { name: 'Français', direction: 'ltr', messages: { play: 'Lecture' } },
			ar: { name: 'العربية', direction: 'rtl', messages: { play: 'تشغيل' } },
		});
		await page.goto('/en/');
		const selector = page.locator('[data-locale-select]');
		await expect(selector.locator('option[value="fr"]')).toHaveText('Français');
		await selector.selectOption('fr');
		await page.waitForURL('**/fr/');
		await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true');
	});

	test('keeps the current committed locale selected when the translation manifest is unavailable', async ({ page }) => {
		await bootEditor(page, '/ar/');
		const selector = page.locator('[data-locale-select]');
		await expect(selector).toHaveValue('ar');
		await expect(selector.locator('option[value="ar"]')).toHaveText('العربية');
	});

	test('keeps persisted project names stable when the URL locale changes', async ({ page }) => {
		await serveTranslationFixture(page, {
			fr: { name: 'Français', direction: 'ltr', messages: { play: 'Lecture', untitledProject: 'Projet sans titre' } },
		});
		let editor = await bootEditor(page, '/embed/en/');
		const trackName = trackNameText(editor).first();
		await trackName.dblclick();
		await editor.locator('[data-track-name] input').fill('Stable name');
		await editor.locator('[data-track-name] input').press('Enter');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		editor = await bootEditor(page, '/embed/fr/');
		await expect(trackNameText(editor).first()).toHaveText('Stable name');
	});

	for (const locale of AUDIO_EDITOR_PATHS) {
		test(`${locale.path} hydrates one writable editor without asset or client errors`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, locale.path);

			await expect(page.locator('[data-audio-editor]')).toHaveCount(1);
			await expect(editor.locator('[data-project-name]')).toHaveText(locale.projectName);
			await expect(editor.locator('[data-status]')).toHaveText(locale.status);
			await expect(editor.locator('[data-track-row]')).toHaveCount(1);
			await expect(trackNameText(editor).first()).toHaveText(locale.trackName);
			await expect(editor.getByRole('button', { name: new RegExp(`^${escapeRegex(locale.arm)}:`) })).toHaveCount(0);
			await expect(editor.getByRole('button', { name: locale.fullscreen, exact: true })).toBeVisible();
			await expect(page.locator('body')).toHaveClass(/kw-audio-editor-design-system-mounted/);
			expect(errors).toEqual([]);
		});
	}
});

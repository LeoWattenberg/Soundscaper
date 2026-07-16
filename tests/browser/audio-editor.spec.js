import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAup3Fixture } from '../aup3-fixture.js';
import { aup4NativeRichFixture } from '../fixtures/aup4-native-rich.js';

const AUDIO_EDITOR_PATHS = [
	{
		path: '/embed/en/',
		projectName: 'Untitled project',
		trackName: 'Track 1',
		status: 'Editor ready. Create a project or import audio.',
		arm: 'Arm for recording',
		fullscreen: 'Fullscreen',
	},
	{
		path: '/embed/de/',
		projectName: 'Unbenanntes Projekt',
		trackName: 'Spur 1',
		status: 'Editor bereit. Erstelle ein Projekt oder importiere Audio.',
		arm: 'Für Aufnahme aktivieren',
		fullscreen: 'Vollbild',
	},
];

function createWavFixture({ name, frequency, duration = 0.8, sampleRate = 48_000, channelCount = 2 }) {
	const frameCount = Math.round(duration * sampleRate);
	const bytesPerSample = 2;
	const dataLength = frameCount * channelCount * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataLength);

	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
	buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
	buffer.writeUInt16LE(bytesPerSample * 8, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataLength, 40);

	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const phase = channel === 0 ? 0 : Math.PI / 3;
			const sample = Math.sin(2 * Math.PI * frequency * frame / sampleRate + phase) * 0.35;
			const offset = 44 + (frame * channelCount + channel) * bytesPerSample;
			buffer.writeInt16LE(Math.round(sample * 32767), offset);
		}
	}

	return { name, mimeType: 'audio/wav', buffer };
}

const toneA = createWavFixture({ name: 'browser-tone-a.wav', frequency: 330 });
const toneB = createWavFixture({ name: 'browser-tone-b.wav', frequency: 660 });
const monoTone = createWavFixture({ name: 'browser-mono-tone.wav', frequency: 440, channelCount: 1 });
const longTone = createWavFixture({ name: 'browser-long-tone.wav', frequency: 220, duration: 8, channelCount: 1 });
const captionLabels = {
	name: 'browser-captions.srt',
	mimeType: 'application/x-subrip',
	buffer: Buffer.from([
		'1',
		'00:00:00,250 --> 00:00:01,500',
		'Intro caption',
		'',
		'2',
		'00:00:02,000 --> 00:00:03,250',
		'Outro caption',
		'',
	].join('\n')),
};
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test.describe('audio editor React/design-system workflows', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

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

	test('keeps time selection available on empty tracks', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const lane = editor.locator('.audio-editor-track-row [data-track-lane]').first();
		const box = await lane.boundingBox();
		expect(box).not.toBeNull();

		await page.mouse.move(box.x + 24, box.y + 48);
		await page.mouse.down();
		await page.mouse.move(box.x + 144, box.y + 48, { steps: 4 });
		await page.mouse.up();
		await expect(editor.getByRole('button', { name: 'Loop selection' })).toBeEnabled();
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

	test('routes browser zoom gestures to the project timeline', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const timeline = editor.locator('[data-timeline]');
		const timelinePanel = editor.locator('.audio-editor-timeline-panel');
		const normalWidth = await timeline.evaluate((element) => element.scrollWidth);

		await timelinePanel.evaluate((element) => { element.tabIndex = -1; element.focus(); });
		await page.keyboard.down('Control');
		await page.keyboard.press('=');
		await page.keyboard.up('Control');
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(normalWidth);

		await page.keyboard.down('Control');
		await page.keyboard.press('-');
		await page.keyboard.up('Control');
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBe(normalWidth);

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
		const monitorToggle = flyout.getByRole('checkbox', { name: 'Monitor input', exact: true });
		await monitorToggle.click();
		await expect(editor.locator('[data-input-meter]')).toHaveCount(0);
		await monitorToggle.click();
		await expect(editor.locator('[data-input-meter]')).toBeVisible();
		const playbackVolumeToggle = flyout.getByRole('checkbox', { name: 'Playback volume', exact: true });
		await playbackVolumeToggle.click();
		await expect(editor.locator('.kw-audio-editor__master-meter')).toHaveCount(0);
		await playbackVolumeToggle.click();
		await expect(editor.locator('.kw-audio-editor__master-meter')).toBeVisible();
	});

	test('exposes play at speed and persists its pitch behavior preference', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const playOptions = editor.getByRole('button', { name: 'Play options', exact: true });
		await playOptions.click();
		const control = editor.locator('[data-play-at-speed]');
		await expect(control).toBeVisible();
		const speed = control.getByRole('slider', { name: 'Playback speed', exact: true });
		await speed.fill('1.5');
		await expect(control.locator('output')).toHaveText('1.5×');
		await importFiles(editor, [monoTone]);

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();

		await playOptions.click();
		await editor.getByRole('menuitem', { name: 'Play at speed', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Pause', exact: true }).click();

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Editing$/ }).click();
		const mode = preferences.getByRole('group', { name: 'Play-at-speed pitch behavior', exact: true });
		await chooseDropdown(page, mode, 'Preserve pitch with StaffPad');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const reopened = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await reopened.getByRole('tab', { name: /Editing$/ }).click();
		await expect(reopened.getByRole('group', { name: 'Play-at-speed pitch behavior', exact: true }).getByRole('button')).toContainText('Preserve pitch with StaffPad');
	});

	test('mixes tracks through group and send buses with Audacity channel strips', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		const mixer = editor.locator('[data-mixer-panel]');
		await expect(mixer).toBeVisible();
		await expect(mixer.locator('.mixer-panel')).toBeVisible();
		await expect(mixer.locator('.mixer-channel')).toHaveCount(2);

		await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
		await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();
		await expect(mixer.locator('[data-mixer-bus]')).toHaveCount(0);
		await expect(mixer.locator('.kw-audio-editor__mixer-channel--group')).toHaveCount(1);
		await expect(mixer.locator('.kw-audio-editor__mixer-channel--send')).toHaveCount(1);
		await expect(mixer.locator('.mixer-panel__row-label').filter({ hasText: 'Sends' })).toHaveCount(1);

		const output = mixer.getByRole('combobox', { name: 'Output: Track 1', exact: true });
		await output.selectOption({ label: 'Group bus 1' });
		await expect(output).toHaveValue(/group-bus/);
		const sendLevel = mixer.getByRole('slider', { name: 'Send level: Track 1 → Send bus 1', exact: true });
		await sendLevel.press('ArrowUp');
		await expect(sendLevel).toHaveAttribute('aria-valuenow', '-59');
		const sendTarget = mixer.getByRole('combobox', { name: 'Sends: Track 1', exact: true });
		await expect(sendTarget).toHaveText('Send bus 1');

		await mixer.locator('.kw-audio-editor__mixer-channel--send .mixer-effect--empty .mixer-effect__dropdown').first().click();
		const effectsPanel = page.locator('.audio-editor-effects-overlay');
		await addRackEffect(page, effectsPanel, 'track', 'Reverb');
		await expect(mixer.locator('.kw-audio-editor__mixer-channel--send .mixer-effect--enabled')).toContainText('Reverb');
		expect(errors).toEqual([]);
	});

	test('keeps pinned recording routes synchronized between track and mixer selectors', async ({ page }) => {
		const errors = collectClientErrors(page);
		await stubDisplayCapture(page);
		let editor = await bootEditor(page, '/embed/en/');

		await expect(editor.locator('[data-recording-input-selectors]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Show arm buttons');

		const trackSelectors = editor.locator('.kw-recording-input-selectors--track').first();
		const trackSource = trackSelectors.getByRole('combobox', { name: 'Recording source: Track 1', exact: true });
		const trackChannel = trackSelectors.getByRole('combobox', { name: 'Channel: Track 1', exact: true });
		await expect(trackSource).toBeVisible();
		await expect(trackChannel).toBeDisabled();

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		let mixer = editor.locator('[data-mixer-panel]');
		const mixerSelectors = mixer.locator('.kw-recording-input-selectors--mixer').first();
		const mixerSource = mixerSelectors.getByRole('combobox', { name: 'Recording source: Track 1', exact: true });
		const mixerChannel = mixerSelectors.getByRole('combobox', { name: 'Channel: Track 1', exact: true });
		await expect(mixerSource).toHaveValue('');

		// The selectors are native comboboxes, so the complete routing workflow is
		// available from a keyboard without opening a custom pointer-only surface.
		await trackSource.focus();
		await expect(trackSource).toBeFocused();
		await trackSource.press('ArrowDown');
		await trackSource.press('Enter');
		await expect(trackSource).toHaveValue('display');
		await expect(mixerSource).toHaveValue('display');
		await expect(trackChannel).toHaveValue('0');
		await expect(mixerChannel).toHaveValue('0');
		await expect.poll(() => page.evaluate(() => globalThis.__soundscaperDisplayCaptureRequests)).toBe(1);

		const releaseInputs = mixer.getByRole('button', { name: 'Release inputs', exact: true });
		await expect(releaseInputs).toBeVisible();
		await expect(trackSelectors).toHaveAttribute('data-recording-input-health', 'open');
		await releaseInputs.click();
		await expect(releaseInputs).toHaveCount(0);
		await expect(trackSelectors).toHaveAttribute('data-recording-input-health', 'unavailable');

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor.locator('[data-recording-input-selectors]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Show arm buttons');
		await expect(editor.locator('.kw-recording-input-selectors--track').first()
			.getByRole('combobox', { name: 'Recording source: Track 1', exact: true })).toHaveValue('display');

		mixer = editor.locator('[data-mixer-panel]');
		if (!await mixer.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixer.locator('.kw-recording-input-selectors--mixer').first()
			.getByRole('combobox', { name: 'Recording source: Track 1', exact: true })).toHaveValue('display');
		await expect(mixer.getByRole('button', { name: 'Release inputs', exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('uses a full-height sidebar behind track controls', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const sidebar = editor.locator('.audio-editor-track-list');
		await expect(sidebar).toBeVisible();
		const dimensions = await sidebar.evaluate((element) => {
			const backing = getComputedStyle(element, '::before');
			return {
				backingHeight: Number.parseFloat(backing.height),
				listHeight: element.getBoundingClientRect().height,
				backingWidth: Number.parseFloat(backing.width),
				panelWidth: element.querySelector('[data-track-header]')?.getBoundingClientRect().width || 0,
			};
		});
		expect(dimensions.backingHeight).toBeCloseTo(dimensions.listHeight, 0);
		expect(dimensions.backingWidth).toBeCloseTo(dimensions.panelWidth, 0);
	});

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
		const monitor = toolToolbar.getByRole('button', { name: 'Monitor input', exact: true });
		await expect(monitor).toHaveAttribute('aria-pressed', 'false');
		await monitor.click();
		await expect(monitor).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.getByRole('alert')).toContainText('Use headphones while monitoring');
		await monitor.click();
		await expect(monitor).toHaveAttribute('aria-pressed', 'false');

		const arm = editor.getByRole('button', { name: /^Arm for recording:/ });
		await expect(arm).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Show arm buttons');
		await expect(arm).toHaveCount(1);
		await expect(arm).toHaveAttribute('aria-pressed', 'true');
	});

	test('omits unavailable project, view, track, and tool commands', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const menubar = editor.getByRole('menubar', { name: 'Application menu' });
		for (const [menuName, labels] of [
			['File', ['Close project', 'Save project as', 'Export selected audio', 'Quit']],
			['View', ['Show piano roll']],
			['Tracks', ['Sync-lock tracks', 'MIDI track']],
			['Generate', ['Plugin manager']],
			['Effect', ['Plugin manager']],
			['Analyze', ['Plugin manager']],
			['Tools', [
				'Plugin manager',
				'Screenshot tools',
				'Run benchmark',
				'Import raw data',
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
		const backup = getMenuItem(fileMenu, 'Backup project');
		await expect(backup).toHaveAttribute('aria-disabled', 'true');
		await expect(backup.locator('[data-disabled-reason]')).toHaveAttribute('title', /disabled placeholder/);
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
		await expect(start).toHaveValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
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
		await chooseNestedCommandAction(page, editor, 'Effect', ['Legacy', 'Tremolo']);
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
		await chooseNestedCommandAction(page, editor, 'Effect', ['Legacy', 'Tremolo']);
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

		await chooseFileAction(page, editor, 'Open');
		const projectsDialog = page.getByRole('dialog', { name: 'Local projects' });
		await expect(projectsDialog).toBeVisible();
		await projectsDialog.getByRole('button', { name: 'Close' }).click();

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);
		await chooseCommandAction(page, editor, 'Effect', 'Add track effects');
		const commandEffects = editor.locator('[data-effects-overlay]');
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

	test('routes manifest visibility commands to the live workspace and preserves the status-only surface', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const selectionSurface = editor.locator('[data-selection-toolbar]');

		await chooseNestedCommandAction(page, editor, 'View', ['Toolbars', 'Selection toolbar']);
		await expect(selectionSurface).toHaveCount(1);
		await expect(selectionSurface).toHaveClass(/status-only/);
		await expect(selectionSurface.getByRole('toolbar', { name: 'Selection toolbar' })).toHaveCount(0);
		await expect(selectionSurface.locator('[data-status]')).toHaveText('Editor ready. Create a project or import audio.');

		await chooseCommandAction(page, editor, 'View', 'Status bar');
		await expect(selectionSurface).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Toolbars', 'Selection toolbar']);
		await expect(selectionSurface.getByRole('toolbar', { name: 'Selection toolbar' })).toBeVisible();
		await expect(selectionSurface.locator('[data-status]')).toHaveText('');
		await chooseCommandAction(page, editor, 'View', 'Status bar');
		await expect(selectionSurface.locator('[data-status]')).toHaveText('Editor ready. Create a project or import audio.');

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Tracks panel']);
		await expect(editor.locator('.audio-editor-timeline-panel')).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Tracks panel']);
		await expect(editor.locator('.audio-editor-timeline-panel')).toBeVisible();
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

		await page.mouse.move(clipBox.x + 10, clipBox.y + 12);
		await page.mouse.down();
		await page.mouse.move(clipBox.x + 35, clipBox.y + 12, { steps: 4 });
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
		await expect(clip.locator('.envelope-overlay')).toBeVisible();
		const box = await clip.boundingBox();
		expect(box).toBeTruthy();
		// Standard clips place the design-system's non-linear 0 dB line about
		// 58 px below the top edge (20 px header plus the body curve offset).
		await page.mouse.click(box.x + box.width * 0.5, box.y + 58);
		await expect(clip.locator('.envelope-point')).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	for (const locale of [
		{
			path: '/embed/en/',
			label: 'Spectral brush',
			reason: /does not provide a usable handler yet/,
		},
		{
			path: '/embed/de/',
			label: 'Spektralpinsel',
			reason: /noch keine nutzbare Aktion bereit/,
		},
	]) {
		test(`${locale.path} keeps the upstream spectral brush visible and inert`, async ({ page }) => {
			const editor = await bootEditor(page, locale.path);
			const entry = editor.locator('[data-action-id="spectral-brush"]');
			await expect(entry).toBeVisible();
			await expect(entry).toHaveAttribute('aria-disabled', 'true');
			await expect(entry).toHaveAttribute('title', locale.reason);
			await expect(entry).toHaveAttribute('data-disabled-reason', locale.reason);
			await expect(entry.getByRole('button', { name: new RegExp(`^${escapeRegex(locale.label)}:`) })).toBeDisabled();
		});
	}

	test('builds the shortcut command inventory from manifest actions and keeps disabled commands inert', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const search = preferences.getByRole('searchbox', { name: 'Search commands', exact: true });

		await search.fill('Insert');
		const insert = preferences.locator('[data-shortcut-action="insert"]');
		const reason = /does not provide a usable handler yet/;
		await expect(insert).toBeVisible();
		await expect(insert).toHaveAttribute('aria-disabled', 'true');
		await expect(insert).toHaveAttribute('title', reason);
		await expect(insert).toHaveAttribute('data-disabled-reason', reason);
		await expect(insert.locator('input')).toBeDisabled();
		await expect(insert.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
		await expect(insert.locator('[data-shortcut-disabled-reason]')).toHaveText(reason);

		await search.fill('Zoom normal');
		await expect(preferences.locator('[data-shortcut-action="zoom-default"]')).toBeVisible();
		await expect(preferences.locator('[data-shortcut-action="plugin-manager"]')).toHaveCount(0);
		await search.fill('Nyquist prompt');
		await expect(preferences.locator('[data-shortcut-action="nyquist-prompt"]')).toBeVisible();
	});

	test('resizes docked panels, moves and resizes floating windows, and resizes editor dialogs', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');

		const mixerPanel = editor.locator('[data-workspace-panel="mixer"]');
		if (!await mixerPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		const bottomDock = editor.locator('[data-panel-dock="bottom"]');
		await expect(bottomDock).toHaveCSS('resize', 'none');
		const dockResizeHandle = bottomDock.locator('[data-workspace-dock-resize-handle="bottom"]');
		await expect(dockResizeHandle).toHaveCSS('cursor', 'ns-resize');
		await expect(mixerPanel).toHaveCSS('resize', 'none');
		const initialDockBounds = await bottomDock.boundingBox();
		expect(initialDockBounds).not.toBeNull();
		const initialMixerBounds = await mixerPanel.boundingBox();
		expect(initialMixerBounds).not.toBeNull();
		const initialMixerSize = Number(await mixerPanel.getAttribute('data-workspace-panel-size'));
		await page.mouse.move(initialDockBounds.x + initialDockBounds.width / 2, initialDockBounds.y + 2);
		await page.mouse.down();
		await page.mouse.move(initialDockBounds.x + initialDockBounds.width / 2, initialDockBounds.y - 66, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => Number(await mixerPanel.getAttribute('data-workspace-panel-size'))).toBeLessThan(initialMixerSize - 40);
		const resizedMixerSize = Number(await mixerPanel.getAttribute('data-workspace-panel-size'));
		await expect.poll(async () => (await bottomDock.boundingBox())?.height).toBeCloseTo(resizedMixerSize, 0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixerPanel).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		if (!await mixerPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixerPanel).toHaveAttribute('data-workspace-panel-size', String(resizedMixerSize));
		await expect.poll(async () => (await mixerPanel.boundingBox())?.width).toBeCloseTo(resizedMixerSize, 0);

		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const metadataPanel = editor.locator('[data-workspace-panel="metadata"]');
		await expect(metadataPanel).toBeVisible();
		await metadataPanel.locator('[data-workspace-panel-dock-picker="metadata"]').selectOption('floating');
		const floatingDock = editor.locator('[data-panel-dock="floating"]');
		await expect(floatingDock.locator('[data-workspace-panel-dock-picker="metadata"]')).toBeFocused();
		await expect(floatingDock).toHaveCSS('resize', 'none');
		await expect(floatingDock.locator('[data-workspace-panel="metadata"]')).toHaveCSS('resize', 'both');
		await expect(floatingDock.locator('[data-floating-panel-move-handle="metadata"]')).toHaveCSS('touch-action', 'none');
		const initialPanelWidth = Number(await metadataPanel.getAttribute('data-workspace-panel-width'));
		const initialPanelHeight = Number(await metadataPanel.getAttribute('data-workspace-panel-height'));
		const metadataBounds = await metadataPanel.boundingBox();
		expect(metadataBounds).not.toBeNull();
		await page.mouse.move(metadataBounds.x + metadataBounds.width - 2, metadataBounds.y + metadataBounds.height - 2);
		await page.mouse.down();
		await page.mouse.move(metadataBounds.x + metadataBounds.width - 42, metadataBounds.y + metadataBounds.height - 34, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-width'))).not.toBe(initialPanelWidth);
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-height'))).not.toBe(initialPanelHeight);

		const initialPanelX = Number(await metadataPanel.getAttribute('data-workspace-panel-x'));
		const initialPanelY = Number(await metadataPanel.getAttribute('data-workspace-panel-y'));
		const moveHandle = metadataPanel.locator('[data-floating-panel-move-handle="metadata"]');
		const moveBounds = await moveHandle.boundingBox();
		expect(moveBounds).not.toBeNull();
		await page.mouse.move(moveBounds.x + moveBounds.width / 2, moveBounds.y + moveBounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(moveBounds.x + moveBounds.width / 2 + 48, moveBounds.y + moveBounds.height / 2 + 32, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-x'))).toBeGreaterThan(initialPanelX + 30);
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-y'))).toBeGreaterThan(initialPanelY + 20);

		const workspace = editor.locator('.kw-audio-editor__workspace');
		const workspaceBounds = await workspace.boundingBox();
		const movedHandleBounds = await moveHandle.boundingBox();
		expect(workspaceBounds).not.toBeNull();
		expect(movedHandleBounds).not.toBeNull();
		await page.mouse.move(movedHandleBounds.x + movedHandleBounds.width / 2, movedHandleBounds.y + movedHandleBounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(workspaceBounds.x + workspaceBounds.width - 2, workspaceBounds.y + workspaceBounds.height - 2, { steps: 5 });
		await page.mouse.up();
		const clampedBounds = await metadataPanel.boundingBox();
		expect(clampedBounds.x + clampedBounds.width).toBeLessThanOrEqual(workspaceBounds.x + workspaceBounds.width + 1);
		expect(clampedBounds.y + clampedBounds.height).toBeLessThanOrEqual(workspaceBounds.y + workspaceBounds.height + 1);

		const keyboardMoveHandle = metadataPanel.locator('[data-workspace-panel-drag-handle="metadata"]');
		const keyboardStartX = Number(await metadataPanel.getAttribute('data-workspace-panel-x'));
		const keyboardStartY = Number(await metadataPanel.getAttribute('data-workspace-panel-y'));
		await keyboardMoveHandle.focus();
		await expect(metadataPanel).toHaveClass(/kw-audio-editor__workspace-panel--active/);
		await keyboardMoveHandle.press('ArrowLeft');
		await keyboardMoveHandle.press('ArrowUp');
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-x'))).toBe(keyboardStartX - 16);
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-y'))).toBe(keyboardStartY - 16);
		const keyboardResizeHandle = metadataPanel.locator('[data-floating-panel-resize-handle="metadata"]');
		const keyboardStartWidth = Number(await metadataPanel.getAttribute('data-workspace-panel-width'));
		const keyboardStartHeight = Number(await metadataPanel.getAttribute('data-workspace-panel-height'));
		await keyboardResizeHandle.focus();
		await keyboardResizeHandle.press('ArrowLeft');
		await keyboardResizeHandle.press('ArrowUp');
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-width'))).toBe(keyboardStartWidth - 16);
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-height'))).toBe(keyboardStartHeight - 16);

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const resizeHandle = preferences.getByRole('button', { name: 'Resize: Editor preferences', exact: true });
		await expect(resizeHandle).toBeVisible();
		const before = await preferences.boundingBox();
		await resizeHandle.focus();
		await resizeHandle.press('ArrowLeft');
		await resizeHandle.press('ArrowUp');
		const after = await preferences.boundingBox();
		expect(after.width).toBeCloseTo(before.width - 16, 0);
		expect(after.height).toBeCloseTo(before.height - 16, 0);
	});

	test('keeps compact side docks separate without toolbar group controls', async ({ page }) => {
		await page.setViewportSize({ width: 800, height: 900 });
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const historyDockPicker = editor.locator('[data-workspace-panel-dock-picker="history"]');
		if (!await historyDockPicker.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await historyDockPicker.selectOption('left');
		await expect(editor.locator('[data-panel-dock="left"] [data-workspace-panel-dock-picker="history"]')).toBeFocused();

		const leftDock = editor.locator('[data-panel-dock="left"]');
		const rightDock = editor.locator('[data-panel-dock="right"]');
		const [tabletLeft, tabletRight] = await Promise.all([leftDock.boundingBox(), rightDock.boundingBox()]);
		expect(tabletLeft).not.toBeNull();
		expect(tabletRight).not.toBeNull();
		expect(tabletLeft.x + tabletLeft.width).toBeLessThanOrEqual(tabletRight.x + 1);

		await page.setViewportSize({ width: 390, height: 844 });
		const [mobileLeft, mobileRight] = await Promise.all([leftDock.boundingBox(), rightDock.boundingBox()]);
		expect(mobileLeft).not.toBeNull();
		expect(mobileRight).not.toBeNull();
		expect(mobileLeft.y + mobileLeft.height).toBeLessThanOrEqual(mobileRight.y + 1);

		await page.setViewportSize({ width: 800, height: 900 });
		await expect(editor.locator('[data-workspace-toolbar-drag-handle]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await expect(preferences.getByRole('tab', { name: /Toolbars$/ })).toHaveCount(0);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();
		await expect(editor.locator('[data-workspace-toolbar]')).toHaveCount(4);
	});

	test('drags workspace panels between docks without subgroup toolbar grabbers', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');

		const historyPanel = editor.locator('[data-workspace-panel="history"]');
		const metadataPanel = editor.locator('[data-workspace-panel="metadata"]');
		if (!await historyPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await expect(historyPanel).toBeVisible();
		await expect(metadataPanel).toBeVisible();
		await metadataPanel.locator('[data-workspace-panel-drag-handle="metadata"]').dragTo(historyPanel, {
			targetPosition: { x: 120, y: 4 },
		});
		await expect.poll(() => editor.locator('[data-panel-dock="right"] [data-workspace-panel]').evaluateAll(
			(panels) => panels.map((panel) => panel.dataset.workspacePanel),
		)).toEqual(['metadata', 'history']);

		const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
		const metadataHandle = metadataPanel.locator('[data-workspace-panel-drag-handle="metadata"]');
		await metadataHandle.dispatchEvent('dragstart', { dataTransfer });
		const floatingTarget = editor.locator('[data-workspace-drop-target="floating"]');
		await expect(editor.locator('[data-workspace-drop-targets]')).toHaveClass(/--active/);
		await floatingTarget.dispatchEvent('dragover', { dataTransfer });
		await floatingTarget.dispatchEvent('drop', { dataTransfer });
		await expect(editor.locator('[data-panel-dock="floating"] [data-workspace-panel="metadata"]')).toBeVisible();

		const floatingHandle = editor.locator('[data-panel-dock="floating"] [data-workspace-panel-drag-handle="metadata"]');
		await floatingHandle.dispatchEvent('dragstart', { dataTransfer });
		const leftTarget = editor.locator('[data-workspace-drop-target="left"]');
		await leftTarget.dispatchEvent('dragover', { dataTransfer });
		await leftTarget.dispatchEvent('drop', { dataTransfer });
		await expect(editor.locator('[data-panel-dock="left"] [data-workspace-panel="metadata"]')).toBeVisible();

		await expect(editor.locator('[data-workspace-toolbar-drag-handle]')).toHaveCount(0);
		expect(errors).toEqual([]);
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
		for (const label of ['Zoom normal', 'Zoom to selection', 'Zoom toggle', 'Center view on playhead']) {
			await expect(getMenuItem(zoomMenu, label)).toBeVisible();
		}
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await expect(editor.getByRole('button', { name: 'Loop selection', exact: true })).toBeEnabled();
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
		const recordingLevel = editor.getByRole('slider', { name: 'Record level', exact: true });
		await recordingLevel.fill('1.37');
		await expect(recordingLevel).toHaveValue('1.37');
		await chooseNestedCommandAction(page, editor, 'View', ['Toolbars', 'Show microphone metering']);
		await expect(recordingLevel).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Toolbars', 'Show microphone metering']);
		await expect(recordingLevel).toHaveValue('1.37');

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);
		await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
		const labelsPanel = editor.locator('[data-workspace-panel="labels"]');
		await expect(labelsPanel).toBeVisible();
		await labelsPanel.getByRole('button', { name: 'New label', exact: true }).click();
		const labelRow = labelsPanel.locator('[data-labels-panel-list] [data-label-id]');
		await expect(labelRow).toHaveCount(1);
		await commitInput(labelRow.getByRole('textbox', { name: /^Label title:/ }), 'Verse');
		const rangeInputs = labelRow.getByRole('spinbutton');
		await commitInput(rangeInputs.nth(1), '0.500');
		await commitInput(rangeInputs.nth(0), '0.125');
		await expect(rangeInputs.nth(0)).toHaveValue('0.125');
		await expect(rangeInputs.nth(1)).toHaveValue('0.500');
		const timelineLabel = editor.locator('[data-label-track] [data-label-id]', { hasText: 'Verse' });
		await expect(timelineLabel).toBeVisible();
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
			await chooseFileAction(page, editor, 'Import labels');
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
		});

		await test.step('export the surviving cue as valid WebVTT', async () => {
			const [download] = await Promise.all([
				page.waitForEvent('download'),
				chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels', 'As WebVTT']),
			]);
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

		expect(errors).toEqual([]);
	});

	test('imports, edits, mixes track states, analyzes, and restores the autosaved project', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');

		await importFiles(editor, [toneA, toneB]);
		await expect(editor).toHaveAttribute('data-track-count', '3');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await expect(clipByName(editor, toneB.name)).toHaveCount(1);

		const firstClip = clipByName(editor, toneA.name);
		await firstClip.click({ position: { x: 24, y: 10 } });
		const clipDialog = await openClipProperties(page, editor, firstClip);
		await expect(clipDialog.locator('[data-clip-fields]')).toHaveAttribute('aria-disabled', 'false');
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('38400');
		await commitInput(clipField(clipDialog, 'startFrame'), '120');
		await expect(clipField(clipDialog, 'startFrame')).toHaveValue('120');
		await closeDialog(clipDialog);

		await seekOnRuler(editor, 48);
		await editor.getByRole('button', { name: 'Split at playhead' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await editor.getByRole('button', { name: 'Undo' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await editor.getByRole('button', { name: 'Redo' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '3');

		const secondImportedTrack = editor.locator('[data-track-row]').nth(2);
		await secondImportedTrack.getByRole('button', { name: 'Mute' }).click();
		await secondImportedTrack.getByRole('button', { name: 'Solo' }).click();
		await chooseCommandAction(page, editor, 'View', 'Show arm buttons');
		await secondImportedTrack.getByRole('button', { name: /^Arm for recording:/ }).click();
		await expect(secondImportedTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
		await expect(secondImportedTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.locator('button[aria-label^="Arm for recording:"][aria-pressed="true"]')).toHaveCount(2);

		const effectsPanel = await openEffectsForTrack(editor, 2);
		await commitInput(effectsPanel.locator('[data-master-gain] input'), '-3');
		await expect(effectsPanel.locator('[data-master-gain] input')).toHaveValue('-3.00');
		await closeEffectsPanel(effectsPanel);

		const analysisDialog = await openAnalysisDialog(page, editor);
		await analysisDialog.getByRole('button', { name: 'Analyze master' }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		await expect(analysisDialog.locator('[data-analysis-value="peak"]')).not.toHaveText('−∞ dBFS');
		await expect(analysisDialog.locator('[data-analysis-value="clipping"]')).toHaveText('0');
		await expect(analysisDialog.locator('[data-analysis-spectrum]')).toBeVisible();
		await expect(analysisDialog.locator('[data-analysis-spectrogram]')).toBeVisible();
		await closeDialog(analysisDialog);

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		await expect(restored).toHaveAttribute('data-track-count', '3');
		await expect(restored).toHaveAttribute('data-clip-count', '3');
		const restoredSecondTrack = restored.locator('[data-track-row]').nth(2);
		await expect(restoredSecondTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
		await expect(restoredSecondTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
		await chooseCommandAction(page, restored, 'View', 'Show arm buttons');
		await expect(restoredSecondTrack.getByRole('button', { name: /^Arm for recording:/ })).toHaveAttribute('aria-pressed', 'true');
		expect(errors).toEqual([]);
	});

	test('splits stereo audio, traverses undo history, recombines it, and restores the result', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');

		await test.step('import and split a stereo clip into panned mono tracks', async () => {
			await importFiles(editor, [toneA]);
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Track channels', 'Split stereo to L/R mono']);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
			await expect(editor).toHaveAttribute('data-track-count', '3');
			await expect(editor).toHaveAttribute('data-clip-count', '2');
			await expect(trackNameText(editor).filter({ hasText: / — Left$/ })).toHaveCount(1);
			await expect(trackNameText(editor).filter({ hasText: / — Right$/ })).toHaveCount(1);
		});

		await test.step('undo and redo the complete channel rewrite', async () => {
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-track-count', '2');
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(trackNameText(editor).filter({ hasText: / — (?:Left|Right)$/ })).toHaveCount(0);

			await editor.getByRole('button', { name: 'Redo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-track-count', '3');
			await expect(editor).toHaveAttribute('data-clip-count', '2');
		});

		await test.step('recombine the mono pair and persist the stereo project', async () => {
			await editor.locator('.audio-editor-track-controls').nth(1).click();
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Track channels', 'Make stereo track']);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
			await expect(editor).toHaveAttribute('data-track-count', '2');
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(trackNameText(editor).filter({ hasText: / — Right$/ })).toHaveCount(0);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

			await page.reload();
			editor = await waitForEditor(page);
			await expect(editor).toHaveAttribute('data-track-count', '2');
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(trackNameText(editor).filter({ hasText: / — Right$/ })).toHaveCount(0);
		});

		expect(errors).toEqual([]);
	});

	test('imports an uppercase AUP3 project as structured tracks and clips', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const fixture = await createAup3Fixture();

		await importFiles(editor, [{
			name: 'Browser project.AUP3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(fixture),
		}]);
		await expect(editor.locator('[data-status]')).toContainText('Imported AUP3 tracks, clips, labels, and settings.');
		await expect(editor).toHaveAttribute('data-track-count', '1');
		await expect(trackNameText(editor).nth(0)).toHaveText('Fixture track');
		await expect(clipByName(editor, 'Audio 1')).toHaveCount(1);
		const clipDialog = await openClipProperties(page, editor, clipByName(editor, 'Audio 1'));
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('4');
		await closeDialog(clipDialog);
		expect(errors).toEqual([]);
	});

	test('opens an Audacity-created AUP4, saves it, and reopens the browser snapshot', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'audacity-native-rich.aup4',
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(aup4NativeRichFixture()),
		});
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '5');

		await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: undefined,
		}));
		const downloadPromise = page.waitForEvent('download');
		await chooseFileAction(page, editor, 'Save project as');
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.aup4$/i);
		const snapshotPath = await download.path();
		expect(snapshotPath).toBeTruthy();
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: download.suggestedFilename(),
			mimeType: 'application/x-audacity-project',
			buffer: await readFile(snapshotPath),
		});
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '5');
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
		const trimHandle = clip.locator('.clip-display__handle--trim-right');
		const trimBox = await trimHandle.boundingBox();
		expect(trimBox).not.toBeNull();
		await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(trimBox.x - 24, trimBox.y + trimBox.height / 2, { steps: 4 });
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
			name: `${toneA.name} clip`,
			exact: true,
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
		await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(trimBox.x - 24, trimBox.y + trimBox.height / 2, { steps: 4 });
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

	test('mixes selected tracks through the real browser graph and restores them with undo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const firstClip = clipByName(editor, toneA.name);
		const secondClip = clipByName(editor, toneB.name);
		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix', 'Mix-down to']);
		const mixedClip = clipByName(editor, 'Mix — Mix and render.wav');
		await expect(mixedClip).toBeVisible({ timeout: 20_000 });
		await expect(firstClip).toHaveCount(0);
		await expect(secondClip).toHaveCount(0);

		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect(clipByName(editor, toneB.name)).toBeVisible();
		await expect(mixedClip).toHaveCount(0);
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
		for (let step = 0; step < 9; step += 1) await zoomIn.click();
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

		const ruler = editor.locator('[data-ruler]');
		await ruler.scrollIntoViewIfNeeded();
		const rulerBox = await ruler.boundingBox();
		expect(rulerBox).not.toBeNull();
		await page.mouse.move(rulerBox.x + 22, rulerBox.y + 26);
		await page.mouse.down();
		await page.mouse.move(rulerBox.x + 82, rulerBox.y + 26, { steps: 4 });
		await page.mouse.up();
		await expect(editor.getByRole('button', { name: 'Loop selection' })).toBeEnabled();
		const selectionToolbar = editor.locator('[data-selection-toolbar]');
		await expect(selectionToolbar.locator('.timecode')).toHaveCount(3);
		await expect(selectionToolbar).toContainText('Selection');
		await expect(selectionToolbar).toContainText('Duration');

		const loopButton = editor.getByRole('button', { name: 'Loop selection', exact: true });
		await page.mouse.move(rulerBox.x + 22, rulerBox.y + 8);
		await page.mouse.down();
		await page.mouse.move(rulerBox.x + 82, rulerBox.y + 8, { steps: 4 });
		await page.mouse.up();
		await expect(loopButton).toHaveAttribute('aria-pressed', 'true');

		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		await playhead.scrollIntoViewIfNeeded();
		await playhead.focus();
		await page.keyboard.press('Home');
		await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		await page.mouse.click(rulerBox.x + 52, rulerBox.y + 8);
		await expect(loopButton).toHaveAttribute('aria-pressed', 'false');
		await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		await page.keyboard.press('ArrowRight');
		await expect(playhead).toHaveAttribute('aria-valuenow', '1');

		await page.keyboard.press('Home');
		const icon = editor.locator('[data-playhead] .playhead-cursor canvas');
		const iconBox = await icon.boundingBox();
		const currentRulerBox = await ruler.boundingBox();
		expect(iconBox).not.toBeNull();
		expect(currentRulerBox).not.toBeNull();
		expect(iconBox.y).toBeGreaterThanOrEqual(currentRulerBox.y);
		expect(iconBox.y + iconBox.height).toBeLessThanOrEqual(currentRulerBox.y + currentRulerBox.height + 1);
		await page.mouse.move(iconBox.x + iconBox.width / 2, iconBox.y + iconBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(iconBox.x + iconBox.width / 2 + 48, iconBox.y + iconBox.height / 2, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
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
		await editor.getByRole('button', { name: 'Spectrogram' }).click();
		await expect(editor).toHaveAttribute('data-timeline-view', 'spectrogram');
		await expect(editor.getByRole('button', { name: 'Spectrogram' })).toHaveAttribute('aria-pressed', 'true');

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
		await expect(editor.getByRole('tablist', { name: 'Project tabs' })).toBeVisible();
		await expect(editor.getByRole('tab')).toHaveCount(1);

		const mobileClip = clipByName(editor, toneA.name);
		const clipDialog = await openClipProperties(page, editor, mobileClip);
		await expectSurfaceWithinViewport(clipDialog, page);
		await page.keyboard.press('Escape');
		await expect(clipDialog).toBeHidden();
		await expect(mobileClip).toBeFocused();

		const effectsLauncher = editor.locator('[data-track-row]').nth(1).getByRole('button', { name: 'Effects', exact: true });
		const effectsPanel = await openEffectsForTrack(editor, 1);
		await expectSurfaceWithinViewport(
			effectsPanel.getByRole('region', { name: 'Effects panel', exact: true }),
			page,
		);
		await page.keyboard.press('Escape');
		await expect(effectsPanel).toBeHidden();
		await expect(effectsLauncher).toBeFocused();

		const firstTrack = editor.locator('[data-track-row]').first();
		const trackMenuButton = firstTrack.getByRole('button', { name: 'Track menu' });
		await trackMenuButton.click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu).toBeVisible();
		const [trackMenuButtonBox, trackMenuBox] = await Promise.all([trackMenuButton.boundingBox(), trackMenu.boundingBox()]);
		expect(trackMenuButtonBox).not.toBeNull();
		expect(trackMenuBox).not.toBeNull();
		expect(Math.abs(trackMenuBox.x - trackMenuButtonBox.x)).toBeLessThanOrEqual(1);
		expect(trackMenuBox.y).toBeGreaterThanOrEqual(trackMenuButtonBox.y + trackMenuButtonBox.height - 1);
		await page.getByRole('button', { name: 'Show arm buttons' }).click();
		await expect(firstTrack.getByRole('button', { name: /^Arm for recording:/ })).toBeVisible();
		await trackMenuButton.click();
		await page.getByRole('button', { name: 'Duplicate track' }).click();
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
		await expect(trackMenu.locator('[data-action-id="local://show-arm-controls"]')).toHaveAttribute(
			'data-parity-status',
			'supplemental',
		);
		await trackMenu.getByRole('button', { name: 'Show arm buttons', exact: true }).click();
		await expect(firstTrack.getByRole('button', { name: /^Arm for recording:/ })).toBeVisible();

		const clip = clipByName(editor, toneA.name);
		await clip.click({ position: { x: 24, y: 10 } });
		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		const clipMenu = page.locator('.audio-editor-clip-context-menu');
		const split = clipMenu.locator('[data-action-id="split"]');
		await expect(split).toHaveAttribute('data-parity-status', 'implemented');
		await expect(split).toHaveAttribute('data-enable-when', 'editable-selection-or-clip');
		await expect(split.locator('xpath=ancestor::div[@role="menuitem"]')).toContainText('S');
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

	test('edits per-track spectrogram settings and exposes adjustable spectral selection handles', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Spectrogram']);

		const panel = editor.locator('[data-workspace-panel="spectrogram"]');
		const settings = panel.locator('[data-spectrogram-settings]');
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

		const defaultTrackLane = editor.locator('.audio-editor-track-row [data-track-lane]').filter({ hasNot: editor.locator('[data-clip-id]') }).first();
		await defaultTrackLane.click({ position: { x: 8, y: 54 } });
		await expect(settings).toHaveAttribute('data-spectrogram-target', /^(?!defaults$).+/);
		await expect(settings.getByLabel('Scale', { exact: true })).toHaveValue('mel');
		await clipByName(editor, toneA.name).click({ position: { x: 24, y: 10 } });
		await expect(settings).toHaveAttribute('data-spectrogram-target', targetTrackId);
		await expect(settings.getByLabel('Scale', { exact: true })).toHaveValue('linear');

		const ruler = editor.locator('[data-ruler]');
		const rulerBox = await ruler.boundingBox();
		expect(rulerBox).not.toBeNull();
		await page.mouse.move(rulerBox.x + 30, rulerBox.y + 24);
		await page.mouse.down();
		await page.mouse.move(rulerBox.x + 110, rulerBox.y + 24, { steps: 4 });
		await page.mouse.up();
		await editor.getByRole('button', { name: 'Select spectral frequency range', exact: true }).click();
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

	test('duplicates, deletes, and opens local projects through accessible menus and dialogs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseFileAction(page, editor, 'Duplicate project');
		await expect(editor.locator('[data-project-name]')).toContainText('copy');
		await chooseFileAction(page, editor, 'Delete project');

		const confirm = page.getByRole('dialog', { name: 'Delete this project?' });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'Delete permanently' }).click();
		await expect(confirm).not.toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		await chooseFileAction(page, editor, 'Open');
		const projects = page.getByRole('dialog', { name: 'Local projects' });
		await expect(projects).toBeVisible();
		await expect(projects.locator('[data-project-list] li')).not.toHaveCount(0);
		await projects.getByRole('button', { name: 'Close' }).click();
		expect(errors).toEqual([]);
	});

	test('streams aligned WAV stems into a local ZIP archive', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="mode"]'), 'Individual stems (ZIP)');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();

		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		await expect(download).toHaveAttribute('download', /-stems-.*\.zip$/);
		const archive = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			return { signature: Array.from(bytes.subarray(0, 4)), length: bytes.length };
		});
		expect(archive.signature).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(archive.length).toBeGreaterThan(200);
		expect(errors).toEqual([]);
	});

	test('offers only supported rack effects and persists track and master effects', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		let effectsPanel = await openEffectsForTrack(editor, 0);

		await openRackPicker(effectsPanel, 'track');
		const picker = page.getByRole('dialog', { name: 'Choose an effect' });
		await picker.locator('[data-effect-type]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(22);
		await expect(page.getByRole('option', { name: 'Invert' })).toHaveCount(1);
		await expect(page.getByRole('option', { name: 'Paulstretch' })).toHaveCount(0);
		await page.getByRole('option', { name: 'Invert' }).click();
		await picker.getByRole('button', { name: 'Add effect' }).click();
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);

		await openRackPicker(effectsPanel, 'master');
		await chooseDropdown(page, page.getByRole('dialog', { name: 'Choose an effect' }).locator('[data-effect-type]'), 'Bass and Treble');
		await page.getByRole('dialog', { name: 'Choose an effect' }).getByRole('button', { name: 'Add effect' }).click();
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Bass and Treble' })).toHaveCount(1);
		const bassKnob = effectsPanel.locator('[data-effect-param="bassDb"]').getByRole('slider', { name: /Bass \(dB\):/ });
		await expect(bassKnob).toBeVisible();
		const bassKnobBox = await bassKnob.boundingBox();
		expect(bassKnobBox).not.toBeNull();
		await page.mouse.move(bassKnobBox.x + bassKnobBox.width / 2, bassKnobBox.y + bassKnobBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(bassKnobBox.x + bassKnobBox.width / 2 + 16, bassKnobBox.y + bassKnobBox.height / 2);
		await page.mouse.up();
		await expect.poll(async () => Number(await bassKnob.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await page.mouse.move(bassKnobBox.x + bassKnobBox.width / 2, bassKnobBox.y + bassKnobBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(bassKnobBox.x + bassKnobBox.width / 2 - 16, bassKnobBox.y + bassKnobBox.height / 2);
		await page.mouse.up();
		await expect.poll(async () => Number(await bassKnob.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(0);
		await commitInput(effectsPanel.locator('[data-effect-param="bassDb"] input'), '7.5');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 0);
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);
		const bassTreble = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Bass and Treble' });
		await expect(bassTreble).toHaveCount(1);
		await bassTreble.getByRole('button', { name: 'Select effect' }).click();
		await expect(effectsPanel.locator('[data-effect-param="bassDb"] input')).toHaveValue('7.5');
		expect(errors).toEqual([]);
	});

	test('copies an ordered effect stack between tracks and exports it as an Audacity macro', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		let effectsPanel = await openEffectsForTrack(editor, 1);

		await addRackEffect(page, effectsPanel, 'track', 'Invert');
		await addRackEffect(page, effectsPanel, 'track', 'Echo');
		const echoSettings = page.getByRole('dialog', { name: 'Echo', exact: true });
		await expect(echoSettings).toBeVisible();
		await commitInput(echoSettings.locator('[data-effect-param="delaySeconds"] input'), '0.75');
		await closeDialog(echoSettings);

		const sourceRack = effectsPanel.locator('[data-effect-rack]');
		const sourceStackTrigger = sourceRack.getByRole('button', { name: 'Effect stack options', exact: true }).first();
		await expect(sourceRack.getByRole('button', { name: 'Effect stack options', exact: true })).toHaveCount(2);
		let stackMenu = await openEffectStackMenu(effectsPanel, 'track');
		await expect(stackMenu.getByRole('menuitem', { name: 'Copy effects', exact: true })).toBeVisible();
		await expect(stackMenu.getByRole('menuitem', { name: 'Paste effects', exact: true })).toHaveAttribute('aria-disabled', 'true');
		await expect(stackMenu.getByRole('menuitem', { name: 'Export as macro', exact: true })).toBeVisible();
		await stackMenu.getByRole('menuitem', { name: 'Copy effects', exact: true }).click();
		await expect(sourceStackTrigger).toBeFocused();

		await closeEffectsPanel(effectsPanel);
		effectsPanel = await openEffectsForTrack(editor, 2);
		const targetStackTrigger = effectsPanel.locator('[data-effect-rack]')
			.getByRole('button', { name: 'Effect stack options', exact: true }).first();
		stackMenu = await openEffectStackMenu(effectsPanel, 'track');
		const paste = stackMenu.getByRole('menuitem', { name: 'Paste effects', exact: true });
		await expect(paste).toHaveAttribute('aria-disabled', 'false');
		await paste.click();
		await expect(targetStackTrigger).toBeFocused();

		const targetRack = effectsPanel.locator('[data-effect-rack]');
		await expect(targetRack.locator('.effect-slot__name-text')).toHaveText(['Invert', 'Echo']);
		await targetRack.getByRole('group', { name: 'Echo', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		const pastedEchoSettings = page.getByRole('dialog', { name: 'Echo', exact: true });
		await expect(pastedEchoSettings.locator('[data-effect-param="delaySeconds"] input')).toHaveValue('0.75');
		await closeDialog(pastedEchoSettings);

		stackMenu = await openEffectStackMenu(effectsPanel, 'track');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			stackMenu.getByRole('menuitem', { name: 'Export as macro', exact: true }).click(),
		]);
		expect(download.suggestedFilename()).toMatch(/browser-tone-b.*\.txt$/i);
		const downloadPath = await download.path();
		expect(downloadPath).not.toBeNull();
		await expect.poll(async () => readFile(downloadPath, 'utf8')).toBe(
			'Invert:\nEcho:Delay="0.75" Decay="0.5"\n',
		);
		expect(errors).toEqual([]);
	});

	test('manages Audacity effect macros with add, file, and run actions in the footer', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Tools', 'Manage macros');

		let manager = page.getByRole('dialog', { name: 'Manage macros', exact: true });
		await expect(manager).toBeVisible();
		await expect(page.locator('[data-editor-surface="macro-manager"]')).toBeVisible();
		const footer = manager.locator('.audio-editor-macro-manager__footer');
		await expect(footer.getByRole('button', { name: 'Effects', exact: true })).toBeVisible();
		await expect(footer.getByRole('button', { name: 'Import macro', exact: true }).locator('.icon[aria-hidden="true"]')).toHaveCount(1);
		await expect(footer.getByRole('button', { name: 'Export macro', exact: true }).locator('.icon[aria-hidden="true"]')).toHaveCount(1);
		await expect(footer.getByRole('button', { name: 'Run macro', exact: true })).toBeVisible();
		await expect(manager.locator('.audio-editor-controlled-dialog__body').getByRole('button', { name: 'Effects', exact: true })).toHaveCount(0);

		await footer.getByRole('button', { name: 'Effects', exact: true }).click();
		const picker = page.getByRole('dialog', { name: 'Choose an effect', exact: true });
		await chooseDropdown(page, picker.locator('[data-effect-type]'), 'Invert');
		await picker.getByRole('button', { name: 'Add effect', exact: true }).click();
		manager = page.getByRole('dialog', { name: 'Manage macros', exact: true });
		await expect(manager.locator('[data-macro-effect-stack]').getByRole('group', { name: 'Invert', exact: true })).toBeVisible();
		await expect(manager.getByRole('button', { name: 'Disable effect', exact: true })).toHaveCount(0);

		await manager.locator('input[type="file"]').setInputFiles({
			name: 'browser-chain.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('Echo:Delay="0.4" Decay="0.65"\nInvert:\n'),
		});
		await expect(manager.getByRole('status')).toHaveText('Macro imported.');
		await expect(manager.getByLabel('Macro name', { exact: true })).toHaveValue('browser-chain');
		await expect(manager.locator('.effect-slot__name-text')).toHaveText(['Echo', 'Invert']);
		await manager.getByLabel('Macro name', { exact: true }).focus();
		await page.keyboard.press('Tab');
		await expect(manager.getByRole('group', { name: 'Echo', exact: true })).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(manager.getByRole('group', { name: 'Invert', exact: true })).toBeFocused();

		await manager.locator('input[type="file"]').setInputFiles({
			name: 'oversized-chain.txt',
			mimeType: 'text/plain',
			buffer: Buffer.alloc((1024 * 1024) + 1, 0x49),
		});
		await expect(manager.getByRole('alert')).toContainText('The macro could not be imported:');
		await expect(manager.locator('.effect-slot__name-text')).toHaveText(['Echo', 'Invert']);

		await manager.getByRole('group', { name: 'Echo', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		const echoSettings = page.getByRole('dialog', { name: 'Echo', exact: true });
		await commitInput(echoSettings.locator('[data-effect-param="delaySeconds"] input'), '0.75');
		await closeDialog(echoSettings);

		manager = page.getByRole('dialog', { name: 'Manage macros', exact: true });
		await manager.getByLabel('Macro name', { exact: true }).fill('Browser chain');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			manager.getByRole('button', { name: 'Export macro', exact: true }).click(),
		]);
		expect(download.suggestedFilename()).toBe('Browser-chain.txt');
		const downloadPath = await download.path();
		expect(downloadPath).not.toBeNull();
		await expect.poll(async () => readFile(downloadPath, 'utf8')).toBe(
			'Echo:Delay="0.75" Decay="0.65"\nInvert:\n',
		);

		const runButton = manager.getByRole('button', { name: 'Run macro', exact: true });
		await runButton.click();
		await expect(runButton).toBeDisabled();
		await expect(manager.getByRole('status')).toHaveText('Macro applied.', { timeout: 20_000 });
		await expect(editor.locator('[data-clip-id]')).toContainText('Browser chain');
		await closeDialog(manager);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('captures and restores a rack Noise Reduction profile', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let effectsPanel = await openEffectsForTrack(editor, 1);
		await openRackPicker(effectsPanel, 'track');
		await chooseDropdown(page, page.getByRole('dialog', { name: 'Choose an effect' }).locator('[data-effect-type]'), 'Noise Reduction');
		await page.getByRole('dialog', { name: 'Choose an effect' }).getByRole('button', { name: 'Add effect' }).click();

		const reduction = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Noise Reduction' });
		await expect(reduction.getByRole('button', { name: 'Enable effect' })).toBeVisible();
		await effectsPanel.locator('[data-effect-noise-profile]').getByRole('button').click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(reduction.getByRole('button', { name: 'Disable effect' })).toBeVisible();
		await expect(effectsPanel.locator('[data-effect-noise-profile]')).toContainText('Replace noise profile');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 1);
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Noise Reduction' })).toContainText('Noise Reduction');
		expect(errors).toEqual([]);
	});

	test('applies an Audacity selection effect with undo and redo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const effectDialog = await openSelectionEffectDialog(page, editor);
		await expect(effectDialog.getByRole('heading', { name: 'Invert', exact: true })).toBeVisible();
		await effectDialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(editor.locator('[data-status]')).toHaveText('Playing effect preview.', { timeout: 20_000 });
		await effectDialog.getByRole('button', { name: 'Stop preview' }).click();
		await expect(editor.locator('[data-status]')).toHaveText('Effect preview cancelled.');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await effectDialog.getByRole('button', { name: 'Apply to selection' }).click();

		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20_000 });
		await expect(effectDialog).toBeHidden();
		await expect(editor.locator('[data-clip-id]')).toContainText('Invert');
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Invert'))?.channelCount).toBe(2);
		await editor.getByRole('button', { name: 'Undo' }).click();
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await editor.getByRole('button', { name: 'Redo' }).click();
		await expect(editor.locator('[data-clip-id]')).toContainText('Invert');
		expect(errors).toEqual([]);
	});

	test('completes an import, effect, and undo workflow in German', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/de/');
		await importFiles(editor, [monoTone]);
		await chooseNestedCommandAction(page, editor, 'Effekt', ['Spezial', 'Invertieren']);
		const effectDialog = page.getByRole('dialog', { name: 'Effekt anwenden', exact: true });
		await expect(effectDialog).toBeVisible();
		await effectDialog.getByRole('button', { name: 'Auf Auswahl anwenden', exact: true }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(editor.locator('[data-clip-id]')).toContainText('Invertieren');
		await editor.getByRole('button', { name: 'Rückgängig', exact: true }).click();
		await expect(clipByName(editor, monoTone.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('copies audio between project tabs through the shared session clipboard', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await editor.getByRole('button', { name: 'Copy', exact: true }).click();
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor.getByRole('tablist', { name: 'Project tabs' }).getByRole('tab')).toHaveCount(2);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await editor.getByRole('button', { name: 'Paste', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('keeps playback free of main-thread long tasks over 50 ms', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		test.skip(!await page.evaluate(() => PerformanceObserver.supportedEntryTypes?.includes('longtask')), 'The Long Task API is unavailable in this browser.');
		await page.evaluate(() => {
			globalThis.__audioEditorLongTasks = [];
			globalThis.__audioEditorLongTaskObserver = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) globalThis.__audioEditorLongTasks.push(entry.duration);
			});
			globalThis.__audioEditorLongTaskObserver.observe({ type: 'longtask', buffered: false });
		});

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await page.waitForTimeout(700);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		const longestTask = await page.evaluate(() => {
			globalThis.__audioEditorLongTaskObserver.disconnect();
			return Math.max(0, ...globalThis.__audioEditorLongTasks);
		});
		expect(longestTask).toBeLessThanOrEqual(50);
		expect(errors).toEqual([]);
	});

	test('keeps mono selections mono when applying Audacity effects', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const effectDialog = await openSelectionEffectDialog(page, editor);
		await expect(effectDialog.getByRole('heading', { name: 'Invert', exact: true })).toBeVisible();
		await effectDialog.getByRole('button', { name: 'Apply to selection' }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(effectDialog).toBeHidden();
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Invert'))?.channelCount).toBe(1);
		await expect.poll(async () => effectSourcePeak(page, 'Invert')).toBeGreaterThan(0.33);
		expect(errors).toEqual([]);
	});

	test('renders a local WAV mix when OfflineAudioContext is available', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		test.skip(!await page.evaluate(() => typeof globalThis.OfflineAudioContext === 'function' || typeof globalThis.webkitOfflineAudioContext === 'function'), 'OfflineAudioContext is unavailable in this browser.');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();

		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 15_000 });
		await expect(download).toHaveAttribute('download', /\.wav$/);
		const signature = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			return [new TextDecoder().decode(bytes.subarray(0, 4)), new TextDecoder().decode(bytes.subarray(8, 12)), bytes.length];
		});
		expect(signature[0]).toBe('RIFF');
		expect(signature[1]).toBe('WAVE');
		expect(signature[2]).toBeGreaterThan(44);
		expect(errors).toEqual([]);
	});

	test('falls back to bounded realtime WAV rendering without OfflineAudioContext', async ({ page }) => {
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		const header = await download.evaluate(async (link) => new TextDecoder().decode(new Uint8Array(await (await fetch(link.href)).arrayBuffer()).subarray(0, 4)));
		expect(header).toBe('RIFF');
		expect(errors).toEqual([]);
	});

	test('validates export choices and cancels a realtime render', async ({ page }) => {
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const exportDialog = await openExportDialog(page, editor);

		await exportDialog.locator('[data-export-field="range"]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(1);
		await expect(page.getByRole('option', { name: 'Current selection' })).toHaveCount(0);
		await expect(exportDialog.locator('[data-export-field="range"]').getByRole('button')).toContainText('Entire project');
		await page.keyboard.press('Escape');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'FLAC');
		await exportDialog.locator('[data-export-field="bitDepth"]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(2);
		await expect(page.getByRole('option', { name: '32-bit Float' })).toHaveCount(0);
		await expect(exportDialog.locator('[data-export-field="bitDepth"]').getByRole('button')).toContainText('24-bit PCM');
		await page.keyboard.press('Escape');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const cancel = exportDialog.getByRole('button', { name: 'Cancel export' });
		await expect(cancel).toBeVisible();
		await cancel.click();
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible({ timeout: 10_000 });
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('opens the same project read-only in another tab', async ({ page, context }) => {
		const first = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, first, 'Tracks', ['Add new track', 'Audio track']);
		await expect(first.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		const secondPage = await context.newPage();
		await secondPage.goto('/embed/en/');
		const second = secondPage.locator('[data-audio-editor]');
		await expect(second).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(second.locator('[data-status]')).toContainText('already open in another tab');
		await second.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'Tracks', exact: true }).click();
		const tracksMenu = secondPage.getByRole('menu', { name: 'Tracks', exact: true });
		const addNewTrack = getMenuItem(tracksMenu, 'Add new track');
		await addNewTrack.click();
		await expect(getMenuItem(addNewTrack.getByRole('menu'), 'Audio track')).toHaveAttribute('aria-disabled', 'true');
		const readOnlyRecord = second.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(readOnlyRecord).toBeDisabled();
		await expect(readOnlyRecord).toHaveAttribute('aria-label', /read-only/i);
		await secondPage.close();
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
						const destination = context.createMediaStreamDestination();
						oscillator.frequency.value = 440;
						gain.gain.value = 0.1;
						oscillator.connect(gain).connect(destination);
						oscillator.start();
						await context.resume();
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
		await expect(editor.getByRole('button', { name: /^Arm for recording:/ })).toHaveCount(0);
		const record = editor.getByRole('button', { name: 'Record onto the active track' });
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		const recordingPreview = tracks.nth(1).locator('[data-clip-id^="recording-preview-"]');
		await expect(recordingPreview).toBeVisible({ timeout: 10_000 });
		await expect(recordingPreview.locator('canvas').first()).toBeVisible();
		await page.waitForTimeout(350);
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
		await expect(recordingPreview).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(tracks.nth(0).locator('[data-clip-id]')).toHaveCount(0);
		await expect(tracks.nth(1).locator('[data-clip-id]')).toHaveCount(1);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		expect(errors).toEqual([]);
	});

	test('has named, keyboard-reachable controls in initial, populated, menu, effects, and dialog states', async ({ page }) => {
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
		await getMenuItem(page.getByRole('menu', { name: 'File', exact: true }), 'Open').click();
		await assertAccessibleBasics(page.getByRole('dialog', { name: 'Local projects' }));
		await assertNoSeriousAxeViolations(page);
		await page.getByRole('dialog', { name: 'Local projects' }).getByRole('button', { name: 'Close' }).click();

		const effectsPanel = await openEffectsForTrack(editor, 1);
		await assertAccessibleBasics(effectsPanel);
		await assertNoSeriousAxeViolations(page);
		await openRackPicker(effectsPanel, 'track');
		await assertAccessibleBasics(page.getByRole('dialog', { name: 'Choose an effect' }));
		await assertNoSeriousAxeViolations(page);
		await closeDialog(page.getByRole('dialog', { name: 'Choose an effect' }));
		await closeEffectsPanel(effectsPanel);

		const clipDialog = await openClipProperties(page, editor, clipByName(editor, toneA.name));
		await assertAccessibleBasics(clipDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(clipDialog);

		const effectDialog = await openSelectionEffectDialog(page, editor);
		await assertAccessibleBasics(effectDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(effectDialog);

		const analysisDialog = await openAnalysisDialog(page, editor);
		await assertAccessibleBasics(analysisDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(analysisDialog);

		const exportDialog = await openExportDialog(page, editor);
		await assertAccessibleBasics(exportDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(exportDialog);
	});

	test('matches the desktop, tablet, and mobile editor shells in light and dark themes', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'chromium', 'The canonical visual baselines use desktop Chromium.');
		test.setTimeout(60_000);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.evaluate(() => document.fonts.ready);
		await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });

		for (const viewport of [
			{ label: 'desktop', width: 1440, height: 1000 },
			{ label: 'tablet', width: 930, height: 1000 },
			{ label: 'mobile', width: 390, height: 844 },
		]) {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
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

	test('encodes a local MP3 with the self-hosted FFmpeg core', async ({ page }) => {
		test.skip(process.env.AUDIO_EDITOR_FFMPEG_BROWSER !== '1', 'Enable for the 31 MB FFmpeg integration check.');
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'MP3');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 90_000 });
		await expect(download).toHaveAttribute('download', /\.mp3$/);
		const signature = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			return { head: new TextDecoder().decode(bytes.subarray(0, 3)), first: bytes[0], second: bytes[1], length: bytes.length };
		});
		expect(signature.head === 'ID3' || (signature.first === 0xff && (signature.second & 0xe0) === 0xe0)).toBe(true);
		expect(signature.length).toBeGreaterThan(256);
		expect(errors).toEqual([]);
	});
});

async function bootEditor(page, path) {
	await page.goto(path);
	const editor = await waitForEditor(page);
	const decline = page.getByRole('button', { name: /^(Decline|Ablehnen)$/ });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

async function serveTranslationFixture(page, locales, { waitForPack } = {}) {
	await page.unroute(`${TRANSLATIONS_ROOT}/**`);
	const packs = new Map();
	const descriptors = {};
	for (const [locale, fixture] of Object.entries(locales)) {
		const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, locale, messages: fixture.messages }));
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const path = `packs/${sha256}.json`;
		packs.set(path, bytes);
		descriptors[locale] = {
			name: fixture.name,
			direction: fixture.direction,
			eligible: true,
			coverage: 1,
			path,
			sha256,
			byteLength: bytes.byteLength,
		};
	}
	const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, locales: descriptors }));
	await page.route(`${TRANSLATIONS_ROOT}/**`, async (route) => {
		const url = new URL(route.request().url());
		const relativePath = url.pathname.slice(new URL(`${TRANSLATIONS_ROOT}/`).pathname.length);
		const body = relativePath === 'latest.json' ? manifest : packs.get(relativePath);
		if (!body) return route.fulfill({ status: 404, body: 'Not found' });
		if (relativePath !== 'latest.json') await waitForPack?.(relativePath);
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Content-Length': String(body.byteLength),
			},
			body,
		});
	});
}

async function waitForEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	return editor;
}

async function importFiles(editor, files) {
	await editor.locator('[data-import-input]').setInputFiles(files);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
}

function trackNameText(editor) {
	return editor.locator('.track-control-panel__track-name-text');
}

function clipByName(editor, name) {
	return editor.getByRole('group', { name: `${name} clip`, exact: true });
}

function clipField(editor, name) {
	return editor.locator(`[data-clip-field="${name}"] input`);
}

async function commitInput(input, value) {
	await input.fill(value);
	await input.blur();
}

async function seekOnRuler(editor, x) {
	await editor.locator('[data-ruler]').click({ position: { x, y: 28 } });
}

async function clickClipInterior(page, clip, position = 0.5) {
	await clip.scrollIntoViewIfNeeded();
	const box = await clip.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.click(
		box.x + Math.max(12, Math.min(box.width - 12, box.width * position)),
		box.y + Math.max(12, box.height * 0.55),
	);
}

async function openClipProperties(page, editor, clip) {
	if (clip) {
		await clip.click({ position: { x: 24, y: 10 } });
		await clip.getByRole('button', { name: 'Clip menu' }).click();
		await page.getByRole('menuitem', { name: 'Clip properties', exact: true }).click();
	} else {
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Clip properties']);
	}
	const dialog = page.getByRole('dialog', { name: 'Clip properties', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="clip"]')).toBeVisible();
	return dialog;
}

async function openEffectsForTrack(editor, trackIndex) {
	await editor.locator('[data-track-row]').nth(trackIndex).getByRole('button', { name: 'Effects', exact: true }).click();
	const overlay = editor.locator('[data-effects-overlay]');
	await expect(overlay).toBeVisible();
	await expect(overlay.getByRole('region', { name: 'Effects panel', exact: true })).toBeVisible();
	return overlay;
}

async function openSelectionEffectDialog(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="selection-effect"]')).toBeVisible();
	return dialog;
}

async function openAnalysisDialog(page, editor) {
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const dialog = page.getByRole('dialog', { name: 'Analysis', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="analysis"]')).toBeVisible();
	return dialog;
}

async function openExportDialog(page, editor) {
	await chooseFileAction(page, editor, 'Export audio');
	const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="export"]')).toBeVisible();
	return dialog;
}

async function closeDialog(dialog) {
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function closeEffectsPanel(panel) {
	await panel.getByRole('button', { name: 'Close effects panel', exact: true }).click();
	await expect(panel).toBeHidden();
}

async function chooseDropdown(page, group, optionName) {
	await group.getByRole('button').click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
	await expect(group.getByRole('button')).toContainText(optionName);
}

async function openRackPicker(panel, scope) {
	const buttons = panel.locator('[data-effect-rack]').getByRole('button', { name: 'Effects', exact: true });
	await (scope === 'master' ? buttons.last() : buttons.first()).click();
	await expect(panel.page().getByRole('dialog', { name: 'Choose an effect' })).toBeVisible();
}

async function addRackEffect(page, panel, scope, effectName) {
	await openRackPicker(panel, scope);
	const picker = page.getByRole('dialog', { name: 'Choose an effect', exact: true });
	await chooseDropdown(page, picker.locator('[data-effect-type]'), effectName);
	await picker.getByRole('button', { name: 'Add effect', exact: true }).click();
}

async function openEffectStackMenu(panel, scope) {
	const buttons = panel.locator('[data-effect-rack]').getByRole('button', { name: 'Effect stack options', exact: true });
	await (scope === 'master' ? buttons.last() : buttons.first()).click();
	const menu = panel.page().locator('.audio-editor-effect-stack-menu');
	await expect(menu).toBeVisible();
	return menu;
}

async function chooseFileAction(page, editor, action) {
	await chooseCommandAction(page, editor, 'File', action);
}

async function chooseCommandAction(page, editor, menu, action) {
	const menubar = editor.getByRole('menubar', { name: /^(Application menu|Anwendungsmenü)$/ });
	await menubar.getByRole('menuitem', { name: menu, exact: true }).click();
	const commandMenu = page.getByRole('menu', { name: menu, exact: true });
	await expect(commandMenu).toBeVisible();
	const item = getMenuItem(commandMenu, action);
	await item.focus();
	await page.keyboard.press('Enter');
}

async function chooseNestedCommandAction(page, editor, menu, actions) {
	const menubar = editor.getByRole('menubar', { name: /^(Application menu|Anwendungsmenü)$/ });
	await menubar.getByRole('menuitem', { name: menu, exact: true }).click();
	const commandMenu = page.getByRole('menu', { name: menu, exact: true });
	await expect(commandMenu).toBeVisible();
	let currentMenu = commandMenu;
	for (const [index, action] of actions.entries()) {
		const item = getMenuItem(currentMenu, action);
		if (index < actions.length - 1) {
			// Use the component's ARIA menu-keyboard contract for flyouts. Firefox
			// can deliver mouseleave while a newly positioned submenu crosses the
			// pointer, which closes the flyout before its leaf receives a click.
			await item.focus();
			await page.keyboard.press('ArrowRight');
			currentMenu = item.getByRole('menu');
			await expect(currentMenu).toBeVisible();
		} else {
			// Do not move the pointer across the flyout boundary for the leaf: in
			// Firefox that can deliver mouseleave before click and detach the nested
			// menu. Activating the already-visible item by keyboard also verifies the
			// required accessible command path.
			await item.focus();
			await page.keyboard.press('Enter');
		}
	}
}

function getMenuItem(menu, label) {
	const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return menu.getByRole('menuitem', { name: new RegExp(`^${escapedLabel}(?:\\s|$)`) }).first();
}

async function expectSurfaceWithinViewport(surface, page) {
	const box = await surface.boundingBox();
	expect(box).not.toBeNull();
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function setDocumentTheme(page, theme) {
	await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
	await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
	await expect.poll(() => page.locator('[data-audio-editor]').evaluate((root) => root.className)).toContain('kw-audio-editor');
	await page.waitForTimeout(50);
}

async function dispatchPinch(timeline) {
	const box = await timeline.boundingBox();
	expect(box).not.toBeNull();
	const y = box.y + Math.min(100, box.height / 2);
	await timeline.dispatchEvent('pointerdown', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 210, clientY: y });
	await timeline.dispatchEvent('pointerdown', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 260, clientY: y });
	await timeline.dispatchEvent('pointermove', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 180, clientY: y });
	await timeline.dispatchEvent('pointermove', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 290, clientY: y });
	await timeline.dispatchEvent('pointerup', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 180, clientY: y });
	await timeline.dispatchEvent('pointerup', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 290, clientY: y });
}

async function disableOfflineAudio(page) {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: undefined });
		Object.defineProperty(globalThis, 'webkitOfflineAudioContext', { configurable: true, value: undefined });
	});
}

async function stubDisplayCapture(page) {
	await page.addInitScript(() => {
		globalThis.__soundscaperDisplayCaptureRequests = 0;
		const createTrack = (kind) => {
			const target = new EventTarget();
			let readyState = 'live';
			Object.defineProperties(target, {
				kind: { value: kind },
				readyState: { get: () => readyState },
				getSettings: { value: () => kind === 'audio' ? { channelCount: 2 } : {} },
				stop: { value: () => {
					if (readyState === 'ended') return;
					readyState = 'ended';
					target.dispatchEvent(new Event('ended'));
				} },
			});
			return target;
		};
		Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
			configurable: true,
			value: async () => {
				globalThis.__soundscaperDisplayCaptureRequests += 1;
				const audioTrack = createTrack('audio');
				const videoTrack = createTrack('video');
				return {
					getAudioTracks: () => [audioTrack],
					getVideoTracks: () => [videoTrack],
					getTracks: () => [audioTrack, videoTrack],
				};
			},
		});
	});
}

async function assertAccessibleBasics(root) {
	const violations = await root.evaluate((container) => {
		const visible = (element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
		};
		const textAlternative = (element) => {
			const labelledBy = element.getAttribute('aria-labelledby');
			const labelledText = labelledBy
				? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
				: '';
			const labels = element.labels ? [...element.labels].map((label) => label.textContent || '').join(' ') : '';
			return [element.getAttribute('aria-label'), labelledText, labels, element.getAttribute('title'), element.textContent]
				.map((value) => String(value || '').trim())
				.find(Boolean) || '';
		};
		const results = [];
		for (const element of container.querySelectorAll('button, input, select, textarea, [role="button"], [role="menuitem"], [role="slider"], [role="tab"], [role="dialog"]')) {
			if (!visible(element) || element.disabled || element.getAttribute('aria-hidden') === 'true') continue;
			if (!textAlternative(element)) results.push(`${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[role=${element.getAttribute('role')}]` : ''} has no accessible name`);
		}
		const ids = [...container.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean);
		for (const id of new Set(ids)) if (ids.filter((candidate) => candidate === id).length > 1) results.push(`duplicate id ${id}`);
		return results;
	});
	expect(violations).toEqual([]);
}

async function assertNoSeriousAxeViolations(page) {
	const results = await new AxeBuilder({ page })
		.include('#kw-audio-editor-design-system')
		.analyze();
	const violations = results.violations
		.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
		.map((violation) => ({
			id: violation.id,
			impact: violation.impact,
			nodes: violation.nodes.map((node) => node.target),
		}));
	expect(violations).toEqual([]);
}

async function effectSourceMetadata(page) {
	return page.evaluate(() => new Promise((resolve, reject) => {
		const openRequest = indexedDB.open('kw-media-audio-editor', 1);
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
				resolve(request.result.filter((source) => source.id?.startsWith('audacity-effect-')));
			};
		};
	}));
}

async function effectSourcePeak(page, name) {
	return page.evaluate(async (effectName) => {
		const sources = await new Promise((resolve, reject) => {
			const openRequest = indexedDB.open('kw-media-audio-editor', 1);
			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => {
				const database = openRequest.result;
				const request = database.transaction('sources', 'readonly').objectStore('sources').getAll();
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					database.close();
					resolve(request.result);
				};
			};
		});
		const source = sources.find((candidate) => candidate.name?.includes(effectName));
		if (!source) return 0;
		let samples;
		if (source.storage === 'opfs') {
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle('audio-editor-sources');
			const file = await (await directory.getFileHandle(source.path)).getFile();
			const header = new DataView(await file.slice(0, 8).arrayBuffer());
			const frames = header.getUint32(0, true);
			samples = new Float32Array(await file.slice(8, 8 + frames * Float32Array.BYTES_PER_ELEMENT).arrayBuffer());
		} else {
			samples = await new Promise((resolve, reject) => {
				const openRequest = indexedDB.open('kw-media-audio-editor', 1);
				openRequest.onerror = () => reject(openRequest.error);
				openRequest.onsuccess = () => {
					const database = openRequest.result;
					const request = database.transaction('sourceChunks', 'readonly')
						.objectStore('sourceChunks').index('sourceToken').getAll(source.sourceToken);
					request.onerror = () => reject(request.error);
					request.onsuccess = () => {
						database.close();
						const first = request.result.sort((left, right) => left.index - right.index)[0];
						resolve(first ? new Float32Array(first.channels[0]) : new Float32Array(0));
					};
				};
			});
		}
		let peak = 0;
		for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
		return peak;
	}, name);
}

function collectClientErrors(page) {
	const errors = [];
	const reportedRequests = new Set();

	function reportRequest(request, reason) {
		const key = `${request.url()}: ${reason}`;
		if (reportedRequests.has(key)) return;
		reportedRequests.add(key);
		errors.push(`Browser dependency ${request.url()} was rejected: ${reason}`);
	}

	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const source = message.location().url;
		errors.push(source ? `${message.text()} (${source})` : message.text());
	});
	page.on('requestfailed', (request) => {
		if (isBrowserDependency(request)) reportRequest(request, request.failure()?.errorText || 'request failed');
	});
	page.on('response', (response) => {
		const request = response.request();
		if (!isBrowserDependency(request)) return;
		if (response.status() === 304) return;
		if (!response.ok()) return reportRequest(request, `HTTP ${response.status()}`);
		const contentType = response.headers()['content-type']?.toLowerCase() || '';
		if ((request.resourceType() === 'script' || /worker\.js(?:$|[?#])/.test(request.url())) && !/(?:java|ecma)script/.test(contentType)) {
			reportRequest(request, `script has disallowed MIME type ${contentType || '(missing)'}`);
		}
		if (/\.wasm(?:$|[?#])/.test(request.url()) && !contentType.startsWith('application/wasm')) {
			reportRequest(request, `WebAssembly has disallowed MIME type ${contentType || '(missing)'}`);
		}
	});

	return errors;
}

function isBrowserDependency(request) {
	return ['script', 'stylesheet', 'font', 'image'].includes(request.resourceType())
		|| /\.(?:wasm|worker\.js)(?:$|[?#])/.test(request.url());
}

function escapeRegex(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

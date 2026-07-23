import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { createAup3Fixture } from '../aup3-fixture.js';
import { aup4NativeRichFixture } from '../fixtures/aup4-native-rich.js';
import { encodeAudacityBinaryXml } from '../../src/common/editor/audacity-binary-xml.js';
import {
	initializeAup4Database,
	insertAup4SampleBlock,
	prepareAup4PortableExport,
	writeAup4Document,
} from '../../src/common/editor/aup4-database.js';
import { createEffect, createMissingEffect } from '../../src/common/editor/effects.js';
import {
	createAup4ProjectDocument,
	createAup4SampleBlock,
} from '../../src/common/editor/aup4-profile.js';
import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
} from '../../src/common/editor/project-v2.js';

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

	test('pins automated send and master tracks below media tracks', async ({ page }) => {
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
		await expect(flyout.locator('.add-track-flyout__row')).toHaveCount(1);
		await expect(flyout.locator('.add-track-flyout__row').getByRole('checkbox', { name: 'Show master track', exact: true })).toHaveCount(1);
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

		const automation = editor.getByRole('button', { name: 'Clip gain', exact: true });
		await automation.click();
		const envelope = firstSend.locator('.audio-editor-output-envelope');
		await expect(envelope.locator('.envelope-point')).toHaveCount(2);
		const envelopeBounds = await envelope.boundingBox();
		expect(envelopeBounds).not.toBeNull();
		await page.mouse.click(
			envelopeBounds.x + envelopeBounds.width / 3,
			envelopeBounds.y + envelopeBounds.height * 0.42,
		);
		await expect(envelope.locator('.envelope-point')).toHaveCount(3);

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
		await expect(restoredRows.first().locator('.envelope-point')).toHaveCount(3);
		await expect(restoredRows.last()).toHaveAttribute('data-output-scope', 'master');
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

	test('routes browser zoom gestures to the project timeline', async ({ page }) => {
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
		await timelinePanel.evaluate((element) => { element.tabIndex = -1; element.focus(); });
		await page.keyboard.down('Control');
		await page.keyboard.press('=');
		await page.keyboard.up('Control');
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(normalWidth);
		await expect.poll(async () => {
			const [viewport, playhead] = await Promise.all([
				ruler.boundingBox(),
				editor.locator('[data-playhead] .playhead-cursor__line').boundingBox(),
			]);
			if (!viewport || !playhead) return Number.POSITIVE_INFINITY;
			return Math.abs(playhead.x - (viewport.x + viewport.width / 2));
		}).toBeLessThanOrEqual(2);
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

	test('opens Audacity microphone and speaker flyouts', async ({ page }) => {
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
						gain.gain.value = 0.2;
						oscillator.connect(gain).connect(destination);
						oscillator.start();
						await context.resume();
						return destination.stream;
					},
				},
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
		const audioDevicesFlyout = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		const allowMicrophone = audioDevicesFlyout.getByRole('button', { name: 'Enable microphones', exact: true });
		await expect(allowMicrophone).toBeVisible();
		await allowMicrophone.click();
		await expect(allowMicrophone).toHaveCount(0);
		await page.keyboard.press('Escape');

		const recordLevel = editor.getByRole('button', { name: 'Record level', exact: true });
		await expect(recordLevel.locator('.musescore-icon')).toHaveText('\uF41B');
		await recordLevel.click();

		const microphoneFlyout = editor.getByRole('dialog', { name: 'Record level', exact: true });
		let sideRecordingMeter = editor.locator('[data-side-recording-meter]');
		await expect(microphoneFlyout).toBeVisible();
		await expect(microphoneFlyout.getByText('Microphone level', { exact: true })).toBeVisible();
		await expect(sideRecordingMeter.getByRole('meter', { name: 'Input level', exact: true })).toBeVisible();
		await expect(microphoneFlyout.getByRole('radio', { name: 'Side bar (vertical)', exact: true })).toBeChecked();
		await expect(microphoneFlyout.getByRole('radio', { name: 'Gradient', exact: true })).toBeVisible();
		await expect(microphoneFlyout.getByRole('combobox', { name: 'dB range', exact: true })).toBeVisible();
		const recordGain = sideRecordingMeter.getByRole('slider', { name: 'Record level', exact: true });
		await recordGain.fill('-6');
		await expect(recordGain).toHaveValue('-6');
		const micMetering = microphoneFlyout.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true });
		await expect(micMetering).toHaveAttribute('aria-checked', 'false');
		await micMetering.click();
		await expect(micMetering).toHaveAttribute('aria-checked', 'true');
		await expect.poll(async () => Number(await sideRecordingMeter
			.getByRole('meter', { name: 'Input level', exact: true })
			.getAttribute('aria-valuenow'))).toBeGreaterThan(-60);
		await expect(sideRecordingMeter).toBeVisible();
		await page.evaluate(() => {
			globalThis.__idleWaveformDraws = 0;
			const prototype = CanvasRenderingContext2D.prototype;
			const clearRect = prototype.clearRect;
			prototype.clearRect = function countIdleWaveformDraws(...args) {
				if (this.canvas?.matches('canvas.clip-body__waveform')) globalThis.__idleWaveformDraws += 1;
				return clearRect.apply(this, args);
			};
		});
		await page.waitForTimeout(150);
		await page.evaluate(() => { globalThis.__idleWaveformDraws = 0; });
		await page.waitForTimeout(350);
		expect(await page.evaluate(() => globalThis.__idleWaveformDraws)).toBe(0);
		await micMetering.click();
		await expect(micMetering).toHaveAttribute('aria-checked', 'false');
		await expect(sideRecordingMeter.getByRole('meter', { name: 'Input level', exact: true })).toHaveAttribute('aria-valuenow', '-60');
		await expect(editor.locator('[data-idle-input-meter]')).toHaveCount(0);
		await microphoneFlyout.getByRole('radio', { name: 'Top bar (horizontal)', exact: true }).click();
		await expect(microphoneFlyout.locator('[data-input-meter]')).toHaveCount(0);
		const topRecordingMeter = editor.locator('[data-meter-kind="recording"][data-meter-position="top"]:not([data-input-meter])');
		await expect(topRecordingMeter).toBeVisible();
		await expect(topRecordingMeter).toHaveAttribute('data-meter-orientation', 'horizontal');
		const topRecordingSlider = topRecordingMeter.getByRole('slider', { name: 'Record level', exact: true });
		await expect(topRecordingSlider).toBeVisible();
		const topSliderBox = await topRecordingSlider.boundingBox();
		const topChannelsBox = await topRecordingMeter.locator('.kw-audio-editor__playback-meter-channels').boundingBox();
		expect(Math.abs((topSliderBox.y + topSliderBox.height / 2) - (topChannelsBox.y + topChannelsBox.height / 2))).toBeLessThanOrEqual(1);
		expect(topSliderBox.height).toBeGreaterThanOrEqual(topChannelsBox.height - 1);
		await editor.getByRole('button', { name: 'Record level', exact: true }).click();
		await microphoneFlyout.getByRole('radio', { name: 'Side bar (vertical)', exact: true }).click();
		sideRecordingMeter = editor.locator('[data-side-recording-meter]');
		await expect(sideRecordingMeter).toBeVisible();
		await expect(sideRecordingMeter.locator('[data-meter-kind="recording"]')).toHaveAttribute('data-meter-orientation', 'vertical');
		const sideRecordingSlider = sideRecordingMeter.getByRole('slider', { name: 'Record level', exact: true });
		await expect(sideRecordingSlider).toBeVisible();
		const sideSliderBox = await sideRecordingSlider.boundingBox();
		const sideChannelsBox = await sideRecordingMeter.locator('.kw-audio-editor__playback-meter-channels').boundingBox();
		expect(Math.abs((sideSliderBox.x + sideSliderBox.width / 2) - (sideChannelsBox.x + sideChannelsBox.width / 2))).toBeLessThanOrEqual(1);
		expect(sideSliderBox.width).toBeGreaterThanOrEqual(sideChannelsBox.width - 1);
		await sideRecordingMeter.getByRole('button', { name: 'Record level', exact: true }).click();
		let sideRecordingFlyout = editor.getByRole('dialog', { name: 'Record level', exact: true });
		await sideRecordingFlyout.getByRole('radio', { name: 'EBU R 128', exact: true }).click();
		const sideInputEbuMeter = sideRecordingMeter.locator('[data-audio-meter]');
		await expect(sideInputEbuMeter).toHaveAttribute('data-meter-type', 'ebu-r128');
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-scale', 'plus9');
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-unit', 'absolute');
		await expect(sideInputEbuMeter.getByRole('meter', { name: 'Input level', exact: true })).toHaveAttribute('aria-valuemin', '-41');
		await expect(sideInputEbuMeter.getByRole('meter', { name: 'Input level', exact: true })).toHaveAttribute('aria-valuetext', '— LUFS');
		await expect(sideRecordingFlyout.getByRole('radio', { name: 'Gradient', exact: true })).toHaveCount(0);
		await expect(sideRecordingFlyout.getByRole('combobox', { name: 'dB range', exact: true })).toHaveCount(0);
		await sideRecordingFlyout.getByRole('radio', { name: 'EBU +18', exact: true }).click();
		await sideRecordingFlyout.getByRole('radio', { name: 'Relative (LU)', exact: true }).click();
		await sideRecordingFlyout.getByRole('radio', { name: 'Short-term (S)', exact: true }).click();
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-scale', 'plus18');
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-unit', 'relative');
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-live-value', 'short-term');
		await expect(sideInputEbuMeter.getByRole('meter', { name: 'Input level', exact: true })).toHaveAttribute('aria-valuemin', '-36');
		await expect(sideRecordingFlyout.getByRole('button', { name: 'Reset measurement', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');

		let playbackSettings = editor.getByRole('button', { name: 'Playback meter settings', exact: true });
		await expect(playbackSettings.locator('.musescore-icon')).toHaveText('\uEF4E');
		await playbackSettings.click();
		let speakerFlyout = editor.getByRole('dialog', { name: 'Playback meter settings', exact: true });
		await expect(speakerFlyout).toBeVisible();
		await expect(speakerFlyout.getByRole('checkbox')).toHaveCount(0);
		await expect(speakerFlyout.getByRole('radio', { name: 'Side bar (vertical)', exact: true })).toBeChecked();
		await page.keyboard.press('Escape');
		const sideMeter = editor.locator('[data-side-playback-meter]');
		await expect(sideMeter).toBeVisible();
		await expect(sideMeter.locator('[data-playback-meter]')).toHaveAttribute('data-meter-orientation', 'vertical');
		const playbackVolume = sideMeter.getByRole('slider', { name: 'Playback volume', exact: true });
		await expect(playbackVolume).toHaveAttribute('aria-orientation', 'vertical');
		await expect(playbackVolume).toHaveAttribute('aria-valuetext', '0 dB');
		await playbackVolume.fill('0.5');
		await expect(playbackVolume).toHaveAttribute('aria-valuetext', '−30 dB');
		await playbackVolume.fill('1');
		await expect(playbackVolume).toHaveAttribute('aria-valuetext', '0 dB');
		const sideMeterBox = await sideMeter.locator('[data-playback-meter]').boundingBox();
		expect(sideMeterBox.height).toBeGreaterThan(sideMeterBox.width);

		playbackSettings = sideMeter.getByRole('button', { name: 'Playback meter settings', exact: true });
		await playbackSettings.click();
		speakerFlyout = editor.getByRole('dialog', { name: 'Playback meter settings', exact: true });
		await expect(speakerFlyout.getByRole('radio', { name: 'Side bar (vertical)', exact: true })).toBeChecked();
		await speakerFlyout.getByRole('radio', { name: 'Gradient', exact: true }).click();
		const playbackMeter = sideMeter.locator('[data-playback-meter]');
		await expect(playbackMeter).toHaveAttribute('data-meter-style', 'gradient');
		const gradientPeak = playbackMeter.locator('.kw-audio-editor__playback-meter-peak').first();
		await expect(gradientPeak).toHaveCSS('background-image', /linear-gradient/);
		await expect(gradientPeak).not.toHaveCSS('clip-path', 'none');
		await speakerFlyout.getByRole('radio', { name: 'RMS', exact: true }).click();
		await expect(playbackMeter.locator('.kw-audio-editor__playback-meter-rms')).toHaveCount(2);
		await speakerFlyout.getByRole('radio', { name: 'Linear (dB)', exact: true }).click();
		const range = speakerFlyout.getByRole('combobox', { name: 'dB range', exact: true });
		await range.selectOption('120');
		await expect(playbackMeter).toHaveAttribute('data-meter-db-range', '120');
		await expect(playbackMeter.locator('.kw-audio-editor__playback-meter-ruler')).toContainText('120');
		await speakerFlyout.getByRole('radio', { name: 'Linear (amp)', exact: true }).click();
		await expect(range).toBeDisabled();
		await expect(playbackMeter.locator('.kw-audio-editor__playback-meter-ruler')).toContainText('0.40');
		await speakerFlyout.getByRole('radio', { name: 'EBU R 128', exact: true }).click();
		await expect(playbackMeter).toHaveAttribute('data-meter-type', 'ebu-r128');
		await expect(playbackMeter).toHaveAttribute('data-ebu-scale', 'plus9');
		await expect(playbackMeter).toHaveAttribute('data-ebu-unit', 'absolute');
		await expect(playbackMeter.locator('[data-ebu-target]')).toContainText('23');
		await expect(speakerFlyout.getByRole('radio', { name: 'Gradient', exact: true })).toHaveCount(0);
		await expect(speakerFlyout.getByRole('combobox', { name: 'dB range', exact: true })).toHaveCount(0);
		await expect(speakerFlyout.getByText('Loudness range (LRA)', { exact: true })).toHaveCount(0);
		await speakerFlyout.getByRole('radio', { name: 'EBU +18', exact: true }).click();
		await speakerFlyout.getByRole('radio', { name: 'Relative (LU)', exact: true }).click();
		await speakerFlyout.getByRole('radio', { name: 'Short-term (S)', exact: true }).click();
		await expect(playbackMeter).toHaveAttribute('data-ebu-scale', 'plus18');
		await expect(playbackMeter).toHaveAttribute('data-ebu-unit', 'relative');
		await expect(playbackMeter).toHaveAttribute('data-ebu-live-value', 'short-term');
		await expect(playbackMeter.getByRole('meter')).toHaveAttribute('aria-valuemin', '-36');
		await expect(playbackMeter.getByRole('meter')).toHaveAttribute('aria-valuemax', '18');
		await expect(playbackMeter.locator('[data-ebu-target]')).toHaveText('0');
		await expect(speakerFlyout.getByRole('button', { name: 'Reset measurement', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'Analyze', 'EBU R 128');
		const ebuPanel = editor.locator('[data-workspace-panel="ebu-r128"]');
		await expect(ebuPanel.getByText('Loudness range (LRA)', { exact: true })).toBeVisible();
		await ebuPanel.getByRole('button', { name: 'Reset measurement', exact: true }).focus();
		await page.keyboard.press('Enter');

		await page.reload();
		const reloaded = await waitForEditor(page);
		const reloadedPlayback = reloaded.locator('[data-side-playback-meter] [data-playback-meter]');
		await expect(reloadedPlayback).toHaveAttribute('data-meter-type', 'ebu-r128');
		await expect(reloadedPlayback).toHaveAttribute('data-ebu-scale', 'plus18');
		await expect(reloadedPlayback).toHaveAttribute('data-ebu-unit', 'relative');
		await expect(reloadedPlayback).toHaveAttribute('data-ebu-live-value', 'short-term');
		const reloadedInput = reloaded.locator('[data-side-recording-meter] [data-audio-meter]');
		await expect(reloadedInput).toHaveAttribute('data-meter-type', 'ebu-r128');
		await expect(reloadedInput).toHaveAttribute('data-ebu-scale', 'plus18');
	});

	test('migrates legacy meter settings while preserving conventional meter choices', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('soundscaper-playback-meter-settings-v1', JSON.stringify({
				position: 'side',
				style: 'gradient',
				type: 'db-linear',
				dbRange: 96,
			}));
			localStorage.setItem('soundscaper-recording-meter-settings-v1', JSON.stringify({
				position: 'top',
				style: 'rms',
				type: 'db-log',
				dbRange: 72,
			}));
		});
		const editor = await bootEditor(page, '/embed/en/');
		const playback = editor.locator('[data-side-playback-meter] [data-playback-meter]');
		await expect(playback).toHaveAttribute('data-meter-type', 'db-linear');
		await expect(playback).toHaveAttribute('data-meter-style', 'gradient');
		await expect(playback).toHaveAttribute('data-meter-db-range', '96');
		const recording = editor.locator('[data-meter-kind="recording"][data-meter-position="top"]');
		await expect(recording).toHaveAttribute('data-meter-type', 'db-log');
		await expect(recording).toHaveAttribute('data-meter-style', 'rms');
		await expect(recording).toHaveAttribute('data-meter-db-range', '72');
		await expect.poll(() => page.evaluate(() => (
			JSON.parse(localStorage.getItem('soundscaper-playback-meter-settings-v2'))
		))).toMatchObject({
			position: 'side',
			style: 'gradient',
			type: 'db-linear',
			dbRange: 96,
			ebuScale: 'plus9',
			ebuUnit: 'absolute',
			ebuLiveValue: 'momentary',
		});
	});

	test('selects and restores custom microphone and speaker devices', async ({ page }) => {
		await page.addInitScript(() => {
			const events = new EventTarget();
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
			let devices = [
				{ kind: 'audioinput', deviceId: 'default', groupId: 'built-in', label: 'System microphone' },
				{ kind: 'audioinput', deviceId: 'usb-mic', groupId: 'usb', label: 'USB microphone' },
				{ kind: 'audiooutput', deviceId: 'default', groupId: 'built-in', label: 'System speakers' },
				{ kind: 'audiooutput', deviceId: 'usb-speakers', groupId: 'usb', label: 'USB speakers' },
			];
			window.__audioSinkIds = [];
			window.__displayCaptureRequests = 0;
			window.__captureTracks = [];
			window.__setAudioDevices = (nextDevices) => {
				devices = nextDevices;
				events.dispatchEvent(new Event('devicechange'));
			};
			Object.defineProperty(AudioContext.prototype, 'setSinkId', {
				configurable: true,
				async value(deviceId) {
					window.__audioSinkIds.push(deviceId);
				},
			});
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					enumerateDevices: async () => devices,
					getUserMedia: async () => {
						const audioTrack = createTrack('audio');
						window.__captureTracks.push(audioTrack);
						return {
							getAudioTracks: () => [audioTrack],
							getVideoTracks: () => [],
							getTracks: () => [audioTrack],
						};
					},
					getDisplayMedia: async () => {
						window.__displayCaptureRequests += 1;
						const audioTrack = createTrack('audio');
						const videoTrack = createTrack('video');
						window.__captureTracks.push(audioTrack, videoTrack);
						return {
							getAudioTracks: () => [audioTrack],
							getVideoTracks: () => [videoTrack],
							getTracks: () => [audioTrack, videoTrack],
						};
					},
					addEventListener: events.addEventListener.bind(events),
					removeEventListener: events.removeEventListener.bind(events),
				},
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		const audioDevicesButton = editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true });
		await expect(audioDevicesButton).toBeVisible();
		await expect(editor.locator('[data-editor-tool-toolbar]').getByRole('button', { name: 'Audio setup', exact: true })).toHaveCount(0);
		await audioDevicesButton.click();
		const flyout = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await expect(flyout).toBeVisible();
		const actionBarZ = Number(await editor.locator('[data-action-bar]').evaluate((element) => getComputedStyle(element).zIndex));
		const toolbarsZ = Number(await editor.locator('[data-toolbar-dock="top"]').evaluate((element) => getComputedStyle(element).zIndex));
		expect(actionBarZ).toBeGreaterThan(toolbarsZ);

		const microphone = flyout.getByRole('combobox', { name: 'Microphone', exact: true });
		const recordingChannels = flyout.getByRole('radiogroup', { name: 'Recording channels', exact: true });
		const speakers = flyout.getByRole('combobox', { name: 'Speakers', exact: true });
		await expect(microphone).toContainText('USB microphone');
		await expect(speakers).toContainText('USB speakers');
		await microphone.selectOption('usb-mic');
		await recordingChannels.getByRole('radio', { name: 'Stereo', exact: true }).check();
		await speakers.selectOption('usb-speakers');
		await expect(microphone).toHaveValue('usb-mic');
		await expect(recordingChannels.getByRole('radio', { name: 'Stereo', exact: true })).toBeChecked();
		await expect(speakers).toHaveValue('usb-speakers');

		await microphone.selectOption('display');
		await flyout.getByRole('button', { name: 'Choose display source', exact: true }).click();
		const changeDisplaySource = flyout.getByRole('button', { name: 'Choose a different display source', exact: true });
		await expect(changeDisplaySource).toBeVisible();
		await changeDisplaySource.click();
		await expect.poll(() => page.evaluate(() => window.__displayCaptureRequests)).toBe(2);
		await expect.poll(() => page.evaluate(() => (
			window.__captureTracks.filter((track) => track.readyState === 'live').length
		))).toBe(3);

		await page.evaluate(() => window.__setAudioDevices([
			{ kind: 'audioinput', deviceId: 'default', groupId: 'built-in', label: 'System microphone' },
			{ kind: 'audioinput', deviceId: 'usb-mic', groupId: 'usb', label: 'USB microphone' },
			{ kind: 'audiooutput', deviceId: 'default', groupId: 'built-in', label: 'System speakers' },
		]));
		await expect(flyout.getByText('The preferred output is unavailable. Using the system default.')).toBeVisible();
		await expect(speakers).toHaveValue('usb-speakers');
		await expect.poll(() => page.evaluate(() => window.__audioSinkIds.at(-1))).toBe('');

		await page.evaluate(() => window.__setAudioDevices([
			{ kind: 'audioinput', deviceId: 'default', groupId: 'built-in', label: 'System microphone' },
			{ kind: 'audioinput', deviceId: 'usb-mic', groupId: 'usb', label: 'USB microphone' },
			{ kind: 'audiooutput', deviceId: 'default', groupId: 'built-in', label: 'System speakers' },
			{ kind: 'audiooutput', deviceId: 'usb-speakers', groupId: 'usb', label: 'USB speakers' },
		]));
		await expect.poll(() => page.evaluate(() => window.__audioSinkIds.at(-1))).toBe('usb-speakers');
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
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

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
		const outputRows = editor.locator('[data-output-track-row]');
		await expect(outputRows).toHaveCount(2);
		expect(await outputRows.evaluateAll((rows) => rows.map((row) => row.dataset.outputScope))).toEqual(['group', 'send']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);
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
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');

		const trackSelectors = editor.locator('.kw-recording-input-selectors--track').first();
		const trackSource = trackSelectors.getByRole('combobox', { name: 'Recording source: Track 1', exact: true });
		const trackChannel = trackSelectors.getByRole('combobox', { name: 'Channel: Track 1', exact: true });
		await expect(trackSource).toBeVisible();
		await expect(trackSource).toHaveValue('device:default');
		await expect(trackChannel).toHaveValue('0');

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		let mixer = editor.locator('[data-mixer-panel]');
		const mixerSelectors = mixer.locator('.kw-recording-input-selectors--mixer').first();
		const mixerSource = mixerSelectors.getByRole('combobox', { name: 'Recording source: Track 1', exact: true });
		const mixerChannel = mixerSelectors.getByRole('combobox', { name: 'Channel: Track 1', exact: true });
		await expect(mixerSource).toHaveValue('device:default');

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

		const releaseInputs = editor.getByRole('button', { name: 'Audio setup', exact: true });
		await releaseInputs.click();
		const audioSetup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		const releaseInputButton = audioSetup.getByRole('button', { name: 'Disable microphones', exact: true });
		await expect(releaseInputButton).toBeVisible();
		await expect(trackSelectors).toHaveAttribute('data-recording-input-health', 'open');
		await releaseInputButton.click();
		await expect(releaseInputButton).toHaveCount(0);
		await expect(trackSelectors).toHaveAttribute('data-recording-input-health', 'unavailable');

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor.locator('[data-recording-input-selectors]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		await expect(editor.locator('.kw-recording-input-selectors--track').first()
			.getByRole('combobox', { name: 'Recording source: Track 1', exact: true })).toHaveValue('display');

		mixer = editor.locator('[data-mixer-panel]');
		if (!await mixer.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixer.locator('.kw-recording-input-selectors--mixer').first()
			.getByRole('combobox', { name: 'Recording source: Track 1', exact: true })).toHaveValue('display');
		await expect(mixer.getByRole('button', { name: 'Disable microphones', exact: true })).toHaveCount(0);
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

	test('omits unavailable project, view, track, and tool commands', async ({ page }) => {
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
		const projectProperties = getMenuItem(fileMenu, 'Project properties');
		await expect(projectProperties).toHaveAttribute('aria-disabled', 'true');
		await expect(projectProperties.locator('[data-disabled-reason]')).toHaveAttribute('title', /does not provide a usable handler/);
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
			await editor.getByRole('button', { name: /^(Spectrogram|Spektrogramm) options$/, exact: true }).click();
			const entry = editor.locator('[data-action-id="spectral-brush"]');
			await expect(entry).toBeVisible();
			await expect(entry).toHaveAttribute('aria-disabled', 'true');
			await expect(entry).toHaveAttribute('title', locale.reason);
			await expect(entry).toHaveAttribute('data-disabled-reason', locale.reason);
			await expect(entry.getByRole('menuitem', { name: new RegExp(`^${escapeRegex(locale.label)}:`) })).toBeDisabled();
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
		await page.mouse.move(initialDockBounds.x + initialDockBounds.width / 2, initialDockBounds.y + 66, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => Number(await mixerPanel.getAttribute('data-workspace-panel-size'))).toBeLessThan(initialMixerSize - 20);
		const resizedMixerSize = Number(await mixerPanel.getAttribute('data-workspace-panel-size'));
		await expect.poll(async () => (await bottomDock.boundingBox())?.height).toBeGreaterThan(0);
		await expect.poll(async () => (await bottomDock.boundingBox())?.height).toBeLessThanOrEqual(resizedMixerSize);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixerPanel).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		if (!await mixerPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixerPanel).toHaveAttribute('data-workspace-panel-size', String(resizedMixerSize));
		await expect.poll(async () => Math.abs(
			((await mixerPanel.boundingBox())?.height || 0) - ((await bottomDock.boundingBox())?.height || 0),
		)).toBeLessThan(2);

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

	test('resizes editor dialogs live with mouse and remains keyboard accessible', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const resizeHandle = preferences.getByRole('button', { name: 'Resize: Editor preferences', exact: true });
		await expect(resizeHandle).toBeVisible();
		const beforeMouseResize = await preferences.boundingBox();
		const resizeHandleBounds = await resizeHandle.boundingBox();
		expect(beforeMouseResize).not.toBeNull();
		expect(resizeHandleBounds).not.toBeNull();

		await page.mouse.move(
			resizeHandleBounds.x + resizeHandleBounds.width / 2,
			resizeHandleBounds.y + resizeHandleBounds.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			resizeHandleBounds.x + resizeHandleBounds.width / 2 - 48,
			resizeHandleBounds.y + resizeHandleBounds.height / 2 - 32,
			{ steps: 4 },
		);
		await expect(preferences).toHaveClass(/audio-editor-resizable-surface--resizing/);
		const liveMouseResize = await preferences.boundingBox();
		expect(liveMouseResize.width).toBeCloseTo(beforeMouseResize.width - 48, 0);
		expect(liveMouseResize.height).toBeCloseTo(beforeMouseResize.height - 32, 0);
		const resizeTheme = await page.evaluate(() => {
			document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
			return document.documentElement.dataset.theme;
		});
		await expect(editor).toHaveCSS('color-scheme', resizeTheme);
		const rerenderedMouseResize = await preferences.boundingBox();
		expect(rerenderedMouseResize.width).toBeCloseTo(liveMouseResize.width, 0);
		expect(rerenderedMouseResize.height).toBeCloseTo(liveMouseResize.height, 0);

		await page.mouse.up();
		await expect(preferences).not.toHaveClass(/audio-editor-resizable-surface--resizing/);
		const committedMouseResize = await preferences.boundingBox();
		await page.mouse.move(
			resizeHandleBounds.x + resizeHandleBounds.width / 2 + 32,
			resizeHandleBounds.y + resizeHandleBounds.height / 2 + 32,
		);
		const afterMouseCleanup = await preferences.boundingBox();
		expect(afterMouseCleanup.width).toBeCloseTo(committedMouseResize.width, 0);
		expect(afterMouseCleanup.height).toBeCloseTo(committedMouseResize.height, 0);

		await resizeHandle.focus();
		await resizeHandle.press('ArrowLeft');
		await resizeHandle.press('ArrowUp');
		const afterKeyboardResize = await preferences.boundingBox();
		expect(afterKeyboardResize.width).toBeCloseTo(committedMouseResize.width - 16, 0);
		expect(afterKeyboardResize.height).toBeCloseTo(committedMouseResize.height - 16, 0);
	});

	test('keeps the floating toolbar position live and commits it after dragging', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const editorBounds = await editor.boundingBox();
		const gripper = editor.locator('[data-toolbar-dock="top"] .toolbar__gripper');
		const gripperBounds = await gripper.boundingBox();
		expect(editorBounds).not.toBeNull();
		expect(gripperBounds).not.toBeNull();

		const startX = gripperBounds.x + gripperBounds.width / 2;
		const startY = gripperBounds.y + gripperBounds.height / 2;
		const floatingX = editorBounds.x + Math.min(320, editorBounds.width / 3);
		const floatingY = editorBounds.y + Math.min(240, editorBounds.height / 3);
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(floatingX, floatingY, { steps: 4 });

		const floatingToolbar = editor.locator('[data-toolbar-dock="floating"]');
		await expect(floatingToolbar).toBeVisible();
		const livePosition = await floatingToolbar.boundingBox();
		const dragTheme = await page.evaluate(() => {
			document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
			return document.documentElement.dataset.theme;
		});
		await expect(editor).toHaveCSS('color-scheme', dragTheme);
		const rerenderedPosition = await floatingToolbar.boundingBox();
		expect(rerenderedPosition.x).toBeCloseTo(livePosition.x, 0);
		expect(rerenderedPosition.y).toBeCloseTo(livePosition.y, 0);

		await page.mouse.move(floatingX + 48, floatingY + 32);
		await expect.poll(async () => (await floatingToolbar.boundingBox()).x).toBeCloseTo(livePosition.x + 48, 0);
		await expect.poll(async () => (await floatingToolbar.boundingBox()).y).toBeCloseTo(livePosition.y + 32, 0);
		await page.mouse.up();
		const committedPosition = await floatingToolbar.boundingBox();
		const committedTheme = await page.evaluate(() => {
			document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
			return document.documentElement.dataset.theme;
		});
		await expect(editor).toHaveCSS('color-scheme', committedTheme);
		const finalPosition = await floatingToolbar.boundingBox();
		expect(finalPosition.x).toBeCloseTo(committedPosition.x, 0);
		expect(finalPosition.y).toBeCloseTo(committedPosition.y, 0);
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
		await expect(editor.locator('[data-workspace-toolbar="transport"]')).toHaveCount(1);
		await expect(editor.locator('[data-workspace-toolbar="tools"]')).toHaveCount(1);
		await expect(editor.locator('[data-workspace-toolbar="edit"]')).toHaveCount(0);
		await expect(editor.locator('[data-workspace-toolbar="meter"]')).toHaveCount(1);
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

	test('routes picker imports by effective Project bin visibility and keeps cards reusable across reload', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');
		const projectBin = projectBinPanel.locator('[data-project-bin-drop-target]');
		await expect(projectBinPanel).toBeVisible();

		await editor.locator('[data-import-input]').setInputFiles([toneA]);
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		const card = projectBin.locator('[data-project-bin-item]').first();
		await expect(card.locator('[data-project-bin-waveform]')).toBeVisible();
		await expect(card.locator('.kw-audio-editor__project-bin-waveform-peaks')).toHaveCount(1);
		const name = card.locator('[data-project-bin-name]');
		await name.fill('Reusable browser tone');
		await name.press('Enter');
		await expect(name).toHaveValue('Reusable browser tone');

		await card.getByRole('button', { name: /Add to timeline/ }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);
		await card.getByRole('button', { name: /More file actions/ }).click();
		await page.getByRole('menuitem', { name: 'Remove from Project bin', exact: true }).click();
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(0);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		await waitForEditor(page);
		await expect(projectBinPanel).toBeVisible();
		await expect(projectBin.locator('[data-project-bin-name]')).toHaveValue('Reusable browser tone');
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		await projectBinPanel.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBinPanel).toBeHidden();
		await editor.locator('[data-import-input]').setInputFiles([toneB]);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(clipByName(editor, toneB.name)).toBeVisible();
	});

	test('exposes Project bin icon controls, source selection, preview, replacement, and project removal', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const projectBin = editor.locator('[data-project-bin-drop-target]');
		await editor.locator('[data-project-bin-input]').setInputFiles([toneA]);
		const card = projectBin.locator('[data-project-bin-item]').first();
		const add = card.getByRole('button', { name: /Add to timeline/ });
		const selectInstances = card.getByRole('button', { name: /Select all instances/ });
		const preview = card.getByRole('button', { name: /^Play:/ });
		const more = card.getByRole('button', { name: /More file actions/ });

		await expect(add).toBeVisible();
		await expect(selectInstances).toBeDisabled();
		await expect(preview).toBeVisible();
		await expect(more).toBeVisible();
		const [moreBox, addBox] = await Promise.all([more.boundingBox(), add.boundingBox()]);
		expect(moreBox.x).toBeLessThan(addBox.x);

		await preview.click();
		await expect(card.getByRole('button', { name: /^Pause:/ })).toHaveAttribute('aria-pressed', 'true');
		await card.getByRole('button', { name: /^Pause:/ }).click();
		await expect(card.getByRole('button', { name: /^Play:/ })).toHaveAttribute('aria-pressed', 'false');

		await add.click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(selectInstances).toBeEnabled();
		await selectInstances.click();
		await expect(clipByName(editor, toneA.name).locator('.clip-display')).toHaveAttribute('data-selected', 'true');

		await more.click();
		const fileChooserPromise = page.waitForEvent('filechooser');
		await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
		const fileChooser = await fileChooserPromise;
		await fileChooser.setFiles(toneB);
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		await more.click();
		await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
		const dialog = page.locator('[data-project-bin-remove-dialog]');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Remove from project', exact: true }).click();
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	});

	test('reveals the Project bin for context moves and supports atomic pointer moves with Escape cancellation', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const firstClip = clipByName(editor, toneA.name);
		const secondClip = clipByName(editor, toneB.name);
		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });
		await expect(firstClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await expect(secondClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);

		await firstClip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		const clipMenu = page.locator('.audio-editor-clip-context-menu');
		const moveToBin = clipMenu.locator('[data-action-id="local://move-clip-to-project-bin"]');
		await expect(moveToBin).toHaveAttribute('data-parity-status', 'supplemental');
		await moveToBin.click();
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');
		const projectBin = projectBinPanel.locator('[data-project-bin-drop-target]');
		await expect(projectBinPanel).toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(2);

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(0);
		await expect(firstClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await expect(secondClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);

		const dragHeader = firstClip.locator('.clip-header');
		const [headerBounds, binBounds] = await Promise.all([dragHeader.boundingBox(), projectBin.boundingBox()]);
		expect(headerBounds).not.toBeNull();
		expect(binBounds).not.toBeNull();
		const startX = headerBounds.x + Math.min(32, headerBounds.width / 2);
		const startY = headerBounds.y + headerBounds.height / 2;
		const dropX = binBounds.x + binBounds.width / 2;
		const dropY = binBounds.y + Math.min(120, binBounds.height / 2);
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(dropX, dropY, { steps: 8 });
		await expect(projectBin).toHaveAttribute('data-drop-active', 'true');
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await expect(projectBin).not.toHaveAttribute('data-drop-active', 'true');
		await expect(editor).toHaveAttribute('data-clip-count', '2');

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(dropX, dropY, { steps: 8 });
		await page.mouse.up();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(2);
	});

	test('resizes tracks from track-control-panel edges and caps their height to the timeline', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clipHeader = clipByName(editor, toneA.name).locator('.clip-header');
		const trackRow = clipHeader.locator('xpath=ancestor::*[@data-track-row][1]');
		const trackHeader = trackRow.locator('[data-track-header]');
		const timelineInner = editor.locator('.audio-editor-timeline-inner');
		const [headerBounds, initialTrackBounds, timelineBounds] = await Promise.all([
			trackHeader.boundingBox(),
			trackRow.boundingBox(),
			timelineInner.boundingBox(),
		]);
		expect(headerBounds).not.toBeNull();
		expect(initialTrackBounds).not.toBeNull();
		expect(timelineBounds).not.toBeNull();
		const clipHeaderBounds = await clipHeader.boundingBox();
		await page.mouse.move(clipHeaderBounds.x + clipHeaderBounds.width / 2, clipHeaderBounds.y + clipHeaderBounds.height - 1);
		await page.mouse.down();
		await page.mouse.move(clipHeaderBounds.x + clipHeaderBounds.width / 2, clipHeaderBounds.y + clipHeaderBounds.height + 16, { steps: 3 });
		await page.mouse.up();
		expect((await trackRow.boundingBox())?.height).toBe(initialTrackBounds.height);

		const resizeX = headerBounds.x + headerBounds.width / 2;
		await page.mouse.move(resizeX, headerBounds.y + headerBounds.height - 2);
		await page.mouse.down();
		await page.mouse.move(resizeX, headerBounds.y + headerBounds.height + 60, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await trackRow.boundingBox())?.height).toBeGreaterThan(initialTrackBounds.height + 40);

		let resizedHeaderBounds = await trackHeader.boundingBox();
		const grownTrackBounds = await trackRow.boundingBox();
		await page.mouse.move(resizeX, resizedHeaderBounds.y + 2);
		await page.mouse.down();
		await page.mouse.move(resizeX, resizedHeaderBounds.y + 31, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await trackRow.boundingBox())?.height).toBeLessThan(grownTrackBounds.height - 20);

		resizedHeaderBounds = await trackHeader.boundingBox();
		const cappedTimelineBounds = await timelineInner.boundingBox();
		await page.mouse.move(resizeX, resizedHeaderBounds.y + resizedHeaderBounds.height - 2);
		await page.mouse.down();
		await page.mouse.move(resizeX, resizedHeaderBounds.y + timelineBounds.height * 2, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await trackRow.boundingBox())?.height).toBeLessThanOrEqual(Math.floor(cappedTimelineBounds.height * 0.9));
	});

	test('auto-fits new track heights until manual resizing and re-engages from View Zoom', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const timeline = editor.locator('[data-timeline]');
		const trackRows = editor.locator('[data-track-list] > [data-track-row]');
		const addAudioTrack = async () => {
			await editor.getByRole('button', { name: 'Add track', exact: true }).click();
			await page.getByRole('menu', { name: 'Add track', exact: true })
				.getByRole('menuitem', { name: 'Audio track', exact: true })
				.click();
		};

		await expect(trackRows).toHaveCount(1);
		expect((await trackRows.first().boundingBox())?.height).toBe(300);
		await importFiles(editor, [toneA]);
		let trackCount = await trackRows.count();
		while ((await trackRows.first().boundingBox())?.height > 114 && trackCount < 10) {
			await addAudioTrack();
			trackCount += 1;
			await expect(trackRows).toHaveCount(trackCount);
		}
		expect(trackCount).toBeLessThan(10);
		await expect.poll(() => trackRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
			.toEqual(Array(trackCount).fill(114));
		await expect.poll(() => timeline.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

		const clipHeader = clipByName(editor, toneA.name).locator('.clip-header');
		const resizedTrackRow = clipHeader.locator('xpath=ancestor::*[@data-track-row][1]');
		const trackHeader = resizedTrackRow.locator('[data-track-header]');
		const headerBounds = await trackHeader.boundingBox();
		const resizeX = headerBounds.x + headerBounds.width / 2;
		await page.mouse.move(resizeX, headerBounds.y + headerBounds.height - 1);
		await page.mouse.down();
		await page.mouse.move(resizeX, headerBounds.y + headerBounds.height + 24, { steps: 3 });
		await page.mouse.up();
		await expect.poll(async () => (await resizedTrackRow.boundingBox())?.height).toBeGreaterThan(114);

		await addAudioTrack();
		trackCount += 1;
		await expect(trackRows).toHaveCount(trackCount);
		expect((await trackRows.last().boundingBox())?.height).toBe(300);

		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Fit height']);
		await expect.poll(() => trackRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
			.toEqual(Array(trackCount).fill(114));

		const timelinePanel = editor.locator('.audio-editor-timeline-panel');
		await timelinePanel.evaluate((element) => { element.tabIndex = -1; element.focus(); });
		await page.keyboard.press('Control+Shift+ArrowDown');
		await expect.poll(() => trackRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
			.toEqual(Array(trackCount).fill(98));
		await page.keyboard.press('Control+Shift+ArrowUp');
		await expect.poll(() => trackRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
			.toEqual(Array(trackCount).fill(114));

		const firstTrackMenuButton = trackRows.first().getByRole('button', { name: 'Track menu', exact: true });
		await firstTrackMenuButton.click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu.getByRole('button', { name: 'Collapse track', exact: true })).toHaveCount(0);
		await trackMenu.getByRole('button', { name: 'Decrease track height', exact: true }).click();
		await expect.poll(async () => (await trackRows.first().boundingBox())?.height).toBe(98);
		await firstTrackMenuButton.click();
		await trackMenu.getByRole('button', { name: 'Increase track height', exact: true }).click();
		await expect.poll(async () => (await trackRows.first().boundingBox())?.height).toBe(114);
	});

	test('previews reusable bin clips on timeline drag and routes external drops by surface', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const projectBin = editor.locator('[data-project-bin-drop-target]');
		await editor.locator('[data-project-bin-input]').setInputFiles([toneA]);
		const card = projectBin.locator('[data-project-bin-item]').first();
		await expect(card).toBeVisible();
		const lane = editor.locator('.audio-editor-track-lane[data-track-lane]').first();
		const laneBounds = await lane.boundingBox();
		expect(laneBounds).not.toBeNull();
		const targetPosition = {
			x: laneBounds.x + Math.min(220, laneBounds.width - 24),
			y: laneBounds.y + laneBounds.height / 2,
		};
		const binTransfer = await page.evaluateHandle(() => new DataTransfer());
		await card.dispatchEvent('dragstart', { dataTransfer: binTransfer });
		await lane.dispatchEvent('dragover', {
			dataTransfer: binTransfer,
			clientX: targetPosition.x,
			clientY: targetPosition.y,
		});
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await lane.dispatchEvent('drop', {
			dataTransfer: binTransfer,
			clientX: targetPosition.x,
			clientY: targetPosition.y,
		});
		await card.dispatchEvent('dragend', { dataTransfer: binTransfer });
		await binTransfer.dispose();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);

		const explicitBinTransfer = await fileDataTransfer(page, [toneB]);
		await projectBin.dispatchEvent('dragenter', { dataTransfer: explicitBinTransfer });
		await projectBin.dispatchEvent('dragover', { dataTransfer: explicitBinTransfer });
		await expect(projectBin).toHaveAttribute('data-drop-active', 'true');
		await projectBin.dispatchEvent('drop', { dataTransfer: explicitBinTransfer });
		await explicitBinTransfer.dispose();
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(2);
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		const timelineTransfer = await fileDataTransfer(page, [monoTone, toneB]);
		const timelineDropX = laneBounds.x + Math.min(420, laneBounds.width - 24);
		const timelineDropY = laneBounds.y + laneBounds.height / 2;
		await lane.dispatchEvent('dragover', {
			dataTransfer: timelineTransfer,
			clientX: timelineDropX,
			clientY: timelineDropY,
		});
		await lane.dispatchEvent('drop', {
			dataTransfer: timelineTransfer,
			clientX: timelineDropX,
			clientY: timelineDropY,
		});
		await timelineTransfer.dispose();
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(2);
		const droppedClipDialog = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
		await expect.poll(async () => Number(await clipField(droppedClipDialog, 'startFrame').inputValue())).toBeGreaterThan(0);
		await closeDialog(droppedClipDialog);
	});

	test('suppresses the default Project bin on compact mobile until explicitly opened', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const editor = await bootEditor(page, '/embed/en/');
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');
		await expect(projectBinPanel).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Project bin']);
		await expect(projectBinPanel).toBeVisible();
	});

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
		await search.fill('reset-configuration');
		const disabledCommand = popup.locator('[data-editor-search-key="command:reset-configuration"]');
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
		await showToolbarButton(page, editor, 'Split at playhead');

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
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		await secondImportedTrack.getByRole('button', { name: /^Arm for recording:/ }).click();
		await expect(secondImportedTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
		await expect(secondImportedTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.locator('button[aria-label^="Arm for recording:"][aria-pressed="true"]')).toHaveCount(2);

		const effectsPanel = await openEffectsForTrack(editor, 2);
		await commitInput(effectsPanel.locator('[data-master-gain] input'), '-3');
		await expect(effectsPanel.locator('[data-master-gain] input')).toHaveValue('-3.00');
		await closeEffectsPanel(effectsPanel);

		const analysisPanel = await openAnalysisPanel(page, editor);
		await expect(analysisPanel.getByRole('button', { name: 'Analyze track', exact: true })).toHaveCount(0);
		await analysisPanel.getByRole('button', { name: 'Analyze master' }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		await expect(analysisPanel.locator('[data-analysis-value="peak"]')).not.toHaveText('−∞ dBFS');
		await expect(analysisPanel.locator('[data-analysis-value="clipping"]')).toHaveText('0');
		await expect(analysisPanel.locator('[data-analysis-spectrum]')).toBeVisible();
		await expect(analysisPanel.locator('[data-analysis-spectrogram]')).toBeVisible();
		await analysisPanel.getByRole('button', { name: 'Close: Analysis', exact: true }).click();
		await expect(analysisPanel).toHaveCount(0);

		for (const [command, panelId, panelName] of [
			['Plot spectrum', 'spectrum', 'Plot spectrum'],
			['Find clipping', 'clipping', 'Find clipping'],
			['Contrast', 'contrast', 'Contrast'],
			['EBU R 128', 'ebu-r128', 'EBU R 128'],
		]) {
			await chooseCommandAction(page, editor, 'Analyze', command);
			const analyzerPanel = editor.locator(`[data-workspace-panel="${panelId}"]`);
			await expect(analyzerPanel).toBeVisible();
			await expect(analyzerPanel).toHaveCSS('resize', 'none');
			await expect(analyzerPanel.locator('[data-floating-panel-resize-handle]')).toHaveCount(0);
			if (panelId === 'ebu-r128') {
				await expect(analyzerPanel.locator('.kw-audio-editor__ebu-dashboard')).toBeVisible();
			}
			await analyzerPanel.getByRole('button', { name: `Close: ${panelName}`, exact: true }).click();
			await expect(analyzerPanel).toHaveCount(0);
		}

		await chooseNestedCommandAction(page, editor, 'View', ['Panels']);
		const panelsMenu = page.getByRole('menu', { name: 'Panels', exact: true });
		for (const analyzerName of ['Analysis', 'Plot spectrum', 'Find clipping', 'Contrast', 'EBU R 128']) {
			await expect(panelsMenu.getByRole('menuitem', { name: analyzerName, exact: true })).toHaveCount(0);
		}
		await page.keyboard.press('Escape');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		await expect(restored).toHaveAttribute('data-track-count', '3');
		await expect(restored).toHaveAttribute('data-clip-count', '3');
		const restoredSecondTrack = restored.locator('[data-track-row]').nth(2);
		await expect(restoredSecondTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
		await expect(restoredSecondTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
		await chooseCommandAction(page, restored, 'View', 'Enable multi-track recording');
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
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '5');

		await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: undefined,
		}));
		const downloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'Export AUP4']);
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.aup4$/i);
		const snapshotPath = await download.path();
		expect(snapshotPath).toBeTruthy();
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: download.suggestedFilename(),
			mimeType: 'application/x-audacity-project',
			buffer: await readFile(snapshotPath),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '5');
		expect(errors).toEqual([]);
	});

	test('keeps an active missing AUP4 effect visible, bypassed, and ordered across save and reopen', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const fixture = await createAup4MissingEffectFixture();

		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'missing-superverb.aup4',
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(fixture),
		});

		const compatibilitySummary = editor.locator('[data-aup4-compatibility-summary]');
		await expect(compatibilitySummary).toBeVisible({ timeout: 30_000 });
		await expect(compatibilitySummary).toContainText('AUP4 open: 0 converted, 1 missing, 0 omitted.');
		await expect(editor).toHaveAttribute('data-track-count', '1');

		let effectsPanel = await openEffectsForTrack(editor, 0);
		let rack = effectsPanel.locator('[data-effect-rack]');
		await expect(rack.locator('.effect-slot__name-text')).toHaveText([
			'Invert',
			'Missing: SuperVerb',
			'Echo',
		]);
		const missingEffect = rack.getByRole('group', { name: 'Missing: SuperVerb', exact: true });
		const selectMissingEffect = missingEffect.getByRole('button', { name: 'Select effect', exact: true });
		await selectMissingEffect.focus();
		await selectMissingEffect.press('Enter');
		const missingDialog = page.getByRole('dialog', { name: 'Missing: SuperVerb', exact: true });
		await expect(missingDialog.locator('[data-missing-effect]')).toContainText('Local playback bypasses it');
		await closeDialog(missingDialog);
		await closeEffectsPanel(effectsPanel);

		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'AUP4 Compatibility Report']);
		let reportDialog = page.getByRole('dialog', { name: 'AUP4 Compatibility Report', exact: true });
		await expect(reportDialog.locator('[data-aup4-compatibility-report]')).toContainText('Missing: SuperVerb');
		await closeAup4CompatibilityReport(reportDialog);

		await compatibilitySummary.getByRole('button', { name: 'Dismiss compatibility summary', exact: true }).click();
		await expect(compatibilitySummary).toBeHidden();
		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'AUP4 Compatibility Report']);
		reportDialog = page.getByRole('dialog', { name: 'AUP4 Compatibility Report', exact: true });
		await expect(reportDialog.locator('[data-aup4-compatibility-report]')).toContainText('Missing: SuperVerb');
		await closeAup4CompatibilityReport(reportDialog);

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();

		await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: undefined,
		}));
		const downloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'Export AUP4']);
		const download = await downloadPromise;
		const snapshotPath = await download.path();
		expect(snapshotPath).toBeTruthy();
		await expect(compatibilitySummary).toBeVisible({ timeout: 30_000 });
		await expect(compatibilitySummary).toContainText('AUP4 export: 0 converted, 1 missing, 0 omitted.');

		await editor.locator('[data-aup4-input]').setInputFiles({
			name: download.suggestedFilename(),
			mimeType: 'application/x-audacity-project',
			buffer: await readFile(snapshotPath),
		});
		await expect(compatibilitySummary).toContainText('AUP4 open: 0 converted, 1 missing, 0 omitted.', { timeout: 30_000 });

		effectsPanel = await openEffectsForTrack(editor, 0);
		rack = effectsPanel.locator('[data-effect-rack]');
		await expect(rack.locator('.effect-slot__name-text')).toHaveText([
			'Invert',
			'Missing: SuperVerb',
			'Echo',
		]);
		await closeEffectsPanel(effectsPanel);
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
		const waveformRatioBeforeTrim = await trimWaveform.evaluate((canvas) => (
			canvas.__kwWaveformPlan.frameCount / canvas.__kwWaveformPlan.durationFrames
		));
		await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(trimBox.x - 24, trimBox.y + trimBox.height / 2, { steps: 4 });
		await expect.poll(async () => (await secondClip.boundingBox())?.width || 0).toBeLessThan(secondBeforeTrim.width - 10);
		const waveformRatioDuringTrim = await trimWaveform.evaluate((canvas) => (
			canvas.__kwWaveformPlan.frameCount / canvas.__kwWaveformPlan.durationFrames
		));
		expect(waveformRatioDuringTrim).toBeCloseTo(waveformRatioBeforeTrim, 4);
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

	test('renders solid Audacity summary columns and connected samples across zoom levels', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await editor.getByRole('button', { name: 'Zoom out', exact: true }).click();
		const waveform = clipByName(editor, longTone.name).locator('canvas.clip-body__waveform');
		await expect(waveform).toHaveAttribute('data-waveform-renderer', 'audacity');
		await expect(waveform).toHaveAttribute('data-waveform-mode', 'summary');
		await expect(waveform).toHaveAttribute('data-waveform-source', 'peaks');

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
		expect(await page.evaluate(() => globalThis.__waveformStrokesAfterPointerDown)).toBeGreaterThan(10);
		await page.mouse.up();
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await page.evaluate(() => {
			globalThis.__waveformClearsAfterPointerDown = 0;
			globalThis.__waveformStrokesAfterPointerDown = 0;
		});
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
		await page.locator('.audio-editor-track-menu').getByRole('button', { name: 'Multi-view', exact: true }).click();
		await expect(track).toHaveAttribute('data-display-mode', 'multiview');
		await expect(waveform).toHaveAttribute('data-waveform-owner', 'audacity');
		const spectrogramColors = await waveform.evaluate((canvas) => {
			const context = canvas.getContext('2d');
			const { data, width, height } = context.getImageData(0, 0, canvas.width, Math.floor(canvas.height / 2));
			const colors = new Set();
			for (let offset = 0; offset < data.length; offset += 4) {
				if (data[offset + 3] === 0) continue;
				colors.add(`${data[offset]}:${data[offset + 1]}:${data[offset + 2]}`);
				if (colors.size > 4) break;
			}
			return { colors: colors.size, width, height };
		});
		expect(spectrogramColors.width).toBeGreaterThan(40);
		expect(spectrogramColors.height).toBeGreaterThan(10);
		expect(spectrogramColors.colors).toBeGreaterThan(1);
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
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		await expect(editor).toHaveAttribute('data-timeline-view', 'spectrogram');
		await expect(editor.getByRole('button', { name: 'Spectrogram', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
		await expect(editor.getByRole('tablist', { name: 'Project tabs' })).toBeVisible();
		await expect(editor.getByRole('tab')).toHaveCount(1);

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
		const trackMenuButton = firstTrack.getByRole('button', { name: 'Track menu' });
		await trackMenuButton.click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu).toBeVisible();
		const [trackMenuButtonBox, trackMenuBox] = await Promise.all([trackMenuButton.boundingBox(), trackMenu.boundingBox()]);
		expect(trackMenuButtonBox).not.toBeNull();
		expect(trackMenuBox).not.toBeNull();
		expect(Math.abs(trackMenuBox.x - trackMenuButtonBox.x)).toBeLessThanOrEqual(1);
		expect(trackMenuBox.y).toBeGreaterThanOrEqual(trackMenuButtonBox.y + trackMenuButtonBox.height - 1);
		await page.getByRole('button', { name: 'Enable multi-track recording' }).click();
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
		await trackMenu.getByRole('button', { name: 'Enable multi-track recording', exact: true }).click();
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

	test('changes stable track colors and supports inherited or overridden clip colors', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const clip = clipByName(editor, toneA.name);
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		const clipBody = clip.locator('.clip-body');

		await track.getByRole('button', { name: 'Track menu', exact: true }).click();
		await page.locator('.audio-editor-track-menu').getByRole('button', { name: 'Track color', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Track color: Red', exact: true }).click();
		await expect(track).toHaveAttribute('data-track-color', 'red');
		await expect(clipBody).toHaveAttribute('data-color', 'red');

		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Clip color/ }).hover();
		await page.getByRole('menuitem', { name: 'Green', exact: true }).click();
		await expect(clipBody).toHaveAttribute('data-color', 'green');

		await track.getByRole('button', { name: 'Track menu', exact: true }).click();
		await page.locator('.audio-editor-track-menu').getByRole('button', { name: 'Track color', exact: true }).click();
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
		await chooseNestedCommandAction(page, editor, 'View', ['Panels']);
		const panelsMenu = page.getByRole('menu', { name: 'Panels', exact: true });
		await expect(panelsMenu.getByRole('menuitem', { name: 'Spectrogram', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');

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

		await chooseFileAction(page, editor, 'Local projects');
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
		const picker = page.getByRole('menu', { name: 'Choose an effect' });
		await expect(picker.getByRole('menuitem')).toHaveCount(22);
		await expect(picker.getByRole('menuitem', { name: 'Invert' })).toHaveCount(1);
		await expect(picker.getByRole('menuitem', { name: 'Paulstretch' })).toHaveCount(0);
		await picker.getByRole('menuitem', { name: 'Invert' }).click();
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);

		await openRackPicker(effectsPanel, 'master');
		await page.getByRole('menu', { name: 'Choose an effect' }).getByRole('menuitem', { name: 'Bass and Treble' }).click();
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Bass and Treble' })).toHaveCount(1);
		const bassDialog = page.getByRole('dialog', { name: 'Bass and Treble', exact: true });
		const bassKnob = bassDialog.locator('[data-effect-param="bassDb"]').getByRole('slider', { name: /Bass \(dB\):/ });
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
		await commitInput(bassDialog.locator('[data-effect-param="bassDb"] input'), '7.5');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 0);
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);
		const bassTreble = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Bass and Treble' });
		await expect(bassTreble).toHaveCount(1);
		await bassTreble.getByRole('button', { name: 'Select effect' }).click();
		await expect(page.getByRole('dialog', { name: 'Bass and Treble', exact: true }).locator('[data-effect-param="bassDb"] input')).toHaveValue('7.5');
		expect(errors).toEqual([]);
	});

	test('keeps rack knob updates live and ends Delay gestures when the window blurs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const effectsPanel = await openEffectsForTrack(editor, 0);

		await addRackEffect(page, effectsPanel, 'track', 'Reverb');
		const reverb = page.getByRole('dialog', { name: 'Reverb', exact: true });
		const decayInput = reverb.locator('[data-effect-param="decay"] input');
		const decayKnob = reverb.locator('[data-effect-param="decay"]').getByRole('slider', { name: /Decay:/ });
		const initialDecay = await decayInput.inputValue();
		const decayBox = await decayKnob.boundingBox();
		expect(decayBox).not.toBeNull();
		await page.mouse.move(decayBox.x + decayBox.width / 2, decayBox.y + decayBox.height / 2);
		await page.mouse.down();
		try {
			await page.mouse.move(decayBox.x + decayBox.width / 2 + 20, decayBox.y + decayBox.height / 2);
			await expect.poll(() => decayInput.inputValue()).not.toBe(initialDecay);
		} finally {
			await page.mouse.up();
		}
		await closeDialog(reverb);

		await addRackEffect(page, effectsPanel, 'track', 'Delay');
		const delay = page.getByRole('dialog', { name: 'Delay', exact: true });
		const mixField = delay.locator('[data-effect-param="mix"]');
		const mixInput = mixField.locator('input');
		const mixKnob = mixField.getByRole('slider', { name: /Mix:/ });
		await commitInput(mixInput, '0');
		const dryBox = await mixKnob.boundingBox();
		expect(dryBox).not.toBeNull();
		await page.mouse.move(dryBox.x + dryBox.width / 2, dryBox.y + dryBox.height / 2);
		await page.mouse.down();
		try {
			await expect(mixKnob).toHaveClass(/knob--dragging/);
			await page.waitForTimeout(50);
			await page.evaluate(({ clientX, clientY }) => {
				document.dispatchEvent(new MouseEvent('mousemove', {
					bubbles: true,
					buttons: 1,
					clientX,
					clientY,
				}));
			}, {
				clientX: dryBox.x + dryBox.width / 2,
				clientY: dryBox.y + dryBox.height / 2 - 24,
			});
			await expect.poll(async () => Number(await mixKnob.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
			await expect.poll(() => mixInput.inputValue()).not.toBe('0');
		} finally {
			await page.mouse.up();
		}

		await commitInput(mixInput, '0.2');
		const liveBox = await mixKnob.boundingBox();
		expect(liveBox).not.toBeNull();
		await page.mouse.move(liveBox.x + liveBox.width / 2, liveBox.y + liveBox.height / 2);
		await page.mouse.down();
		await expect(mixKnob).toHaveClass(/knob--dragging/);
		await page.waitForTimeout(50);
		await page.evaluate(({ clientX, clientY }) => {
			document.dispatchEvent(new MouseEvent('mousemove', {
				bubbles: true,
				buttons: 1,
				clientX,
				clientY,
			}));
		}, {
			clientX: liveBox.x + liveBox.width / 2,
			clientY: liveBox.y + liveBox.height / 2 - 20,
		});
		await expect(mixInput).toHaveValue('0.2');
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await expect(mixKnob).not.toHaveClass(/knob--dragging/);
		await expect.poll(() => mixInput.inputValue()).not.toBe('0.2');
		const committedMix = await mixInput.inputValue();
		await page.mouse.move(liveBox.x + liveBox.width / 2, liveBox.y + liveBox.height / 2 - 40);
		await expect.poll(() => mixInput.inputValue()).toBe(committedMix);
		await page.mouse.up();

		await closeDialog(delay);
		expect(errors).toEqual([]);
	});

	test('opens effects in a full-width dock and keeps effect settings open when the dock closes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');
		if (await projectBinPanel.isVisible()) {
			await projectBinPanel.locator('.kw-audio-editor__workspace-panel-close').click();
			await expect(projectBinPanel).toBeHidden();
		}
		const effectsPanel = await openEffectsForTrack(editor, 0);
		const rack = effectsPanel.locator('[data-effect-rack]');
		const packagePanel = rack.locator('.effects-panel');
		const sideDock = editor.locator('[data-panel-dock="right"]:has([data-workspace-panel="effects"])');
		const resizeHandle = sideDock.locator('[data-workspace-dock-resize-handle="right"]');

		await expect(editor.locator('[data-effects-overlay]')).toHaveCount(0);
		await expect(effectsPanel.locator('.kw-audio-editor__workspace-panel-header').getByText('Effects', { exact: true })).toBeVisible();
		await expect(packagePanel.locator('.effects-panel__header, .effects-panel-header')).toBeHidden();
		await expect(resizeHandle).toHaveCSS('cursor', 'ew-resize');
		await expect(resizeHandle).toHaveText('↔');
		await expect(resizeHandle).toHaveCSS('writing-mode', 'horizontal-tb');
		const initialDockBox = await sideDock.boundingBox();
		expect(initialDockBox).not.toBeNull();
		await page.mouse.move(initialDockBox.x + 2, initialDockBox.y + initialDockBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(initialDockBox.x - 46, initialDockBox.y + initialDockBox.height / 2, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await sideDock.boundingBox())?.width || 0).toBeGreaterThan(initialDockBox.width + 30);
		await effectsPanel.locator('[data-workspace-panel-dock-picker="effects"]').selectOption('left');
		const leftDock = editor.locator('[data-panel-dock="left"]:has([data-workspace-panel="effects"])');
		const leftResizeHandle = leftDock.locator('[data-workspace-dock-resize-handle="left"]');
		await expect(leftResizeHandle).toHaveCSS('cursor', 'ew-resize');
		await expect(leftResizeHandle).toHaveText('↔');
		await expect(leftResizeHandle).toHaveCSS('writing-mode', 'horizontal-tb');
		const initialLeftDockBox = await leftDock.boundingBox();
		expect(initialLeftDockBox).not.toBeNull();
		await leftResizeHandle.press('ArrowLeft');
		await expect.poll(async () => (await leftDock.boundingBox())?.width || 0).toBeLessThan(initialLeftDockBox.width);
		const shrunkenLeftDockBox = await leftDock.boundingBox();
		expect(shrunkenLeftDockBox).not.toBeNull();
		await page.mouse.move(
			shrunkenLeftDockBox.x + shrunkenLeftDockBox.width - 2,
			shrunkenLeftDockBox.y + shrunkenLeftDockBox.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			shrunkenLeftDockBox.x + shrunkenLeftDockBox.width + 30,
			shrunkenLeftDockBox.y + shrunkenLeftDockBox.height / 2,
			{ steps: 4 },
		);
		await page.mouse.up();
		await expect.poll(async () => (await leftDock.boundingBox())?.width || 0).toBeGreaterThan(shrunkenLeftDockBox.width + 20);
		await expect.poll(async () => {
			const [rackBox, panelBox] = await Promise.all([rack.boundingBox(), packagePanel.boundingBox()]);
			return rackBox && panelBox ? Math.abs(rackBox.width - panelBox.width) : Number.POSITIVE_INFINITY;
		}).toBeLessThanOrEqual(1);

		const masterSection = packagePanel.locator('.effects-panel__content > .effects-panel__master-section');
		await expect(masterSection).toBeVisible();
		await expect.poll(async () => {
			const [panelBox, masterBox] = await Promise.all([packagePanel.boundingBox(), masterSection.boundingBox()]);
			return panelBox && masterBox ? masterBox.y - panelBox.y : 0;
		}).toBeGreaterThan(120);

		await addRackEffect(page, effectsPanel, 'track', 'Reverb');
		const settings = page.getByRole('dialog', { name: 'Reverb', exact: true });
		await expect(settings).toBeVisible();
		await closeEffectsPanel(effectsPanel);
		await expect(settings).toBeVisible();
		await closeDialog(settings);
		expect(errors).toEqual([]);
	});

	test('edits and restores a parametric EQ rack through its graph controls', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let effectsPanel = await openEffectsForTrack(editor, 1);

		await openRackPicker(effectsPanel, 'track');
		const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
		const eqOption = picker.getByRole('menuitem', { name: /parametric EQ/i }).first();
		await expect(eqOption).toBeVisible();
		await eqOption.click();

		let eq = page.locator('[data-parametric-eq]');
		await expect(eq).toBeVisible();
		let handles = eq.locator('.audio-editor-parametric-eq__handle');
		await expect(handles).toHaveCount(4);
		await eq.getByRole('button', { name: 'Add band', exact: true }).click();
		await expect(handles).toHaveCount(5);
		await expect(handles.nth(4)).toHaveAttribute('data-selected', 'true');

		let eqDialog = eq.locator('xpath=ancestor::*[@role="dialog"]').first();
		await closeDialog(eqDialog);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		let rackEq = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: /parametric EQ/i });
		await rackEq.getByRole('button', { name: 'Select effect', exact: true }).click();
		eq = page.locator('[data-parametric-eq]');
		handles = eq.locator('.audio-editor-parametric-eq__handle');
		await expect(handles).toHaveCount(4);
		eqDialog = eq.locator('xpath=ancestor::*[@role="dialog"]').first();
		await closeDialog(eqDialog);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		rackEq = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: /parametric EQ/i });
		await rackEq.getByRole('button', { name: 'Select effect', exact: true }).click();
		eq = page.locator('[data-parametric-eq]');
		handles = eq.locator('.audio-editor-parametric-eq__handle');
		await expect(handles).toHaveCount(5);

		await handles.nth(4).click();
		const selectedBand = eq.getByRole('region', { name: 'Selected band', exact: true });
		await commitInput(selectedBand.getByLabel('Frequency (Hz)', { exact: true }), '3200');
		await commitInput(selectedBand.getByLabel('Gain (dB)', { exact: true }), '4.5');
		await commitInput(selectedBand.getByLabel('Q', { exact: true }), '1.75');
		await selectedBand.locator('select').first().selectOption('lowshelf');
		await commitInput(eq.locator('.audio-editor-parametric-eq__output input[type="number"]'), '-2.5');
		await expect(selectedBand.locator('select').first()).toHaveValue('lowshelf');
		await expect(selectedBand.getByLabel('Frequency (Hz)', { exact: true })).toHaveValue('3200');
		await expect(selectedBand.getByLabel('Gain (dB)', { exact: true })).toHaveValue('4.5');
		await expect(eq.locator('.audio-editor-parametric-eq__output input[type="number"]')).toHaveValue('-2.5');

		const settingsDialog = eq.locator('xpath=ancestor::*[@role="dialog"]').first();
		await closeDialog(settingsDialog);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();

		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 1);
		rackEq = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: /parametric EQ/i });
		await expect(rackEq).toHaveCount(1);
		await rackEq.getByRole('button', { name: 'Select effect', exact: true }).click();
		eq = page.locator('[data-parametric-eq]');
		await expect(eq.locator('.audio-editor-parametric-eq__handle')).toHaveCount(5);
		await eq.locator('.audio-editor-parametric-eq__handle').nth(4).click();
		const restoredBand = eq.getByRole('region', { name: 'Selected band', exact: true });
		await expect(restoredBand.locator('select').first()).toHaveValue('lowshelf');
		await expect(restoredBand.getByLabel('Frequency (Hz)', { exact: true })).toHaveValue('3200');
		await expect(restoredBand.getByLabel('Gain (dB)', { exact: true })).toHaveValue('4.5');
		await expect(eq.locator('.audio-editor-parametric-eq__output input[type="number"]')).toHaveValue('-2.5');
		await closeDialog(eq.locator('xpath=ancestor::*[@role="dialog"]').first());
		await restored.getByRole('button', { name: 'Play', exact: true }).click();
		const pause = restored.getByRole('button', { name: 'Pause', exact: true });
		await expect(pause).toBeVisible();
		await pause.click();

		test.skip(!await page.evaluate(() => typeof globalThis.OfflineAudioContext === 'function' || typeof globalThis.webkitOfflineAudioContext === 'function'), 'OfflineAudioContext is unavailable in this browser.');
		const exportDialog = await openExportDialog(page, restored);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 15_000 });
		await expect(download).toHaveAttribute('download', /\.wav$/);
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
		await page.getByRole('menu', { name: 'Choose an effect' }).getByRole('menuitem', { name: 'Noise Reduction' }).click();

		const reduction = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Noise Reduction' });
		await expect(reduction.getByRole('button', { name: 'Enable effect' })).toBeVisible();
		const settingsDialog = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
		await settingsDialog.locator('[data-effect-noise-profile]').getByRole('button').click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(reduction.getByRole('button', { name: 'Disable effect' })).toBeVisible();
		await expect(settingsDialog.locator('[data-effect-noise-profile]')).toContainText('Replace noise profile');
		await closeDialog(settingsDialog);

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

	test('offers and destructively applies the parametric EQ from the selection Effect menu', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');

		const effectDialog = await openParametricEqSelectionEffect(page, editor);
		const eq = effectDialog.locator('[data-parametric-eq]');
		await expect(eq).toBeVisible();
		await expect(eq.locator('.audio-editor-parametric-eq__handle')).toHaveCount(4);
		await commitInput(eq.locator('.audio-editor-parametric-eq__output input[type="number"]'), '-6');
		await expect(eq.locator('.audio-editor-parametric-eq__output input[type="number"]')).toHaveValue('-6');
		await effectDialog.getByRole('button', { name: 'Preview', exact: true }).click();
		const stopPreview = effectDialog.getByRole('button', { name: 'Stop preview', exact: true });
		await expect(stopPreview).toBeVisible();
		await stopPreview.click();
		await expect(effectDialog.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
		await effectDialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();

		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(effectDialog).toBeHidden();
		await expect(editor.locator('[data-clip-id]')).toContainText(/parametric EQ/i);
		await expect.poll(async () => (
			(await effectSourceMetadata(page)).some((source) => /parametric EQ/i.test(source.name || ''))
		)).toBe(true);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, monoTone.name)).toHaveCount(1);
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
		await chooseCommandAction(page, editor, 'Edit', 'Copy');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor.getByRole('tablist', { name: 'Project tabs' }).getByRole('tab')).toHaveCount(2);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('keeps playback smooth without redrawing clip waveforms or producing long tasks', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await showToolbarButton(page, editor, 'Split at playhead');
		await importFiles(editor, [toneA]);
		await seekOnRuler(editor, 60);
		await editor.getByRole('button', { name: 'Split at playhead' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		test.skip(!await page.evaluate(() => PerformanceObserver.supportedEntryTypes?.includes('longtask')), 'The Long Task API is unavailable in this browser.');
		await page.evaluate(() => {
			globalThis.__audioEditorLongTasks = [];
			globalThis.__playbackWaveformDraws = 0;
			const prototype = CanvasRenderingContext2D.prototype;
			const clearRect = prototype.clearRect;
			prototype.clearRect = function countPlaybackWaveformDraws(...args) {
				if (this.canvas?.matches('canvas.clip-body__waveform')) globalThis.__playbackWaveformDraws += 1;
				return clearRect.apply(this, args);
			};
			globalThis.__audioEditorLongTaskObserver = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) globalThis.__audioEditorLongTasks.push(entry.duration);
			});
			globalThis.__audioEditorLongTaskObserver.observe({ type: 'longtask', buffered: false });
		});

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await page.waitForTimeout(500);
		await page.evaluate(() => { globalThis.__playbackWaveformDraws = 0; });
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
			globalThis.__audioEditorLongTaskObserver.disconnect();
			return {
				longestTask: Math.max(0, ...globalThis.__audioEditorLongTasks),
				waveformDraws: globalThis.__playbackWaveformDraws,
			};
		});
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(new Set(playheadPositions.map((position) => position.toFixed(1))).size).toBeGreaterThan(10);
		expect(playbackMetrics.waveformDraws).toBe(0);
		expect(playbackMetrics.longestTask).toBeLessThanOrEqual(50);
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

	test('opens the same project read-only in another tab and can claim its lock', async ({ page, context }) => {
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
		await second.getByRole('button', { name: 'Edit here' }).click();
		await expect(readOnlyRecord).toBeEnabled();
		const firstRecord = first.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(firstRecord).toBeDisabled({ timeout: 5_000 });
		await expect(first.locator('[data-status]')).toContainText('already open in another tab');

		await page.close();
		await expect(second.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 5_000 });
		await expect(readOnlyRecord).toBeEnabled();
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
		await analysisPanel.getByRole('button', { name: 'Close: Analysis', exact: true }).click();

		const exportDialog = await openExportDialog(page, editor);
		await assertAccessibleBasics(exportDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(exportDialog);
	});

	test('matches the desktop, tablet, and mobile editor shells in light and dark themes', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'chromium', 'The canonical visual baselines use desktop Chromium.');
		test.setTimeout(60_000);
		const editor = await bootEditor(page, '/embed/en/');
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

	test('encodes a local MP3 with the self-hosted FFmpeg core', async ({ page }) => {
		test.skip(process.env.AUDIO_EDITOR_FFMPEG_BROWSER !== '1', 'Enable for the 31 MB FFmpeg integration check.');
		// Exercise the production runtime URL contract with the exact pinned npm
		// bytes so CDN availability and CORS configuration cannot make CI flaky.
		const runtimeRoot = 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10';
		const runtimeFiles = new Map([
			['ffmpeg-core.js', {
				file: new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url),
				contentType: 'text/javascript',
			}],
			['ffmpeg-core.wasm', {
				file: new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url),
				contentType: 'application/wasm',
			}],
		]);
		await page.route(`${runtimeRoot}/**`, async (route) => {
			const fixture = runtimeFiles.get(new URL(route.request().url()).pathname.split('/').at(-1));
			if (!fixture) return route.fulfill({ status: 404, body: 'Unknown FFmpeg runtime asset.' });
			return route.fulfill({
				status: 200,
				contentType: fixture.contentType,
				body: await readFile(fixture.file),
			});
		});
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

async function fileDataTransfer(page, files) {
	return page.evaluateHandle((entries) => {
		const transfer = new DataTransfer();
		for (const entry of entries) {
			const binary = atob(entry.base64);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			transfer.items.add(new File([bytes], entry.name, { type: entry.mimeType }));
		}
		return transfer;
	}, files.map((file) => ({
		name: file.name,
		mimeType: file.mimeType,
		base64: file.buffer.toString('base64'),
	})));
}

async function importFiles(editor, files) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await projectBin.isVisible()) {
		await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBin).toBeHidden();
	}
	await editor.locator('[data-import-input]').setInputFiles(files);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
}

let aup4FixtureSql;
async function createAup4MissingEffectFixture() {
	const SQL = await (aup4FixtureSql ||= initSqlJs());
	const sampleRate = 48_000;
	const frameCount = sampleRate;
	const source = createAudioSourceV2({
		id: 'missing-effects-source',
		storageKey: 'missing-effects-source',
		name: 'Missing effects source',
		frameCount,
		channelCount: 1,
		sampleRate,
		originalSampleRate: sampleRate,
	});
	const clip = createAudioClipV2({
		id: 'missing-effects-clip',
		sourceId: source.id,
		title: 'Missing effects audio',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: frameCount,
		durationFrames: frameCount,
	});
	const track = createAudioTrackV2({
		id: 'missing-effects-track',
		name: 'Missing effects track',
		clipIds: [clip.id],
		effects: [
			createEffect('audacity-invert', { id: 'fixture-invert' }),
			createMissingEffect({
				id: 'fixture-superverb',
				enabled: true,
				missing: {
					name: 'SuperVerb',
					nativeId: 'Effect_VST3_Acme_SuperVerb_/plugins/superverb.vst3',
					reason: 'plugin-unavailable',
					source: 'aup4',
				},
			}),
			createEffect('audacity-echo', {
				id: 'fixture-echo',
				params: { delaySeconds: 0.1, decay: 0.25 },
			}),
		],
	}, sampleRate);
	const project = createAudioEditorProjectV2({
		id: 'missing-effects-project',
		title: 'Missing effects fixture',
		sampleRate,
		sources: [source],
		clips: [clip],
		tracks: [track],
		selection: {
			startFrame: 0,
			endFrame: frameCount,
			trackIds: [track.id],
			clipIds: [clip.id],
		},
		view: { selectedTrackIds: [track.id] },
	});
	const samples = Float32Array.from(
		{ length: frameCount },
		(_value, frame) => Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.2,
	);
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const blockId = insertAup4SampleBlock(database, createAup4SampleBlock(samples));
		const channelBlocks = new Map([
			[`${source.id}:0`, [{ blockId, start: 0, sampleCount: frameCount }]],
		]);
		writeAup4Document(
			database,
			encodeAudacityBinaryXml(createAup4ProjectDocument(project, channelBlocks)),
			{ autosave: false, now: 0 },
		);
		prepareAup4PortableExport(database);
		return database.export();
	} finally {
		database.close();
	}
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

async function openClipProperties(page, editor, clip, clickOptions = {}) {
	if (clip) {
		await clip.click({ position: { x: 24, y: 10 }, ...clickOptions });
		if (clickOptions.force) {
			await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Clip properties']);
		} else {
			await clip.getByRole('button', { name: 'Clip menu' }).click();
			await page.getByRole('menuitem', { name: 'Clip properties', exact: true }).click();
		}
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
	const panel = editor.locator('[data-workspace-panel="effects"]');
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('region', { name: 'Effects panel', exact: true })).toBeVisible();
	return panel;
}

async function openSelectionEffectDialog(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="selection-effect"]')).toBeVisible();
	return dialog;
}

async function openParametricEqSelectionEffect(page, editor) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	const effectMenu = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(effectMenu).toBeVisible();
	const filters = effectMenu.getByRole('menuitem', { name: /^EQ and filters(?:\s|$)/i }).first();
	await expect(filters).toBeVisible();
	await filters.focus();
	await page.keyboard.press('ArrowRight');
	const filtersMenu = filters.getByRole('menu');
	await expect(filtersMenu).toBeVisible();
	const eq = filtersMenu.getByRole('menuitem', { name: /parametric EQ/i }).first();
	await expect(eq).toBeVisible();
	await eq.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="selection-effect"]')).toBeVisible();
	return dialog;
}

async function openAnalysisPanel(page, editor) {
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const panel = editor.locator('[data-workspace-panel="analysis"]');
	await expect(panel).toBeVisible();
	return panel;
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

async function closeAup4CompatibilityReport(dialog) {
	await dialog.locator('[data-aup4-compatibility-report]').getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function closeEffectsPanel(panel) {
	await panel.getByRole('button', { name: 'Close: Effects', exact: true }).click();
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
	await expect(panel.page().getByRole('menu', { name: 'Choose an effect' })).toBeVisible();
}

async function addRackEffect(page, panel, scope, effectName) {
	await openRackPicker(panel, scope);
	const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
	await picker.getByRole('menuitem', { name: effectName, exact: true }).click();
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

async function showToolbarButton(page, editor, label) {
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	const flyout = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
	const toggle = flyout.getByRole('checkbox', { name: label, exact: true });
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await expect(flyout).toBeHidden();
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
	const name = new RegExp(`^${escapedLabel}(?:\\s|$)`);
	return menu.getByRole('menuitem', { name })
		.or(menu.getByRole('menuitemcheckbox', { name }))
		.first();
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
	await expect.poll(() => page.locator('[data-audio-editor]').evaluate((root) => root.style.colorScheme)).toBe(theme);
	await page.waitForTimeout(50);
}

async function waitForResponsiveEditorLayout(editor) {
	await expect.poll(() => editor.evaluate((root) => (
		root.classList.contains('kw-audio-editor--compact') === window.matchMedia('(max-width: 900px)').matches
	))).toBe(true);
	await editor.evaluate(() => new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(resolve));
	}));
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
		for (const element of container.querySelectorAll('button, input, select, textarea, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="slider"], [role="tab"], [role="dialog"]')) {
			if (!visible(element) || element.disabled || element.getAttribute('aria-hidden') === 'true') continue;
			if (!textAlternative(element)) results.push(`${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[role=${element.getAttribute('role')}]` : ''} has no accessible name`);
		}
		const ids = [...container.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean);
		for (const id of new Set(ids)) if (ids.filter((candidate) => candidate === id).length > 1) results.push(`duplicate id ${id}`);
		return results;
	});
	expect(violations).toEqual([]);
}

async function assertNoSeriousAxeViolations(page, selector = '#kw-audio-editor-design-system') {
	const results = await new AxeBuilder({ page })
		.include(selector)
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
		const openRequest = indexedDB.open('kw-media-audio-editor', 2);
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
		const { source, peaks } = await new Promise((resolve, reject) => {
			const openRequest = indexedDB.open('kw-media-audio-editor', 2);
			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => {
				const database = openRequest.result;
				const sourcesRequest = database.transaction('sources', 'readonly').objectStore('sources').getAll();
				sourcesRequest.onerror = () => reject(sourcesRequest.error);
				sourcesRequest.onsuccess = () => {
					const source = sourcesRequest.result.find((candidate) => candidate.name?.includes(effectName));
					if (!source) {
						database.close();
						resolve({ source: null, peaks: null });
						return;
					}
					const peaksRequest = database.transaction('analysis', 'readonly')
						.objectStore('analysis').get(`audio-editor-peaks-v1:${source.id}`);
					peaksRequest.onerror = () => reject(peaksRequest.error);
					peaksRequest.onsuccess = () => {
						database.close();
						resolve({ source, peaks: peaksRequest.result?.value || null });
					};
				};
			};
		});
		if (!source || !peaks?.levels?.length) return 0;
		let peak = 0;
		for (const level of peaks.levels) {
			for (const sample of level.minimums || []) peak = Math.max(peak, Math.abs(sample));
			for (const sample of level.maximums || []) peak = Math.max(peak, Math.abs(sample));
		}
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

/* SPDX-License-Identifier: AGPL-3.0-only */

import { readdir } from 'node:fs/promises';

import { darkTheme } from '../../vendor/audacity-design-system/tokens/src/themes/dark.v2.ts';
import { lightTheme } from '../../vendor/audacity-design-system/tokens/src/themes/light.v2.ts';
import { BROWSER_PRODUCT_FIXTURE_ROOT } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

const cssColor = (hex) => `rgb(${[1, 3, 5].map((offset) =>
	Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;

test('desktop Preferences opens General and manages the display-only FFmpeg location', async ({ page }) => {
	await installDesktopFfmpegFixture(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const general = preferences.getByRole('tab', { name: /General$/u });
	await expect(preferences.getByRole('tab').first()).toHaveText(/General$/u);
	await expect(general).toHaveAttribute('aria-selected', 'true');
	await expect(preferences.getByRole('group', { name: 'Language', exact: true })).toBeVisible();
	const panel = preferences.locator('[data-external-ffmpeg-preference="true"]');
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'unconfigured');
	await expect(panel.getByLabel('FFmpeg location', { exact: true })).toHaveValue('No location selected');

	await panel.getByRole('button', { name: 'Browse', exact: true }).click();
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'ready');
	await expect(panel.getByLabel('FFmpeg location', { exact: true })).toHaveValue('/fixture/bin/ffmpeg');
	await expect(panel).toContainText('FFmpeg 9.0.1 is ready.');
	await panel.getByRole('button', { name: 'Clear', exact: true }).click();
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'unconfigured');
	await panel.getByRole('button', { name: 'Install', exact: true }).click();
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'ready');
	await panel.getByRole('button', { name: 'Rescan', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__externalFfmpegCalls)).toEqual([
		'get', 'choose', 'clear', 'install', 'rescan',
	]);

	await preferences.getByRole('tab', { name: /Appearance$/u }).click();
	await expect(preferences.getByRole('group', { name: 'Language', exact: true })).toHaveCount(0);
});

test('desktop defaults to Speed, preserves Memory, and leaves AI code on demand', async ({ page }) => {
	test.setTimeout(90_000);
	const assets = await readdir(new URL(`../../${BROWSER_PRODUCT_FIXTURE_ROOT}/soundscaper/assets/`, import.meta.url));
	const asset = (name, extension = 'js') => {
		const file = assets.find((candidate) => candidate.startsWith(`${name}-`) && candidate.endsWith(`.${extension}`));
		if (!file) throw new Error(`Browser fixture has no ${name} chunk`);
		return `assets/${file}`;
	};
	const manifest = {
		'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx': {
			file: asset('SoundscaperAudioEditorBootstrap'), isDynamicEntry: true,
		},
		'src/common/editor/ui/inspector/ExportDialog.jsx': {
			file: asset('ExportDialog'), isDynamicEntry: true,
		},
		'src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx': {
			file: asset('WorkspacePreferencesDialog'), isDynamicEntry: true,
			css: [asset('WorkspacePreferencesDialog', 'css')],
		},
		'src/common/editor/ui/dialogs/LocalModelManagerDialog.tsx': {
			file: asset('LocalModelManagerDialog'), isDynamicEntry: true,
		},
	};
	// The web build removes the manifest; the desktop protocol serves it directly.
	await page.route('**/.offline-build-manifest.json', async (route) => {
		await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
	});
	await installDesktopFfmpegFixture(page);
	const requested = [];
	page.on('request', (request) => { requested.push(new URL(request.url()).pathname); });
	const editor = await bootEditor(page, '/embed/en/');
	const warmup = page.locator('[data-desktop-speed-warmup="ready"]');
	await expect(warmup).toHaveCount(1, { timeout: 20_000 });
	await expect(warmup).toHaveAttribute('data-desktop-speed-warmup-failed', '0');

	const ordinaryChunk = manifest['src/common/editor/ui/inspector/ExportDialog.jsx']?.file;
	const ordinaryStylesheet = manifest['src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx'].css[0];
	const aiChunk = manifest['src/common/editor/ui/dialogs/LocalModelManagerDialog.tsx']?.file;
	expect(ordinaryChunk).toMatch(/^assets\/.+\.js$/u);
	expect(aiChunk).toMatch(/^assets\/.+\.js$/u);
	expect(requested).toContain(`/${ordinaryChunk}`);
	expect(requested).toContain(`/${ordinaryStylesheet}`);
	expect(requested.filter((path) => /\/LocalModelManagerDialog-[^/]+\.js$/u.test(path))).toEqual([]);

	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const optimization = preferences.getByRole('group', { name: 'Optimize for', exact: true });
	await expect(optimization.getByRole('button')).toContainText('Speed');
	await chooseDropdown(page, optimization, 'Memory');
	await expect.poll(() => savedOptimizationMode(page)).toBe('memory');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	const memoryEditor = page.locator('[data-audio-editor-bound="true"][data-editor-ready="true"]');
	await expect(memoryEditor).toBeVisible({ timeout: 20_000 });
	await expect(page.locator('[data-desktop-speed-warmup]')).toHaveCount(0);
	await chooseCommandAction(page, memoryEditor, 'Edit', 'Preferences');
	const memoryPreferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const memoryOptimization = memoryPreferences.getByRole('group', { name: 'Optimize for', exact: true });
	await expect(memoryOptimization.getByRole('button')).toContainText('Memory');
	await chooseDropdown(page, memoryOptimization, 'Speed');
	await expect.poll(() => savedOptimizationMode(page)).toBe('speed');
	await memoryPreferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	await expect(warmup).toHaveCount(1, { timeout: 20_000 });
	await expect(warmup).toHaveAttribute('data-desktop-speed-warmup-failed', '0');
	const reopenedEditor = page.locator('[data-audio-editor-bound="true"]');
	await chooseCommandAction(page, reopenedEditor, 'Edit', 'Preferences');
	await expect(page.getByRole('dialog', { name: 'Editor preferences', exact: true })
		.getByRole('group', { name: 'Optimize for', exact: true }).getByRole('button')).toContainText('Speed');
});

test('browser Preferences opens General without the desktop-only FFmpeg location', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await expect(page.locator('[data-desktop-speed-warmup]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByRole('tab').first()).toHaveText(/General$/u);
	await expect(preferences.getByRole('tab', { name: /General$/u })).toHaveAttribute('aria-selected', 'true');
	await expect(preferences.getByRole('group', { name: 'Language', exact: true })).toBeVisible();
	await expect(preferences.getByRole('group', { name: 'Optimize for', exact: true })).toHaveCount(0);
	await expect(preferences.locator('[data-external-ffmpeg-preference="true"]')).toHaveCount(0);
});

test('Track visualization opens the combined waveform and spectrogram settings', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const track = editor.locator('[data-track-row]').first();
	await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Track display']);

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const waveform = preferences.getByRole('tab', { name: /Track display$/u });
	await expect(waveform).toHaveAttribute('aria-selected', 'true');
	await expect(preferences.getByRole('tab', { name: /^(Waveform|Spectrogram)$/u })).toHaveCount(0);
	await expect(preferences.locator('[data-spectrogram-settings]')).toBeVisible();
	await expect(preferences.getByRole('group', { name: 'Default view', exact: true })).toBeVisible();
	const settings = preferences.locator('[data-waveform-visualization-settings]');
	await expect(settings.getByRole('spinbutton', { name: 'Low/mid crossover (Hz)', exact: true }))
		.toHaveValue('250');
	await expect(settings.getByRole('spinbutton', { name: 'Mid/high crossover (Hz)', exact: true }))
		.toHaveValue('4000');
});

for (const mode of ['Light', 'Dark']) {
	test(`${mode} Appearance uses flat sections, separators and design-system checkboxes`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const editor = await bootEditor(page, '/embed/en/');
		await page.emulateMedia({ colorScheme: mode.toLowerCase() });
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Appearance$/u }).click();
		await preferences.getByRole('radio', { name: mode, exact: true }).check();
		await expect(page.locator('html')).toHaveAttribute('data-theme', mode.toLowerCase());

		const theme = preferences.getByRole('heading', { name: 'Theme', exact: true }).locator('..');
		const clipStyle = preferences.getByRole('heading', { name: 'Clip style', exact: true }).locator('..');
		for (const section of [theme, clipStyle]) {
			await expect(section).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
			await expect(section).toHaveCSS('border-width', '0px');
			await expect(section).toHaveCSS('border-radius', '0px');
		}
		const separator = theme.locator('xpath=following-sibling::*[1]');
		await expect(separator).toHaveAttribute('role', 'separator');
		await expect(separator).toBeVisible();
		const palette = mode === 'Dark' ? darkTheme : lightTheme;
		expect(await separator.evaluate((node) => {
			const line = getComputedStyle(node, '::after');
			return { height: line.height, color: line.backgroundColor };
		})).toEqual({ height: '1px', color: cssColor(palette.border.onElevated) });

		const checkbox = preferences.getByRole('checkbox', { name: 'Follow system theme', exact: true });
		await expect(checkbox).not.toBeChecked();
		await expect(checkbox).toHaveCSS('border-width', '0px');
		await expect(checkbox).toHaveCSS('outline-style', 'none');
		await preferences.screenshot({ path: testInfo.outputPath(`appearance-${mode}.png`) });
		const idleFill = cssColor(palette.background.control.checkbox.idle);
		await expect(checkbox).toHaveCSS('background-color', idleFill);
		await checkbox.hover();
		await expect(checkbox).toHaveCSS('border-width', '0px');
		await expect(checkbox).toHaveCSS('background-color', cssColor(palette.background.control.checkbox.hover));
		await page.mouse.move(0, 0);
		await page.keyboard.press('Tab');
		await checkbox.focus();
		await expect(checkbox).toHaveCSS('box-shadow', `${cssColor(palette.border.focus)} 0px 0px 0px 2px`);
		await page.keyboard.press('Space');
		await expect(checkbox).toBeChecked();
		await expect(checkbox.locator('.checkbox__icon')).toBeVisible();
		await expect(checkbox).toHaveCSS('border-width', '0px');
		await expect(checkbox).toHaveCSS('background-color', idleFill);
		await page.keyboard.press('Space');
		await expect(checkbox).not.toBeChecked();
	});
}

test('Program start chooses what the next session opens with', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const programStart = preferences.getByRole('radiogroup', { name: 'Program start', exact: true });
	await expect(programStart).toHaveAttribute('data-program-start', 'continue-last-session');
	await expect(programStart.getByRole('radio', { name: 'Continue last session', exact: true })).toBeChecked();

	await programStart.getByRole('radio', { name: 'Start with new project', exact: true }).check();
	await expect(programStart).toHaveAttribute('data-program-start', 'new-project');

	// The attribute mirrors the stored preference, so reopening the dialog is
	// what proves the choice reached the controller rather than the checkbox.
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await expect(preferences.getByRole('radiogroup', { name: 'Program start', exact: true }))
		.toHaveAttribute('data-program-start', 'new-project');
});

test("the Effects page rearranges the Effect menu the way Audacity's does", async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	let menu = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(menu.getByRole('menuitem', { name: /^Volume and compression/u })).toBeVisible();
	await page.keyboard.press('Escape');

	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	const organization = preferences.getByRole('group', { name: 'Effect menu organization', exact: true });
	await chooseDropdown(page, organization, 'Sort by effect name');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();

	await menubar.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	menu = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(menu.getByRole('menuitem', { name: /^Volume and compression/u })).toHaveCount(0);
	const amplify = menu.getByRole('menuitem', { name: /^Amplify(?: —|$)/u });
	await expect(amplify).toBeVisible();
	await expect(amplify).toBeDisabled();
	await page.keyboard.press('Escape');
});

async function savedOptimizationMode(page) {
	return page.evaluate(() => new Promise((resolve, reject) => {
		const opened = globalThis.indexedDB.open('kw-media-soundscaper-editor-v1');
		opened.onerror = () => reject(opened.error);
		opened.onsuccess = () => {
			const database = opened.result;
			const stored = database.transaction('settings', 'readonly').objectStore('settings')
				.get('soundscaper:audio-editor-preferences-v1');
			stored.onerror = () => { database.close(); reject(stored.error); };
			stored.onsuccess = () => {
				const mode = stored.result?.value?.performance?.optimizeFor ?? null;
				database.close();
				resolve(mode);
			};
		};
	}));
}

async function installDesktopFfmpegFixture(page) {
	await page.addInitScript(() => {
		const calls = [];
		const status = (state, overrides = {}) => Object.freeze({
			state,
			location: null,
			version: null,
			detail: '',
			canInstall: state === 'unconfigured',
			canBrowse: true,
			canClear: state === 'ready',
			...overrides,
		});
		const ready = () => status('ready', {
			location: '/fixture/bin/ffmpeg',
			version: '9.0.1',
			detail: 'Fixture capability probes passed.',
		});
		Object.defineProperty(globalThis, '__externalFfmpegCalls', {
			configurable: true,
			value: calls,
		});
		const bridge = Object.freeze({
			getEnvironment: async () => null,
			signalReady: async () => undefined,
			setLocale: async () => undefined,
			onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			getExternalFfmpegStatus: async () => { calls.push('get'); return status('unconfigured'); },
			chooseExternalFfmpeg: async () => { calls.push('choose'); return ready(); },
			clearExternalFfmpeg: async () => { calls.push('clear'); return status('unconfigured'); },
			installExternalFfmpeg: async () => { calls.push('install'); return ready(); },
			rescanExternalFfmpeg: async () => { calls.push('rescan'); return ready(); },
		});
		Object.defineProperty(globalThis, 'soundscaperDesktop', {
			configurable: true,
			value: Object.freeze({ v1: bridge }),
		});
	});
}

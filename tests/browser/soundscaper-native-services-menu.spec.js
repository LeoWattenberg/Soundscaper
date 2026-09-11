/* SPDX-License-Identifier: AGPL-3.0-only */

import { openNativePreferences } from './helpers/assistance-task-menu.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	getMenuItem,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';

test('selected Soundscaper exposes the default-off native tier only through menus', async ({ page }) => {
	await installNativeServicesFixture(page);
	const editor = await bootEditor(page, '/embed/en/');
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeProbeCount)).toBeGreaterThan(0);
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

	await expect(page.locator('[data-soundscaper-native-services-dialog="true"]')).toHaveCount(0);
	await expect(page.getByText('Native audio and effects', { exact: true })).toHaveCount(0);
	await openNativePreferences(page, editor, 'Audio settings', 'Native audio and latency…');

	const dialog = page.getByRole('dialog', { name: 'Audio setup', exact: true });
	await expect(dialog).toBeVisible();
	const nativeAudio = dialog.getByRole('tab', { name: 'Native audio', exact: true });
	await expect(nativeAudio).toBeFocused();
	await expect(nativeAudio).toHaveAttribute('aria-selected', 'true');
	await expect(dialog.getByText('Native audio is off.', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Fixture professional payload is unavailable', { exact: true })).toBeVisible();

	await expect(dialog.getByRole('tab', { name: 'Scanning & Settings', exact: true })).toHaveCount(0);
	await nativeAudio.press('ArrowRight');
	await expect(dialog.getByRole('tab', { name: 'Devices', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);

	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
	await expect(page.locator('[data-soundscaper-native-services-dialog="true"]')).toHaveCount(0);
});


test('Plugin Manager stays available with processing off and supports keyboard and narrow themes', async ({ page }) => {
	await installNativeServicesFixture(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	const dialog = page.getByRole('dialog', { name: 'Plugin Manager', exact: true });
	await expect(dialog.getByRole('tab', { name: 'Devices', exact: true })).toHaveCount(0);
	await dialog.getByRole('textbox', { name: 'Search plugins' }).fill('no plugin');
	await expect(dialog.getByRole('table')).toBeVisible();
	const installed = dialog.getByRole('tab', { name: 'Installed', exact: true });
	await installed.focus();
	await installed.press('ArrowRight');
	await expect(dialog.getByRole('tab', { name: 'Scanning & Settings' })).toBeFocused();
	await page.setViewportSize({ width: 390, height: 844 });
	for (const theme of ['dark', 'light']) {
		await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
		await expect(dialog.locator('.button').first()).toHaveCSS('--button-bg-idle', theme === 'dark' ? '#515A63' : '#D3D4DC');
		const box = await dialog.boundingBox();
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(390);
	}
	await page.emulateMedia({ forcedColors: 'active' });
	await expect(dialog.getByRole('tab', { name: 'Scanning & Settings' })).toBeFocused();
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(editor.getByRole('menuitem', { name: 'Effect', exact: true })).toBeFocused();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
});

test('Plugin Manager filters installed rows and reviews only the selected installation', async ({ page }) => {
	await installNativeServicesFixture(page, true);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	const dialog = page.getByRole('dialog', { name: 'Plugin Manager', exact: true });
	const search = dialog.getByRole('textbox', { name: 'Search plugins' });
	await expect(dialog.locator('[data-native-plugin-entry]')).toHaveCount(2);
	await dialog.getByRole('button', { name: 'Status', exact: true }).click();
	await page.getByRole('option', { name: 'Needs attention', exact: true }).click();
	await expect(dialog.locator('[data-native-plugin-entry]')).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Echo', exact: true }).click();
	await expect(dialog.getByRole('region', { name: 'Plugin details' })).toContainText('Review this installation before use.');
	await search.fill('absent');
	await expect(dialog.getByRole('region', { name: 'Plugin details' })).toHaveCount(0);
	await expect(dialog.getByText('No plugins match these filters.', { exact: true })).toBeVisible();
	await search.fill('Echo');
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
	await dialog.locator('[data-native-plugin-review="allow"]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual(['review:echo-install:allow']);
	await expect(dialog.locator('[data-native-plugin-review="revoke"]')).toBeVisible();
	await expect(dialog.locator('[data-native-plugin-instantiate]')).toHaveCount(0);
});

test('Framescaper never exposes the Soundscaper native-services surface', async ({ page }) => {
	await installNativeServicesFixture(page);
	const framescaper = await bootEditor(page, '/framescaper/embed/en/');
	await expect(framescaper).toHaveAttribute('data-product', 'framescaper');
	const framescaperTools = await openNestedCommandMenu(page, framescaper, 'Tools', []);
	await expect(getMenuItem(framescaperTools, 'Audio setup')).toHaveCount(0);
	await page.keyboard.press('Escape');
	const framescaperEffects = await openNestedCommandMenu(page, framescaper, 'Effect', []);
	await expect(getMenuItem(framescaperEffects, 'Native effects')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.locator('[data-soundscaper-native-services-dialog="true"]')).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
});

async function installNativeServicesFixture(page, withPlugins = false) {
	await page.addInitScript((includePlugins) => {
		const runtimeCalls = [];
		let probeCount = 0;
		const unavailablePayload = Object.freeze({
			status: 'unavailable', reason: 'not-built', detail: 'Fixture professional payload is unavailable',
		});
		const audio = Object.freeze({
			enabled: false, quarantined: false, payload: unavailablePayload, backends: Object.freeze([]),
		});
		const quarantine = Object.freeze({
			loaded: true, degraded: false, records: Object.freeze([]), pendingFaults: 0,
		});
		const plugins = Object.freeze({
			enabled: false, quarantined: false,
			payload: Object.freeze({ status: 'unavailable', reason: 'not-built' }),
			formats: Object.freeze([]),
			consent: Object.freeze({ scanningEnabled: false, formats: Object.freeze([]) }),
			quarantine,
		});
		let registry = { entries: includePlugins ? [
			{ entryId: 'echo', format: 'VST3', name: 'Echo', vendor: 'Fixture', eligible: false,
				ineligibleReason: 'Review this installation before use.', installations: [{ installationId: 'echo-install',
					version: '1.0', reviewed: false, selected: true, quarantined: false }] },
			{ entryId: 'gain', format: 'LV2', name: 'Gain', vendor: 'Fixture', eligible: true,
				ineligibleReason: null, installations: [{ installationId: 'gain-install',
					version: '2.0', reviewed: true, selected: true, quarantined: false }] },
		] : [] };
		const refused = async (name) => {
			runtimeCalls.push(name);
			throw new Error(`Default-off fixture must not call ${name}.`);
		};
		Object.defineProperty(globalThis, '__soundscaperNativeRuntimeCalls', {
			configurable: true, value: runtimeCalls,
		});
		Object.defineProperty(globalThis, '__soundscaperNativeProbeCount', {
			configurable: true, get: () => probeCount,
		});
		const bridge = Object.freeze({
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
			getEnvironment: async () => null,
			signalReady: async () => undefined,
			onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			readNativeTierControls: async () => Object.freeze({
				probeHelperEnabled: false, probeHelperQuarantined: false,
				audioHelperEnabled: false, audioHelperQuarantined: false,
				nativeEffectDiscoveryEnabled: false,
			}),
			applyNativeTierControl: async () => { throw new Error('No fixture tier control is changed.'); },
			nativeAudioHelperAvailability: async () => { probeCount += 1; return audio; },
			setNativeAudioHelperEnabled: async () => false,
			describeNativeAudioBackend: () => refused('describeNativeAudioBackend'),
			nativePluginAvailability: async () => plugins,
			setNativePluginConsent: () => refused('setNativePluginConsent'),
			scanNativePlugins: () => refused('scanNativePlugins'),
			listNativePlugins: async () => registry,
			openNativeAudioSession: () => refused('openNativeAudioSession'),
			bindNativeAudioSession: () => refused('bindNativeAudioSession'),
			nativeAudioSessionStatus: () => refused('nativeAudioSessionStatus'),
			calibrateNativeAudioSession: () => refused('calibrateNativeAudioSession'),
			reportNativeAudioSessionTransfer: () => refused('reportNativeAudioSessionTransfer'),
			reportNativeAudioSessionLoss: () => refused('reportNativeAudioSessionLoss'),
			closeNativeAudioSession: () => refused('closeNativeAudioSession'),
			reviewNativePluginInstallation: async ({ installationId, action: review }) => {
				runtimeCalls.push(`review:${installationId}:${review}`);
				registry = { entries: registry.entries.map((entry) => ({ ...entry,
					installations: entry.installations.map((installation) => installation.installationId === installationId
						? { ...installation, reviewed: review === 'allow' } : installation),
				})) };
				return registry;
			},
			instantiateNativePlugin: () => refused('instantiateNativePlugin'),
			runNativePluginOffline: () => refused('runNativePluginOffline'),
			setNativePluginBypassed: () => refused('setNativePluginBypassed'),
			persistNativePluginState: () => refused('persistNativePluginState'),
			restoreNativePluginState: () => refused('restoreNativePluginState'),
			openNativePluginVendorUi: () => refused('openNativePluginVendorUi'),
			closeNativePluginVendorUi: () => refused('closeNativePluginVendorUi'),
			closeNativePluginInstance: () => refused('closeNativePluginInstance'),
		});
		const surface = Object.freeze({ v1: bridge });
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: surface });
	}, withPlugins);
}

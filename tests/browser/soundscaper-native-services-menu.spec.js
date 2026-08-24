/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
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
	const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	const audioGroups = tools.getByRole('menuitem', { name: /^Audio setup(?:\s|$)/u });
	await audioGroups.last().press('ArrowRight');
	const audio = audioGroups.last().getByRole('menu');
	await expect(audio).toBeVisible();
	const device = getMenuItem(audio, 'Native audio device…');
	await expect(device).toBeDisabled();
	await expect(device).toContainText('Fixture professional payload is unavailable');
	const preferences = getMenuItem(audio, 'Native audio and latency…');
	await expect(preferences).toBeEnabled();
	await preferences.press('Enter');

	const dialog = page.getByRole('dialog', { name: 'Native audio and effects', exact: true });
	await expect(dialog).toBeVisible();
	const nativeAudio = dialog.getByRole('tab', { name: 'Native audio', exact: true });
	await expect(nativeAudio).toBeFocused();
	await expect(nativeAudio).toHaveAttribute('aria-selected', 'true');
	await expect(dialog.getByText('Native audio is off.', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Fixture professional payload is unavailable', { exact: true })).toBeVisible();

	await nativeAudio.press('ArrowRight');
	const scan = dialog.getByRole('tab', { name: 'Scan', exact: true });
	await expect(scan).toBeFocused();
	await expect(scan).toHaveAttribute('aria-selected', 'true');
	await scan.press('Home');
	await expect(dialog.getByRole('tab', { name: 'Devices', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(editor.getByRole('menubar', { name: 'Application menu' })
		.getByRole('menuitem', { name: 'Tools', exact: true })).toBeFocused();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
	await expect(page.locator('[data-soundscaper-native-services-dialog="true"]')).toHaveCount(0);
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

async function installNativeServicesFixture(page) {
	await page.addInitScript(() => {
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
		const registry = Object.freeze({ entries: Object.freeze([]) });
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
			reviewNativePluginInstallation: () => refused('reviewNativePluginInstallation'),
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
	});
}

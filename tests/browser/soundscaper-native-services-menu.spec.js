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
	await openNativePreferences(page, editor, 'Audio settings', 'Native audio and latency');

	const dialog = page.getByRole('dialog', { name: 'Audio devices', exact: true });
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

test('described native audio devices survive an ordinary Audio setup refresh', async ({ page }) => {
	await installNativeServicesFixture(page, false, true);
	const editor = await bootEditor(page, '/embed/en/');
	await openNativePreferences(page, editor, 'Audio settings', 'Native audio and latency');
	const nativeDialog = page.getByRole('dialog', { name: 'Audio devices', exact: true });
	await nativeDialog.getByRole('tab', { name: 'Devices', exact: true }).click();
	await nativeDialog.locator('[data-native-audio-describe="alsa"]').click();
	await expect(nativeDialog.getByText('Studio interface', { exact: true })).toBeVisible();
	await nativeDialog.getByRole('button', { name: 'Close', exact: true })
		.filter({ hasText: /^Close$/u }).click();

	await editor.locator('[data-action-bar]')
		.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	const microphone = setup.getByRole('combobox', { name: 'Microphone', exact: true });
	const speakers = setup.getByRole('combobox', { name: 'Speakers', exact: true });
	await expect(microphone).toContainText('Studio interface');
	await expect(speakers).toContainText('Studio interface');

	await setup.getByRole('button', { name: 'Refresh devices', exact: true }).click();
	await expect(microphone).toContainText('Studio interface');
	await expect(speakers).toContainText('Studio interface');
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls))
		.toContain('describeNativeAudioBackend:alsa');
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
	await expect(installed).toBeFocused();
	await expect(dialog.getByRole('tab', { name: 'Scanning & Settings' })).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	for (const theme of ['dark', 'light']) {
		await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
		await expect(dialog.locator('.button').first()).toHaveCSS('--button-bg-idle', theme === 'dark' ? '#515A63' : '#D3D4DC');
		const box = await dialog.boundingBox();
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(390);
	}
	await page.emulateMedia({ forcedColors: 'active' });
	await expect(installed).toBeFocused();
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(editor.getByRole('menuitem', { name: 'Effect', exact: true })).toBeFocused();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
});

test('Plugin Manager filters installed rows and allows only the selected installation', async ({ page }) => {
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
	await expect(dialog.getByRole('region', { name: 'Plugin details' })).toContainText('Allow this installation before use.');
	await search.fill('absent');
	await expect(dialog.getByRole('region', { name: 'Plugin details' })).toHaveCount(0);
	await expect(dialog.getByText('No plugins match these filters.', { exact: true })).toBeVisible();
	await search.fill('Echo');
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
	await dialog.locator('[data-native-plugin-allowance="allow"]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual(['allowance:echo-install:true']);
	await expect(dialog.locator('[data-native-plugin-allowance="revoke"]')).toBeVisible();
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

test('Effects preferences manages supported plugin folders without format switches', async ({ page }) => {
	await installNativeServicesFixture(page, false, false, true);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	const folders = preferences.getByRole('group', { name: 'VST3', exact: true });
	await expect(folders).toBeVisible();
	await expect(preferences.getByText('Not available on this system', { exact: true })).toHaveCount(0);
	await expect(preferences.getByRole('group', { name: 'Audio Units', exact: true })).toHaveCount(0);
	await expect(preferences.getByRole('button', { name: /Allow scanning|Stop scanning|Admit folder/u })).toHaveCount(0);
	const system = folders.getByRole('checkbox', { name: 'System VST3 folder', exact: true });
	await expect(system).not.toBeChecked();
	await system.click();
	await expect(system).toBeChecked();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls))
		.toEqual(['consent:vst3:grant:', 'consent:vst3:add-standard-root:system-vst3']);
	await folders.getByRole('button', { name: 'Add path: VST3', exact: true }).click();
	await expect(folders.getByText('/opt/vendor/plugins', { exact: true })).toBeVisible();
	await expect(folders.getByRole('checkbox')).toHaveCount(1);
	await folders.getByRole('button', { name: 'Remove path: /opt/vendor/plugins', exact: true }).click();
	await expect(folders.getByText('/opt/vendor/plugins', { exact: true })).toHaveCount(0);
	await system.click();
	await expect(system).not.toBeChecked();
	await expect(preferences.getByRole('button', { name: 'Scan for plugins', exact: true })).toBeDisabled();
	await system.click();
	await expect(system).toBeChecked();
	await preferences.getByRole('checkbox', { name: 'Enable plugin scanning', exact: true }).click();
	await expect(preferences.getByRole('button', { name: 'Scan for plugins', exact: true })).toBeEnabled();
	await preferences.getByRole('button', { name: 'Scan for plugins', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls))
		.toContain('scan:vst3:system-vst3');
	await preferences.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: /^Close$/u }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	await expect(folders.getByRole('checkbox', { name: 'System VST3 folder', exact: true })).toBeChecked();
	await folders.getByRole('button', { name: 'Add path: VST3', exact: true }).click();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(folders.getByText('/opt/vendor/plugins', { exact: true })).toBeVisible();
	await expect(folders.getByRole('button', { name: 'Add path: VST3', exact: true })).toBeVisible();
	const box = await folders.boundingBox();
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(390);
});

async function installNativeServicesFixture(page, withPlugins = false, withNativeAudio = false, withPluginFolders = false) {
	await page.addInitScript(({ includePlugins, includeNativeAudio, includePluginFolders }) => {
		const runtimeCalls = [];
		let probeCount = 0;
		const unavailablePayload = Object.freeze({
			status: 'unavailable', reason: 'not-built', detail: 'Fixture professional payload is unavailable',
		});
		const audio = Object.freeze({
			enabled: includeNativeAudio, quarantined: false,
			payload: includeNativeAudio
				? Object.freeze({ status: 'available', reason: null, detail: '' }) : unavailablePayload,
			backends: Object.freeze(includeNativeAudio ? ['alsa'] : []),
		});
		const quarantine = Object.freeze({
			loaded: true, degraded: false, records: Object.freeze([]), pendingFaults: 0,
		});
		let plugins = Object.freeze({
			enabled: false, quarantined: false,
			payload: Object.freeze(includePluginFolders ? { status: 'available', reason: null } : { status: 'unavailable', reason: 'not-built' }),
			formats: Object.freeze([]),
			consent: Object.freeze({ scanningEnabled: false, formats: Object.freeze(includePluginFolders ? [
				{ format: 'vst3', supported: true, granted: false, roots: [
					{ rootId: 'system-vst3', origin: 'standard', name: 'System VST3 folder', admitted: false },
				] },
				{ format: 'au', supported: false, granted: false, roots: [] },
			] : []) }),
			quarantine,
		});
		let registry = { entries: includePlugins ? [
			{ entryId: 'echo', format: 'VST3', name: 'Echo', vendor: 'Fixture', eligible: false,
				ineligibleReason: 'Allow this installation before use.', installations: [{ installationId: 'echo-install',
					version: '1.0', allowed: false, selected: true, quarantined: false }] },
			{ entryId: 'gain', format: 'LV2', name: 'Gain', vendor: 'Fixture', eligible: true,
				ineligibleReason: null, installations: [{ installationId: 'gain-install',
					version: '2.0', allowed: true, selected: true, quarantined: false }] },
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
				nativeEffectDiscoveryEnabled: plugins.enabled,
			}),
			applyNativeTierControl: async ({ action, enabled }) => {
				if (!includePluginFolders || action !== 'set-native-effect-discovery-enabled') throw new Error('No fixture tier control is changed.');
				plugins = { ...plugins, enabled };
				return { probeHelperEnabled: false, probeHelperQuarantined: false,
					audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: enabled };
			},
			nativeAudioHelperAvailability: async () => { probeCount += 1; return audio; },
			setNativeAudioHelperEnabled: async () => includeNativeAudio,
			describeNativeAudioBackend: async ({ backend }) => {
				if (!includeNativeAudio) return refused('describeNativeAudioBackend');
				runtimeCalls.push(`describeNativeAudioBackend:${backend}`);
				return Object.freeze({
					status: 'described',
					inventory: Object.freeze({
						backend, status: 'ready', detail: '',
						devices: Object.freeze([Object.freeze({
							handle: 'studio-interface', label: 'Studio interface',
							direction: 'duplex', channelCount: 8, isDefault: false,
						})]),
					}),
				});
			},
			nativePluginAvailability: async () => plugins,
			setNativePluginConsent: async ({ format, action, rootId = '' }) => {
				if (!includePluginFolders) return refused('setNativePluginConsent');
				runtimeCalls.push(`consent:${format}:${action}:${rootId}`);
				const formats = plugins.consent.formats.map((entry) => {
					if (entry.format !== format) return entry;
					if (action === 'grant') return { ...entry, granted: true };
					if (action === 'add-custom-root') return { ...entry, roots: [...entry.roots,
						{ rootId: 'custom-vst3', origin: 'custom', name: 'plugins', displayPath: '/opt/vendor/plugins', admitted: true }] };
					return { ...entry, roots: entry.roots.flatMap((root) => root.rootId !== rootId ? [root]
						: action === 'remove-root' && root.origin === 'custom' ? [] : [{ ...root, admitted: action === 'add-standard-root' }]) };
				});
				plugins = { ...plugins, consent: { formats, scanningEnabled: formats.some((entry) => entry.granted && entry.roots.some((root) => root.admitted)) } };
			},
			scanNativePlugins: async ({ format, rootId }) => {
				if (!includePluginFolders) return refused('scanNativePlugins');
				runtimeCalls.push(`scan:${format}:${rootId}`);
				return { status: 'described', scan: { format, status: 'complete', detail: '', entries: [] } };
			},
			listNativePlugins: async () => registry,
			openNativeAudioSession: () => refused('openNativeAudioSession'),
			bindNativeAudioSession: () => refused('bindNativeAudioSession'),
			nativeAudioSessionStatus: () => refused('nativeAudioSessionStatus'),
			calibrateNativeAudioSession: () => refused('calibrateNativeAudioSession'),
			reportNativeAudioSessionTransfer: () => refused('reportNativeAudioSessionTransfer'),
			reportNativeAudioSessionLoss: () => refused('reportNativeAudioSessionLoss'),
			closeNativeAudioSession: () => refused('closeNativeAudioSession'),
			setNativePluginInstallationAllowed: async ({ installationId, allowed }) => {
				runtimeCalls.push(`allowance:${installationId}:${String(allowed)}`);
				registry = { entries: registry.entries.map((entry) => ({ ...entry,
					installations: entry.installations.map((installation) => installation.installationId === installationId
						? { ...installation, allowed } : installation),
				})) };
				return registry;
			},
			selectNativePluginInstallation: () => refused('selectNativePluginInstallation'),
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
	}, { includePlugins: withPlugins, includeNativeAudio: withNativeAudio, includePluginFolders: withPluginFolders });
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';

test('keyboard removal of a custom plugin folder retains the surviving Add path action', async ({ page, browserName }) => {
	await installPluginFolderBridge(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	const folders = preferences.getByRole('group', { name: 'VST3', exact: true });
	const add = folders.getByRole('button', { name: 'Add path: VST3', exact: true });
	const remove = folders.getByRole('button', { name: 'Remove path: /opt/vendor/plugins', exact: true });
	await add.click();
	await expect(remove).toBeEnabled();
	await remove.click();
	await expect(remove).toHaveCount(0);
	await expect(add).toBeEnabled();
	await add.click();
	await expect(remove).toBeEnabled();
	if (browserName !== 'webkit') await test.step('native backward-tab navigation', async () => {
		await add.press('Shift+Tab');
		await expect(remove).toBeFocused();
	});
	await remove.focus();
	await expect(remove).toBeFocused();
	await remove.press('Enter');
	await expect(remove).toHaveCount(0);
	await expect(add).toBeEnabled();
	await expect(add).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toBeEnabled();
	await expect.poll(() => page.evaluate(() => window.__round7PluginFolderCalls))
		.toEqual(['grant', 'add-custom-root', 'remove-root', 'add-custom-root', 'remove-root', 'add-custom-root']);
	expect(errors).toEqual([]);
});

async function installPluginFolderBridge(page) {
	await page.addInitScript(() => {
		let granted = false;
		let added = false;
		const calls = [];
		window.__round7PluginFolderCalls = calls;
		const unavailable = { status: 'unavailable', reason: 'not-built', detail: '' };
		const availability = () => ({ enabled: false, quarantined: false, payload: unavailable, formats: [],
			consent: { scanningEnabled: false, formats: [{ format: 'vst3', supported: true, granted, roots: added
				? [{ rootId: 'custom-vst3', origin: 'custom', name: 'plugins', displayPath: '/opt/vendor/plugins', admitted: true }]
				: [] }] }, quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 } });
		const forbidden = Object.fromEntries([
			'setNativeAudioHelperEnabled', 'describeNativeAudioBackend', 'scanNativePlugins',
			'openNativeAudioSession', 'bindNativeAudioSession', 'nativeAudioSessionStatus',
			'calibrateNativeAudioSession', 'reportNativeAudioSessionTransfer', 'reportNativeAudioSessionLoss',
			'closeNativeAudioSession', 'setNativePluginInstallationAllowed', 'selectNativePluginInstallation',
			'instantiateNativePlugin', 'runNativePluginOffline', 'setNativePluginBypassed',
			'persistNativePluginState', 'restoreNativePluginState', 'openNativePluginVendorUi',
			'closeNativePluginVendorUi', 'closeNativePluginInstance',
		].map(name => [name, async () => { throw new Error(`Unexpected native operation: ${name}`); }]));
		Object.defineProperty(window, 'soundscaperDesktop', { configurable: true, value: { v1: {
			...forbidden,
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
			getEnvironment: async () => null, signalReady: async () => undefined,
			onMenuCommand: () => () => undefined, onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined, onWindowStateChanged: () => () => undefined,
			readNativeTierControls: async () => ({ probeHelperEnabled: false, probeHelperQuarantined: false,
				audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false }),
			nativeAudioHelperAvailability: async () => ({ enabled: false, quarantined: false, payload: unavailable, backends: [] }),
			nativePluginAvailability: async () => availability(), listNativePlugins: async () => ({ entries: [] }),
			setNativePluginConsent: async ({ action }) => {
				calls.push(action);
				if (action === 'grant') granted = true;
				if (action === 'add-custom-root') added = true;
				if (action === 'remove-root') added = false;
			},
		} } });
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { AxeBuilder, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';

test('Framescaper keeps blocked native preferences and OFX management menu-only and accessible', async ({ page }) => {
	await page.addInitScript(() => {
		const preferences = {
			nativeMediaEnabled: false,
			hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false,
			ofxConsentEnabled: false,
		};
		const nativeServices = {
			snapshot: async () => ({
				snapshotVersion: 1,
				runtimeAvailable: false,
				nativeMediaEnabled: preferences.nativeMediaEnabled,
				queue: [], roots: [], watchRules: [],
			}),
			control: async () => { throw new Error('No blocked queue job can be controlled.'); },
			reorder: async () => [],
			remove: async () => false,
			capabilities: async () => ({
				snapshotVersion: 1, masterEnabled: false, buildFingerprint: null, entries: [],
			}),
			preferences: async () => ({ ...preferences }),
			setPreference: async ({ preference, enabled }) => {
				const key = {
					'native-media': 'nativeMediaEnabled',
					'hardware-decode': 'hardwareDecodeEnabled',
					'hardware-encode': 'hardwareEncodeEnabled',
					'ofx-consent': 'ofxConsentEnabled',
				}[preference];
				if (!key || typeof enabled !== 'boolean') throw new Error('Invalid native preference.');
				preferences[key] = enabled;
				return enabled;
			},
		};
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: Object.freeze({
				nativeServices: Object.freeze(nativeServices),
				readNativeTierControls: async () => ({
					probeHelperEnabled: false,
					probeHelperQuarantined: false,
					audioHelperEnabled: false,
					audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: false,
				}),
				applyNativeTierControl: async () => ({
					probeHelperEnabled: false,
					probeHelperQuarantined: false,
					audioHelperEnabled: false,
					audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: false,
				}),
			}) }),
		});
	});
	await page.emulateMedia({ forcedColors: 'active' });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const menubar = editor.getByRole('menubar', { name: 'Application menu' });

	const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	const preferencesItem = getMenuItem(tools, 'Native media and scratch…');
	await expect(preferencesItem).toBeEnabled();
	await preferencesItem.focus();
	await page.keyboard.press('Enter');
	const preferencesDialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await expect(preferencesDialog).toBeVisible();
	await expect(preferencesDialog.getByText(/Native media runtime is unavailable/u)).toBeVisible();
	await expect.poll(() => page.evaluate(() => Boolean(
		document.querySelector('[data-framescaper-native-services-dialog="true"]')
			?.contains(document.activeElement),
	))).toBe(true);
	for (const preference of ['native-media', 'hardware-decode', 'hardware-encode', 'ofx-consent']) {
		await expect(preferencesDialog.locator(`[data-native-service-preference="${preference}"]`))
			.not.toBeChecked();
	}
	const preferencesA11y = await new AxeBuilder({ page })
		.include('[data-framescaper-native-services-dialog="true"]')
		.analyze();
	expect(preferencesA11y.violations.filter(({ impact }) => (
		impact === 'critical' || impact === 'serious'
	))).toEqual([]);
	await page.keyboard.press('Escape');
	await expect(preferencesDialog).toBeHidden();
	await expect(menubar.getByRole('menuitem', { name: 'Tools', exact: true })).toBeFocused();

	const videoEffects = await openNestedCommandMenu(page, editor, 'Effect', ['Video effects']);
	await expect(getMenuItem(videoEffects, 'Add OFX…')).toBeDisabled();
	const manageOfx = getMenuItem(videoEffects, 'Manage OFX…');
	await expect(manageOfx).toBeEnabled();
	await manageOfx.focus();
	await page.keyboard.press('Enter');
	const ofxDialog = page.getByRole('dialog', { name: /Manage OFX/u });
	await expect(ofxDialog).toBeVisible();
	await expect(ofxDialog.locator('[data-native-service-preference="ofx-consent"]')).not.toBeChecked();
	await expect(ofxDialog.getByText('Detailed runtime capability evidence is unavailable.')).toBeVisible();
	const ofxA11y = await new AxeBuilder({ page })
		.include('[data-framescaper-native-services-dialog="true"]')
		.analyze();
	expect(ofxA11y.violations.filter(({ impact }) => (
		impact === 'critical' || impact === 'serious'
	))).toEqual([]);
	await page.keyboard.press('Escape');
	await expect(menubar.getByRole('menuitem', { name: 'Effect', exact: true })).toBeFocused();

	await page.goto('/embed/en/');
	const soundscaper = page.locator('[data-audio-editor]');
	await expect(soundscaper).toHaveAttribute('data-product', 'soundscaper');
	const soundscaperTools = await openNestedCommandMenu(page, soundscaper, 'Tools', []);
	await expect(getMenuItem(soundscaperTools, 'Native media and scratch…')).toHaveCount(0);
});

test('enabled OpenFX scan, inventory, and control stay inside the menu-opened surface', async ({ page }) => {
	await page.addInitScript(() => {
		const calls = [];
		const preferences = {
			nativeMediaEnabled: true,
			hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false,
			ofxConsentEnabled: true,
		};
		let plugins = [];
		const plugin = (state = 'consented') => ({
			pluginHandle: '12'.repeat(20),
			pluginId: 'org.framescaper.browserfixture',
			vendor: 'Framescaper',
			version: { major: 1, minor: 0 },
			binarySha256: '34'.repeat(32),
			supportedContexts: ['filter'],
			parameters: [{ name: 'radius', type: 'double', animates: true }],
			components: ['RGBA'], pixelDepths: ['byte'], threading: 'fully-safe',
			state, quarantined: false,
		});
		const nativeServices = {
			snapshot: async () => ({
				snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
				queue: [], roots: [], watchRules: [],
			}),
			control: async () => { throw new Error('No queue job belongs to this fixture.'); },
			reorder: async () => [],
			remove: async () => false,
			capabilities: async () => ({
				snapshotVersion: 1, masterEnabled: true, buildFingerprint: null,
				entries: [{
					domain: 'ofx', id: 'isolated-host', state: 'available', reason: 'ready',
					userEnabled: true, buildFingerprint: null, detail: null,
				}],
			}),
			preferences: async () => ({ ...preferences }),
			setPreference: async ({ preference, enabled }) => {
				calls.push(['preference', preference, enabled]);
				return enabled;
			},
			scanOpenFxPlugin: async () => {
				calls.push(['scan']);
				plugins = [plugin()];
				return plugins[0];
			},
			listOpenFxPlugins: async () => {
				calls.push(['inventory']);
				return plugins.map((entry) => structuredClone(entry));
			},
			controlOpenFxPlugin: async ({ pluginHandle, action }) => {
				calls.push(['control', pluginHandle, action]);
				if (pluginHandle !== '12'.repeat(20) || action !== 'enable') {
					throw new Error('The browser fixture admits one exact enable control.');
				}
				plugins = [plugin('enabled')];
				return plugins[0];
			},
		};
		Object.defineProperty(globalThis, '__framescaperOpenFxCalls', {
			configurable: true, value: calls,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: Object.freeze({
				nativeServices: Object.freeze(nativeServices),
				readNativeTierControls: async () => ({
					probeHelperEnabled: false, probeHelperQuarantined: false,
					audioHelperEnabled: false, audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: false,
				}),
				applyNativeTierControl: async () => ({
					probeHelperEnabled: false, probeHelperQuarantined: false,
					audioHelperEnabled: false, audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: false,
				}),
			}) }),
		});
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await expect(editor.locator('[data-framescaper-openfx-scan="true"]')).toHaveCount(0);
	await expect(editor.getByText('org.framescaper.browserfixture')).toHaveCount(0);

	const videoEffects = await openNestedCommandMenu(page, editor, 'Effect', ['Video effects']);
	const manageOfx = getMenuItem(videoEffects, 'Manage OFX…');
	await expect(manageOfx).toBeEnabled();
	await manageOfx.click();
	const dialog = page.getByRole('dialog', { name: /Manage OFX/u });
	const scan = dialog.locator('[data-framescaper-openfx-scan="true"]');
	await expect(scan).toBeEnabled();
	await scan.click();
	const row = dialog.locator('[data-framescaper-openfx-plugin="' + '12'.repeat(20) + '"]');
	await expect(row).toContainText('org.framescaper.browserfixture');
	await expect(row).toContainText('consented');
	await expect(row).not.toContainText('/private/');
	await row.getByRole('button', { name: 'Enable', exact: true }).click();
	await expect(row).toContainText('enabled');
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperOpenFxCalls)).toEqual([
		['inventory'], ['scan'], ['inventory'],
		['control', '12'.repeat(20), 'enable'], ['inventory'],
	]);
});

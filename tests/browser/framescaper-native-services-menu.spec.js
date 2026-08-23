/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';

for (const advertised of [false, true]) {
	test(`selected V27 excludes ${advertised ? 'advertised' : 'blocked'} native and OpenFX services`, async ({ page }) => {
		await installNativeServicesFixture(page, advertised);
		const editor = await bootEditor(page, '/framescaper/embed/en/');

		const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
		for (const label of ['Background jobs…', 'Watch folders…', 'Native media and scratch…']) {
			await expect(getMenuItem(tools, label)).toHaveCount(0);
		}
		await page.keyboard.press('Escape');

		const effect = await openNestedCommandMenu(page, editor, 'Effect', []);
		await expect(getMenuItem(effect, 'Video Transitions')).toBeEnabled();
		await expect(getMenuItem(effect, 'Video Finishing')).toBeEnabled();
		await expect(getMenuItem(effect, 'Video effects')).toHaveCount(0);
		await expect(getMenuItem(effect, 'Add OFX…')).toHaveCount(0);
		await expect(getMenuItem(effect, 'Manage OFX…')).toHaveCount(0);
		await page.keyboard.press('Escape');

		await expect(page.locator('[data-framescaper-native-services-dialog="true"]')).toHaveCount(0);
		await expect(page.locator('[data-framescaper-openfx-scan="true"]')).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => globalThis.__framescaperOpenFxCalls)).toEqual([]);
	});
}

async function installNativeServicesFixture(page, advertised) {
	await page.addInitScript(({ nativeTierAdvertised }) => {
		const calls = [];
		const preferences = {
			nativeMediaEnabled: nativeTierAdvertised,
			hardwareDecodeEnabled: nativeTierAdvertised,
			hardwareEncodeEnabled: nativeTierAdvertised,
			ofxConsentEnabled: nativeTierAdvertised,
		};
		const nativeServices = {
			snapshot: async () => ({
				snapshotVersion: 1,
				runtimeAvailable: nativeTierAdvertised,
				nativeMediaEnabled: nativeTierAdvertised,
				queue: [], roots: [], watchRules: [],
			}),
			control: async () => { throw new Error('No native queue job belongs to this fixture.'); },
			reorder: async () => [],
			remove: async () => false,
			capabilities: async () => ({
				snapshotVersion: 1,
				masterEnabled: nativeTierAdvertised,
				buildFingerprint: null,
				entries: nativeTierAdvertised ? [{
					domain: 'ofx', id: 'isolated-host', state: 'available', reason: 'ready',
					userEnabled: true, buildFingerprint: null, detail: null,
				}] : [],
			}),
			preferences: async () => ({ ...preferences }),
			setPreference: async ({ enabled }) => enabled,
			scanOpenFxPlugin: async () => {
				calls.push(['scan']);
				throw new Error('Selected V27 must not scan OpenFX plug-ins.');
			},
			listOpenFxPlugins: async () => {
				calls.push(['inventory']);
				return [];
			},
			controlOpenFxPlugin: async () => {
				calls.push(['control']);
				throw new Error('Selected V27 must not control OpenFX plug-ins.');
			},
		};
		Object.defineProperty(globalThis, '__framescaperOpenFxCalls', {
			configurable: true,
			value: calls,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: Object.freeze({
				nativeServices: Object.freeze(nativeServices),
				readNativeTierControls: async () => ({
					probeHelperEnabled: nativeTierAdvertised,
					probeHelperQuarantined: false,
					audioHelperEnabled: nativeTierAdvertised,
					audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: nativeTierAdvertised,
				}),
				applyNativeTierControl: async () => ({
					probeHelperEnabled: nativeTierAdvertised,
					probeHelperQuarantined: false,
					audioHelperEnabled: nativeTierAdvertised,
					audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: nativeTierAdvertised,
				}),
			}) }),
		});
	}, { nativeTierAdvertised: advertised });
}

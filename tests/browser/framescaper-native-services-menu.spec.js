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

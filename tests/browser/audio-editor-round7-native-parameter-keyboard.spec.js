/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

test('installed native parameter arrow edits retain fine adjustment and exact state', async ({ page }) => {
	const dialog = await openInstalledGain(page);
	const range = dialog.locator('[data-native-plugin-parameter="gain"]');
	await expect(range).toHaveValue('0.25');
	await range.dblclick();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(.25);
	await range.press('ArrowRight');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(.26);
	await range.press('ArrowLeft');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(.25);
	await dialog.locator('[data-native-plugin-persist-state]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.persisted)).toBe(2);
	await range.press('End');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(1);
	await dialog.locator('[data-native-plugin-restore-state]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(.25);
});

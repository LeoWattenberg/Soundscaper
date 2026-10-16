/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

test('restoring installed native plug-in state refreshes its visible controls', async ({ page }) => {
	const dialog = await openInstalledGain(page);
	const range = dialog.locator('[data-native-plugin-parameter="gain"]');
	await expect(range).toHaveValue('0.25');
	await range.press('Home');
	await expect(range).toHaveValue('0');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(0);
	await dialog.locator('[data-native-plugin-persist-state]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.persisted)).toBe(2);
	await expect(range).toBeEnabled();
	await range.press('End');
	await expect(range).toHaveValue('1');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(1);
	await dialog.locator('[data-native-plugin-restore-state]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(0);
	await expect(range).toBeEnabled();
	console.log('Restored native host and visible parameter', { host: await page.evaluate(() => globalThis.__nativePluginParameterHost.values[0]), visible: await range.inputValue() });
	await expect(range).toHaveValue('0');
	await range.press('End');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(1);
});

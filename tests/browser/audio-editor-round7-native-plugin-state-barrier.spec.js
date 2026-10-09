/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

test('Store state captures the completed native slider position while host writes are pending', async ({ page }) => {
	const dialog = await openInstalledGain(page);
	const range = dialog.locator('[data-native-plugin-parameter="gain"]');
	await range.focus();
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(.26);
	await dialog.locator('[data-native-plugin-persist-state]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.persisted)).toBe(2);
	await expect(range).toHaveValue('0.26');
	await page.evaluate(() => globalThis.__nativePluginParameterHost.setDelay(400));
	const bounds = await range.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width * .3, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height / 2, { steps: 6 });
	await page.mouse.up();
	await dialog.locator('[data-native-plugin-persist-state]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.persisted)).toBe(3);
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBeGreaterThan(.75);
	await expect(range).toHaveValue(String(await page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])));
	await page.evaluate(() => globalThis.__nativePluginParameterHost.setDelay(0));
	await range.dblclick();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(.25);
	await dialog.locator('[data-native-plugin-restore-state]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBeGreaterThan(.75);
	await expect(range).toHaveValue(String(await page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])));
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

for (const completion of ['host reply', 'Close', 'Escape']) test(`installed native plug-in retains its final drag through ${completion}`, async ({ page }) => {
	const dialog = await openInstalledGain(page);
	const range = dialog.locator('[data-native-plugin-parameter="gain"]');
	await expect(range).toBeEnabled();
	await expect(range).toHaveValue('0.25');
	// An ordinary settled keyboard write confirms the complete production RPC route.
	await range.press('ArrowRight');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBeGreaterThan(.25);
	await expect(range).toBeEnabled();
	await page.evaluate(() => globalThis.__nativePluginParameterHost.setDelay(200));
	const box = await range.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width * .3, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2, { steps: 6 });
	await page.mouse.up();
	const releasedValue = Number(await range.inputValue());
	expect(releasedValue).toBeGreaterThan(.75);
	if (completion === 'Close') await dialog.locator('.audio-editor-dialog-footer').getByRole('button', { name: 'Close', exact: true }).click();
	else if (completion === 'Escape') await page.keyboard.press('Escape');
	if (completion !== 'host reply') await expect(dialog).toBeHidden();
	// A prior keyboard write can exceed .75 while the final drag write is queued.
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(releasedValue);
	const applied = await page.evaluate(() => ({ value: globalThis.__nativePluginParameterHost.values[0],
		writes: [...globalThis.__nativePluginParameterHost.writes] }));
	console.log('Native installed gain slider final position', { completion, ...applied });
	expect(applied.value).toBe(releasedValue);
	if (completion === 'host reply') await expect(range).toHaveValue(String(releasedValue));
});

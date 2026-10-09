/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

test('installed native plug-in keeps its live host while the ordinary transport is idle', async ({ page }) => {
	const dialog = await openInstalledGain(page);
	const host = await page.evaluate(() => ({ persisted: globalThis.__nativePluginParameterHost.persisted,
		requests: [...globalThis.__nativePluginParameterHost.requests] }));
	console.log('Native instantiated idle host', { ...host, alerts: await dialog.getByRole('alert').allTextContents() });
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(dialog.locator('[data-native-plugin-parameter="gain"]')).toHaveValue('0.25');
});

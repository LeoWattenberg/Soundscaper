/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('a refused meter Position save settles and permits a normal retry', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const panel = editor.locator('[data-workspace-panel="playback-meter"]');
	const toolbar = editor.locator('[data-audio-meter][data-meter-kind="playback"][data-meter-position="top"]');
	const openSettings = async () => {
		const settings = editor.getByRole('dialog', { name: 'Playback meter settings', exact: true });
		if (!await settings.isVisible()) await editor.getByRole('button', { name: 'Playback meter settings', exact: true }).click();
		return settings;
	};
	await expect(panel).toBeVisible();
	let settings = await openSettings();
	await settings.getByRole('radio', { name: 'Toolbar', exact: true }).click();
	await expect(toolbar).toBeVisible();
	await expect(panel).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => (
		JSON.parse(localStorage.getItem('soundscaper-playback-meter-settings-v2'))?.position
	))).toBe('top');
	await expect.poll(() => savedPanelVisible(page)).toBe(false);
	await page.evaluate(() => {
		const original = IDBObjectStore.prototype.put;
		window.__meterSaveAttempts = 0;
		window.__restoreMeterStorage = () => { IDBObjectStore.prototype.put = original; };
		IDBObjectStore.prototype.put = function (value, key) {
			if (this.name === 'settings' && value?.key === 'audio-editor-preferences-v1') {
				window.__meterSaveAttempts += 1;
				// Stop the baseline feedback loop after three refusals so verification
				// never leaves a quota simulation running in the editor.
				if (window.__meterSaveAttempts <= 3) {
					throw new DOMException('The device storage is full.', 'QuotaExceededError');
				}
				window.__restoreMeterStorage();
			}
			return original.call(this, value, key);
		};
	});
	try {
		settings = await openSettings();
		await settings.getByRole('radio', { name: 'Panel', exact: true }).click();
		await page.waitForFunction(() => window.__meterSaveAttempts > 2 || (
			window.__meterSaveAttempts > 0
			&& JSON.parse(localStorage.getItem('soundscaper-playback-meter-settings-v2'))?.position === 'top'
		));
		expect(await page.evaluate(() => window.__meterSaveAttempts)).toBeLessThanOrEqual(2);
		await expect(toolbar).toBeVisible();
		await expect(panel).toHaveCount(0);
		await expect.poll(() => savedPanelVisible(page)).toBe(false);
		await page.evaluate(() => window.__restoreMeterStorage());
		settings = await openSettings();
		await settings.getByRole('radio', { name: 'Panel', exact: true }).click();
		await expect(panel).toBeVisible();
		await expect(toolbar).toHaveCount(0);
		await expect.poll(() => savedPanelVisible(page)).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await page.evaluate(() => {
			window.__restoreMeterStorage?.();
			delete window.__restoreMeterStorage;
			delete window.__meterSaveAttempts;
		});
	}
});

async function savedPanelVisible(page) {
	return page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const setting = database.transaction('settings', 'readonly').objectStore('settings')
				.get('soundscaper:audio-editor-preferences-v1');
			setting.onerror = () => { database.close(); reject(setting.error); };
			setting.onsuccess = () => {
				database.close(); resolve(setting.result?.value?.workspace?.panels?.['playback-meter']?.visible);
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

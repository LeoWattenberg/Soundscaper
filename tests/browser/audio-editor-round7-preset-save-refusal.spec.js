/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('a refused ordinary effect preset save retains its name for a successful retry', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.press('Enter');
	const effect = await openParametricEqSelectionEffect(page, editor);
	const openName = async (name) => {
		await effect.getByRole('button', { name: 'Save preset', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
		const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
		await prompt.getByRole('textbox').fill(name);
		return prompt;
	};
	const healthy = await openName('Healthy saved room');
	await healthy.getByRole('textbox').press('Enter');
	await expect(healthy).toBeHidden();
	await expect(effect.getByRole('button', { name: 'Preset', exact: true })).toContainText('Healthy saved room');
	const names = () => page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const read = database.transaction('settings', 'readonly').objectStore('settings')
				.get('audio-editor-effect-presets-v1');
			read.onerror = () => { database.close(); reject(read.error); };
			read.onsuccess = () => {
				database.close(); resolve(read.result?.value?.presets?.map(({ name }) => name) ?? []);
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
	await expect.poll(names).toContain('Healthy saved room');
	const refused = await openName('Keep my refused room');
	await page.evaluate(() => {
		const put = IDBObjectStore.prototype.put;
		Object.defineProperty(IDBObjectStore.prototype, 'put', { configurable: true, value(value, key) {
			if (this.name === 'settings' && value?.key === 'audio-editor-effect-presets-v1') {
				Object.defineProperty(IDBObjectStore.prototype, 'put', { configurable: true, value: put });
				globalThis.__round7PresetRefusals = (globalThis.__round7PresetRefusals ?? 0) + 1;
				throw new DOMException('The device storage is full.', 'QuotaExceededError');
			}
			return put.call(this, value, key);
		} });
	});
	await refused.getByRole('textbox').press('Enter');
	await expect.poll(() => page.evaluate(() => globalThis.__round7PresetRefusals ?? 0)).toBe(1);
	await expect(effect.getByText('The device storage is full.', { exact: true })).toBeVisible();
	expect(await names()).not.toContain('Keep my refused room');
	await expect(refused).toBeVisible();
	await expect(refused.getByRole('textbox')).toHaveValue('Keep my refused room');
	await refused.getByRole('textbox').press('Enter');
	await expect(refused).toBeHidden();
	await expect(effect.getByRole('button', { name: 'Preset', exact: true })).toContainText('Keep my refused room');
	await expect.poll(names).toContain('Keep my refused room');
});

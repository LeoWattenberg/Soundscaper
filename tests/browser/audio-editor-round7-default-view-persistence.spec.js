/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, clipByName, importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

registerAudioEditorHooks();

test('a refused default-view save restores the live timeline and permits a normal retry', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	const defaults = preferences.getByRole('group', { name: 'Default view', exact: true });
	const track = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
	await chooseDropdown(page, defaults, 'Rainbow waveform');
	await expect(editor).toHaveAttribute('data-timeline-view', 'waveform-rainbow');
	await expect(track).toHaveAttribute('data-display-mode', 'waveform-rainbow');
	await expect.poll(() => page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const stored = database.transaction('settings', 'readonly').objectStore('settings')
				.get('soundscaper:audio-editor-preferences-v1');
			stored.onerror = () => { database.close(); reject(stored.error); };
			stored.onsuccess = () => {
				database.close(); resolve(stored.result?.value?.appearance?.defaultView);
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME)).toBe('waveform-rainbow');
	await page.evaluate(() => {
		const originalPut = IDBObjectStore.prototype.put;
		Object.defineProperty(IDBObjectStore.prototype, 'put', {
			configurable: true,
			value(value, key) {
				if (this.name === 'settings' && value?.key === 'audio-editor-preferences-v1') {
					Object.defineProperty(IDBObjectStore.prototype, 'put', {
						configurable: true, value: originalPut,
					});
					throw new DOMException('The device storage is full.', 'QuotaExceededError');
				}
				return originalPut.call(this, value, key);
			},
		});
	});
	await defaults.getByRole('button').click();
	await page.getByRole('option', { name: 'Half-wave', exact: true }).click();
	await expect(defaults.getByRole('button')).toContainText('Rainbow waveform');
	await expect(editor).toHaveAttribute('data-timeline-view', 'waveform-rainbow');
	await expect(track).toHaveAttribute('data-display-mode', 'waveform-rainbow');
	await chooseDropdown(page, defaults, 'Half-wave');
	await expect(defaults.getByRole('button')).toContainText('Half-wave');
	await expect(editor).toHaveAttribute('data-timeline-view', 'half-wave');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
});

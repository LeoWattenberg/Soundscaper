/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('a failed pending shortcut save retains the newer binding for an ordinary retry', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	const field = command.getByRole('textbox').first();
	const assign = command.getByRole('button', { name: 'Assign', exact: true });
	await field.fill('Ctrl+Alt+Shift+F6');
	await assign.click();
	await expect.poll(() => savedBinding(page)).toEqual(['Ctrl+Alt+Shift+F6']);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+Alt+Shift+F6');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	await holdAndObserveSettings(page);
	try {
		await field.fill('Ctrl+Alt+Shift+F7');
		await assign.click();
		await expect.poll(() => page.evaluate(() => Boolean(window.__round7RefuseShortcutSave))).toBe(true);
		await expect(assign).toBeDisabled();
		await field.fill('Ctrl+Alt+Shift+F8');
		await expect(field).toHaveValue('Ctrl+Alt+Shift+F8');
		// Abort the actual pending IndexedDB writer: the normal persistence
		// failure must restore the saved binding without replacing newer text.
		await page.evaluate(() => window.__round7RefuseShortcutSave());
		await page.evaluate(() => window.__round7ReleaseShortcutStorage());
		await expect.poll(() => savedBinding(page)).toEqual(['Ctrl+Alt+Shift+F6']);
		await expect(page.getByRole('alert').filter({ hasText: 'The IndexedDB transaction failed.' })).toBeVisible();
		await expect(field).toHaveValue('Ctrl+Alt+Shift+F8');
		await assign.click();
		await expect.poll(() => savedBinding(page)).toEqual(['Ctrl+Alt+Shift+F8']);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
		await page.keyboard.press('Control+Alt+Shift+F8');
		await expect(editor.locator('[data-label-track]')).toHaveCount(1);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	} finally {
		await page.evaluate(() => window.__round7ReleaseShortcutStorage?.());
	}
});

async function holdAndObserveSettings(page) {
	await page.evaluate(databaseName => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const transaction = database.transaction('settings', 'readwrite');
			const settings = transaction.objectStore('settings');
			let released = false;
			let finish;
			const completed = new Promise(done => { finish = done; });
			window.__round7ReleaseShortcutStorage = () => { released = true; return completed; };
			const deadline = performance.now() + 10_000;
			const complete = () => { database.close(); finish(); };
			transaction.oncomplete = complete;
			transaction.onabort = complete;
			const keepAlive = () => {
				if (released || performance.now() >= deadline) return;
				const read = settings.get('audio-editor-preferences-v1');
				read.onsuccess = keepAlive;
			};
			keepAlive();
			const put = IDBObjectStore.prototype.put;
			Object.defineProperty(IDBObjectStore.prototype, 'put', { configurable: true, value(value, key) {
				const result = put.call(this, value, key);
				if (this.name === 'settings' && value?.key === 'audio-editor-preferences-v1') {
					Object.defineProperty(IDBObjectStore.prototype, 'put', { configurable: true, value: put });
					const writer = this.transaction;
					window.__round7RefuseShortcutSave = () => { writer.abort(); delete window.__round7RefuseShortcutSave; };
				}
				return result;
			} });
			resolve();
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

async function savedBinding(page) {
	return page.evaluate(databaseName => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const read = database.transaction('settings', 'readonly').objectStore('settings')
				.get('soundscaper:audio-editor-preferences-v1');
			read.onerror = () => { database.close(); reject(read.error); };
			read.onsuccess = () => { database.close(); resolve(read.result?.value?.shortcuts?.['new-label-track'] ?? []); };
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeClipProperties, collectClientErrors,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('a retired track resample cannot dismiss a newer factory confirmation', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'dialog-recording.wav', frequency: 330, channelCount: 1 })]);
	const clip = editor.locator('[data-clip-id][role="group"]').first();
	await clip.locator('.clip-header').click();
	const resample = async () => {
		await chooseCommandAction(page, editor, 'Tracks', 'Resample');
		const dialog = page.getByRole('dialog', { name: 'Resample', exact: true });
		await dialog.locator('input').fill('24000');
		await dialog.getByRole('button', { name: 'Resample', exact: true }).click();
		return dialog;
	};
	const healthy = await resample();
	await expect(healthy).toBeHidden({ timeout: 10_000 });
	await expectRate(24_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expectRate(48_000);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await holdDerivedSourceStorage(page);
	try {
		const pending = await resample();
		await expect.poll(() => page.evaluate(() => window.__round7ResampleSourceReadPending === true)).toBe(true);
		await expect(pending).toBeVisible();
		await pending.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(pending).toBeHidden();
		await chooseCommandAction(page, editor, 'Help', 'Revert to factory settings');
		const confirmation = page.getByRole('dialog', { name: 'Revert to factory settings', exact: true });
		await expect(confirmation).toBeVisible();
		await page.evaluate(() => window.__round7ReleaseResampleStorage());
		await expect(editor.locator('[data-editor-status]')).toHaveAttribute('title', 'Done');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await expect(confirmation).toBeVisible();
		await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expectRate(24_000);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expectRate(48_000);
		expect(errors).toEqual([]);
	} finally {
		await page.evaluate(() => window.__round7ReleaseResampleStorage?.());
	}

	async function expectRate(rate) {
		const properties = await openClipProperties(page, editor, clip);
		await properties.getByText('Media settings', { exact: true }).click();
		await expect(properties.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value')).toHaveText(String(rate));
		await closeClipProperties(properties);
	}
});

async function holdDerivedSourceStorage(page) {
	await page.evaluate(databaseName => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result;
			const transaction = database.transaction('sources', 'readwrite');
			const sources = transaction.objectStore('sources');
			let released = false;
			let finish;
			const completed = new Promise(done => { finish = done; });
			const get = IDBObjectStore.prototype.get;
			const restore = () => Object.defineProperty(IDBObjectStore.prototype, 'get', { configurable: true, value: get });
			window.__round7ReleaseResampleStorage = () => { released = true; restore(); return completed; };
			const deadline = performance.now() + 10_000;
			const complete = () => { restore(); database.close(); finish(); };
			transaction.oncomplete = complete;
			transaction.onabort = complete;
			const keepAlive = () => {
				if (released || performance.now() >= deadline) return;
				const read = sources.get('__round7_resample_hold__');
				read.onsuccess = keepAlive;
			};
			keepAlive();
			Object.defineProperty(IDBObjectStore.prototype, 'get', { configurable: true, value(key) {
				const request = get.call(this, key);
				if (this.name === 'sources' && key !== '__round7_resample_hold__') {
					window.__round7ResampleSourceReadPending = true;
					restore();
				}
				return request;
			} });
			resolve();
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

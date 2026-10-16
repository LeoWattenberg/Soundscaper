/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, waitForEditor } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('a completed workspace save retains the newer name typed while storage is busy', async ({ page }) => {
	const errors = collectClientErrors(page);
	let editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	let preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Workspace$/u }).click();
	const name = preferences.getByRole('textbox', { name: 'Workspace name', exact: true });
	const create = preferences.getByRole('button', { name: 'Create from current layout', exact: true });
	const preset = preferences.getByRole('button', { name: 'Workspace preset', exact: true });
	// Healthy ordinary Create clears exactly its unchanged draft after a real
	// save. The following scenario keeps the same native persistence contract.
	await name.fill('Healthy layout');
	await create.click();
	await expect(name).toHaveValue('');
	await expect.poll(() => savedWorkspaceNames(page)).toContain('Healthy layout');
	await holdSettingsTransaction(page);
	try {
		await name.fill('First pending layout');
		await create.click();
		await expect(preset).toHaveText(/First pending layout/u);
		await expect(name).toHaveValue('First pending layout');
		await name.fill('Next layout');
		await expect(name).toHaveValue('Next layout');
		await releaseSettingsTransaction(page);
		await expect.poll(() => savedWorkspaceNames(page)).toContain('First pending layout');
		await expect(name).toHaveValue('Next layout');
		await create.click();
		await expect(name).toHaveValue('');
		await expect.poll(() => savedWorkspaceNames(page)).toContain('Next layout');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await page.reload();
		editor = await waitForEditor(page);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Workspace$/u }).click();
		await preferences.getByRole('button', { name: 'Workspace preset', exact: true }).click();
		const options = page.getByRole('listbox', { name: 'Workspace preset', exact: true });
		for (const label of ['Healthy layout', 'First pending layout', 'Next layout']) {
			await expect(options.getByRole('option', { name: label, exact: true })).toHaveCount(1);
		}
		expect(errors).toEqual([]);
	} finally {
		await releaseSettingsTransaction(page);
	}
});

async function holdSettingsTransaction(page) {
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
			window.__round7ReleaseWorkspaceStorage = () => { released = true; return completed; };
			const deadline = performance.now() + 10_000;
			const complete = () => { database.close(); finish(); };
			transaction.oncomplete = complete;
			transaction.onabort = complete;
			const continueRead = () => {
				if (released || performance.now() >= deadline) return;
				const read = settings.get('soundscaper:audio-editor-preferences-v1');
				read.onsuccess = continueRead;
				read.onerror = () => { released = true; reject(read.error); };
			};
			continueRead();
			resolve();
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

async function releaseSettingsTransaction(page) {
	await page.evaluate(async () => {
		await window.__round7ReleaseWorkspaceStorage?.();
		delete window.__round7ReleaseWorkspaceStorage;
	});
}

async function savedWorkspaceNames(page) {
	return page.evaluate(databaseName => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const read = database.transaction('settings', 'readonly').objectStore('settings')
				.get('soundscaper:audio-editor-preferences-v1');
			read.onerror = () => { database.close(); reject(read.error); };
			read.onsuccess = () => {
				database.close(); resolve(read.result?.value?.workspace?.custom?.map(workspace => workspace.name) ?? []);
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

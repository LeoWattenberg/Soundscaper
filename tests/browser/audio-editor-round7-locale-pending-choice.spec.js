/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors,
	importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('choosing the current language cancels an older navigation while the real project save is pending', async ({ page }) => {
	const errors = collectClientErrors(page);
	let editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'locale-session.wav' })]);
	const projectId = await editor.getAttribute('data-project-id');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	let preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const chooseLanguage = async label => {
		await preferences.getByRole('group', { name: 'Language', exact: true }).getByRole('button').click();
		await page.getByRole('option', { name: label, exact: true }).click();
	};
	await chooseLanguage('Deutsch');
	await page.waitForURL('**/embed/de/');
	editor = await waitForEditor(page);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await page.goto('/embed/en/');
	editor = await waitForEditor(page);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await holdProjectStorage(page);
	let storageHeld = true;
	try {
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);
		await expect(editor.locator('[data-label-track]')).toHaveCount(1);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await chooseLanguage('Deutsch');
		await expect(preferences).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saving');
		await chooseLanguage('English');
		await releaseProjectStorage(page);
		storageHeld = false;
		await expect.poll(() => savedLabelCount(page, projectId)).toBe(1);
		await expect(page.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		// The saved indicator precedes native garbage collection and the language
		// continuation. Observe that older navigation through its bounded window.
		await page.waitForURL('**/embed/de/', { timeout: 1500, waitUntil: 'domcontentloaded' }).catch(error => {
			if (error.name !== 'TimeoutError') throw error;
		});
		editor = await waitForEditor(page);
		expect(new URL(page.url()).pathname).toBe('/embed/en/');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		expect(errors).toEqual([]);
	} finally {
		if (storageHeld) await releaseProjectStorage(page);
	}
});

async function holdProjectStorage(page) {
	await page.evaluate(databaseName => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result;
			const transaction = database.transaction('projects', 'readwrite');
			const projects = transaction.objectStore('projects');
			let released = false;
			let finish;
			const settled = new Promise(done => { finish = done; });
			window.__round7ReleaseLocaleStorage = () => { released = true; return settled; };
			const deadline = performance.now() + 10_000;
			const complete = () => { database.close(); finish(); };
			transaction.oncomplete = complete;
			transaction.onabort = complete;
			const keepAlive = () => {
				if (released || performance.now() >= deadline) return;
				const read = projects.get('__round7_locale_hold__');
				read.onsuccess = keepAlive;
				read.onerror = () => { released = true; reject(read.error); };
			};
			keepAlive();
			resolve();
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

async function releaseProjectStorage(page) {
	await page.evaluate(async () => {
		await window.__round7ReleaseLocaleStorage?.();
		delete window.__round7ReleaseLocaleStorage;
	});
}

async function savedLabelCount(page, projectId) {
	return page.evaluate(({ databaseName, projectId }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result;
			const read = database.transaction('projects', 'readonly').objectStore('projects').get(projectId);
			read.onerror = () => { database.close(); reject(read.error); };
			read.onsuccess = () => { database.close(); resolve(read.result?.tracks.filter(track => track.type === 'label').length ?? 0); };
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId });
}

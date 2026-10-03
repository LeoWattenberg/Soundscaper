/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	commitInput,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import {
	SOUNDSCAPER_DATABASE_NAME,
	SOUNDSCAPER_OPFS_DIRECTORY_NAME,
} from './helpers/editor-databases.js';

test.describe('clear all local editor data', () => {
	registerAudioEditorHooks();

	test('cancels without loss, then removes every saved project and media body before a fresh save', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');

		await renameProject(page, editor, 'Clear audit first');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
		const firstProjectId = await editor.getAttribute('data-project-id');

		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await renameProject(page, editor, 'Clear audit second');
		await importFiles(editor, [toneB]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
		const secondProjectId = await editor.getAttribute('data-project-id');
		expect(firstProjectId).toBeTruthy();
		expect(secondProjectId).toBeTruthy();
		expect(secondProjectId).not.toBe(firstProjectId);

		const before = await durableEditorInventory(page);
		expect(before.projects).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: firstProjectId, title: 'Clear audit first' }),
			expect.objectContaining({ id: secondProjectId, title: 'Clear audit second' }),
		]));
		expect(before.bodyEntries.length).toBeGreaterThanOrEqual(2);

		await openClearDialog(page, editor);
		let clear = page.getByRole('dialog', { name: 'Clear all local editor data', exact: true });
		await clear.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(clear).toBeHidden();
		await expect(editor).toHaveAttribute('data-project-id', secondProjectId);
		await expect(clipByName(editor, toneB.name)).toBeVisible();
		await expectLocalProjects(page, editor, ['Clear audit first', 'Clear audit second']);
		expect(await durableEditorInventory(page)).toEqual(before);

		await openClearDialog(page, editor);
		clear = page.getByRole('dialog', { name: 'Clear all local editor data', exact: true });
		await clear.getByRole('button', { name: 'Clear all local editor data', exact: true }).click();
		await expect(clear).toBeHidden({ timeout: 20_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(secondProjectId);
		const cleared = await durableEditorInventory(page);
		expect(cleared.projects.map(({ id }) => id)).not.toContain(firstProjectId);
		expect(cleared.projects.map(({ id }) => id)).not.toContain(secondProjectId);
		expect(cleared.revisionProjectIds).not.toContain(firstProjectId);
		expect(cleared.revisionProjectIds).not.toContain(secondProjectId);
		expect(cleared.bodyEntries).toEqual([]);
		expect(intersection(before.mediaAddresses, cleared.mediaAddresses)).toEqual([]);

		await renameProject(page, editor, 'Saved after clear');
		await importFiles(editor, [monoTone]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
		const replacementProjectId = await editor.getAttribute('data-project-id');
		expect(replacementProjectId).toBeTruthy();
		expect([firstProjectId, secondProjectId]).not.toContain(replacementProjectId);

		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-project-id', replacementProjectId, { timeout: 20_000 });
		await expect(editor.locator('[data-project-name]')).toHaveText('Saved after clear');
		await expect(clipByName(editor, monoTone.name)).toBeVisible();
		await expectLocalProjects(page, editor, ['Saved after clear'], [
			'Clear audit first',
			'Clear audit second',
		]);

		const afterReload = await durableEditorInventory(page);
		expect(afterReload.projects).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: replacementProjectId, title: 'Saved after clear' }),
		]));
		expect(afterReload.bodyEntries.length).toBeGreaterThan(0);
		expect(afterReload.projects.map(({ id }) => id)).not.toContain(firstProjectId);
		expect(afterReload.projects.map(({ id }) => id)).not.toContain(secondProjectId);
		expect(afterReload.revisionProjectIds).not.toContain(firstProjectId);
		expect(afterReload.revisionProjectIds).not.toContain(secondProjectId);
		expect(intersection(before.mediaAddresses, afterReload.mediaAddresses)).toEqual([]);
		expect(intersection(before.bodyFingerprints, afterReload.bodyFingerprints)).toEqual([]);
		expect(errors).toEqual([]);
	});
});

async function renameProject(page, editor, title) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(dialog.locator('[data-project-name-input] input'), title);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-project-name]')).toHaveText(title);
}

async function openClearDialog(page, editor) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Clear all local editor data']);
	await expect(page.getByRole('dialog', { name: 'Clear all local editor data', exact: true })).toBeVisible();
}

async function expectLocalProjects(page, editor, presentTitles, absentTitles = []) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Local projects']);
	const dialog = page.getByRole('dialog', { name: 'Local projects', exact: true });
	await expect(dialog).toBeVisible();
	for (const title of presentTitles) {
		await expect(dialog.locator('[data-project-list]').getByRole('button', {
			name: new RegExp(`^${escapeRegExp(title)} Last edited:`, 'u'),
		})).toBeVisible();
	}
	for (const title of absentTitles) await expect(dialog.getByText(title, { exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function intersection(left, right) {
	const rightValues = new Set(right);
	return left.filter((value) => rightValues.has(value));
}

async function durableEditorInventory(page) {
	return page.evaluate(async ({ databaseName, opfsDirectoryName }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const keyText = (key) => Array.isArray(key) ? key.map(keyText).join('|') : String(key);
		const bytesOf = async (value) => {
			if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
			if (value instanceof ArrayBuffer) return new Uint8Array(value);
			if (ArrayBuffer.isView(value)) {
				return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
			}
			return null;
		};
		const digest = async (bytes) => Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(value) => value.toString(16).padStart(2, '0'),
		).join('');
		const binaryParts = async (value) => {
			const parts = [];
			for (const field of ['blob', 'payload']) {
				const bytes = await bytesOf(value?.[field]);
				if (bytes) parts.push({ field, bytes });
			}
			if (Array.isArray(value?.channels)) {
				for (const [index, channel] of value.channels.entries()) {
					const bytes = await bytesOf(channel);
					if (bytes) parts.push({ field: `channels[${String(index)}]`, bytes });
				}
			}
			return parts;
		};
		const database = await result(indexedDB.open(databaseName));
		const storeNames = ['projects', 'revisions', 'sources', 'sourceChunks', 'mediaAssets', 'mediaAssetChunks'];
		let rows;
		try {
			const transaction = database.transaction(storeNames, 'readonly');
			rows = Object.fromEntries(await Promise.all(storeNames.map(async (storeName) => {
				const store = transaction.objectStore(storeName);
				const [keys, values] = await Promise.all([result(store.getAllKeys()), result(store.getAll())]);
				return [storeName, keys.map((key, index) => ({ key, value: values[index] }))];
			})));
		} finally {
			database.close();
		}

		const bodyEntries = [];
		const mediaAddresses = new Set();
		for (const storeName of ['sources', 'sourceChunks', 'mediaAssets', 'mediaAssetChunks']) {
			for (const { key, value } of rows[storeName]) {
				mediaAddresses.add(`row:${storeName}:${keyText(key)}`);
				for (const field of ['id', 'sourceId', 'sourceToken', 'mediaChunkToken', 'path']) {
					if (typeof value?.[field] === 'string' && value[field]) {
						mediaAddresses.add(`${field}:${value[field]}`);
					}
				}
				for (const { field, bytes } of await binaryParts(value)) {
					bodyEntries.push({
						address: `${storeName}:${keyText(key)}:${field}`,
						byteLength: bytes.byteLength,
						sha256: await digest(bytes),
					});
				}
			}
		}

		if (typeof navigator.storage?.getDirectory === 'function') {
			const root = await navigator.storage.getDirectory();
			let sourceDirectory = null;
			try {
				sourceDirectory = await root.getDirectoryHandle(opfsDirectoryName);
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
			}
			const visit = async (directory, prefix = '') => {
				for await (const [name, handle] of directory.entries()) {
					const path = `${prefix}${name}`;
					if (handle.kind === 'directory') await visit(handle, `${path}/`);
					else {
						const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
						mediaAddresses.add(`path:${path}`);
						bodyEntries.push({
							address: `opfs:${path}`,
							byteLength: bytes.byteLength,
							sha256: await digest(bytes),
						});
					}
				}
			};
			if (sourceDirectory) await visit(sourceDirectory);
		}

		bodyEntries.sort((left, right) => left.address.localeCompare(right.address));
		return {
			projects: rows.projects.map(({ value }) => ({ id: value.id, title: value.title }))
				.sort((left, right) => left.id.localeCompare(right.id)),
			revisionProjectIds: [...new Set(rows.revisions.map(({ value }) => value.projectId))].sort(),
			mediaAddresses: [...mediaAddresses].sort(),
			bodyEntries,
			bodyFingerprints: [...new Set(bodyEntries.map(({ byteLength, sha256 }) => (
				`${String(byteLength)}:${sha256}`
			)))].sort(),
		};
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, opfsDirectoryName: SOUNDSCAPER_OPFS_DIRECTORY_NAME });
}

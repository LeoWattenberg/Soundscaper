/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog } from './audio-editor-test-helpers.js';

for (const stage of ['write', 'close']) test(`Cancel export during native archive ${stage} removes its temporary clip ZIP`, async ({ page }) => {
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		globalThis.__ordinaryZipStorageAvailable = typeof globalThis.FileSystemFileHandle?.prototype.createWritable === 'function'
			&& typeof globalThis.FileSystemWritableFileStream?.prototype.write === 'function'
			&& typeof globalThis.FileSystemWritableFileStream?.prototype.close === 'function';
		if (!globalThis.__ordinaryZipStorageAvailable) return;
		const streams = new WeakSet();
		const createWritable = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = async function (...arguments_) {
			const stream = await Reflect.apply(createWritable, this, arguments_);
			if (this.name.endsWith('.zip')) streams.add(stream);
			return stream;
		};
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const observation = { stage: null, entered: false, release: () => release() };
		globalThis.__ordinaryZipStorage = observation;
		for (const stage of ['write', 'close']) {
			const operation = FileSystemWritableFileStream.prototype[stage];
			FileSystemWritableFileStream.prototype[stage] = async function (...arguments_) {
				const result = await Reflect.apply(operation, this, arguments_);
				if (streams.has(this) && observation.stage === stage && !observation.entered) {
					observation.entered = true;
					await gate;
				}
				return result;
			};
		}
	});
	const editor = await bootEditor(page, '/embed/en/');
	test.skip(!await page.evaluate(() => globalThis.__ordinaryZipStorageAvailable),
		'This browser does not provide native origin-storage writable streams.');
	await importFiles(editor, [monoTone]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Individual clips (split by clips)');
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await chooseDropdown(page, dialog.locator('[data-export-field="dither"]'), 'None');
	await expect(dialog.locator('[data-export-field="tails"]')).toHaveCount(0);
	await page.evaluate(stage => { globalThis.__ordinaryZipStorage.stage = stage; }, stage);
	try {
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__ordinaryZipStorage.entered)).toBe(true);
		const cancel = dialog.getByRole('button', { name: 'Cancel export', exact: true });
		await expect(cancel).toBeEnabled();
		await cancel.click();
		await page.evaluate(() => globalThis.__ordinaryZipStorage.release());
		await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
		await expect(dialog.locator('[data-export-download]')).toBeHidden();
		await expect.poll(() => temporaryZips(page)).toEqual([]);
	} finally {
		await page.evaluate(async () => {
			globalThis.__ordinaryZipStorage.release();
			const root = await navigator.storage.getDirectory();
			try {
				const directory = await root.getDirectoryHandle('audio-editor-exports');
				for await (const [name] of directory.entries()) if (name.endsWith('.zip')) await directory.removeEntry(name);
			} catch (error) { if (error.name !== 'NotFoundError') throw error; }
		});
	}
});

async function temporaryZips(page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		try {
			const directory = await root.getDirectoryHandle('audio-editor-exports');
			const files = [];
			for await (const [name, handle] of directory.entries()) if (name.endsWith('.zip')) files.push({ name, size: (await handle.getFile()).size });
			return files;
		} catch (error) { if (error.name === 'NotFoundError') return []; throw error; }
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('temporary export recovery', () => {
	registerAudioEditorHooks();

	test('reload removes an abandoned OPFS export', async ({ page }) => {
		const errors = collectClientErrors(page);
		await bootEditor(page, '/embed/en/');
		test.skip(!await page.evaluate(() => typeof navigator.storage?.getDirectory === 'function'),
			'This browser does not expose OPFS.');
		await page.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle('audio-editor-exports', { create: true });
			const file = await directory.getFileHandle('abandoned-export.wav', { create: true });
			const writable = await file.createWritable();
			await writable.write(Uint8Array.of(1, 2, 3, 4));
			await writable.close();
		});
		await page.reload();
		await waitForEditor(page);
		expect(errors).toEqual([]);
		await expect.poll(() => temporaryExportNames(page)).toEqual([]);
	});

	test('a second tab preserves a locked export until its owner closes', async ({ context, page }) => {
		const firstErrors = collectClientErrors(page);
		await bootEditor(page, '/embed/en/');
		test.skip(!await page.evaluate(() => typeof navigator.storage?.getDirectory === 'function'
			&& typeof navigator.locks?.request === 'function'), 'This browser does not expose OPFS and Web Locks.');

		const liveName = 'live-export.wav';
		const abandonedName = 'abandoned-export.wav';
		await page.evaluate(async ({ liveName, abandonedName }) => {
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle('audio-editor-exports', { create: true });
			for (const name of [liveName, abandonedName]) {
				const file = await directory.getFileHandle(name, { create: true });
				const writable = await file.createWritable();
				await writable.write(Uint8Array.of(1, 2, 3, 4));
				await writable.close();
			}
			await new Promise((resolve, reject) => {
				void navigator.locks.request(`audio-editor-export-file:${liveName}`, async () => {
					resolve();
					await new Promise(() => {});
				}).catch(reject);
			});
		}, { liveName, abandonedName });

		const secondPage = await context.newPage();
		const secondErrors = collectClientErrors(secondPage);
		await secondPage.goto(page.url());
		await waitForEditor(secondPage);
		await expect.poll(() => temporaryExportNames(secondPage)).toEqual([liveName]);

		await page.close();
		await secondPage.reload();
		await waitForEditor(secondPage);
		await expect.poll(() => temporaryExportNames(secondPage)).toEqual([]);
		expect(firstErrors).toEqual([]);
		expect(secondErrors).toEqual([]);
	});
});

async function temporaryExportNames(page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle('audio-editor-exports');
		const names = [];
		for await (const [name] of directory.entries()) names.push(name);
		return names.sort();
	});
}

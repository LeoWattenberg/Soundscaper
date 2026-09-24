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
		await expect.poll(() => page.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle('audio-editor-exports');
			const names = [];
			for await (const [name] of directory.entries()) names.push(name);
			return names;
		})).toEqual([]);
	});
});

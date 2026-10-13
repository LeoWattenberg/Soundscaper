/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { expect, audioTest as test } from './helpers/motionscaper-linked-fixture.js';
import { createMotionscaperOpaqueArchive } from '../helpers/motionscaper-opaque-archive.ts';
import { disableNativeSavePicker, seedWorkspaceOnboardingComplete, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const [family, version] of [['framescaper', 3], ['motionscaper', 1]] as const) {
	test(`successor File menu opens ${family}/${String(version)} read-only and exports an exact archive copy`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		await disableNativeSavePicker(page); await seedWorkspaceOnboardingComplete(page);
		await page.goto('/embed/en/'); const editor = await waitForEditor(page); await waitForProjectActivation(editor);
		const inventory = () => page.evaluate(async () => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('kw-media-framescaper-editor-v2'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
			try { const transaction = database.transaction(['owners', 'assets', 'chunks', 'portableArchives'], 'readonly');
				return await Promise.all(['owners', 'assets', 'chunks', 'portableArchives'].map(name => new Promise<unknown[]>((resolve, reject) => { const request = transaction.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result as unknown[]); request.onerror = () => reject(request.error); })));
			} finally { database.close(); }
		});
		await expect.poll(async () => (await inventory())[0]?.length).toBe(1); const before = await inventory();
		const original = Buffer.from(await (await createMotionscaperOpaqueArchive(family, version)).arrayBuffer());
		await page.getByRole('menuitem', { name: 'File', exact: true }).click();
		const open = page.getByRole('menuitem', { name: /^Open(?: Ctrl\+O)?$/u }); await expect(open).toBeEnabled();
		const selected = page.waitForEvent('filechooser'); await open.click();
		await (await selected).setFiles({ name: 'Opaque original.fscape', mimeType: 'application/zip', buffer: original });
		await expect(page.getByRole('tab', { name: /Opaque original/u })).toBeVisible();
		await page.getByRole('menuitem', { name: 'File', exact: true }).click();
		await expect(page.getByRole('menuitem', { name: /^Save project(?: —.*| Ctrl\+S)?$/u })).toBeDisabled();
		const downloaded = page.waitForEvent('download'); await page.getByRole('menuitem', { name: 'Export project file (.fscape)', exact: true }).click();
		const path = await (await downloaded).path(); expect(path).not.toBeNull(); expect(await readFile(path!)).toEqual(original);
		expect(await inventory()).toEqual(before); expect(errors).toEqual([]);
	});
}

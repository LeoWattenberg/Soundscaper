/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { createMotionscaperOpaqueArchive } from '../helpers/motionscaper-opaque-archive.ts';
import { ACCEPTED_PROJECT_FILE_EXTENSION_LIST } from '../../src/common/project-file-extensions.ts';

async function menu(page: Page, top: string, label: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: label, exact: true }).click();
}

async function projectInventory(page: Page): Promise<Record<string, unknown[]>> {
	return page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('kw-media-motionscaper-editor-v1');
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try {
			const names = Array.from(database.objectStoreNames).filter(name => name !== 'writeLeases');
			const transaction = database.transaction(names, 'readonly');
			return Object.fromEntries(await Promise.all(names.map(async name => {
				const records = await new Promise<unknown[]>((resolve, reject) => {
					const request = transaction.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result as unknown[]); request.onerror = () => reject(request.error);
				});
				return [name, records] as const;
			})));
		} finally { database.close(); }
	});
}

for (const [family, version, extension] of [['motionscaper', 2, '.scape'], ['framescaper', 2, '.fscape'], ['soundscaper', 1, '.liscape']] as const) {
	test(`M02 File menu retains ${family}/${String(version)} from ${extension} read-only, copies exact bytes and restores authored history`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
		await page.getByRole('dialog').getByLabel('Project title', { exact: true }).fill('Retained composition');
		await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
		await menu(page, 'View', 'Composition Settings');
		await page.getByRole('dialog').getByLabel('Project title', { exact: true }).fill('Retained unsaved edit');
		await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(page.locator('[data-motion-save-status]')).toContainText('Unsaved'); const before = await projectInventory(page);
		const rows = before.projects; expect(rows).toHaveLength(1);
		const projectId = (rows?.[0] as { id: string }).id;
		const original = Buffer.from(await (await createMotionscaperOpaqueArchive(family, version, projectId)).arrayBuffer());
		await menu(page, 'File', 'Open');
		const input = page.getByLabel('Scape project (.mscape, .fscape, .sscape)', { exact: true });
		await expect(input).toHaveAttribute('accept', `${ACCEPTED_PROJECT_FILE_EXTENSION_LIST},.aep,.aepx`);
		await input.setInputFiles({ name: `Opaque original${extension}`, mimeType: 'application/zip', buffer: original });
		const dialog = page.getByRole('dialog', { name: 'Read-only archive', exact: true }); await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(`${family} / ${String(version)}`);
		await expect(page.locator('[data-motion-project-title]')).toHaveText('Retained unsaved edit');
		const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Save Copy', exact: true }).click();
		const path = await (await download).path(); expect(path).not.toBeNull(); expect(await readFile(path!)).toEqual(original);
		await expect(dialog.getByRole('status')).toContainText('Original archive copied unchanged'); expect(await projectInventory(page)).toEqual(before);
		await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
		await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
		await menu(page, 'Edit', 'Undo'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Retained composition');
		await menu(page, 'Edit', 'Redo'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Retained unsaved edit'); expect(errors).toEqual([]);
	});
}

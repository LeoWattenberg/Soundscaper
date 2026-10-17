/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';

async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}

test('Motionscaper authors shapes and portable text only through menus with recoverable undo', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/');
	await menu(page, 'File', 'New Composition');
	await page.getByLabel('Project title', { exact: true }).fill('Portable title card');
	await page.getByLabel('Width', { exact: true }).fill('320');
	await page.getByLabel('Height', { exact: true }).fill('180');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'New Rectangle', exact: true })).toHaveCount(0);
	await menu(page, 'Layer', 'New Rectangle');
	const layer = page.getByRole('dialog', { name: 'New Rectangle', exact: true });
	await expect(layer.getByLabel('Layer name', { exact: true })).toBeFocused();
	await layer.getByLabel('Layer name', { exact: true }).fill('Background card');
	await layer.getByLabel('Fill color', { exact: true }).fill('#808080');
	await layer.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
	await menu(page, 'Edit', 'Undo');
	await expect(page.locator('[data-motion-workspace] dd').last()).toHaveText('0');
	await menu(page, 'Edit', 'Redo');
	await expect(page.locator('[data-motion-workspace] dd').last()).toHaveText('1');
	await menu(page, 'Layer', 'New Text');
	await page.getByRole('dialog').getByLabel('Text', { exact: true }).fill('Hello motion');
	await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });
	await expect(page.locator('[data-motion-workspace] dd').last()).toHaveText('2');
	const pending = page.waitForEvent('download');
	await menu(page, 'File', 'Save Copy');
	const download = await pending; const path = await download.path();
	if (!path) throw new Error('Archive download did not complete.');
	const assetChunks: Uint8Array[] = [];
	const imported = await importMotionscaperArchive(new Blob([await readFile(path)]), () => ({
		writeAssetChunk: (_asset, bytes) => { assetChunks.push(bytes); return Promise.resolve(); }, finishAsset: () => Promise.resolve(),
		commit: () => Promise.resolve(), rollback: () => Promise.resolve(),
	}));
	expect(imported.kind).toBe('current');
	if (imported.kind !== 'current') throw new Error('Current archive expected.');
	expect(imported.project.compositions[0]?.layers.map(({ kind }) => kind)).toEqual(['text', 'shapes']);
	expect(imported.project.assets[0]?.kind).toBe('font');
	expect(assetChunks.reduce((sum, bytes) => sum + bytes.byteLength, 0)).toBe(imported.project.assets[0]?.byteLength);
	await menu(page, 'File', 'Save');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload();
	await menu(page, 'File', 'Project Library');
	await page.getByRole('button', { name: 'Portable title card', exact: true }).click();
	await expect(page.locator('[data-motion-workspace] dd').last()).toHaveText('2');
});

test('German layer dialogs remain keyboard dismissible and return focus to their menu', async ({ page }: { page: Page }) => {
	await page.goto('/embed/de/');
	await menu(page, 'Datei', 'Neue Komposition');
	await page.getByRole('button', { name: 'Erstellen', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Ebene', 'Neuer Stern');
	await expect(page.getByLabel('Ebenenname', { exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('menuitem', { name: 'Ebene', exact: true })).toBeFocused();
});

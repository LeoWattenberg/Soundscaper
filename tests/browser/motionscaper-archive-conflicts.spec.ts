/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import type { Page } from '@playwright/test';
import { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';
const original = createMotionscaperProject({ id: 'menu-archive-collision', compositionId: 'composition', title: 'Original local project', width: 64, height: 32, durationFrames: 4 });
const body = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
const digest = digestScapeBytes(body), asset = { kind: 'image' as const, id: 'original-unused', name: 'Unused original.png', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, byteLength: body.length, sha256: digest, storageKey: `motion-sha256:${digest}` };
async function menu(page: Page, top: string, action: string) { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: action, exact: true }).click(); }
async function input(title: string) {
	const blob = await exportMotionscaperArchive({ ...original, title, assets: [asset] }, () => new Blob([body])); if (!blob) throw new Error('Missing test archive.');
	return { name: 'selected.mscape', mimeType: 'application/octet-stream', buffer: Buffer.from(await blob.arrayBuffer()) };
}
async function open(page: Page, title: string) { await menu(page, 'File', 'Open'); await page.locator('input[type=file]').setInputFiles(await input(title)); }
async function savedCopy(page: Page) {
	const downloading = page.waitForEvent('download'); await menu(page, 'File', 'Save Copy'); const download = await downloading, path = await download.path(); if (!path) throw new Error('Download missing.');
	const chunks: Uint8Array[] = []; const result = await importMotionscaperArchive(new Blob([await readFile(path)]), () => ({ writeAssetChunk: async (_asset, bytes) => { chunks.push(bytes.slice()); }, async finishAsset() {}, async commit() {}, async rollback() {} }));
	expect(result.kind).toBe('current'); expect(Buffer.concat(chunks)).toEqual(Buffer.from(body)); if (result.kind !== 'current') throw new Error('Unexpected family.'); return result.project;
}
test('M02 File Open reviews Cancel, draft Replace, Undo, Save and independent Copy without losing original closure', async ({ page }) => {
	await page.goto('/embed/en/'); await open(page, original.title); await expect(page.locator('[data-motion-project-title]')).toHaveText(original.title);
	await menu(page, 'View', 'Composition Settings'); await page.getByLabel('Project title', { exact: true }).fill('Local unsaved draft'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await open(page, 'Incoming scene'); const review = page.getByRole('dialog', { name: 'Open Project Conflict', exact: true }); await expect(review).toBeVisible();
	await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect(review).toBeHidden();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Local unsaved draft'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
	await open(page, 'Incoming scene'); await review.getByRole('button', { name: 'Replace Local Draft', exact: true }).click(); await expect(review).toBeHidden();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Incoming scene'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
	await menu(page, 'Edit', 'Undo'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Local unsaved draft');
	await menu(page, 'Edit', 'Redo'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Incoming scene');
	const replaced = await savedCopy(page); expect(replaced.id).toBe(original.id); expect(replaced.revision).toBeGreaterThan(original.revision);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Incoming scene', exact: true }).click();
	await open(page, original.title); await review.getByRole('button', { name: 'Import Independent Copy', exact: true }).click(); await expect(review).toBeHidden();
	const copied = await savedCopy(page); expect(copied.id).not.toBe(original.id); expect(copied.assets).toEqual([asset]);
	await menu(page, 'File', 'Project Library'); await expect(page.getByRole('button', { name: 'Incoming scene', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: original.title, exact: true })).toBeVisible();
});

test('M02 German conflict review keeps an active draft and restores menu focus', async ({ page }) => {
	await page.goto('/embed/de/'); await menu(page, 'Datei', 'Öffnen'); await page.locator('input[type=file]').setInputFiles(await input(original.title));
	await expect(page.locator('[data-motion-project-title]')).toHaveText(original.title);
	await menu(page, 'Datei', 'Öffnen'); await page.locator('input[type=file]').setInputFiles(await input('Incoming'));
	const review = page.getByRole('dialog', { name: 'Projektkonflikt beim Öffnen', exact: true }); await expect(review).toBeVisible();
	await review.getByRole('button', { name: 'Aktuelles Dokument behalten', exact: true }).click(); await expect(review).toBeHidden();
	await expect(page.locator('[data-motion-project-title]')).toHaveText(original.title); await expect(page.getByRole('menuitem', { name: 'Datei', exact: true })).toBeFocused();
});

test('M02 inactive collisions require an explicit saved-versus-recovery choice', async ({ page }) => {
	await page.goto('/embed/en/'); await open(page, original.title); await expect(page.locator('[data-motion-project-title]')).toHaveText(original.title);
	await menu(page, 'View', 'Composition Settings'); await page.getByLabel('Project title', { exact: true }).fill('Retained recovery draft'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes'); await page.reload();
	await open(page, 'Different selected scene'); let review = page.getByRole('dialog', { name: 'Open Project Conflict', exact: true });
	await expect(review).toContainText('Retained recovery draft'); await review.getByRole('button', { name: 'Open Local Saved Revision', exact: true }).click();
	await expect(page.locator('[data-motion-project-title]')).toHaveText(original.title); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload(); await open(page, 'Different selected scene'); review = page.getByRole('dialog', { name: 'Open Project Conflict', exact: true });
	await review.getByRole('button', { name: 'Recover Local Draft', exact: true }).click();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Retained recovery draft'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
});

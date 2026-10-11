/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';

async function menu(page, top, command) {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}

test('Motionscaper creates, edits, saves and reopens a composition through its menus', async ({ page }) => {
	await page.goto('/embed/en/');
	await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
	await menu(page, 'File', 'New Composition');
	const dialog = page.getByRole('dialog', { name: 'New Composition', exact: true });
	await expect(dialog.getByLabel('Project title', { exact: true })).toBeFocused();
	await dialog.getByLabel('Project title', { exact: true }).fill('Lower third');
	await dialog.getByLabel('Width', { exact: true }).fill('1280');
	await dialog.getByLabel('Height', { exact: true }).fill('720');
	await dialog.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('[data-motion-workspace]')).toContainText('Lower third');
	await expect(page.locator('[data-motion-workspace]')).toContainText('1280 × 720');
	await menu(page, 'View', 'Composition Settings');
	const settings = page.getByRole('dialog', { name: 'Composition Settings', exact: true });
	await settings.getByLabel('Project title', { exact: true }).fill('Lower third edited');
	await settings.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(page.locator('[data-motion-workspace]')).toContainText('Unsaved changes');
	await menu(page, 'Edit', 'Undo');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Lower third');
	await menu(page, 'Edit', 'Redo');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Lower third edited');
	await menu(page, 'File', 'Save');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload();
	await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
	await expect(page.locator('[data-motion-workspace]')).toHaveCount(0);
	await menu(page, 'File', 'Project Library');
	await page.getByRole('dialog', { name: 'Project Library', exact: true }).getByRole('button', { name: 'Lower third edited', exact: true }).click();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Lower third edited');
	await expect(page.locator('[data-motion-workspace]')).toContainText('1280 × 720');
	await menu(page, 'View', 'Composition Settings');
	await page.getByRole('dialog').getByLabel('Project title', { exact: true }).fill('Recovered lower third');
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
	await page.reload();
	await menu(page, 'File', 'Project Library');
	await page.getByRole('button', { name: 'Recover unsaved changes', exact: true }).click();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Recovered lower third');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
});

test('Motionscaper imports and saves a portable .mscape copy without changing its composition', async ({ page }) => {
	const project = createMotionscaperProject({ id: 'portable-project', compositionId: 'portable-comp', title: 'Portable animation',
		width: 960, height: 540, frameRate: { num: 24000, den: 1001 }, durationFrames: 144 });
	const archive = await exportMotionscaperArchive(project, () => null);
	await page.goto('/embed/en/');
	await menu(page, 'File', 'Open');
	await page.getByLabel('Scape project (.mscape, .fscape, .sscape)', { exact: true }).setInputFiles({
		name: 'portable.mscape', mimeType: 'application/octet-stream', buffer: Buffer.from(await archive.arrayBuffer()),
	});
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Portable animation');
	const downloadPromise = page.waitForEvent('download');
	await menu(page, 'File', 'Save Copy');
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('Portable animation.mscape');
	const bytes = await readFile(await download.path());
	const copy = await importMotionscaperArchive(new Blob([bytes]), () => ({
		writeAssetChunk: () => undefined, finishAsset: () => undefined,
		commit: () => undefined, rollback: () => undefined,
	}));
	expect(copy.kind).toBe('current');
	expect(copy.project).toEqual(project);
	await menu(page, 'File', 'Open');
	await page.getByLabel('Scape project (.mscape, .fscape, .sscape)', { exact: true }).setInputFiles({
		name: 'again.mscape', mimeType: 'application/octet-stream', buffer: bytes,
	});
	await expect(page.getByRole('alert')).toContainText('already exists');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Portable animation');
});

test('Motionscaper restores menu focus when a German composition dialog is cancelled', async ({ page }) => {
	await page.goto('/embed/de/');
	await menu(page, 'Datei', 'Neue Komposition');
	const dialog = page.getByRole('dialog', { name: 'Neue Komposition', exact: true });
	await expect(dialog.getByLabel('Projekttitel', { exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('menuitem', { name: 'Datei', exact: true })).toBeFocused();
	await expect(page.locator('[data-motion-workspace]')).toHaveCount(0);
});

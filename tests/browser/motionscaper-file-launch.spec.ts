/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { createMotionscaperOpaqueArchive } from '../helpers/motionscaper-opaque-archive.ts';

async function menu(page: Page, top: string, label: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: label, exact: true }).click();
}

async function installQueue(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'launchQueue', { configurable: true, value: { setConsumer(consumer: (params: { files: unknown[] }) => void) {
			Object.defineProperty(globalThis, '__motionTestLaunch', { configurable: true, value: (files: File[]) => consumer({ files: files.map(file => ({ kind: 'file', getFile: () => Promise.resolve(file) })) }) });
		} } });
	});
}

async function launch(page: Page, blobs: readonly { blob: Blob; name: string }[]): Promise<void> {
	await expect.poll(() => page.evaluate(() => typeof Reflect.get(globalThis, '__motionTestLaunch'))).toBe('function');
	const files = await Promise.all(blobs.map(async ({ blob, name }) => ({ name, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) })));
	await page.evaluate(input => {
		const launch = Reflect.get(globalThis, '__motionTestLaunch') as (files: File[]) => void;
		launch(input.map(({ name, bytes }) => new File([new Uint8Array(bytes)], name, { type: 'application/zip' })));
	}, files);
}

async function currentArchive(id: string, title: string): Promise<Blob> {
	const blob = await exportMotionscaperArchive(createMotionscaperProject({ id, compositionId: `${id}-comp`, title,
		width: 32, height: 32, frameRate: { num: 30, den: 1 }, durationFrames: 30 }), () => null);
	if (!blob) throw new Error('The launch fixture archive was not assembled.'); return blob;
}

test('M01 browser launch queue opens authored and opaque Scape files through the document runtime', async ({ page }) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await installQueue(page); await page.goto('/embed/en/');
	await launch(page, [{ blob: await currentArchive('launched-project', 'Launched composition'), name: 'launched.mscape' }]);
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Launched composition');
	await launch(page, [{ blob: await createMotionscaperOpaqueArchive('motionscaper', 2), name: 'future.mscape' }]);
	const dialog = page.getByRole('dialog', { name: 'Read-only archive', exact: true }); await expect(dialog).toBeVisible();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Launched composition'); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); expect(errors).toEqual([]);
});

test('M01 file launch preserves an active authoring dialog and refuses multi-file launches', async ({ page }) => {
	await installQueue(page); await page.goto('/embed/en/');
	await launch(page, [{ blob: await currentArchive('retained-project', 'Retained composition'), name: 'retained.mscape' }]);
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Retained composition');
	await menu(page, 'View', 'Composition Settings'); const dialog = page.getByRole('dialog', { name: 'Composition Settings', exact: true });
	await dialog.getByLabel('Project title', { exact: true }).fill('In-progress authoring');
	const second = { blob: await currentArchive('second-project', 'Second composition'), name: 'second.mscape' };
	await launch(page, [second]); await expect(page.getByRole('alert')).toContainText('Close the current dialog'); await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel('Project title', { exact: true })).toHaveValue('In-progress authoring');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('[data-motion-project-title]')).toHaveText('In-progress authoring');
	await launch(page, [second, second]); await expect(page.getByRole('alert')).toContainText('choose one Scape project');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('In-progress authoring');
});

test('M01 installed shortcuts open the localized menu workflow and consume only the launch query', async ({ page }) => {
	await page.goto('/embed/de/?other=keep&launch=new-project#retained');
	await expect(page.getByRole('dialog', { name: 'Neue Komposition', exact: true })).toBeVisible();
	expect(new URL(page.url()).searchParams.get('other')).toBe('keep'); expect(new URL(page.url()).searchParams.has('launch')).toBe(false); expect(new URL(page.url()).hash).toBe('#retained');
	await page.keyboard.press('Escape'); await page.goto('/embed/en/?launch=open-project');
	await expect(page.getByRole('dialog', { name: 'Open', exact: true })).toBeVisible();
	await expect(page.getByLabel('Scape project (.mscape, .fscape, .sscape)', { exact: true })).toBeVisible(); expect(new URL(page.url()).searchParams.has('launch')).toBe(false);
});

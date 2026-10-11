/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { createMotionscaperOpaqueArchive } from '../helpers/motionscaper-opaque-archive.ts';
async function bytes(id: string, title: string) {
	const blob = await exportMotionscaperArchive(createMotionscaperProject({ id, title, compositionId: 'comp', width: 32, height: 32, durationFrames: 2 }), () => null);
	if (!blob) throw new Error('Archive missing.'); return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
interface LaunchFile { readonly token: string; readonly name: string; readonly bytes: readonly number[]; readonly failRelease?: boolean }
async function install(page: Page, cold: LaunchFile) {
	await page.addInitScript(initial => {
		const queue = [initial], held = new Map<string, typeof initial>(); const acks: string[] = [], binds: string[] = []; let takes = 0; let listener = () => undefined as void;
		const failures = new Set<string>(); let manual: typeof initial | null = null;
		Object.defineProperty(globalThis, '__motionSelect', { value: (file: typeof initial) => { manual = file; } });
		Object.defineProperty(globalThis, '__motionLaunch', { value: (file: typeof initial) => { queue.push(file); listener(); } });
		Object.defineProperty(globalThis, '__motionLaunchState', { value: () => ({ acks: [...acks], binds: [...binds], takes }) });
		Object.defineProperty(globalThis, 'scapeDesktop', { value: { v1: { getEnvironment: async () => ({ locale: 'en' }), motionFiles: {
			selectOpen: async () => { const file = manual; manual = null; if (!file) return null; held.set(file.token, file); return { token: file.token, name: file.name, byteLength: file.bytes.length }; }, read: async ({ token, offset, length }: { token: string; offset: number; length: number }) => {
				const file = held.get(token); if (!file) throw new Error('Read after release.'); return new Uint8Array(file.bytes.slice(offset, offset + length));
			}, release: async ({ token }: { token: string }) => { const file = held.get(token); if (file?.failRelease && !failures.has(token)) { failures.add(token); throw new Error('Release is temporarily unavailable.'); } held.delete(token); },
			bindOpened: async ({ projectId }: { projectId: string }) => { binds.push(projectId); }, beginSave: async () => null, write: async () => undefined, commit: async () => { throw new Error('Not a save.'); }, cancel: async () => undefined,
		}, motionLaunch: {
			take: async () => { takes++; const file = queue.shift(); if (!file) return null; held.set(file.token, file); return { token: file.token, name: file.name, byteLength: file.bytes.length }; },
			acknowledge: async ({ token }: { token: string }) => { if (held.has(token)) throw new Error('Acknowledged before release.'); acks.push(token); },
			onPending: (callback: () => void) => { listener = callback; return () => { listener = () => undefined; }; },
		} } } });
	}, cold);
}
async function launch(page: Page, file: LaunchFile) { await page.evaluate(value => { (Reflect.get(globalThis, '__motionLaunch') as (value: LaunchFile) => void)(value); }, file); }
async function state(page: Page) { return page.evaluate(() => (Reflect.get(globalThis, '__motionLaunchState') as () => { acks: string[]; binds: string[]; takes: number })()); }
async function menu(page: Page, top: string, item: string) { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); }

test('M01 native cold launch wakes the lazy editor and warm files wait through authoring, collision review and opaque custody', async ({ page }) => {
	await install(page, { token: 'cold', name: 'cold.mscape', bytes: await bytes('native-original', 'Cold original') }); await page.goto('/embed/en/');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Cold original'); await expect.poll(async () => (await state(page)).acks).toEqual(['cold']);
	await menu(page, 'View', 'Composition Settings'); const settings = page.getByRole('dialog', { name: 'Composition Settings', exact: true });
	await settings.getByLabel('Project title', { exact: true }).fill('Protected authored draft');
	await launch(page, { token: 'warm', name: 'warm.mscape', bytes: await bytes('native-original', 'Warm incoming') }); await expect(settings).toBeVisible();
	await settings.getByRole('button', { name: 'Apply', exact: true }).click(); const review = page.getByRole('dialog', { name: 'Open Project Conflict', exact: true }); await expect(review).toBeVisible();
	const future = await createMotionscaperOpaqueArchive('motionscaper', 2);
	await launch(page, { token: 'future', name: 'future.mscape', bytes: Array.from(new Uint8Array(await future.arrayBuffer())) });
	await launch(page, { token: 'last', name: 'last.mscape', bytes: await bytes('native-last', 'Last launched project') });
	expect((await state(page)).acks).toEqual(['cold']); await review.getByRole('button', { name: 'Import Independent Copy', exact: true }).click();
	const opaque = page.getByRole('dialog', { name: 'Read-only archive', exact: true }); await expect(opaque).toBeVisible();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Warm incoming'); expect((await state(page)).acks).toEqual(['cold', 'warm']);
	await page.keyboard.press('Escape'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Last launched project');
	await expect.poll(async () => (await state(page)).acks).toEqual(['cold', 'warm', 'future', 'last']); expect((await state(page)).binds).toEqual(['native-original', 'native-last']);
});

test('M01 native cold launch retains an accepted project while file release is retried before the next queued file', async ({ page }) => {
	await install(page, { token: 'retry', name: 'retry.mscape', failRelease: true, bytes: await bytes('native-retry', 'Accepted once') }); await page.goto('/embed/en/');
	const review = page.getByRole('dialog', { name: 'Open', exact: true }); await expect(review).toBeVisible(); await expect(review).toContainText('already open');
	await launch(page, { token: 'next', name: 'next.mscape', bytes: await bytes('native-next', 'Next project') }); expect((await state(page)).acks).toEqual([]);
	await review.getByRole('button', { name: 'Retry Completion', exact: true }).click(); await expect(page.locator('[data-motion-project-title]')).toHaveText('Next project');
	expect((await state(page)).binds).toEqual(['native-retry', 'native-next']); await expect.poll(async () => (await state(page)).acks).toEqual(['retry', 'next']);
});

test('M01 invalid native launch retains failed cleanup and advances only after an explicit retry', async ({ page }) => {
	await install(page, { token: 'invalid', name: 'invalid.mscape', failRelease: true, bytes: [1, 2, 3] }); await page.goto('/embed/en/');
	const dialog = page.getByRole('dialog', { name: 'Open', exact: true }); await expect(dialog).toContainText('selected native file is still retained');
	await launch(page, { token: 'valid', name: 'valid.mscape', bytes: await bytes('valid-after-failure', 'Opened after cleanup') }); expect((await state(page)).acks).toEqual([]);
	await dialog.getByRole('button', { name: 'Retry Completion', exact: true }).click(); await expect(page.locator('[data-motion-project-title]')).toHaveText('Opened after cleanup');
	await expect.poll(async () => (await state(page)).acks).toEqual(['invalid', 'valid']); expect((await state(page)).binds).toEqual(['valid-after-failure']);
});


test('M02 native File Open Copy retains the selected capability for cleanup retry without binding the original', async ({ page }) => {
	await install(page, { token: 'original', name: 'original.mscape', bytes: await bytes('native-original', 'Original project') }); await page.goto('/embed/en/');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Original project');
	await page.evaluate(file => { (Reflect.get(globalThis, '__motionSelect') as (value: LaunchFile) => void)(file); }, { token: 'manual', name: 'selected.mscape', failRelease: true, bytes: await bytes('native-original', 'Independent native copy') });
	await menu(page, 'File', 'Open'); const review = page.getByRole('dialog', { name: 'Open Project Conflict', exact: true });
	await review.getByRole('button', { name: 'Import Independent Copy', exact: true }).click(); await expect(review).toContainText('already open');
	await review.getByRole('button', { name: 'Retry Completion', exact: true }).click(); await expect(review).toBeHidden();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Independent native copy'); expect((await state(page)).binds).toEqual(['native-original']);
	await menu(page, 'File', 'Project Library'); await expect(page.getByRole('button', { name: 'Original project', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Independent native copy', exact: true })).toBeVisible();
});

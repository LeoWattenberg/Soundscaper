/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
async function menu(page: Page, top: string, item: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); }
async function close(page: Page): Promise<void> { await page.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
test('native selected-file controls keep the controller connection after dialog close and disconnect explicitly', async ({ page }) => {
	const project = createMotionscaperProject({ id: 'native-selected', title: 'Native first', compositionId: 'main', width: 2, height: 2, durationFrames: 2 });
	const versions = await Promise.all([project, { ...project, revision: 1, title: 'Native saved update' }, { ...project, id: 'other-document', revision: 2, title: 'Different document' }].map(async value => {
		const blob = await exportMotionscaperArchive(value, () => null); if (!blob) throw new Error('Native fixture archive is absent.'); return [...new Uint8Array(await blob.arrayBuffer())];
	}));
	await page.addInitScript(({ versions }) => {
		let generation = 1, cancelled = 0; const tokens = new Map<string, Uint8Array>();
		const files = {
			select: async () => ({ watchId: 'selected-watch', name: 'Chosen.mscape' }),
			poll: async ({ afterGeneration }: { afterGeneration: number }) => { if (afterGeneration === generation) return { state: 'unchanged', generation }; const token = `pinned-${generation}`, bytes = new Uint8Array(versions[generation - 1]!); tokens.set(token, bytes); return { state: 'snapshot', snapshot: { token, name: 'Chosen.mscape', generation, byteLength: bytes.length } }; },
			read: async ({ token, offset, length }: { token: string; offset: number; length: number }) => tokens.get(token)!.slice(offset, offset + length),
			release: async ({ token }: { token: string }) => { tokens.delete(token); }, cancel: async () => { cancelled++; },
		};
		Object.defineProperty(globalThis, 'framescaperSuccessorDesktop', { value: { v1: { motionSavedFiles: files } } });
		Object.defineProperty(globalThis, 'nativeMotionFixture', { value: { update: () => { generation++; }, cancelled: () => cancelled } });
	}, { versions });
	await page.goto('/embed/en/'); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible(); await menu(page, 'File', 'Linked compositions…');
	const dialog = page.getByRole('dialog', { name: 'Linked Motionscaper compositions' });
	await expect(dialog.getByRole('button', { name: 'Create pairing URL', exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Choose saved .mscape file', exact: true }).click(); await expect(dialog.getByText('Native first', { exact: true })).toBeVisible();
	await close(page); await page.evaluate(() => (globalThis as unknown as { nativeMotionFixture: { update(): void } }).nativeMotionFixture.update());
	await menu(page, 'File', 'Linked compositions…'); await expect(dialog.getByText('Native saved update', { exact: true })).toBeVisible();
	await page.evaluate(() => (globalThis as unknown as { nativeMotionFixture: { update(): void } }).nativeMotionFixture.update());
	await dialog.getByRole('button', { name: 'Refresh saved revision', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('different project or composition');
	await expect(dialog.locator('code')).toHaveCount(1); await expect(dialog.getByText('Native saved update', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click(); await expect(dialog.getByRole('status')).toHaveText('Disconnected');
	expect(await page.evaluate(() => (globalThis as unknown as { nativeMotionFixture: { cancelled(): number } }).nativeMotionFixture.cancelled())).toBe(1);
});

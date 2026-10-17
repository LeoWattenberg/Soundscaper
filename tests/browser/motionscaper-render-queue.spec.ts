/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function create(page: Page, title: string, duration: number): Promise<void> {
	await menu(page, 'File', 'New Composition'); await page.getByLabel('Project title', { exact: true }).fill(title);
	await page.getByLabel('Width', { exact: true }).fill('32'); await page.getByLabel('Height', { exact: true }).fill('32'); await page.getByLabel('Duration in frames', { exact: true }).fill(String(duration));
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
function metadata(bytes: Uint8Array): { identity: { projectId: string; revisionDigest: string }; frameCount: number } {
	const decode = new TextDecoder();
	for (let offset = 0; offset + 512 <= bytes.length && bytes[offset];) {
		const name = decode.decode(bytes.subarray(offset, offset + 100)).split('\0')[0]; const size = Number.parseInt(decode.decode(bytes.subarray(offset + 124, offset + 136)), 8);
		if (name === 'sequence.json') return JSON.parse(decode.decode(bytes.subarray(offset + 512, offset + 512 + size))) as ReturnType<typeof metadata>;
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	throw new Error('Sequence metadata is missing.');
}
test('queue keeps pinned jobs across dialog close and project switches, then downloads and releases results', async ({ page }) => {
	test.setTimeout(60_000);
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	const downloads: Download[] = []; page.on('download', download => { downloads.push(download); });
	await page.goto('/embed/en/'); await create(page, 'First pinned scene', 300);
	await menu(page, 'File', 'Render'); let render = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await render.getByRole('button', { name: 'Render', exact: true }).click(); await expect(render.getByRole('progressbar')).toBeVisible();
	await render.getByRole('button', { name: 'Close', exact: true }).last().click();
	await create(page, 'Second pinned scene', 2);
	await menu(page, 'File', 'Render'); render = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await render.getByRole('button', { name: 'Render', exact: true }).click(); await render.getByRole('button', { name: 'Close', exact: true }).last().click();
	await menu(page, 'File', 'Render Queue'); const queue = page.getByRole('dialog', { name: 'Render Queue', exact: true });
	await expect(queue.locator('[data-motion-render-job]')).toHaveCount(2); await expect(queue.getByRole('status')).toHaveText(['Completed', 'Completed'], { timeout: 30_000 });
	await expect.poll(() => downloads.length).toBe(2); expect(downloads.map(download => download.suggestedFilename())).toEqual(['First pinned scene.tar', 'Second pinned scene.tar']);
	const records = await Promise.all(downloads.map(async download => { const path = await download.path(); if (!path) throw new Error('Missing output.'); return metadata(await readFile(path)); }));
	expect(records.map(record => record.frameCount)).toEqual([300, 2]); expect(records[0]!.identity.projectId).not.toBe(records[1]!.identity.projectId);
	const first = queue.locator('[data-motion-render-job]').first(); await first.getByText('Submitted revision', { exact: true }).click();
	await expect(first.locator('code')).toHaveText(records[0]!.identity.revisionDigest);
	const again = page.waitForEvent('download'); await first.getByRole('button', { name: 'Download Again', exact: true }).click(); expect((await again).suggestedFilename()).toBe('First pinned scene.tar');
	await first.getByRole('button', { name: 'Remove Job', exact: true }).click(); await expect(queue.locator('[data-motion-render-job]')).toHaveCount(1);
});

test('render queue is localized and menu-only before any composition exists', async ({ page }) => {
	await page.goto('/embed/de/'); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Datei', 'Render-Warteschlange'); const dialog = page.getByRole('dialog', { name: 'Render-Warteschlange', exact: true });
	await expect(dialog).toContainText('Keine Render-Aufträge.'); await dialog.getByRole('button', { name: 'Schließen', exact: true }).last().click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('queued render cancellation publishes no partial output and retries the same submitted revision', async ({ page }) => {
	test.setTimeout(60_000);
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	const downloads: Download[] = []; page.on('download', download => { downloads.push(download); });
	await page.goto('/embed/en/'); await create(page, 'Cancelled original', 1000); await menu(page, 'File', 'Render');
	const render = page.getByRole('dialog', { name: 'Render Composition', exact: true }); await render.getByRole('button', { name: 'Render', exact: true }).click();
	await expect(render.getByRole('progressbar')).toBeVisible(); await render.getByRole('button', { name: 'Close', exact: true }).last().click();
	await menu(page, 'File', 'Render Queue'); const queue = page.getByRole('dialog', { name: 'Render Queue', exact: true });
	const job = queue.locator('[data-motion-render-job]'); await job.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(job.getByRole('status')).toHaveText('Cancelled'); expect(downloads).toHaveLength(0);
	await job.getByText('Submitted revision', { exact: true }).click(); const digest = await job.locator('code').textContent();
	await job.getByRole('button', { name: 'Retry Original Revision', exact: true }).click();
	await expect(job.getByRole('status')).toHaveText('Completed', { timeout: 30_000 }); await expect.poll(() => downloads.length).toBe(1);
	await expect(job).toContainText('Attempt 2'); await expect(job.locator('code')).toHaveText(digest!);
	const path = await downloads[0]!.path(); if (!path) throw new Error('Retried output is missing.'); const record = metadata(await readFile(path));
	expect(record.frameCount).toBe(1000); expect(record.identity.revisionDigest).toBe(digest);
});

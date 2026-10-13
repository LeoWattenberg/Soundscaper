/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test, withBrowserCoverageContext, inspectLinkedOfflineReadiness } from './helpers/motionscaper-linked-fixture.js';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { observeLinkedVideoPixels, verifyLinkedVideoPixels } from './helpers/motion-linked-video-pixels.js';
const motionOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_LINK_MOTION_PORT || 4346}`;
const frameOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_LINK_FRAME_PORT || 4345}`;
test.use({ serviceWorkers: 'allow' });
async function menu(page: Page, top: string, item: string | RegExp): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: item, exact: typeof item === 'string' }).click();
}
async function close(page: Page): Promise<void> { await page.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
async function solid(page: Page, color: string): Promise<void> {
	await menu(page, 'Layer', 'New Solid'); await page.locator('input[type=color]').fill(color);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function save(page: Page): Promise<void> { await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); }
async function previewColor(page: Page): Promise<number[]> {
	await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-visual-error', '');
	const png = await page.locator('[data-video-preview-canvas]').screenshot();
	return page.evaluate(async bytes => {
		const image = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), value => value.charCodeAt(0))], { type: 'image/png' }));
		try { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); return [...context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data]; }
		finally { image.close(); }
	}, png.toString('base64'));
}
async function exportVideoColor(page: Page): Promise<number[]> {
	await menu(page, 'File', /^Export video(?:\s|$)/u); const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
	await dialog.getByRole('group', { name: 'Format', exact: true }).getByRole('button').click(); await page.getByRole('option', { name: 'MP4 video', exact: true }).click();
	const size = dialog.locator('[data-export-field="canvasSize"] input'); await size.nth(0).fill('96'); await size.nth(1).fill('64');
	await dialog.locator('[data-export-field="canvasFrameRate"] input').fill('2'); await dialog.locator('[data-export-action="start"] button').click();
	const link = dialog.locator('[data-export-download]');
	try { await expect(link).toHaveAttribute('download', /\.mp4$/u, { timeout: 15_000 }); }
	catch (cause) { throw new Error(`Linked export failed: ${await dialog.innerText()} / ${await page.locator('[data-editor-status]').innerText()} / dialogs ${JSON.stringify(await page.getByRole('dialog').allTextContents())}`, { cause }); }
	const downloading = page.waitForEvent('download'); await link.click(); const file = await downloading; const path = await file.path(); if (!path) throw new Error('Linked video download is absent.');
	const bytes = await readFile(path); expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
	const outputPath = test.info().outputPath('linked-export.mp4'); await writeFile(outputPath, bytes); await test.info().attach('linked-export', { path: outputPath, contentType: 'video/mp4' });
	const observation = await observeLinkedVideoPixels(page, bytes);
	await test.info().attach('linked-video-native-and-presentation', { contentType: 'application/json', body: JSON.stringify({
		byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), ...observation,
	}, null, 2) });
	const verified = verifyLinkedVideoPixels(observation);
	test.info().annotations.push({ type: 'linked-video-file-fidelity', description: verified.classifications.join(', ') });
	return verified.colors[0]!;
}
test('actual editor menus connect saved compositions, update automatically, and pin Undo until Resume', async ({ page: frame, context, browser, browserCoverage, browserCoverageSites, launchOptions, headless, channel, linkedOrigins }) => {
	test.setTimeout(120_000);
	const errors: string[] = []; frame.on('pageerror', error => errors.push(error.message));
	await frame.addInitScript(() => Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined }));
	await frame.goto('/en/'); await expect(frame.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	await menu(frame, 'File', 'Linked compositions…'); const links = frame.getByRole('dialog', { name: 'Linked Motionscaper compositions' });
	await links.getByRole('button', { name: 'Create pairing URL', exact: true }).click(); const pairing = await links.getByRole('textbox', { name: 'Pairing URL', exact: true }).inputValue();
	const motion = await context.newPage(); motion.on('pageerror', error => errors.push(error.message)); await motion.goto(`${motionOrigin}/embed/en/`);
	await menu(motion, 'File', 'New Composition');
	for (const [label, value] of [['Project title', 'Linked title'], ['Width', '64'], ['Height', '64'], ['Duration in frames', '30']] as const) await motion.getByLabel(label, { exact: true }).fill(value);
	await motion.getByRole('button', { name: 'Create', exact: true }).click(); await expect(motion.getByRole('dialog')).toHaveCount(0);
	await solid(motion, '#ff0000'); await save(motion); await menu(motion, 'File', 'Send Composition to Framescaper');
	await motion.getByRole('textbox', { name: 'Framescaper pairing URL', exact: true }).fill(pairing);
	const opened = context.waitForEvent('page'); await motion.getByRole('button', { name: 'Connect and Send Saved Revision', exact: true }).click(); const bridge = await opened;
	await bridge.getByRole('button', { name: 'Connect to Framescaper', exact: true }).click();
	await expect(links.locator('code')).toHaveText(/^[a-f0-9]{64}$/u); const first = await links.locator('code').textContent();
	await close(frame); await expect.poll(() => previewColor(frame)).toEqual([255, 0, 0, 255]); await menu(frame, 'File', 'Linked compositions…');
	await expect(motion.getByRole('dialog').getByRole('status')).toContainText('saved revisions update automatically'); await close(motion);
	await solid(motion, '#00ff00'); const downloaded = motion.waitForEvent('download'); await menu(motion, 'File', 'Save Copy'); await downloaded;
	await expect(links.locator('code')).toHaveText(first!); await save(motion); await expect(links.locator('code')).not.toHaveText(first!); const second = await links.locator('code').textContent();
	await close(frame); await menu(frame, 'Edit', /^Undo/u); await menu(frame, 'File', 'Linked compositions…');
	await expect(links.locator('code')).toHaveText(first!); await expect(links.getByText('Updates pinned by history', { exact: true })).toBeVisible();
	await solid(motion, '#0000ff'); await save(motion); await expect(links.getByText('Pending output change', { exact: true })).toBeVisible(); await expect(links.locator('code')).toHaveText(first!);
	await links.getByRole('button', { name: 'Resume automatic updates', exact: true }).click(); await expect(links.locator('code')).not.toHaveText(first!); await expect(links.locator('code')).not.toHaveText(second!);
	const third = await links.locator('code').textContent();
	await menu(motion, 'View', 'Composition Settings'); await motion.getByLabel('Width', { exact: true }).fill('96'); await motion.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(motion.getByRole('dialog')).toHaveCount(0); await save(motion);
	await expect(links.getByText('Pending output change', { exact: true })).toBeVisible(); await expect(links.locator('code')).toHaveText(third!);
	await links.getByRole('button', { name: 'Conform pending revision', exact: true }).click();
	const review = links.getByRole('region', { name: 'Review composition change', exact: true }); await expect(review).toBeVisible(); await expect(review.getByRole('heading')).toBeFocused(); await expect(links.locator('code')).toHaveText(third!);
	await review.getByRole('button', { name: 'Cancel review', exact: true }).click(); await expect(review).toHaveCount(0); await expect(links.locator('code')).toHaveText(third!); await expect(links.getByRole('button', { name: 'Conform pending revision', exact: true })).toBeFocused();
	await links.getByRole('button', { name: 'Conform pending revision', exact: true }).click(); await review.getByRole('button', { name: 'Apply reviewed changes', exact: true }).click();
	await expect(review).toHaveCount(0); await expect(links.locator('code')).not.toHaveText(third!); const conformed = await links.locator('code').textContent();
	await links.getByRole('button', { name: 'Disconnect', exact: true }).click(); await close(frame); const projectId = await frame.locator('[data-project-id]').getAttribute('data-project-id');
	const download = frame.waitForEvent('download'); await menu(frame, 'File', 'Export project file (.fscape)'); const archive = await download;
	const path = await archive.path(); if (!path) throw new Error('The successor archive download is absent.'); const bytes = await readFile(path);
	await withBrowserCoverageContext({ browser, launchOptions: { ...launchOptions, headless, channel }, browserCoverage, browserCoverageSites, options: { baseURL: frameOrigin, serviceWorkers: 'block' }, title: `${test.info().titlePath.join(' ')} fresh recipient` }, async fresh => {
		const imported = await fresh.newPage(); imported.on('pageerror', error => errors.push(error.message)); await imported.addInitScript(() => Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined })); await imported.goto('/embed/en/'); await expect(imported.locator('[data-audio-editor-bound="true"]')).toBeVisible(); await expect(imported.locator('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true'); await expect(imported.locator('[data-project-id]')).not.toHaveAttribute('data-project-activation-pending', 'true'); await expect(imported.locator('[data-project-id]')).not.toHaveAttribute('data-edit-block-reason', /.+/u);
		const chooser = imported.waitForEvent('filechooser'); await menu(imported, 'File', /^Open\s+Ctrl\+O$/u); await (await chooser).setFiles({ name: archive.suggestedFilename(), mimeType: 'application/zip', buffer: bytes });
		await expect(imported.locator('[data-project-id]')).toHaveAttribute('data-project-id', projectId!);
		await menu(imported, 'File', 'Linked compositions…'); await expect(imported.getByRole('dialog').locator('code')).toHaveText(conformed!); await close(imported);
		await expect.poll(() => previewColor(imported)).toEqual([0, 0, 255, 255]);
		const encodedColor = await exportVideoColor(imported); for (const [index, expected] of [0, 0, 255, 255].entries()) expect(Math.abs(encodedColor[index]! - expected), JSON.stringify(encodedColor)).toBeLessThanOrEqual(12);
	});
	const offlineReadiness = await inspectLinkedOfflineReadiness(frame, linkedOrigins.sites[0]!);
	await test.info().attach('linked-offline-used-font-custody', { contentType: 'application/json', body: JSON.stringify(offlineReadiness, null, 2) });
	await linkedOrigins.close(); await frame.reload(); await expect(frame.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	await expect.poll(() => previewColor(frame)).toEqual([0, 0, 255, 255]); await menu(frame, 'File', 'Linked compositions…'); await expect(links.locator('code')).toHaveText(conformed!);
	expect(errors).toEqual([]);
});

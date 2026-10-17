/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_culling__';
async function fixture(page) {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-culling-native-fixture.tsx', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', outdir: 'culling-fixture', entryNames: 'entry' });
	await page.route(`${ROOT}/**`, async route => {
		const path = new URL(route.request().url()).pathname, html = path.endsWith('/index.html'), css = path.endsWith('.css');
		const output = bundle.outputFiles.find(file => file.path.endsWith(css ? '.css' : '.js'));
		await route.fulfill({ contentType: html ? 'text/html' : css ? 'text/css' : 'text/javascript',
			body: html ? '<!doctype html><title>Culling qualification</title><link rel="stylesheet" href="entry.css">' : output.text });
	});
	await page.goto(`${ROOT}/index.html`);
	await page.evaluate(async root => { (await import(`${root}/entry.js`)).mountCullingNativeV1(); }, ROOT);
	await expect(page.getByRole('button', { name: 'Photo 1.png', exact: true })).toBeVisible();
}
async function state(page) { return page.evaluate(async root => (await import(`${root}/entry.js`)).cullingNativeStateV1(), ROOT); }
async function toggle(page, menu, action) {
	await page.getByText(menu, { exact: true }).click(); await page.getByRole('button', { name: action, exact: true }).click();
	await page.getByText(menu, { exact: true }).click();
}

test('filmstrip opts in without adding preview targets and native keyboard focus preserves modifier selections', async ({ page }) => {
	await fixture(page); await expect(page.getByRole('img')).toHaveCount(0); expect((await state(page)).previewCalls).toBe(0);
	await toggle(page, 'View', 'Thumbnails'); await expect(page.getByRole('img')).toHaveCount(64);
	await expect(page.getByRole('status', { name: 'Preview ready count' })).toHaveText('64');
	const initialCalls = (await state(page)).previewCalls; expect(initialCalls).toBeGreaterThanOrEqual(64);
	await page.getByRole('img').evaluateAll(canvases => { globalThis.cullingQualifiedCanvases = canvases; });
	await toggle(page, 'View', 'Filmstrip'); await expect(page.getByRole('img')).toHaveCount(64);
	expect(await page.locator('.lightscaper-photo-grid').evaluate(grid => getComputedStyle(grid).display)).toBe('flex');
	expect(await page.getByRole('img').evaluateAll(canvases => canvases.every((canvas, index) => canvas === globalThis.cullingQualifiedCanvases[index]))).toBe(true);
	expect((await state(page)).previewCalls).toBe(initialCalls);
	const first = page.getByRole('button', { name: 'Photo 1.png', exact: true }), third = page.getByRole('button', { name: 'Photo 3.png', exact: true });
	await first.click(); await third.click({ modifiers: ['Control'] });
	await expect(page.getByRole('status', { name: 'Selected photo IDs' })).toHaveText('photo-1,photo-3');
	await third.press('Control+ArrowRight'); await expect(page.getByRole('button', { name: 'Photo 4.png', exact: true })).toBeFocused();
	await expect(page.getByRole('status', { name: 'Selected photo IDs' })).toHaveText('photo-1,photo-3');
	await page.keyboard.press('Shift+Home'); await expect(first).toBeFocused();
	await expect(page.getByRole('status', { name: 'Selected photo IDs' })).toHaveText('photo-1,photo-2,photo-3');
	await first.press('Control+a'); expect((await state(page)).selection.selectedIds).toHaveLength(64);
	await first.press('Escape'); await expect(page.getByRole('status', { name: 'Selected photo IDs' })).toHaveText('');
});

test('auto advance follows successful acknowledgment, pauses failed refresh, and fences held saves across generations', async ({ page }) => {
	await fixture(page);
	const first = page.getByRole('button', { name: 'Photo 1.png', exact: true }), second = page.getByRole('button', { name: 'Photo 2.png', exact: true });
	await first.click(); await first.press('5'); await expect(first).toBeFocused(); await expect(first).toContainText('Rating: 5');
	await toggle(page, 'Photo', 'Auto advance'); await first.click(); await first.press('4'); await expect(second).toBeFocused();
	await page.getByRole('combobox', { name: 'Save behavior' }).selectOption('failed'); await second.click(); await second.press('3');
	await expect(second).toBeFocused(); await expect(second).toContainText('Rating: 0');
	await page.getByRole('combobox', { name: 'Save behavior' }).selectOption('refresh-failed'); await second.click(); await second.press('2');
	await expect(second).toBeFocused(); await expect(second).toContainText('Rating: 2');
	await expect(page.getByRole('status', { name: 'Cull notice' })).toHaveText('refresh-failed');
	await page.getByRole('combobox', { name: 'Save behavior' }).selectOption('held-saved'); await second.click(); await second.press('1');
	await expect(page.getByRole('status', { name: 'Pending cull' })).toHaveText('photo-2');
	const admitted = (await state(page)).saves.length; await second.press('5'); expect((await state(page)).saves).toHaveLength(admitted);
	await page.getByRole('button', { name: 'Replace generation' }).click(); expect((await state(page)).heldAborted).toBe(true);
	await page.getByRole('button', { name: 'Release save' }).click(); await expect(page.getByRole('status', { name: 'Pending cull' })).toHaveText('none');
	await expect(page.getByRole('status', { name: 'Selected photo IDs' })).toHaveText(''); expect((await state(page)).maximumActive).toBe(1);
	await page.getByRole('button', { name: 'Next page' }).click();
	await expect(page.getByRole('button', { name: 'Photo 65.png', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Photo 2.png', exact: true })).toHaveCount(0);
});

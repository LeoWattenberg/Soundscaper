/* SPDX-License-Identifier: AGPL-3.0-only */

import { gunzipSync } from 'node:zlib';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { readFile } from 'node:fs/promises';
import { bootEditor, chooseCommandAction, importFiles, openNestedCommandMenu, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('Nyquist Get effects smoke', () => {
	registerAudioEditorHooks();
	test('downloads and runs an archived effect in Chromium', async ({ page }) => {
		test.setTimeout(90_000);
		await page.setViewportSize({ width: 1024, height: 600 });
		const fixture = new URL('../fixtures/nyquist-archive/', import.meta.url);
		const manifest = gunzipSync(await readFile(new URL('manifest.json.gz', fixture)));
		const metadata = await readFile(new URL('../../evidence/nyquist-plugin-publication/catalog-metadata-ed168a19631ec48d0029dfb5c17d16c339a174c1.json', import.meta.url));
		const source = gunzipSync(await readFile(new URL('10bandeq.ny.gz', fixture)));
		await page.route('**/plugins/nyquist/audacityteam.org/**/manifest.json', (route) => route.fulfill({
			body: manifest, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
		}));
		await page.route('**/plugins/nyquist/audacityteam.org/**/files/10bandeq.ny', (route) => route.fulfill({
			body: source, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' },
		}));
		await page.route('**/plugins/nyquist/audacityteam.org/**/catalog-metadata-*.json', (route) => route.fulfill({
			body: metadata, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
		}));
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'archive.wav', frequency: 440, duration: 0.2, channelCount: 1 })]);
		let menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
		await menu.getByRole('menuitem', { name: 'Studio Fade Out', exact: true }).click();
		const bundled = page.getByRole('dialog', { name: 'Studio Fade Out' });
		await expect(bundled).toBeVisible();
		await bundled.getByRole('button', { name: 'Cancel', exact: true }).click();
		menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
		await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
		const catalog = page.getByRole('dialog', { name: 'Get effects' });
		await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('one band at a time');
		await expect(catalog.locator('strong').filter({ hasText: 'Ten Band EQ' })).toBeVisible({ timeout: 20_000 });
		await expect(catalog.getByText('An Equalizer (EQ) that can modify one band at a time.')).toBeVisible();
		await catalog.getByRole('button', { name: 'Install Ten Band EQ' }).click();
		await expect(catalog.getByRole('button', { name: 'Remove Ten Band EQ' })).toBeVisible({ timeout: 20_000 });
		await catalog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(catalog).toBeHidden();
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
		await menu.getByRole('menuitem', { name: 'Ten Band EQ', exact: true }).click();
		const plugin = page.getByRole('dialog', { name: 'Ten Band EQ' });
		await expect(plugin).toBeVisible();
		await expect(plugin.getByText('An Equalizer (EQ) that can modify one band at a time.')).toBeVisible();
		await plugin.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(plugin).toBeHidden({ timeout: 20_000 });
	});
});

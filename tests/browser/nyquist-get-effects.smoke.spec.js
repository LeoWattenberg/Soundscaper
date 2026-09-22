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
		const source = gunzipSync(await readFile(new URL('10bandeq.ny.gz', fixture)));
		await page.route('**/plugins/nyquist/audacityteam.org/**/manifest.json', (route) => route.fulfill({
			body: manifest, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
		}));
		await page.route('**/plugins/nyquist/audacityteam.org/**/files/10bandeq.ny', (route) => route.fulfill({
			body: source, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' },
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
		await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('10bandeq');
		await expect(catalog.getByText('10bandeq.ny')).toBeVisible({ timeout: 20_000 });
		await catalog.getByRole('button', { name: 'Install' }).click();
		await expect(catalog.getByText('Ten band E Q...')).toBeVisible({ timeout: 20_000 });
		await catalog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(catalog).toBeHidden();
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
		await menu.getByRole('menuitem', { name: 'Ten band E Q...', exact: true }).click();
		const plugin = page.getByRole('dialog', { name: 'Ten band E Q...' });
		await expect(plugin).toBeVisible();
		await plugin.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(plugin).toBeHidden({ timeout: 20_000 });
	});
});

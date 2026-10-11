/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/browser-coverage-fixture.js';

test('Motionscaper boots its own shell and opens its workspace only from the menu', async ({ page }) => {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/embed/en/');
	await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-product', 'motionscaper');
	await expect(page).toHaveTitle('Motionscaper');
	await expect(page.locator('[data-audio-editor], [data-frame-editor]')).toHaveCount(0);
	await expect(page.locator('[data-motion-workspace]')).toHaveCount(0);
	await expect(page.getByRole('combobox', { name: /Search commands/u })).toHaveCount(0);
	expect(await page.evaluate(async () => (await indexedDB.databases()).some(({ name }) => name?.includes('motionscaper')))).toBe(false);
	await page.getByRole('menuitem', { name: 'View', exact: true }).click();
	await page.getByRole('menuitemcheckbox', { name: 'Motion Workspace', exact: true }).click();
	await expect(page.locator('[data-motion-workspace]')).toBeVisible();
	await page.getByRole('menuitem', { name: 'View', exact: true }).click();
	const workspace = page.getByRole('menuitemcheckbox', { name: 'Motion Workspace', exact: true });
	await expect(workspace).toHaveAttribute('aria-checked', 'true');
	await workspace.click();
	await expect(page.locator('[data-motion-workspace]')).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('Motionscaper exposes a localized keyboard-accessible menu', async ({ page }) => {
	await page.goto('/embed/de/');
	await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
	const view = page.getByRole('menuitem', { name: 'Ansicht', exact: true });
	await view.focus();
	await page.keyboard.press('Enter');
	const workspace = page.getByRole('menuitemcheckbox', { name: 'Motion-Arbeitsbereich', exact: true });
	await expect(workspace).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Motion-Arbeitsbereich', exact: true })).toBeVisible();
	await page.getByRole('menuitem', { name: 'Datei', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: /^Neue Komposition/u })).toBeVisible();
});

test('Motionscaper keeps peer editors inside the Other editors menu', async ({ page }) => {
	await page.goto('/en/');
	await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
	const peers = page.locator('details').filter({ has: page.getByText('Other editors', { exact: true }) });
	await expect(page.getByRole('navigation', { name: 'Motionscaper navigation' })).toBeVisible();
	await expect(peers.getByRole('link', { name: 'Audio editor', exact: true })).toBeHidden();
	await peers.getByText('Other editors', { exact: true }).click();
	await expect(peers.getByRole('link', { name: 'Audio editor', exact: true })).toHaveAttribute('href', 'https://soundscaper.org/en/');
	await expect(peers.getByRole('link', { name: 'Video editor', exact: true })).toHaveAttribute('href', 'https://framescaper.org/en/');
});

test.describe('Motionscaper offline shell', () => {
	test.use({ serviceWorkers: 'allow' });
	test('reopens the product and its previously opened workspace offline', async ({ page, context }) => {
		await page.goto('/en/');
		await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-motionscaper.webmanifest');
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
			if (navigator.serviceWorker.controller) return;
			await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
		});
		await page.getByRole('menuitem', { name: 'View', exact: true }).click();
		await page.getByRole('menuitemcheckbox', { name: 'Motion Workspace', exact: true }).click();
		await expect(page.locator('[data-motion-workspace]')).toBeVisible();
		await expect.poll(() => page.evaluate(async () => (
			(await caches.keys()).filter((name) => name.startsWith('soundscaper-application-shell-v2-motionscaper-'))
		))).toHaveLength(1);
		await context.setOffline(true);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('data-product', 'motionscaper');
		await expect(page.locator('[data-motion-workspace]')).toHaveCount(0);
		await page.getByRole('menuitem', { name: 'View', exact: true }).click();
		await page.getByRole('menuitemcheckbox', { name: 'Motion Workspace', exact: true }).click();
		await expect(page.locator('[data-motion-workspace]')).toBeVisible();
	});
});


test('Help opens the Motion handbook through keyboard menus without initializing a project', async ({ page, context }) => {
	await context.route('https://motionscaper.org/docs/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Motionscaper handbook</h1>' }));
	await page.goto('/embed/de/');
	await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
	const help = page.getByRole('menuitem', { name: 'Hilfe', exact: true });
	await help.focus(); await page.keyboard.press('Enter');
	await expect(page.getByRole('menuitem', { name: 'Motionscaper-Handbuch', exact: true })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('menuitem', { name: 'Dein erstes Motion-Projekt', exact: true })).toBeFocused();
	const opened = context.waitForEvent('page');
	await page.keyboard.press('Enter');
	const handbook = await opened;
	await expect(handbook).toHaveURL('https://motionscaper.org/docs/de/first-project/');
	await expect(handbook.getByRole('heading')).toHaveText('Motionscaper handbook');
	expect(await page.evaluate(async () => (await indexedDB.databases()).some(({ name }) => name?.includes('motionscaper')))).toBe(false);
	await expect(page.locator('[data-motion-workspace]')).toHaveCount(0);
	await handbook.close();
});

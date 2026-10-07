/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/browser-coverage-fixture.js';

for (const [locale, copy] of [
	['en', { view: 'View', file: 'File', show: 'Show photo library', hide: 'Hide photo library', library: 'Photo library', empty: 'Your photo library is empty.', menu: 'Application menu' }],
	['de', { view: 'Ansicht', file: 'Datei', show: 'Fotobibliothek anzeigen', hide: 'Fotobibliothek ausblenden', library: 'Fotobibliothek', empty: 'Deine Fotobibliothek ist leer.', menu: 'Anwendungsmenü' }],
]) {
	test(`${locale}: the photo shell opens and closes its empty library from the keyboard`, async ({ page, baseURL }) => {
		const origin = lightscaperOrigin(baseURL);
		await page.goto(`${origin}/${locale}/`);
		await expect(page).toHaveTitle('Lightscaper');
		await expect(page.getByRole('heading', { name: 'Lightscaper', level: 2 })).toBeVisible();
		await expect(page.getByRole('region', { name: copy.library, exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: copy.show, exact: true })).toBeHidden();
		const menu = page.getByRole('navigation', { name: copy.menu, exact: true });
		const view = menu.locator('summary').filter({ hasText: copy.view });
		const show = menu.getByRole('button', { name: copy.show, exact: true });
		await view.focus();
		await page.keyboard.press('Enter');
		await page.keyboard.press('Tab');
		await expect(show).toBeFocused();
		await page.keyboard.press('Enter');
		const library = page.getByRole('region', { name: copy.library, exact: true });
		await expect(library).toBeVisible();
		await expect(library.getByRole('status')).toHaveText(copy.empty);
		await expect(view).toBeFocused();
		await page.keyboard.press('Space');
		await page.keyboard.press('Tab');
		await expect(menu.getByRole('button', { name: copy.hide, exact: true })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(library).toHaveCount(0);
		await expect(view).toBeFocused();
	});

	test(`${locale}: the File menu links to both peer products and install metadata identifies Lightscaper`, async ({ page, baseURL, request }) => {
		const origin = lightscaperOrigin(baseURL);
		await page.goto(`${origin}/${locale}/`);
		const menu = page.getByRole('navigation', { name: copy.menu, exact: true });
		const file = menu.locator('summary').filter({ hasText: copy.file });
		await file.click();
		for (const [name, domain] of [['Soundscaper', 'soundscaper.org'], ['Framescaper', 'framescaper.org']]) {
			await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('href', `https://${domain}/${locale}/`);
		}
		await menu.getByRole('link', { name: 'Framescaper', exact: true }).focus();
		await page.keyboard.press('Escape');
		await expect(file).toBeFocused();
		await expect(menu.getByRole('link', { name: 'Framescaper', exact: true })).toBeHidden();
		const manifest = await request.get(`${origin}/manifest-lightscaper.webmanifest`);
		expect(manifest.ok()).toBe(true);
		const body = await manifest.json();
		expect(body.name).toBe('Lightscaper');
		expect(body.start_url).toBe('/en/');
		expect(body.file_handlers).toBeUndefined();
		expect(body.share_target).toBeUndefined();
	});

	test(`${locale}: menus dismiss when another menu opens or focus leaves the menu`, async ({ page, baseURL }) => {
		await page.goto(`${lightscaperOrigin(baseURL)}/${locale}/`);
		const app = page.getByRole('region', { name: 'Lightscaper', exact: true });
		await expect(app).toHaveAttribute('data-lightscaper-bound', 'true');
		const menu = app.getByRole('navigation', { name: copy.menu, exact: true });
		const file = menu.locator('summary').filter({ hasText: copy.file });
		const view = menu.locator('summary').filter({ hasText: copy.view });
		const peer = menu.getByRole('link', { name: 'Soundscaper', exact: true });
		const show = menu.getByRole('button', { name: copy.show, exact: true });
		await file.click();
		await expect(peer).toBeVisible();
		await view.click();
		await expect(peer).toBeHidden();
		await expect(show).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(view).toBeFocused();
		await expect(show).toBeHidden();
		await file.click();
		await peer.focus();
		await view.focus();
		await expect(peer).toBeHidden();
		await file.click();
		await app.getByRole('heading', { name: 'Lightscaper', exact: true }).click();
		await expect(peer).toBeHidden();
	});

	for (const [source, sourceName] of productNames()) {
		for (const [destination, destinationName] of productNames().filter(([id]) => id !== source)) {
			test(`${locale}: switching ${source} to ${destination} mounts the destination on its own origin`, async ({ page }) => {
				const declared = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS;
				test.skip(!declared, 'Product switching requires the ordinary three-origin browser configuration.');
				const origins = JSON.parse(declared);
				const canonical = `https://${destination}.org/${locale}/`;
				const destinationUrl = `${origins[destination]}/${locale}/`;
				let navigations = 0;
				await page.route(/^https:\/\/(?:soundscaper|framescaper|lightscaper)\.org\//u, async (route) => {
					const request = route.request();
					if (!request.isNavigationRequest() || request.url() !== canonical) {
						await route.abort();
						return;
					}
					navigations += 1;
					// WebKit interception cannot fulfill HTTP redirects. An inert refresh
					// still follows the clicked document navigation into the peer origin.
					await route.fulfill({
						status: 200, contentType: 'text/html',
						body: `<!doctype html><meta http-equiv="refresh" content="0;url=${destinationUrl}">`,
					});
				});
				await page.goto(`${origins[source]}/${locale}/`);
				await expect(page).toHaveTitle(sourceName);
				await expectApplicationReady(page, source);
				const menu = source === 'lightscaper'
					? page.getByRole('navigation', { name: copy.menu, exact: true }).locator('details').filter({ has: page.locator('summary').filter({ hasText: copy.file }) })
					: page.locator('[data-product-menu]');
				await menu.locator('summary').click();
				const link = menu.locator(`a[href="${canonical}"]`);
				await expect(link).toHaveAttribute('href', canonical);
				await link.click();
				await expect(page).toHaveURL(destinationUrl);
				await expect(page).toHaveTitle(destinationName);
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await expect(page.locator('[data-sidebar]')).toHaveAttribute('data-product', destination);
				await expect(page.getByRole('heading', { name: destinationName, level: 1 })).toBeVisible();
				await expectApplicationReady(page, destination);
				expect(navigations).toBe(1);
			});
		}
	}
}

function productNames() {
	return [['soundscaper', 'Soundscaper'], ['framescaper', 'Framescaper'], ['lightscaper', 'Lightscaper']];
}

async function expectApplicationReady(page, product) {
	if (product === 'lightscaper') {
		await expect(page.locator('[data-lightscaper-bound="true"]')).toBeVisible();
		await expect(page.locator('[data-audio-editor-bound="true"]')).toHaveCount(0);
		return;
	}
	await expect(page.locator('[data-audio-editor-bound="true"]')).toHaveAttribute('data-editor-ready', 'true', { timeout: 20_000 });
}

function lightscaperOrigin(baseURL) {
	const declared = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS;
	if (declared) return JSON.parse(declared).lightscaper;
	if (!baseURL) throw new Error('The Lightscaper browser workflow requires a preview origin.');
	return baseURL;
}

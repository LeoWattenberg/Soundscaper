/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });

test('the opted-in photo grid stays below its menu and supports wheel scrolling and keyboard access to the last row', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native catalog custody remains deferred on WebKit.');
	test.setTimeout(60_000);
	const fixture = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-photo-query-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__lightscaper_layout_fixture.js', async route => {
		await route.fulfill({ contentType: 'text/javascript', body: fixture.outputFiles[0].text });
	});
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/en/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	await expect(app.locator('[data-photo-library]')).toHaveCount(0);
	await page.evaluate(async () => { await (await import(new URL('/__lightscaper_layout_fixture.js', location.href).href)).seedPhotoLibraryQueryNativeV1(); });
	await app.locator('summary').filter({ hasText: /^View$/u }).focus(); await page.keyboard.press('Enter');
	await app.getByRole('button', { name: 'Show photo library', exact: true }).focus(); await page.keyboard.press('Enter');
	const library = app.locator('[data-photo-library]'), photos = library.locator('[data-photo-id]');
	await expect(photos).toHaveCount(64);
	const bounds = await app.boundingBox(), header = await app.locator('header').boundingBox(), grid = await library.boundingBox();
	expect(bounds).not.toBeNull(); expect(header).not.toBeNull(); expect(grid).not.toBeNull();
	expect(grid.y).toBeGreaterThanOrEqual(header.y + header.height);
	await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + bounds.height / 2);
	await page.mouse.wheel(0, 500);
	await expect.poll(() => app.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
	await photos.first().focus(); await page.keyboard.press('End');
	await expect(photos.last()).toBeFocused(); await expect(photos.last()).toBeInViewport({ ratio: 1 });
	await expect(photos).toHaveCount(64); await expect(library.getByRole('alert')).toHaveCount(0);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

// The handbook is served from a path on the product origin, so every route in
// this suite carries the base the deployment serves it under - in the URLs it
// navigates to and in the URLs it expects a followed link to land on. A link
// authored root-absolute in Markdown is rebased at build time, and asserting
// the base is how a link that missed that rebase is caught here rather than in
// production, where it would land on the editor instead of a handbook page.
const BASE = handbookPlan('soundscaper').scope;

test('routes readers to product-specific first-project guides', async ({ page }) => {
	await page.goto(BASE);
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper Handbook' })).toBeVisible();
	await page.getByRole('link', { name: 'Choose an editor' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}start/choose-an-editor/$`, 'u'));
	await expect(page.getByRole('heading', { level: 1, name: 'Choose an editor' })).toBeVisible();

	await page.getByRole('link', { name: 'Start a Framescaper project' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}framescaper/first-project/$`, 'u'));
	await expect(page.getByRole('heading', { level: 1, name: 'Your first Framescaper project' })).toBeVisible();
});

test('local search indexes generated runtime references without cross-origin requests', async ({ page, baseURL }) => {
	const firstPartyOrigin = new URL(baseURL).origin;
	const crossOriginRequests = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (/^https?:$/u.test(url.protocol) && url.origin !== firstPartyOrigin) crossOriginRequests.push(url.href);
	});
	await page.goto(BASE);
	await page.getByRole('button', { name: 'Search' }).click();
	await page.getByPlaceholder('Search').fill('WavPack');
	const dialog = page.getByRole('dialog', { name: 'Search' });
	await expect(dialog.getByText(/\d+ results? for WavPack/u)).toBeVisible();
	await dialog.getByRole('link', { name: 'Export formats' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}reference/generated/formats/$`, 'u'));
	await expect(page.getByRole('cell', { name: 'WavPack', exact: true })).toBeVisible();
	expect(crossOriginRequests).toEqual([]);
});

test('mobile readers can navigate the handbook sidebar', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`${BASE}soundscaper/first-project/`);
	await page.getByRole('button', { name: /menu/iu }).click();
	await page.getByRole('link', { name: 'Storage, backups, and privacy' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}projects-and-data/storage-backups-and-privacy/$`, 'u'));
});

// The generated reference pages carry the widest and longest tables in the
// handbook, so one of each shape is checked: a short one and the effect
// inventory, whose parameter table is the largest the generator produces.
for (const route of [
	BASE,
	`${BASE}soundscaper/first-project/`,
	`${BASE}reference/generated/formats/`,
	`${BASE}reference/generated/audio-effects/`,
]) {
	test(`has no serious accessibility violations at ${route}`, async ({ page }) => {
		await page.goto(route);
		const results = await new AxeBuilder({ page }).analyze();
		const serious = results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
		expect(serious).toEqual([]);
	});
}

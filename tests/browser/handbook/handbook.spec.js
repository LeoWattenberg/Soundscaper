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

test('starts a newcomer on a tutorial and hands them on to the how-to guides', async ({ page }) => {
	await page.goto(`${BASE}tutorials/`);
	await expect(page.getByRole('heading', { level: 1, name: 'Tutorials' })).toBeVisible();
	await page.getByRole('link', { name: 'Your first Soundscaper project' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}tutorials/your-first-project/$`, 'u'));
	// The example the tutorial is a lesson on is handed to the reader, not
	// merely named, and it comes from the assets bucket rather than the site.
	await expect(page.getByRole('link', { name: 'guide-music-loop.wav' })).toHaveAttribute('href', /^https:\/\/assets\.soundscaper\.org\/guides\/examples\/guide-music-loop\.wav$/u);
	await page.getByRole('link', { name: 'Fade in and fade out' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/fade-in-and-fade-out/$`, 'u'));
});

test('reaches a guide through its category, and back out again', async ({ page }) => {
	await page.goto(`${BASE}guides/`);
	await expect(page.getByRole('heading', { level: 1, name: 'How-to guides' })).toBeVisible();

	// The index groups the guides by category, and each category heading is a
	// link to the category's own page rather than a bare label.
	await page.getByRole('heading', { level: 2, name: 'Volume and dynamics' }).getByRole('link').click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/$`, 'u'));
	await expect(page.getByRole('heading', { level: 1, name: 'Volume and dynamics' })).toBeVisible();

	await page.getByRole('link', { name: 'Normalize peaks to a set level' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/normalize-peaks/$`, 'u'));
	await expect(page.getByRole('heading', { level: 1, name: 'Normalize peaks to a set level' })).toBeVisible();

	// Every guide leads back to the rest of its category and on to a related one.
	await page.getByRole('link', { name: 'Even out volume with a compressor' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/even-out-volume-with-a-compressor/$`, 'u'));
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
	await page.goto(`${BASE}soundscaper/recording/`);
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
	`${BASE}guides/`,
	`${BASE}guides/volume/normalize-peaks/`,
	`${BASE}tutorials/clean-up-a-voice-recording/`,
]) {
	test(`has no serious accessibility violations at ${route}`, async ({ page }) => {
		await page.goto(route);
		const results = await new AxeBuilder({ page }).analyze();
		const serious = results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
		expect(serious).toEqual([]);
	});
}

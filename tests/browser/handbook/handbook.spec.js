import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('routes readers to product-specific first-project guides', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper Handbook' })).toBeVisible();
	await page.getByRole('link', { name: 'Choose an editor' }).first().click();
	await expect(page).toHaveURL(/\/start\/choose-an-editor\/$/u);
	await expect(page.getByRole('heading', { level: 1, name: 'Choose an editor' })).toBeVisible();

	await page.getByRole('link', { name: 'Start a Framescaper project' }).click();
	await expect(page).toHaveURL(/\/framescaper\/first-project\/$/u);
	await expect(page.getByRole('heading', { level: 1, name: 'Your first Framescaper project' })).toBeVisible();
});

test('local search indexes generated runtime references without cross-origin requests', async ({ page, baseURL }) => {
	const firstPartyOrigin = new URL(baseURL).origin;
	const crossOriginRequests = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (/^https?:$/u.test(url.protocol) && url.origin !== firstPartyOrigin) crossOriginRequests.push(url.href);
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'Search' }).click();
	await page.getByPlaceholder('Search').fill('WavPack');
	const dialog = page.getByRole('dialog', { name: 'Search' });
	await expect(dialog.getByText(/1 result for WavPack/u)).toBeVisible();
	await dialog.getByRole('link', { name: 'Export formats' }).click();
	await expect(page).toHaveURL(/\/reference\/generated\/formats\/$/u);
	await expect(page.getByRole('cell', { name: 'WavPack', exact: true })).toBeVisible();
	expect(crossOriginRequests).toEqual([]);
});

test('mobile readers can navigate the handbook sidebar', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/soundscaper/first-project/');
	await page.getByRole('button', { name: /menu/iu }).click();
	await page.getByRole('link', { name: 'Storage, backups, and privacy' }).click();
	await expect(page).toHaveURL(/\/projects-and-data\/storage-backups-and-privacy\/$/u);
});

for (const route of ['/', '/soundscaper/first-project/', '/reference/generated/formats/']) {
	test(`has no serious accessibility violations at ${route}`, async ({ page }) => {
		await page.goto(route);
		const results = await new AxeBuilder({ page }).analyze();
		const serious = results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
		expect(serious).toEqual([]);
	});
}

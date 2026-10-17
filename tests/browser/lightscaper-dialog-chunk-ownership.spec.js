/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/browser-coverage-fixture.js';

for (const [locale, title, heading] of [
	['en', 'Privacy Policy', '1. Scope and overview'],
	['de', 'Datenschutzerklärung', '1. Geltungsbereich und Überblick'],
]) {
	test(`${locale}: the Lightscaper public privacy dialog opens without an editor bootstrap`, async ({ page }) => {
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		const errors = [];
		page.on('pageerror', error => { errors.push(error.message); });
		await page.goto(`${origin}/privacy/${locale}/`);
		const dialog = page.getByRole('dialog', { name: title, exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible();
		await expect(dialog.getByText('privacy@support.soundscaper.org', { exact: true }).first()).toBeVisible();
		await expect(page.locator('[data-audio-editor], [data-lightscaper-bound]')).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

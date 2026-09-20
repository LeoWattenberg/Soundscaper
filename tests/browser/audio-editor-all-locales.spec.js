/* SPDX-License-Identifier: AGPL-3.0-only */

import { COMMITTED_LOCALE_TAGS, LOCALE_BY_TAG } from '../../src/common/i18n/locales.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { collectClientErrors } from './audio-editor-test-helpers.js';

test('every committed locale boots its lazy production catalog', async ({ browserName, page }) => {
	test.skip(browserName !== 'chromium', 'The end-to-end coverage surface is Chromium.');
	test.setTimeout(240_000);
	const clientErrors = collectClientErrors(page);

	for (const locale of COMMITTED_LOCALE_TAGS) {
		await test.step(locale, async () => {
			await page.goto(`/embed/${locale}/`);
			const editor = page.locator('[data-audio-editor]');
			await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
			await expect(page.locator('html')).toHaveAttribute('lang', locale);
			await expect(page.locator('html')).toHaveAttribute('dir', LOCALE_BY_TAG[locale].direction);
		});
	}

	expect(clientErrors).toEqual([]);
});

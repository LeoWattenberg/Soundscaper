/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors } from './audio-editor-test-helpers.js';
import { stubStorageEstimate } from './helpers/browser-environment-stubs.js';

for (const language of ['en', 'fr']) {
	test(`storage capacity uses the ${language} workspace's ordinary number format`, async ({ page }) => {
		const errors = collectClientErrors(page);
		await stubStorageEstimate(page, { usage: 2.5 * 1024 ** 3, quota: 10 * 1024 ** 3 });
		const editor = await bootEditor(page, `/embed/${language}/`);
		await editor.getByRole('menubar').getByRole('menuitem', { name: language === 'fr' ? 'Aide' : 'Help', exact: true }).press('Enter');
		await page.getByRole('menuitemcheckbox', { name: language === 'fr' ? 'Déboguer le stockage' : 'Debug storage', exact: true }).click();
		const panel = editor.locator('[data-storage-capacity]');
		await panel.locator('summary').click();
		await panel.getByRole('button', { name: language === 'fr' ? "Actualiser l'estimation" : 'Refresh estimate', exact: true }).click();
		const formatter = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
		await expect(panel.locator('summary')).toContainText(`${formatter.format(7.5)} GB`);
		await expect(panel.locator('dd').first()).toContainText(`${formatter.format(2.5)} GB`);
		await expect(panel.locator('dd').first()).toContainText(`${formatter.format(10)} GB`);
		expect(errors).toEqual([]);
	});
}
